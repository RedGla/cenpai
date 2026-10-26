"""FR07: private temporary job storage, deletion, expiry, and per-IP rate limiting.

Layout under `root`:  <job-id>/...  (our jobs)   and   gradio/...  (framework upload/output cache,
set as GRADIO_TEMP_DIR by the app). Everything under root is swept; nothing is kept across restarts.
"""
from __future__ import annotations

import logging
import re
import shutil
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("cenpai.jobs")
_ID = re.compile(r"^[0-9a-f]{32}$")
GRADIO_SUBDIR = "gradio"


@dataclass(frozen=True)
class Job:
    id: str
    dir: Path
    created: float
    owner: str


def _rm(path: Path) -> bool:
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        elif path.exists() or path.is_symlink():
            path.unlink()
        return True
    except OSError:
        log.warning("cleanup failed for one entry")   # never log the path
        return False


class JobStore:
    def __init__(self, root: Path, retention_s: int):
        self.root = Path(root)
        self.retention_s = retention_s
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / GRADIO_SUBDIR).mkdir(exist_ok=True)
        self._jobs: dict[str, Job] = {}
        self._first_seen: dict[Path, float] = {}
        self._lock = threading.Lock()

    def create(self, owner: str, now: float | None = None) -> Job:
        job_id = uuid.uuid4().hex
        d = self.root / job_id
        d.mkdir(mode=0o700)
        job = Job(job_id, d, time.time() if now is None else now, owner)
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str, owner: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id) if _ID.match(job_id or "") else None
        return job if job and job.owner == owner else None

    def delete(self, job_id: str, owner: str | None = None) -> bool:
        """Idempotent. With `owner`, only that session's job is deleted."""
        if not _ID.match(job_id or ""):
            raise ValueError("invalid job id")
        with self._lock:
            job = self._jobs.get(job_id)
            if job and owner is not None and job.owner != owner:
                return False
            self._jobs.pop(job_id, None)
        ok = _rm(self.root / job_id)
        # the framework keeps its own copy of any file it served; ours are named cenpai_<id8>.*
        for f in (self.root / GRADIO_SUBDIR).glob(f"*/cenpai_{job_id[:8]}*"):
            ok = _rm(f) and ok
            try:
                f.parent.rmdir()          # only succeeds when empty
            except OSError:
                pass
        return ok

    def delete_owner(self, owner: str) -> int:
        with self._lock:
            ids = [j.id for j in self._jobs.values() if j.owner == owner]
        return sum(self.delete(i) for i in ids)

    def _framework_entries(self) -> list[Path]:
        g = self.root / GRADIO_SUBDIR
        return list(g.iterdir()) if g.is_dir() else []

    def sweep(self, now: float | None = None) -> int:
        """Remove expired jobs and expired framework-cache entries. Returns the number removed."""
        now = time.time() if now is None else now
        removed = 0
        with self._lock:
            expired = [j.id for j in self._jobs.values() if now - j.created > self.retention_s]
        for i in expired:
            removed += self.delete(i)
        # anything else under root: unknown dirs (e.g. left by a crash) and framework cache entries
        with self._lock:
            known = set(self._jobs)
        strays = [p for p in self.root.iterdir() if p.name != GRADIO_SUBDIR and p.name not in known]
        current = strays + self._framework_entries()
        for p in current:
            first = self._first_seen.setdefault(p, now)
            if now - first > self.retention_s:
                removed += _rm(p)
        for p in list(self._first_seen):
            if p not in current or not p.exists():
                del self._first_seen[p]
        return removed

    def wipe_all(self) -> None:
        with self._lock:
            self._jobs.clear()
            self._first_seen.clear()
        for p in list(self.root.iterdir()):
            if p.name == GRADIO_SUBDIR:
                for q in list(p.iterdir()):
                    _rm(q)
            else:
                _rm(p)

    def start_sweeper(self, interval_s: int) -> threading.Thread:
        def loop():
            while True:
                time.sleep(interval_s)
                try:
                    self.sweep()
                except Exception:   # a failed tick must not kill cleanup for good
                    log.exception("sweep failed")
        t = threading.Thread(target=loop, name="cenpai-sweeper", daemon=True)
        t.start()
        return t


class RateLimiter:
    """Sliding one-hour window per key (client IP)."""
    MAX_KEYS = 10_000

    def __init__(self, per_hour: int):
        self.per_hour = per_hour
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > 3600:
                q.popleft()
            if len(self._hits) > self.MAX_KEYS:   # shortcut: drop idle keys, enough for a demo
                self._hits = {k: v for k, v in self._hits.items() if v}
            if len(q) >= self.per_hour:
                return False
            q.append(now)
            return True
