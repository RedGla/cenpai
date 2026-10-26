"""The single entry point every upload goes through (UI or direct API call): validate, process, clean up.

Nothing here knows about Gradio. A job's files live only under its private directory; on any failure
the whole directory is removed, so a partially processed file can never be offered as a result.
"""
from __future__ import annotations

import logging
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

from . import media
from .censor import MODES
from .config import Limits
from .jobs import GRADIO_SUBDIR, JobStore, RateLimiter
from .validate import IMAGE_EXTS, RejectedMedia, validate_upload

log = logging.getLogger("cenpai.service")

REMINDER = "Review the result before sharing — automatic detection can miss plates. Audio and faces are not anonymized."
NO_PLATES = "No plates were detected. This does not mean the file is safe to share."

State = Literal["complete", "failed", "canceled", "unavailable"]


@dataclass
class Outcome:
    state: State
    message: str
    output: Path | None = None
    kind: str | None = None          # "image" | "video" when a result exists
    job_id: str | None = None
    result: media.Result | None = None


def _fail(msg: str, state: State = "failed") -> Outcome:
    return Outcome(state, f"**{state.capitalize()}.** {msg} No output is available.")


class Service:
    def __init__(self, detector, store: JobStore, limits: Limits, limiter: RateLimiter | None = None):
        self.detector = detector
        self.store = store
        self.limits = limits
        self.limiter = limiter or RateLimiter(limits.rate_per_ip_per_hour)
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    # -- helpers --------------------------------------------------------------------------------
    def _under_upload_cache(self, p: Path) -> bool:
        """Only the framework upload cache is acceptable input; never another job's directory."""
        try:
            p.resolve().relative_to((self.store.root / GRADIO_SUBDIR).resolve())
            return True
        except (ValueError, OSError):
            return False

    def cancel(self, session: str) -> None:
        with self._lock:
            ev = self._cancel.get(session)
        if ev:
            ev.set()

    def job_alive(self, job_id: str | None, session: str) -> bool:
        return bool(job_id) and self.store.get(job_id, session) is not None

    def delete(self, job_id: str | None, session: str) -> None:
        if job_id:
            try:
                self.store.delete(job_id, owner=session)
            except ValueError:
                pass

    # -- main -----------------------------------------------------------------------------------
    def process(self, file_path: str | None, mode: str, session: str, client: str,
                progress: Callable[[float, str], None] = lambda f, d="": None) -> Outcome:
        if self.detector is None:
            return _fail("The detection model is not available on this server, so no files can be processed.", "unavailable")
        if mode not in MODES:
            return _fail("Unknown censoring mode.")
        if not file_path:
            return _fail("Choose a file first.")
        src = Path(file_path)
        if not self._under_upload_cache(src) or not src.is_file():
            return _fail("The upload could not be found.")
        if not self.limiter.allow(client):
            return _fail("Too many uploads from your network in the last hour. Please try again later.")

        ext = src.suffix.lower().lstrip(".")
        if ext not in IMAGE_EXTS | {"mp4"}:
            self._drop_upload(src)
            return _fail("Unsupported file type. Use JPG, JPEG, PNG or MP4.")

        self.store.delete_owner(session)                # one active job per session
        cancel = threading.Event()
        with self._lock:
            self._cancel[session] = cancel
        job = self.store.create(session)
        t0 = time.perf_counter()
        try:
            upload = job.dir / f"upload.{ext}"           # generated name; the original name is dropped
            shutil.copyfile(src, upload)
            self._drop_upload(src)
            info = validate_upload(upload, self.limits)
            if info.kind == "image":
                res = media.process_image(upload, info, job, self.detector, mode)
            else:
                res = media.process_video(upload, info, job, self.detector, mode, progress, cancel,
                                          time.time() + self.limits.job_timeout_s)
            upload.unlink(missing_ok=True)               # keep only the censored output
        except RejectedMedia as e:
            return self._abort(job, f"Upload rejected: {e}")
        except media.JobCancelled:
            return self._abort(job, "Processing was canceled.", "canceled")
        except media.JobTimeout:
            return self._abort(job, "Processing took too long and was stopped.")
        except media.ProcessingError as e:
            return self._abort(job, str(e))
        except Exception as e:                           # never leak details; log the type only
            log.error("job=%s unexpected %s", job.id[:8], type(e).__name__)
            return self._abort(job, "An unexpected error occurred.")
        finally:
            with self._lock:
                self._cancel.pop(session, None)

        log.info("job=%s kind=%s state=complete plates=%d frames=%d secs=%.2f model=%s", job.id[:8], info.kind,
                 res.plates, res.frames, time.perf_counter() - t0, getattr(self.detector, "version", "?"))
        return Outcome("complete", self._complete_message(info.kind, res), res.output, info.kind, job.id, res)

    def _abort(self, job, msg: str, state: State = "failed") -> Outcome:
        self.store.delete(job.id)
        log.info("job=%s state=%s", job.id[:8], state)
        return _fail(msg, state)

    def _drop_upload(self, src: Path) -> None:
        """Remove the framework's copy of the upload as soon as we have our own."""
        try:
            if src.is_file():
                src.unlink()
                src.parent.rmdir()        # the framework's per-upload hash dir; only removed when empty
        except OSError:
            pass

    @staticmethod
    def _complete_message(kind: str, res: media.Result) -> str:
        if res.plates == 0:
            head = NO_PLATES
        elif kind == "image":
            head = f"{res.plates} plate region(s) censored."
        else:
            head = f"{res.plates} plate detection(s) censored across {res.frames_with_plates} of {res.frames} frames."
        return f"**Complete.** {head}\n\n{REMINDER}"
