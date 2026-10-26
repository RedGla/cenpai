import json

import numpy as np
import pytest

from cenpai.detector import (Detection, Detector, ModelLoadError, letterbox, load_detector,
                             postprocess, sha256_file)


def raw_of(*rows):
    """rows of (cx, cy, w, h, score) in letterboxed px -> (1,5,N)."""
    return np.array(rows, dtype=np.float32).T[None]


def test_letterbox_roundtrip():
    img = np.zeros((1080, 1920, 3), np.uint8)
    out, scale, pad = letterbox(img, 640)
    assert out.shape == (640, 640, 3)
    assert scale == pytest.approx(1 / 3)
    assert pad == (0, 140)
    # source-centre (960, 540) -> letterboxed (320, 320) -> back
    d = postprocess(raw_of((320, 320, 30, 12, 0.9)), scale, pad, (1080, 1920), 0.25, 0.5)
    assert len(d) == 1
    cx, cy = (d[0].x1 + d[0].x2) / 2, (d[0].y1 + d[0].y2) / 2
    assert abs(cx - 960) <= 1 and abs(cy - 540) <= 1


def test_postprocess_maps_to_source_coords_and_rounds_outward():
    # scale 0.5, pad 0: letterboxed box (100,100)-(140,120) -> source (200,200)-(280,240)
    d = postprocess(raw_of((120, 110, 40, 20, 0.8)), 0.5, (0, 0), (1000, 1000), 0.25, 0.5)
    assert d == [Detection(200, 200, 280, 240, pytest.approx(0.8))]


def test_boxes_clipped_to_image():
    d = postprocess(raw_of((5, 5, 100, 100, 0.9)), 1.0, (0, 0), (50, 60), 0.25, 0.5)
    assert d[0][:4] == (0, 0, 55, 50)


def test_nms_keeps_separate_plates():
    d = postprocess(raw_of((50, 50, 20, 10, 0.9), (300, 300, 20, 10, 0.8)), 1.0, (0, 0), (640, 640), 0.25, 0.5)
    assert len(d) == 2


def test_nms_collapses_overlapping_boxes():
    d = postprocess(raw_of((50, 50, 20, 10, 0.9), (51, 50, 20, 10, 0.8)), 1.0, (0, 0), (640, 640), 0.25, 0.5)
    assert len(d) == 1 and d[0].score == pytest.approx(0.9)


def test_no_candidates_returns_empty():
    assert postprocess(raw_of((50, 50, 20, 10, 0.1)), 1.0, (0, 0), (640, 640), 0.25, 0.5) == []




def test_load_and_detect_through_session(fake_model):
    det = load_detector(fake_model)
    assert isinstance(det, Detector) and det.version == "fake-test"
    out = det.detect(np.zeros((64, 64, 3), np.uint8))
    assert len(out) == 1 and out[0][:4] == (22, 27, 42, 37)


def test_sha_mismatch_raises(fake_model):
    (fake_model / "fake.onnx").write_bytes((fake_model / "fake.onnx").read_bytes() + b"x")
    with pytest.raises(ModelLoadError, match="checksum"):
        load_detector(fake_model)


def test_missing_metadata_raises(tmp_path):
    with pytest.raises(ModelLoadError):
        load_detector(tmp_path)


def test_imgsz_mismatch_raises(fake_model):
    meta = json.loads((fake_model / "MODEL.json").read_text())
    meta["imgsz"] = 640
    (fake_model / "MODEL.json").write_text(json.dumps(meta))
    with pytest.raises(ModelLoadError, match="imgsz"):
        load_detector(fake_model)


def test_multiclass_names_rejected(fake_model):
    meta = json.loads((fake_model / "MODEL.json").read_text())
    meta["names"] = ["a", "b"]
    (fake_model / "MODEL.json").write_text(json.dumps(meta))
    with pytest.raises(ModelLoadError, match="one class"):
        load_detector(fake_model)
