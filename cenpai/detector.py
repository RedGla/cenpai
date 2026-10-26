"""ONNX license-plate detector (serving side; no torch / ultralytics).

Expects an Ultralytics-style single-class detect export: input (1,3,S,S) RGB float32 in [0,1],
output (1,5,N) = cx, cy, w, h, score in letterboxed pixels (no NMS inside the graph).
The deployed artifact is described by models/MODEL.json and verified by sha256 on load.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np

PAD_VALUE = 114
CLASS_NAME = "license_plate"


class Detection(NamedTuple):
    x1: int
    y1: int
    x2: int
    y2: int
    score: float


class ModelLoadError(RuntimeError):
    pass


def letterbox(bgr: np.ndarray, size: int) -> tuple[np.ndarray, float, tuple[int, int]]:
    """Resize keeping aspect ratio and centre on a size x size canvas. Returns (img, scale, (pad_x, pad_y))."""
    h, w = bgr.shape[:2]
    scale = min(size / h, size / w)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), PAD_VALUE, dtype=np.uint8)
    px, py = (size - nw) // 2, (size - nh) // 2
    canvas[py:py + nh, px:px + nw] = resized
    return canvas, scale, (px, py)


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
    order = np.argsort(-scores)
    keep: list[int] = []
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    while order.size:
        i = order[0]
        keep.append(int(i))
        rest = order[1:]
        if not rest.size:
            break
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        iou = inter / np.maximum(areas[i] + areas[rest] - inter, 1e-9)
        order = rest[iou <= iou_thr]
    return keep


def postprocess(raw: np.ndarray, scale: float, pad: tuple[int, int], orig_hw: tuple[int, int],
                conf: float, iou: float) -> list[Detection]:
    """raw (1,5,N) -> NMS'd detections in source-pixel coordinates (outward-rounded, clipped)."""
    p = raw[0].T  # (N,5)
    p = p[p[:, 4] >= conf]
    if not len(p):
        return []
    cx, cy, w, h, s = p.T
    xyxy = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
    keep = _nms(xyxy, s, iou)
    H, W = orig_hw
    out: list[Detection] = []
    for i in keep:
        x1 = (xyxy[i, 0] - pad[0]) / scale
        y1 = (xyxy[i, 1] - pad[1]) / scale
        x2 = (xyxy[i, 2] - pad[0]) / scale
        y2 = (xyxy[i, 3] - pad[1]) / scale
        x1, y1 = int(np.floor(max(x1, 0))), int(np.floor(max(y1, 0)))
        x2, y2 = int(np.ceil(min(x2, W))), int(np.ceil(min(y2, H)))
        if x2 > x1 and y2 > y1:
            out.append(Detection(x1, y1, x2, y2, float(s[i])))
    return out


class Detector:
    def __init__(self, model_path: Path, imgsz: int, conf: float, iou: float = 0.5, version: str = "unknown"):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.log_severity_level = 3
        try:
            self.session = ort.InferenceSession(str(model_path), so, providers=["CPUExecutionProvider"])
        except Exception as e:  # corrupt / incompatible file
            raise ModelLoadError(f"cannot load model: {type(e).__name__}") from e
        inp = self.session.get_inputs()[0]
        shape = inp.shape
        if len(shape) != 4 or shape[2] != imgsz or shape[3] != imgsz:
            raise ModelLoadError(f"model input {shape} does not match imgsz={imgsz}")
        out_shape = self.session.get_outputs()[0].shape
        if len(out_shape) != 3 or out_shape[1] != 5:
            raise ModelLoadError(f"unexpected output shape {out_shape}; need single-class (1,5,N)")
        self.input_name, self.imgsz, self.conf, self.iou, self.version = inp.name, imgsz, conf, iou, version

    def detect(self, bgr: np.ndarray) -> list[Detection]:
        img, scale, pad = letterbox(bgr, self.imgsz)
        x = np.ascontiguousarray(img[:, :, ::-1].transpose(2, 0, 1), dtype=np.float32)[None] / 255.0
        raw = self.session.run(None, {self.input_name: x})[0]
        return postprocess(raw, scale, pad, bgr.shape[:2], self.conf, self.iou)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_detector(models_dir: Path = Path("models")) -> Detector:
    meta_path = Path(models_dir) / "MODEL.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        model_path = Path(models_dir) / meta["file"]
        expected, imgsz, conf = meta["sha256"], int(meta["imgsz"]), float(meta["conf"])
    except (OSError, ValueError, KeyError) as e:
        raise ModelLoadError(f"no usable model metadata at {meta_path}") from e
    if meta.get("names", [CLASS_NAME]) != [CLASS_NAME]:
        raise ModelLoadError("model must have exactly one class: license_plate")
    if not model_path.is_file():
        raise ModelLoadError(f"model file missing: {meta['file']}")
    if sha256_file(model_path) != expected:
        raise ModelLoadError("model checksum mismatch")
    return Detector(model_path, imgsz, conf, float(meta.get("iou", 0.5)), str(meta.get("version", meta["file"])))
