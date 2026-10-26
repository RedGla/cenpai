"""Shared fixtures. Media is generated on the fly; nothing real is committed.

StubDetector is a TEST-ONLY stand-in that returns scripted boxes. It must never be
used to serve users (the app reports 503 / refuses uploads without a verified model).
"""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from cenpai.detector import Detection, sha256_file

FFMPEG = shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not installed")


def _pic(w, h):
    rng = np.random.default_rng(1)
    arr = rng.integers(60, 200, (h, w, 3), dtype=np.uint8)
    return Image.fromarray(arr)


@pytest.fixture
def make_jpg(tmp_path):
    def _make(w=320, h=240, exif_orientation=None, name="a.jpg"):
        img = _pic(w, h)
        p = tmp_path / name
        if exif_orientation:
            exif = Image.Exif()
            exif[0x0112] = exif_orientation
            img.save(p, "JPEG", exif=exif)
        else:
            img.save(p, "JPEG")
        return p
    return _make


@pytest.fixture
def make_png(tmp_path):
    def _make(w=320, h=240, name="a.png"):
        p = tmp_path / name
        _pic(w, h).save(p, "PNG")
        return p
    return _make


@pytest.fixture
def make_mp4(tmp_path):
    def _make(seconds=1.0, w=320, h=240, fps=10, audio=True, rotate=0, name="v.mp4",
              audio_codec="aac", metadata=(), faststart=False):
        assert FFMPEG, "ffmpeg required"
        base = tmp_path / ("base_" + name)
        cmd = [FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i",
               f"testsrc2=size={w}x{h}:rate={fps}:duration={seconds}"]
        if audio:
            cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", audio_codec, "-shortest"]
        for m in metadata:                     # e.g. "location=+14.5995+120.9842/"
            cmd += ["-metadata", m]
        if faststart:
            cmd += ["-movflags", "+faststart"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(base)]
        subprocess.run(cmd, check=True, timeout=60)
        if not rotate:
            return base
        out = tmp_path / name
        subprocess.run([FFMPEG, "-y", "-v", "error", "-display_rotation", str(rotate), "-i", str(base),
                        "-c", "copy", str(out)], check=True, timeout=60)
        return out
    return _make


class StubDetector:
    """Scripted detections. `per_frame` is a list cycled per call, or one list for all calls."""
    version = "stub"

    def __init__(self, boxes=None):
        self.boxes = boxes or []
        self.calls = 0
        self.last_shape = None

    def detect(self, bgr):
        self.calls += 1
        self.last_shape = bgr.shape
        return list(self.boxes)


@pytest.fixture
def stub():
    return StubDetector


@pytest.fixture
def det():
    return Detection


@pytest.fixture
def store(tmp_path):
    from cenpai.jobs import JobStore
    return JobStore(tmp_path / "jobs", retention_s=3300)


@pytest.fixture
def upload(store):
    """Copy a file into the (fake) framework upload cache, like Gradio does, and return its path."""
    counter = iter(range(10_000))

    def _up(src: Path, as_name: str | None = None) -> str:
        d = store.root / "gradio" / f"h{next(counter)}"
        d.mkdir(parents=True)
        dst = d / (as_name or src.name)
        shutil.copyfile(src, dst)
        return str(dst)
    return _up


@pytest.fixture
def make_service(store):
    from cenpai.config import Limits
    from cenpai.service import Service

    def _make(detector, **limit_kw):
        return Service(detector, store, Limits(**limit_kw))
    return _make


# TEST-ONLY synthetic ONNX graph (constant output, not a real detector) for exercising load/session plumbing.
@pytest.fixture
def fake_model(tmp_path):
    onnx = pytest.importorskip("onnx")
    from onnx import TensorProto, helper, numpy_helper
    S = 64
    const = numpy_helper.from_array(np.array([[32, 32, 20, 10, 0.9]], dtype=np.float32).T[None], "c")
    nodes = [
        helper.make_node("ReduceMean", ["images"], ["m"], keepdims=0),
        helper.make_node("Mul", ["m", "zero"], ["z"]),
        helper.make_node("Add", ["c", "z"], ["output0"]),
    ]
    g = helper.make_graph(
        nodes, "fake",
        [helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, S, S])],
        [helper.make_tensor_value_info("output0", TensorProto.FLOAT, [1, 5, 1])],
        [const, numpy_helper.from_array(np.array(0, np.float32), "zero")])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 12)])
    m.ir_version = 8
    p = tmp_path / "fake.onnx"
    onnx.save(m, p)
    meta = {"file": "fake.onnx", "sha256": sha256_file(p), "imgsz": S, "conf": 0.25, "iou": 0.5,
            "names": ["license_plate"], "version": "fake-test"}
    (tmp_path / "MODEL.json").write_text(json.dumps(meta))
    return tmp_path
