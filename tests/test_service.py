import logging

import pytest

from cenpai import media
from cenpai.detector import Detection
from cenpai.service import NO_PLATES, REMINDER

BOX = Detection(20, 20, 90, 50, 0.9)


def test_complete_with_plates_has_reminder(make_service, make_png, upload, stub):
    svc = make_service(stub([BOX]))
    out = svc.process(upload(make_png()), "solid", "s1", "1.1.1.1")
    assert out.state == "complete" and out.output.is_file() and out.kind == "image"
    assert "1 plate region" in out.message and REMINDER in out.message


def test_no_plates_message_is_explicit_and_not_a_safety_claim(make_service, make_png, upload, stub):
    out = make_service(stub()).process(upload(make_png()), "solid", "s1", "ip")
    assert out.state == "complete" and NO_PLATES in out.message and REMINDER in out.message
    lowered = out.message.lower().replace(NO_PLATES.lower(), "")
    assert "verified" not in lowered and "safe" not in lowered


def test_model_unavailable_is_reported_not_faked(make_service, make_png, upload):
    out = make_service(None).process(upload(make_png()), "solid", "s1", "ip")
    assert out.state == "unavailable" and out.output is None and "not available" in out.message


def test_failed_job_offers_no_download_and_leaves_no_files(make_service, make_png, upload, stub, store, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail /tmp/xyz")
    monkeypatch.setattr(media, "process_image", boom)
    out = make_service(stub([BOX])).process(upload(make_png()), "solid", "s1", "ip")
    assert out.state == "failed" and out.output is None and out.job_id is None
    assert "secret" not in out.message and "failed" in out.message.lower()
    assert [p for p in store.root.iterdir() if p.name != "gradio"] == []


def test_processing_error_message_passes_through(make_service, make_png, upload, stub, monkeypatch):
    def bad(*a, **k):
        raise media.ProcessingError("The image could not be decoded.")
    monkeypatch.setattr(media, "process_image", bad)
    out = make_service(stub()).process(upload(make_png()), "solid", "s", "ip")
    assert "could not be decoded" in out.message and out.output is None


def test_rejected_upload_is_cleaned_up(make_service, tmp_path, upload, stub, store):
    bad = tmp_path / "evil.jpg"
    bad.write_bytes(b"MZ not an image")
    cached = upload(bad)
    out = make_service(stub()).process(cached, "solid", "s1", "ip")
    assert out.state == "failed" and "rejected" in out.message.lower()
    assert not __import__("pathlib").Path(cached).exists()                       # framework copy removed
    assert [p for p in store.root.iterdir() if p.name != "gradio"] == []


def test_path_outside_upload_cache_is_refused(make_service, make_png, stub, store):
    other = store.create("other-session")
    secret = other.dir / "cenpai_result.png"
    secret.write_bytes(make_png().read_bytes())
    out = make_service(stub()).process(str(secret), "solid", "attacker", "ip")
    assert out.state == "failed" and out.output is None and secret.exists()    # not read, not deleted


def test_unknown_mode_and_missing_file(make_service, make_png, upload, stub):
    svc = make_service(stub())
    assert svc.process(upload(make_png()), "rainbow", "s", "ip").state == "failed"
    assert svc.process(None, "solid", "s", "ip").state == "failed"


def test_rate_limit_rejects(make_service, make_png, upload, stub):
    svc = make_service(stub(), rate_per_ip_per_hour=2)
    results = [svc.process(upload(make_png()), "solid", "s", "9.9.9.9").state for _ in range(3)]
    assert results == ["complete", "complete", "failed"]
    assert "Too many" in svc.process(upload(make_png()), "solid", "s", "9.9.9.9").message


def test_new_upload_replaces_previous_job_of_same_session(make_service, make_png, upload, stub):
    svc = make_service(stub())
    a = svc.process(upload(make_png()), "solid", "s", "ip")
    b = svc.process(upload(make_png()), "solid", "s", "ip")
    assert not a.output.exists() and b.output.exists()


def test_delete_is_owner_bound(make_service, make_png, upload, stub):
    svc = make_service(stub())
    a = svc.process(upload(make_png()), "solid", "owner", "ip")
    svc.delete(a.job_id, "intruder")
    assert a.output.exists() and svc.job_alive(a.job_id, "owner") and not svc.job_alive(a.job_id, "intruder")
    svc.delete(a.job_id, "owner")
    assert not a.output.exists() and not svc.job_alive(a.job_id, "owner")


def test_logs_have_no_paths_or_names(make_service, make_png, upload, stub, caplog, tmp_path):
    caplog.set_level(logging.DEBUG)
    svc = make_service(stub([BOX]))
    svc.process(upload(make_png(), as_name="PLATE_ABC123_private.png"), "solid", "s", "ip")
    text = caplog.text
    assert "job=" in text and "state=complete" in text
    assert "ABC123" not in text and "private" not in text and str(tmp_path) not in text
