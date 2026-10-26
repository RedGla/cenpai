"""FR03: censor detected plates. Default is an opaque solid mask; blur/pixelate are optional."""
from __future__ import annotations

from typing import Literal

import cv2
import numpy as np

from .detector import Detection

Mode = Literal["solid", "blur", "pixelate"]
MODES: tuple[str, ...] = ("solid", "blur", "pixelate")
PAD_FRAC = 0.10
PAD_MIN_PX = 4
PIXEL_BLOCKS = 6     # blocks along the box's short side
BLUR_SIGMA_FRAC = 0.5  # sigma = this * longest side of the padded box


def pad_box(d: Detection, hw: tuple[int, int], frac: float = PAD_FRAC, min_px: int = PAD_MIN_PX) -> tuple[int, int, int, int]:
    """Expand a detection by max(frac * size, min_px) per axis and clip to the image."""
    H, W = hw
    px = max(int(round((d.x2 - d.x1) * frac)), min_px)
    py = max(int(round((d.y2 - d.y1) * frac)), min_px)
    return max(d.x1 - px, 0), max(d.y1 - py, 0), min(d.x2 + px, W), min(d.y2 + py, H)


def censor(bgr: np.ndarray, dets: list[Detection], mode: Mode = "solid") -> np.ndarray:
    """Return a censored copy. Input array is not modified."""
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode!r}")
    out = bgr.copy()
    for d in dets:
        x1, y1, x2, y2 = pad_box(d, bgr.shape[:2])
        if x2 <= x1 or y2 <= y1:
            continue
        roi = out[y1:y2, x1:x2]
        if mode == "solid":
            roi[:] = 0
        elif mode == "blur":
            sigma = max(BLUR_SIGMA_FRAC * max(x2 - x1, y2 - y1), 1.0)
            out[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (0, 0), sigma)
        else:
            h, w = roi.shape[:2]
            block = max(min(h, w) // PIXEL_BLOCKS, 1)
            small = cv2.resize(roi, (max(w // block, 1), max(h // block, 1)), interpolation=cv2.INTER_AREA)
            out[y1:y2, x1:x2] = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
    return out
