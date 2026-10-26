import json
import subprocess
import threading
import time

import pytest

from cenpai.config import Limits
from cenpai.detector import Detection
from cenpai.media import JobCancelled, JobTimeout, ProcessingError, process_video
from cenpai.validate import validate_upload
from tests.conftest import needs_ffmpeg

pytestmark = needs_ffmpeg
BOX = Detection(20, 20, 80, 50, 0.9)


def probe(path, *extra):
    p = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", *extra,
                        str(path)], capture_output=True, check=True, timeout=60)
    return json.loads(p.stdout)


def nb_frames(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                        "stream=nb_read_frames", "-of", "csv=p=0", str(path)], capture_output=True, check=True, timeout=60)
    return int(p.stdout.decode().strip().strip(","))


def stream(info, kind):
    return next((s for s in info["streams"] if s["codec_type"] == kind), None)


def run(src, store, detector, mode="solid", cancel=None, deadline=None):
    info = validate_upload(src, Limits())
    job = store.create("s")
    res = process_video(src, info, job, detector, mode, lambda f, d="": None, cancel or threading.Event(),
                        deadline or time.time() + 120)
    return res, job, info


def test_every_frame_detected_and_frame_count_preserved(make_mp4, store, stub):
    src = make_mp4(seconds=2, fps=10)
    s = stub([BOX])
    res, job, _ = run(src, store, s)
    assert s.calls == res.frames == nb_frames(src) == nb_frames(res.output) == 20
    assert res.plates == 20 and res.frames_with_plates == 20


def test_duration_and_audio_preserved(make_mp4, store, stub):
    src = make_mp4(seconds=2, fps=10)
    res, _, info = run(src, store, stub([BOX]))
    a, b = probe(src), probe(res.output)
    vs_a, vs_b = stream(a, "video"), stream(b, "video")
    assert abs(float(vs_a["duration"]) - float(vs_b["duration"])) <= 1 / 10 + 1e-3
    au_a, au_b = stream(a, "audio"), stream(b, "audio")
    assert au_b is not None and au_b["codec_name"] == "aac"
    assert abs(float(au_a["duration"]) - float(au_b["duration"])) <= 0.1
    # A/V alignment: start offset between the streams must be unchanged (within 50 ms)
    off_a = float(au_a["start_time"]) - float(vs_a["start_time"])
    off_b = float(au_b["start_time"]) - float(vs_b["start_time"])
    assert abs(off_a - off_b) <= 0.05


def test_video_without_audio(make_mp4, store, stub):
    res, _, _ = run(make_mp4(audio=False), store, stub())
    assert stream(probe(res.output), "audio") is None


def test_non_aac_audio_is_reencoded_to_aac(make_mp4, store, stub):
    src = make_mp4(seconds=1, audio_codec="libmp3lame")
    assert stream(probe(src), "audio")["codec_name"] == "mp3"
    res, _, _ = run(src, store, stub())
    assert stream(probe(res.output), "audio")["codec_name"] == "aac"


def test_h264_yuv420p_faststart(make_mp4, store, stub):
    res, _, _ = run(make_mp4(), store, stub([BOX]))
    v = stream(probe(res.output), "video")
    assert (v["codec_name"], v["pix_fmt"]) == ("h264", "yuv420p")
    data = res.output.read_bytes()
    assert 0 < data.find(b"moov") < data.find(b"mdat")


def test_rotated_video_output_upright(make_mp4, store, stub):
    src = make_mp4(seconds=1, w=320, h=240, rotate=90, audio=False)
    s = stub([BOX])
    res, _, info = run(src, store, s)
    assert (info.width, info.height) == (240, 320)
    assert s.last_shape[:2] == (320, 240)                    # the detector saw upright frames
    v = stream(probe(res.output), "video")
    assert (v["width"], v["height"]) == (240, 320) and not v.get("side_data_list")   # no rotation tag left


def test_odd_dimensions_are_padded_not_rejected(make_mp4, store, stub, tmp_path):
    p = tmp_path / "odd.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=322x240:rate=10:duration=1",
                    "-vf", "format=yuv444p,crop=321:239", "-c:v", "libx264", str(p)], check=True)
    res, _, info = run(p, store, stub())
    assert (info.width, info.height) == (321, 239)
    v = stream(probe(res.output), "video")
    assert (v["width"], v["height"]) == (322, 240) and v["pix_fmt"] == "yuv420p"


def test_source_metadata_is_not_carried_over(make_mp4, store, stub):
    src = make_mp4(seconds=1, metadata=["location=+14.5995+120.9842/", "creation_time=2020-01-02T03:04:05Z",
                                       "title=PRIVATE-TITLE", "comment=owner-name"])
    assert "location" in probe(src)["format"]["tags"]        # the fixture really carries it
    res, _, _ = run(src, store, stub())
    out = probe(res.output)
    tags = {k.lower(): str(v) for t in [out["format"].get("tags", {})] + [s.get("tags", {}) for s in out["streams"]]
            for k, v in t.items()}
    joined = json.dumps(tags).lower()
    for needle in ("location", "14.5995", "creation_time", "2020-01-02", "private-title", "owner-name"):
        assert needle not in joined, f"{needle} survived in {tags}"


def test_cancel_leaves_no_output(make_mp4, store, stub):
    cancel = threading.Event()
    s = stub([BOX])
    orig = s.detect

    def detect(bgr):
        if s.calls == 4:
            cancel.set()
        return orig(bgr)
    s.detect = detect
    src = make_mp4(seconds=3, fps=10)
    job_before = len(list(store.root.iterdir()))
    with pytest.raises(JobCancelled):
        run(src, store, s, cancel=cancel)
    job_dir = next(p for p in store.root.iterdir() if len(p.name) == 32)
    assert list(job_dir.glob("*.mp4")) == [] and s.calls <= 6


def test_deadline_in_the_past_times_out_cleanly(make_mp4, store, stub):
    with pytest.raises(JobTimeout):
        run(make_mp4(), store, stub(), deadline=time.time() - 1)
    job_dir = next(p for p in store.root.iterdir() if len(p.name) == 32)
    assert list(job_dir.glob("*.mp4")) == []


def test_truncated_file_is_never_completed(make_mp4, store, stub, tmp_path):
    good = make_mp4(seconds=3, fps=10, audio=False, faststart=True)   # moov first => probes fine when cut
    cut = tmp_path / "cut.mp4"
    cut.write_bytes(good.read_bytes()[: int(good.stat().st_size * 0.6)])
    info = validate_upload(cut, Limits())                              # still passes validation (first frame decodes)
    job = store.create("s")
    with pytest.raises(ProcessingError, match="ended early|decoded"):
        process_video(cut, info, job, stub([BOX]), "solid", lambda f, d="": None, threading.Event(), time.time() + 60)
    assert list(job.dir.glob("*.mp4")) == [] and not (job.dir / "out.partial.mp4").exists()


def test_progress_is_reported_and_ends_at_one(make_mp4, store, stub):
    seen = []
    src = make_mp4(seconds=2, fps=10, audio=False)
    info = validate_upload(src, Limits())
    process_video(src, info, store.create("s"), stub(), "solid", lambda f, d="": seen.append(f), threading.Event(),
                  time.time() + 60)
    assert seen and seen[-1] == 1.0 and all(0 <= f <= 1 for f in seen) and seen == sorted(seen)


def test_video_through_service_reports_frames(make_service, make_mp4, upload, stub):
    out = make_service(stub([BOX])).process(upload(make_mp4(seconds=1, fps=10)), "blur", "s", "ip")
    assert out.state == "complete" and out.kind == "video" and out.output.suffix == ".mp4"
    assert "10 of 10 frames" in out.message


def test_service_marks_failure_for_truncated_video(make_service, make_mp4, upload, stub, tmp_path, store):
    good = make_mp4(seconds=3, fps=10, audio=False, faststart=True)
    cut = tmp_path / "cut2.mp4"
    cut.write_bytes(good.read_bytes()[: int(good.stat().st_size * 0.6)])
    out = make_service(stub([BOX])).process(upload(cut), "solid", "s", "ip")
    assert out.state == "failed" and out.output is None
    assert [p for p in store.root.iterdir() if p.name != "gradio"] == []
