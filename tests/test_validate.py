import dataclasses

import pytest
from PIL import Image

from cenpai.config import Limits, load_limits
from cenpai.validate import RejectedMedia, validate_upload
from tests.conftest import needs_ffmpeg

L = Limits()


def test_accepts_supported_images(make_jpg, make_png):
    assert validate_upload(make_jpg(), L).kind == "image"
    assert validate_upload(make_jpg(name="b.jpeg"), L).ext == "jpeg"
    info = validate_upload(make_png(), L)
    assert (info.kind, info.ext, info.width, info.height) == ("image", "png", 320, 240)


def test_rejects_renamed_non_media(tmp_path):
    p = tmp_path / "evil.jpg"
    p.write_bytes(b"MZ\x90\x00 not an image")
    with pytest.raises(RejectedMedia):
        validate_upload(p, L)


def test_rejects_extension_content_mismatch(make_png, tmp_path):
    p = tmp_path / "x.jpg"
    p.write_bytes(make_png().read_bytes())
    with pytest.raises(RejectedMedia, match="does not match"):
        validate_upload(p, L)


def test_rejects_unsupported_extension(tmp_path):
    p = tmp_path / "a.gif"
    p.write_bytes(b"GIF89a")
    with pytest.raises(RejectedMedia, match="Unsupported"):
        validate_upload(p, L)


def test_rejects_over_bytes(make_jpg):
    with pytest.raises(RejectedMedia, match="too large"):
        validate_upload(make_jpg(), dataclasses.replace(L, image_max_mb=0.001))


def test_rejects_over_pixels_before_decode(make_png):
    with pytest.raises(RejectedMedia, match="MP"):
        validate_upload(make_png(w=400, h=300), dataclasses.replace(L, image_max_pixels=100_000))


def test_rejects_corrupt_image(tmp_path, make_jpg):
    p = tmp_path / "c.jpg"
    p.write_bytes(make_jpg().read_bytes()[:200])
    with pytest.raises(RejectedMedia, match="corrupt"):
        validate_upload(p, L)


@needs_ffmpeg
def test_accepts_video_and_reports_audio(make_mp4):
    info = validate_upload(make_mp4(seconds=1, fps=10), L)
    assert (info.kind, info.width, info.height, info.has_audio) == ("video", 320, 240, True)
    assert info.fps == pytest.approx(10) and info.duration_s == pytest.approx(1, abs=0.2)
    assert not validate_upload(make_mp4(audio=False, name="n.mp4"), L).has_audio


@needs_ffmpeg
def test_accepts_portrait_video(make_mp4):
    # 1080x1920 portrait is within the cap in either orientation
    info = validate_upload(make_mp4(seconds=0.5, w=1080, h=1920, fps=5, audio=False), L)
    assert (info.width, info.height) == (1080, 1920)


@needs_ffmpeg
def test_rotation_tag_swaps_dimensions(make_mp4):
    info = validate_upload(make_mp4(seconds=0.5, w=320, h=240, fps=5, rotate=90, audio=False), L)
    assert (info.width, info.height) == (240, 320)


@needs_ffmpeg
def test_rejects_video_over_duration_fps_dims(make_mp4):
    with pytest.raises(RejectedMedia, match="too long"):
        validate_upload(make_mp4(seconds=2, fps=5), dataclasses.replace(L, video_max_seconds=1))
    with pytest.raises(RejectedMedia, match="frame rate"):
        validate_upload(make_mp4(seconds=1, fps=25, name="f.mp4"), dataclasses.replace(L, video_max_fps=24))
    with pytest.raises(RejectedMedia, match="resolution"):
        validate_upload(make_mp4(seconds=1, fps=5, w=2560, h=1440, name="d.mp4"), L)


@needs_ffmpeg
def test_accepts_29_97_fps(make_mp4, tmp_path):
    import subprocess
    p = tmp_path / "ntsc.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30000/1001:duration=1",
                    "-pix_fmt", "yuv420p", str(p)], check=True)
    assert validate_upload(p, L).fps == pytest.approx(29.97, abs=0.01)


@needs_ffmpeg
def test_rejects_corrupt_mp4(make_mp4, tmp_path):
    good = make_mp4(seconds=1, fps=10)
    p = tmp_path / "cut.mp4"
    p.write_bytes(good.read_bytes()[: good.stat().st_size // 3])
    with pytest.raises(RejectedMedia, match="corrupt"):
        validate_upload(p, L)


def test_limits_reject_unsafe_retention():
    with pytest.raises(ValueError):
        Limits(retention_s=3500, sweep_interval_s=60)
    with pytest.raises(ValueError):
        Limits(retention_s=600, job_timeout_s=600)
    with pytest.raises(ValueError):
        Limits(sweep_interval_s=600)


def test_load_limits_env_override():
    assert load_limits({"CENPAI_VIDEO_MAX_SECONDS": "30", "CENPAI_QUEUE_MAX": "3"}).video_max_seconds == 30
    assert load_limits({}) == Limits()
