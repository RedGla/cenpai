import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cenpai.service import NO_PLATES, REMINDER


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("CENPAI_DEV_STUB", raising=False)

    clients = []

    def _make(models_dir):
        from cenpai.app import create_app
        work = tmp_path / "work"
        # entering the context runs the app lifespan, which starts Gradio's queue worker
        c = TestClient(create_app(models_dir, work), raise_server_exceptions=False).__enter__()
        clients.append(c)
        c.work = work
        c.cfg = c.get("/config").json()
        return c
    yield _make
    for c in clients:
        c.__exit__(None, None, None)


def event_index(cfg, n_in, n_out):
    return next(d["id"] for d in cfg["dependencies"] if len(d["inputs"]) == n_in and len(d["outputs"]) == n_out)


def run_event(c, fn_index, data, session):
    """Drive an event exactly like the browser: join the queue, then read the SSE stream."""
    r = c.post("/gradio_api/queue/join", json={"data": data, "fn_index": fn_index, "session_hash": session,
                                                "event_data": None, "trigger_id": None})
    assert r.status_code == 200, r.text
    with c.stream("GET", "/gradio_api/queue/data", params={"session_hash": session}) as s:
        for line in s.iter_lines():
            if line.startswith("data:"):
                msg = json.loads(line[5:])
                if msg.get("msg") == "process_completed":
                    return msg
    raise AssertionError("no completion message")


def upload(c, path: Path):
    r = c.post("/gradio_api/upload", files={"files": (path.name, path.read_bytes())})
    assert r.status_code == 200, r.text
    server_path = r.json()[0]
    return {"path": server_path, "orig_name": path.name, "meta": {"_type": "gradio.FileData"}}


def markdown_text(cfg):
    return "\n".join(str(comp["props"].get("value", "")) for comp in cfg["components"] if comp["type"] == "markdown")


def job_dirs(c):
    return [p for p in c.work.iterdir() if p.name != "gradio"]


# ---------------------------------------------------------------- health / readiness

def test_healthz_503_without_model(make_client, tmp_path):
    c = make_client(tmp_path / "no-models")
    r = c.get("/healthz")
    assert r.status_code == 503 and "model unavailable" in r.json()["reasons"]


def test_healthz_200_with_verified_model(make_client, fake_model):
    r = make_client(fake_model).get("/healthz")
    assert r.status_code == 200 and r.json() == {"status": "ok", "model": "fake-test"}


def test_dev_stub_never_reports_healthy_and_is_refused_on_render(make_client, tmp_path, monkeypatch):
    monkeypatch.setenv("CENPAI_DEV_STUB", "1")
    c = make_client(tmp_path / "no-models")
    assert c.get("/healthz").status_code == 503 and "NOT A REAL MODEL" in markdown_text(c.cfg)
    monkeypatch.setenv("RENDER", "true")
    c2 = make_client(tmp_path / "no-models")
    assert "NOT A REAL MODEL" not in markdown_text(c2.cfg) and "not available" in markdown_text(c2.cfg)


# ---------------------------------------------------------------- page content and exposed routes

def test_page_shows_limits_privacy_reminder_and_source(make_client, fake_model):
    text = markdown_text(make_client(fake_model).cfg)
    for needle in (REMINDER, "20 MB", "100 MB", "60 s", "1 hour", "AGPL-3.0", "github.com/RedGla/cenpai"):
        assert needle in text


def test_missing_model_banner(make_client, tmp_path):
    assert "model is not available" in markdown_text(make_client(tmp_path / "x").cfg)


def test_api_routes_disabled(make_client, fake_model):
    c = make_client(fake_model)
    assert c.get("/gradio_api/info").json()["named_endpoints"] == {}
    assert c.get("/docs").status_code == 404
    process_event = next(d for d in c.cfg["dependencies"] if len(d["inputs"]) == 3)
    # a direct (non-queued) run would bypass the queue limits; it must not be possible
    r = c.post(f"/gradio_api/run/{process_event['api_name']}", json={"data": [None, "solid", None]})
    assert r.status_code == 404
    assert c.cfg.get("footer_links") == []


def test_no_telemetry_configured(make_client, fake_model):
    make_client(fake_model)
    assert os.environ["GRADIO_ANALYTICS_ENABLED"] == "False"


def test_uploads_land_in_the_swept_cache(make_client, fake_model, make_png):
    c = make_client(fake_model)
    f = upload(c, make_png())
    assert Path(f["path"]).resolve().is_relative_to((c.work / "gradio").resolve())


# ---------------------------------------------------------------- end to end through the real queue

def test_e2e_image_then_delete(make_client, fake_model, make_png):
    c = make_client(fake_model)
    sid = uuid.uuid4().hex
    go, reset = event_index(c.cfg, 3, 5), event_index(c.cfg, 1, 6)
    msg = run_event(c, go, [upload(c, make_png(w=200, h=150)), "solid", None], sid)
    assert msg["success"], msg
    status, img, vid, dl, _ = msg["output"]["data"]
    assert "Complete" in status and REMINDER in status
    assert img["visible"] is True and vid["visible"] is False and dl["visible"] is True
    out = Path(dl["value"]["path"])
    assert out.is_file() and out.suffix == ".png"
    assert len(job_dirs(c)) == 1

    run_event(c, reset, [None], sid)
    assert job_dirs(c) == []
    # framework copies removed too; Gradio leaves one empty 0-byte tmp file, which holds no user data
    leftovers = [p for p in (c.work / "gradio").rglob("*") if p.is_file() and p.stat().st_size > 0]
    assert leftovers == []


def test_e2e_corrupt_upload_fails_without_download(make_client, fake_model, tmp_path):
    c = make_client(fake_model)
    bad = tmp_path / "evil.jpg"
    bad.write_bytes(b"not an image at all")
    msg = run_event(c, event_index(c.cfg, 3, 5), [upload(c, bad), "solid", None], uuid.uuid4().hex)
    status, img, vid, dl, _ = msg["output"]["data"]
    assert "Failed" in status and dl["visible"] is False and img["visible"] is False
    assert job_dirs(c) == []


def test_e2e_missing_model_refuses_to_process(make_client, tmp_path, make_png):
    c = make_client(tmp_path / "none")
    msg = run_event(c, event_index(c.cfg, 3, 5), [upload(c, make_png()), "solid", None], uuid.uuid4().hex)
    status, _, _, dl, _ = msg["output"]["data"]
    assert "not available" in status and dl["visible"] is False


def test_e2e_no_plates_message(make_client, fake_model, make_png, monkeypatch):
    c = make_client(fake_model)
    c.app.state.service.detector.conf = 0.99    # fake model scores 0.9 -> nothing detected
    msg = run_event(c, event_index(c.cfg, 3, 5), [upload(c, make_png()), "blur", None], uuid.uuid4().hex)
    assert NO_PLATES in msg["output"]["data"][0]


def test_e2e_video_then_delete_purges_every_copy(make_client, fake_model, make_mp4):
    c = make_client(fake_model)
    sid = uuid.uuid4().hex
    go, reset = event_index(c.cfg, 3, 5), event_index(c.cfg, 1, 6)
    msg = run_event(c, go, [upload(c, make_mp4(seconds=1, fps=10)), "solid", None], sid)
    status, img, vid, dl, _ = msg["output"]["data"]
    assert "Complete" in status and "10 of 10 frames" in status and REMINDER in status
    assert vid["visible"] is True and img["visible"] is False and Path(dl["value"]["path"]).suffix == ".mp4"
    run_event(c, reset, [None], sid)
    assert job_dirs(c) == []
    assert [p for p in (c.work / "gradio").rglob("*") if p.is_file() and p.stat().st_size > 0] == []


def test_e2e_cancel_button_stops_a_running_video_job(make_client, fake_model, make_mp4):
    import threading
    import time

    c = make_client(fake_model)
    svc = c.app.state.service
    inner = svc.detector

    class Slow:                       # slows detection so the job is still running when Cancel arrives
        version = "slow"

        def detect(self, bgr):
            time.sleep(0.1)
            return inner.detect(bgr)
    svc.detector = Slow()

    sid, result = uuid.uuid4().hex, {}
    go = event_index(c.cfg, 3, 5)
    cancel_dep = next(d for d in c.cfg["dependencies"] if not d["inputs"] and not d["outputs"] and d["api_name"] != "on_unload")
    src = upload(c, make_mp4(seconds=5, fps=10, audio=False))      # 50 frames x 0.1 s = 5 s if not canceled

    def work():
        result["msg"] = run_event(c, go, [src, "solid", None], sid)
    t = threading.Thread(target=work)
    t.start()
    for _ in range(100):               # wait until the job is actually processing
        if svc._cancel.get(sid):
            break
        time.sleep(0.05)
    assert svc._cancel.get(sid), "job never started"
    r = c.post(f"/gradio_api/run/{cancel_dep['api_name']}", json={"data": [], "fn_index": cancel_dep["id"], "session_hash": sid})
    assert r.status_code == 200, r.text
    t.join(timeout=60)
    assert not t.is_alive()
    status, _, _, dl, _ = result["msg"]["output"]["data"]
    assert "canceled" in status.lower() and dl["visible"] is False
    assert job_dirs(c) == []

def test_unload_handler_removes_that_sessions_job(make_client, fake_model, make_png):
    # Exercises the handler and its gr.Request wiring. The real trigger (browser tab closing) is Gradio's own
    # and is NOT covered here; the sweeper is the backstop for abandoned sessions.
    c = make_client(fake_model)
    mine, other = uuid.uuid4().hex, uuid.uuid4().hex
    go = event_index(c.cfg, 3, 5)
    run_event(c, go, [upload(c, make_png()), "solid", None], mine)
    run_event(c, go, [upload(c, make_png()), "solid", None], other)
    assert len(job_dirs(c)) == 2
    dep = next(d for d in c.cfg["dependencies"] if d["api_name"] == "on_unload")
    assert run_event(c, dep["id"], [], mine)["success"]
    left = job_dirs(c)
    assert len(left) == 1 and c.app.state.service.job_alive(left[0].name, other)