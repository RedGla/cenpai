import pytest

from cenpai.config import Limits
from cenpai.jobs import GRADIO_SUBDIR, JobStore, RateLimiter


@pytest.fixture
def store(tmp_path):
    return JobStore(tmp_path / "jobs", retention_s=3300)


def test_create_uses_generated_names_and_private_dir(store):
    j = store.create("sess-a")
    assert len(j.id) == 32 and j.dir.is_dir() and j.dir.parent == store.root


def test_delete_removes_all(store):
    j = store.create("a")
    (j.dir / "in.jpg").write_bytes(b"x")
    (j.dir / "sub").mkdir()
    (j.dir / "sub" / "out.mp4").write_bytes(b"y")
    assert store.delete(j.id) is True
    assert not j.dir.exists()
    assert store.delete(j.id) is True   # idempotent


def test_delete_also_removes_framework_copies_of_the_output(store):
    j = store.create("a")
    cached = store.root / GRADIO_SUBDIR / "hash1" / f"cenpai_{j.id[:8]}.mp4"
    cached.parent.mkdir()
    cached.write_bytes(b"x")
    other = store.root / GRADIO_SUBDIR / "hash2" / "cenpai_ffffffff.mp4"
    other.parent.mkdir()
    other.write_bytes(b"y")
    store.delete(j.id)
    assert not cached.exists() and not cached.parent.exists()
    assert other.exists()                      # another job's copy is untouched


def test_delete_requires_matching_owner(store):
    j = store.create("a")
    assert store.delete(j.id, owner="b") is False and j.dir.exists()
    assert store.get(j.id, "b") is None and store.get(j.id, "a") is not None
    assert store.delete(j.id, owner="a") is True and not j.dir.exists()


@pytest.mark.parametrize("bad", ["../x", "..", "a/b", "", "ZZ" * 16, "0" * 31])
def test_invalid_ids_rejected(store, bad):
    with pytest.raises(ValueError):
        store.delete(bad)
    assert store.get(bad, "a") is None


def test_sweep_expires_old_jobs_only(store):
    old, new = store.create("a", now=1000), store.create("b", now=4000)
    assert store.sweep(now=1000 + 3300) == 0
    assert store.sweep(now=1000 + 3301) == 1
    assert not old.dir.exists() and new.dir.exists()


def test_abandoned_session_is_swept(store):
    j = store.create("closed-tab", now=0)
    (j.dir / "out.mp4").write_bytes(b"z")
    store.sweep(now=3301)
    assert not j.dir.exists() and store.get(j.id, "closed-tab") is None


def test_delete_owner(store):
    a1, a2, b = store.create("a"), store.create("a"), store.create("b")
    assert store.delete_owner("a") == 2
    assert not a1.dir.exists() and not a2.dir.exists() and b.dir.exists()


def test_framework_cache_entries_expire_from_first_sight(store):
    cached = store.root / GRADIO_SUBDIR / "abc123"
    cached.mkdir()
    (cached / "upload.jpg").write_bytes(b"x")
    stray = store.root / "crash-leftover"
    stray.mkdir()
    store.sweep(now=100)                       # first sight
    assert cached.exists() and stray.exists()
    store.sweep(now=100 + 3301)
    assert not cached.exists() and not stray.exists()
    assert (store.root / GRADIO_SUBDIR).is_dir()   # the cache root itself stays


def test_startup_wipe(tmp_path):
    s1 = JobStore(tmp_path / "j", 3300)
    j = s1.create("a")
    (s1.root / GRADIO_SUBDIR / "x").mkdir()
    s2 = JobStore(tmp_path / "j", 3300)       # simulates a restart
    s2.wipe_all()
    assert not j.dir.exists() and list((s2.root / GRADIO_SUBDIR).iterdir()) == []


def test_retention_le_one_hour():
    L = Limits()
    assert L.retention_s + 2 * L.sweep_interval_s <= 3600 and L.sweep_interval_s <= 300


def test_rate_limiter():
    r = RateLimiter(20)
    assert all(r.allow("ip", now=i) for i in range(20))
    assert r.allow("ip", now=30) is False
    assert r.allow("other", now=30) is True
    assert r.allow("ip", now=3601 + 19) is True    # window slid past the first hits
