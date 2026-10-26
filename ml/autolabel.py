"""PRD §3 (B): draft plate boxes for unlabeled images with OWLv2 zero-shot detection.

The output is a DRAFT. Import it into Roboflow (YOLO format), review every image, fix and delete boxes, then
export it and register it with `labels: owlv2-reviewed`. `ml.dataset` refuses unreviewed drafts.

    python -m ml.autolabel --images C:/Users/rapha/CenpAI-data/raw/my-photos --out C:/Users/rapha/CenpAI-data/drafts/my-photos

The model (~600 MB) needs about 2 GB of free RAM; on this laptop prefer Colab. A low threshold favours recall:
deleting a wrong box in review is cheaper than finding a missed plate.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np

from cenpai.detector import Detection, _nms
from cenpai.media import _load_bgr

MODEL_ID = "google/owlv2-base-patch16"
PROMPTS = ["a photo of a license plate", "a car number plate"]
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


class Owlv2Detector:
    """Same `.detect(bgr) -> list[Detection]` interface as cenpai.detector.Detector."""
    version = f"{MODEL_ID} zero-shot"

    def __init__(self, threshold: float = 0.1, model_id: str = MODEL_ID, nms_iou: float = 0.5):
        import torch
        from transformers import Owlv2ForObjectDetection, Owlv2Processor
        self.torch, self.threshold, self.nms_iou = torch, threshold, nms_iou
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = Owlv2Processor.from_pretrained(model_id)
        self.model = Owlv2ForObjectDetection.from_pretrained(model_id).to(self.device).eval()

    def detect(self, bgr: np.ndarray) -> list[Detection]:
        from PIL import Image
        h, w = bgr.shape[:2]
        inputs = self.processor(text=[PROMPTS], images=Image.fromarray(bgr[:, :, ::-1]), return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            out = self.model(**inputs)
        side = max(h, w)       # OWLv2 pads to a square at the bottom/right, so boxes are in padded-square pixels
        res = self.processor.image_processor.post_process_object_detection(
            out, threshold=self.threshold, target_sizes=self.torch.tensor([[side, side]]))[0]
        return clip_dets(res["boxes"].cpu().numpy(), res["scores"].cpu().numpy(), w, h, self.nms_iou)


def clip_dets(boxes: np.ndarray, scores: np.ndarray, w: int, h: int, nms_iou: float) -> list[Detection]:
    """Clip xyxy boxes to the image, drop empty ones, merge prompt duplicates with NMS."""
    if not len(boxes):
        return []
    b = np.column_stack([np.clip(boxes[:, 0], 0, w), np.clip(boxes[:, 1], 0, h),
                         np.clip(boxes[:, 2], 0, w), np.clip(boxes[:, 3], 0, h)])
    ok = (b[:, 2] > b[:, 0]) & (b[:, 3] > b[:, 1])
    b, s = b[ok], scores[ok]
    return [Detection(int(np.floor(b[i, 0])), int(np.floor(b[i, 1])), int(np.ceil(b[i, 2])), int(np.ceil(b[i, 3])),
                      float(s[i])) for i in _nms(b, s, nms_iou)] if len(b) else []


def to_yolo_lines(dets: list[Detection], w: int, h: int) -> str:
    return "".join(f"0 {(d.x1 + d.x2) / 2 / w:.6f} {(d.y1 + d.y2) / 2 / h:.6f} {(d.x2 - d.x1) / w:.6f} "
                   f"{(d.y2 - d.y1) / h:.6f}\n" for d in dets)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--threshold", type=float, default=0.1)
    a = ap.parse_args()
    if a.out.exists():
        raise SystemExit(f"{a.out} exists; drafts are never overwritten")
    (a.out / "images").mkdir(parents=True)
    (a.out / "labels").mkdir()
    det = Owlv2Detector(a.threshold)
    n = boxes = 0
    for img in sorted(p for p in a.images.rglob("*") if p.suffix.lower() in IMAGE_EXTS):
        bgr, _ = _load_bgr(img)
        dets = det.detect(bgr)
        name = f"{n:06d}{img.suffix.lower()}"          # generated name; the mapping is in sources.csv
        shutil.copyfile(img, a.out / "images" / name)
        (a.out / "labels" / name).with_suffix(".txt").write_text(to_yolo_lines(dets, *bgr.shape[1::-1]), encoding="utf-8")
        with open(a.out / "sources.csv", "a", encoding="utf-8") as f:
            f.write(f"{name},{img.relative_to(a.images).as_posix()}\n")
        n, boxes = n + 1, boxes + len(dets)
    (a.out / "data.yaml").write_text("train: images\nval: images\nnames:\n  0: license_plate\n", encoding="utf-8")
    (a.out / "DRAFT_README.txt").write_text(
        f"OWLv2 DRAFT labels ({MODEL_ID}, threshold {a.threshold}). Review every image before training.\n", encoding="utf-8")
    print(f"{n} images, {boxes} draft boxes -> {a.out}")


if __name__ == "__main__":
    main()
