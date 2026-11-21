"""Write web/tests/fixtures/golden.json: seeded random detector outputs run through the
Python reference (cenpai/detector.py). The web test checks that the TypeScript port in
web/src/detect/ returns the same boxes and scores.

Run from the repo root: python tools/make_golden.py
Raw outputs are float64 so both sides do the same arithmetic; real model outputs are float32.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from cenpai.detector import letterbox, postprocess  # noqa: E402

OUT = ROOT / "web" / "tests" / "fixtures" / "golden.json"
SIZES = [(720, 1280), (1080, 1920), (480, 640), (640, 640), (1281, 719), (3, 1000), (1, 1)]
MODEL_SIZES = [640, 416]


def make_raw(rng: np.random.Generator, n: int, size: int) -> np.ndarray:
    """(1,5,n): cx, cy, w, h, score in letterboxed pixels, with clustered near-duplicates for NMS."""
    n_base = n // 3
    cx = rng.uniform(-10, size + 10, n_base)
    cy = rng.uniform(-10, size + 10, n_base)
    w = rng.uniform(4, size / 3, n_base)
    h = rng.uniform(3, size / 6, n_base)
    idx = rng.integers(0, n_base, n)
    jitter = rng.normal(0, 0.06, (4, n))
    bw, bh = w[idx], h[idx]
    cols = np.stack([
        cx[idx] + jitter[0] * bw,
        cy[idx] + jitter[1] * bh,
        bw * (1 + jitter[2]),
        bh * (1 + jitter[3]),
        rng.uniform(0, 1, n),  # continuous scores: no ties, so NMS order is unambiguous
    ])
    return cols[None].astype(np.float64)


def main() -> None:
    rng = np.random.default_rng(20261116)
    letterboxes, postprocs = [], []
    for h, w in SIZES:
        for size in MODEL_SIZES:
            img = np.zeros((h, w, 3), np.uint8)
            canvas, scale, pad = letterbox(img, size)
            letterboxes.append({"h": h, "w": w, "size": size, "scale": scale,
                                "pad": list(pad), "canvas_shape": list(canvas.shape)})
    for i in range(24):
        h, w = SIZES[i % 5]
        size = MODEL_SIZES[i % 2]
        conf = [0.25, 0.5, 0.78, 0.81][i % 4]
        iou = 0.5
        raw = make_raw(rng, 300, size)
        _, scale, pad = letterbox(np.zeros((h, w, 3), np.uint8), size)
        dets = postprocess(raw, scale, pad, (h, w), conf, iou)
        postprocs.append({
            "h": h, "w": w, "size": size, "conf": conf, "iou": iou,
            "scale": scale, "pad": list(pad), "n": raw.shape[2],
            "raw": raw[0].reshape(-1).tolist(),  # channel-major: 5 rows of n
            "detections": [[d.x1, d.y1, d.x2, d.y2, d.score] for d in dets],
        })
    assert sum(len(p["detections"]) for p in postprocs) > 50, "fixture too weak"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Pixel path: cv2.resize INTER_LINEAR and the full letterbox canvas, on seeded random images.
    # Smooth images (upscaled noise) look like camera frames; raw noise is the worst case.
    pixels = []
    for (h, w), (dh, dw), smooth in [((37, 53), (16, 23), False), ((9, 13), (20, 31), False),
                                     ((128, 72), (74, 42), True), ((60, 90), (60, 90), True)]:
        img = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
        if smooth:
            small = rng.integers(0, 256, (max(2, h // 8), max(2, w // 8), 3), dtype=np.uint8)
            img = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
        out = cv2.resize(img, (dw, dh), interpolation=cv2.INTER_LINEAR)
        pixels.append({"h": h, "w": w, "dh": dh, "dw": dw,
                       "src_rgb": img[:, :, ::-1].reshape(-1).tolist(),
                       "dst_rgb": out[:, :, ::-1].reshape(-1).tolist()})
    lb_pixels = []
    for (h, w), size in [((50, 80), 64), ((80, 45), 48)]:
        small = rng.integers(0, 256, (h // 5, w // 5, 3), dtype=np.uint8)
        bgr = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
        canvas, _, _ = letterbox(bgr, size)
        lb_pixels.append({"h": h, "w": w, "size": size,
                          "src_rgb": bgr[:, :, ::-1].reshape(-1).tolist(),
                          "canvas_rgb": canvas[:, :, ::-1].reshape(-1).tolist()})
    OUT.write_text(json.dumps({"letterbox": letterboxes, "postprocess": postprocs,
                               "resize": pixels, "letterbox_pixels": lb_pixels}), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KiB), "
          f"{sum(len(p['detections']) for p in postprocs)} detections")


if __name__ == "__main__":
    main()
