"""PRD §8: evaluate a detector through the SERVING code path (cenpai.detector + cenpai.media image loading),
so the reported numbers are those of the artifact the website loads.

    python -m ml.evaluate --model-dir runs/<name>/release --data data/processed/<version> --split test
    python -m ml.evaluate --owlv2 --conf 0.1 --data data/processed/<version> --split test   # zero-shot reference

Matching: per image, predictions sorted by score are greedily matched to the unmatched ground-truth box with the
highest IoU >= threshold. AP uses COCO-style 101-point interpolation; single class, so mAP == AP.
"""
from __future__ import annotations

import argparse
import json
import platform
import time
from datetime import date
from pathlib import Path

import numpy as np

from cenpai.detector import Detector, sha256_file
from cenpai.media import _load_bgr

IOU_THRS = np.round(np.arange(0.50, 0.96, 0.05), 2)
SIZE_BUCKETS = (("small", 32 ** 2), ("medium", 96 ** 2), ("large", float("inf")))   # COCO areas, source pixels


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if not len(a) or not len(b):
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = lambda r: (r[:, 2] - r[:, 0]) * (r[:, 3] - r[:, 1])
    return inter / np.maximum(area(a)[:, None] + area(b)[None, :] - inter, 1e-9)


def match(preds: np.ndarray, gts: np.ndarray, thr: float) -> tuple[np.ndarray, np.ndarray]:
    """preds (n,5) x1 y1 x2 y2 score, gts (m,4). Returns (tp flag per pred, score of the pred matched to each gt or -1)."""
    order = np.argsort(-preds[:, 4]) if len(preds) else np.array([], int)
    tp, gt_score = np.zeros(len(preds), bool), np.full(len(gts), -1.0)
    ious = iou_matrix(preds[:, :4], gts) if len(preds) else np.zeros((0, len(gts)))
    for i in order:
        cand = np.where((gt_score < 0) & (ious[i] >= thr), ious[i], -1)
        j = int(np.argmax(cand)) if len(gts) else -1
        if j >= 0 and cand[j] >= 0:
            tp[i], gt_score[j] = True, preds[i, 4]
    return tp, gt_score


def ap101(scores: np.ndarray, tp: np.ndarray, n_gt: int) -> float:
    if n_gt == 0:
        return float("nan")
    o = np.argsort(-scores)
    ctp = np.cumsum(tp[o])
    rec = ctp / n_gt
    prec = ctp / np.arange(1, len(o) + 1)
    prec = np.maximum.accumulate(prec[::-1])[::-1] if len(prec) else prec   # monotone envelope
    pts = [prec[rec >= r].max() if (rec >= r).any() else 0.0 for r in np.linspace(0, 1, 101)]
    return float(np.mean(pts))


def pr_at(scores: np.ndarray, tp: np.ndarray, n_gt: int, conf: float) -> tuple[float, float, float]:
    keep = scores >= conf
    t = int(tp[keep].sum())
    p = t / keep.sum() if keep.sum() else 1.0
    r = t / n_gt if n_gt else float("nan")
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def pick_conf(scores: np.ndarray, tp: np.ndarray, n_gt: int, min_recall: float) -> tuple[float, bool]:
    """Highest threshold whose recall >= min_recall (recall first, PRD §8); otherwise the max-F1 threshold.
    Returns (conf, target_met)."""
    if not len(scores) or not n_gt:
        return 0.25, False
    o = np.argsort(-scores, kind="stable")
    s, ctp = scores[o], np.cumsum(tp[o])
    rec, prec = ctp / n_gt, ctp / np.arange(1, len(s) + 1)
    last = np.r_[s[1:] != s[:-1], True]          # a threshold keeps every tied score, so use the end of each tie run
    ok = np.nonzero(last & (rec >= min_recall))[0]
    if ok.size:
        return float(s[ok[0]]), True
    f1 = 2 * prec * rec / np.maximum(prec + rec, 1e-9)
    idx = np.nonzero(last)[0]
    return float(s[idx[np.argmax(f1[idx])]]), False


def curve(run: dict, thr: float = 0.5) -> tuple[np.ndarray, np.ndarray, list[np.ndarray], int]:
    """All prediction scores, their TP flags at IoU `thr`, per-image matched-gt scores, and the gt count."""
    imgs = run["images"]
    pairs = [match(i["preds"], i["gts"], thr) for i in imgs]
    scores = np.concatenate([i["preds"][:, 4] for i in imgs]) if imgs else np.array([])
    tp = np.concatenate([p[0] for p in pairs]) if pairs else np.array([], bool)
    return scores, tp, [p[1] for p in pairs], sum(len(i["gts"]) for i in imgs)


def load_split(data_dir: Path, split: str) -> list[tuple[Path, Path]]:
    imgs = sorted((Path(data_dir) / "images" / split).iterdir())
    return [(p, Path(data_dir) / "labels" / split / (p.stem + ".txt")) for p in imgs]


def collect(detector, data_dir: Path, split: str) -> dict:
    """Run the detector over a split. Returns per-image predictions and pixel ground truth plus timings."""
    images, secs = [], []
    for img, lbl in load_split(data_dir, split):
        bgr, _ = _load_bgr(img)
        H, W = bgr.shape[:2]
        gts = np.array([[(cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H]
                        for cx, cy, w, h in (map(float, l.split()[1:5]) for l in lbl.read_text().split("\n") if l.strip())]
                       ).reshape(-1, 4)
        t0 = time.perf_counter()
        dets = detector.detect(bgr)
        secs.append(time.perf_counter() - t0)
        preds = np.array([[d.x1, d.y1, d.x2, d.y2, d.score] for d in dets], float).reshape(-1, 5)
        images.append({"file": img.name, "preds": preds, "gts": gts})
    return {"images": images, "secs": secs}


def score(run: dict, conf: float) -> dict:
    imgs = run["images"]
    res = {"images": len(imgs), "negatives": sum(not len(i["gts"]) for i in imgs), "conf": conf}
    aps, misses, by_size = [], [], {b: [0, 0] for b, _ in SIZE_BUCKETS}
    for thr in IOU_THRS:
        allscores, tp, gscores, n_gt = curve(run, thr)
        aps.append(ap101(allscores, tp, n_gt))
        if thr == 0.5:
            res["gt_boxes"] = n_gt
            res["precision"], res["recall"], res["f1"] = pr_at(allscores, tp, n_gt, conf)
            for i, gs in zip(imgs, gscores):
                fn = int((gs < conf).sum())
                fp = int((i["preds"][:, 4] >= conf).sum()) - int((gs >= conf).sum())
                if fn or fp:
                    misses.append((i["file"], fn, fp))
                for box, s in zip(i["gts"], gs):
                    area = (box[2] - box[0]) * (box[3] - box[1])
                    b = next(n for n, lim in SIZE_BUCKETS if area < lim)
                    by_size[b][0] += 1
                    by_size[b][1] += s >= conf
    res["ap50"], res["ap50_95"] = aps[0], float(np.nanmean(aps))
    res["recall_by_size"] = {b: (hit / n if n else None, n) for b, (n, hit) in by_size.items()}
    res["worst"] = sorted(misses, key=lambda m: (-m[1], -m[2]))[:20]
    res["ms_per_image"] = 1000 * float(np.mean(run["secs"])) if run["secs"] else None
    return res


def write_report(res: dict, path: Path, model: str, sha: str, split: str, data_dir: Path, iou_nms: float) -> None:
    f = lambda v: "n/a" if v is None or v != v else f"{v:.3f}"
    lines = [
        f"# Evaluation: {model} on `{split}`", "",
        f"Date {date.today().isoformat()} · data `{Path(data_dir).name}` · sha256 `{sha}`", "",
        f"Confidence {res['conf']:.4f} (chosen on val) · NMS IoU {iou_nms} · match IoU 0.50, greedy by score", "",
        "| Images | Plates | Negatives | Precision | Recall | F1 | mAP@0.50 | mAP@0.50:0.95 | ms/image |",
        "|---|---|---|---|---|---|---|---|---|",
        f"| {res['images']} | {res['gt_boxes']} | {res['negatives']} | {f(res['precision'])} | {f(res['recall'])} | "
        f"{f(res['f1'])} | {f(res['ap50'])} | {f(res['ap50_95'])} | {f(res['ms_per_image'])} |", "",
        "Recall by plate area (source pixels; small < 32², medium < 96²):", "",
        "| Size | Plates | Recall |", "|---|---|---|",
        *[f"| {b} | {n} | {f(r)} |" for b, (r, n) in res["recall_by_size"].items()], "",
        f"Detector-only time on {platform.processor() or platform.machine()} ({platform.system()}), "
        "serving ONNX Runtime CPU session, mean over the split (first call included); not a full-pipeline benchmark.", "",
        "Images with misses (FN) or false positives (FP), worst 20:", "",
        "| File | FN | FP |", "|---|---|---|", *[f"| {a} | {b} | {c} |" for a, b, c in res["worst"]], "",
        "Small groups are noisy; do not over-interpret them. Censoring effectiveness (AC03) is checked separately "
        "on the encoded outputs.",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model-dir", type=Path, help="folder with MODEL.json + .onnx")
    ap.add_argument("--owlv2", action="store_true", help="evaluate the OWLv2 zero-shot reference instead")
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--split", default="test", choices=("train", "val", "test"))
    ap.add_argument("--conf", type=float, help="override the threshold (required for --owlv2)")
    ap.add_argument("--report", type=Path)
    a = ap.parse_args()
    if a.owlv2:
        from ml.autolabel import Owlv2Detector
        if a.conf is None:
            ap.error("--owlv2 needs --conf (choose it on val)")
        det, name, sha, iou_nms = Owlv2Detector(threshold=0.01), "owlv2-zero-shot", "n/a (Hugging Face weights)", 0.5
    else:
        meta = json.loads((a.model_dir / "MODEL.json").read_text(encoding="utf-8"))
        onnx = a.model_dir / meta["file"]
        if sha256_file(onnx) != meta["sha256"]:
            raise SystemExit("checksum mismatch: MODEL.json does not describe this .onnx")
        det = Detector(onnx, int(meta["imgsz"]), conf=0.001, iou=float(meta.get("iou", 0.5)))
        name, sha, iou_nms = meta["version"], meta["sha256"], float(meta.get("iou", 0.5))
        a.conf = float(meta["conf"]) if a.conf is None else a.conf
    res = score(collect(det, a.data, a.split), a.conf)
    report = a.report or Path("docs/reports") / f"eval_{name}_{a.split}.md"
    write_report(res, report, name, sha, a.split, a.data, iou_nms)
    print(f"wrote {report}: P={res['precision']:.3f} R={res['recall']:.3f} mAP50={res['ap50']:.3f}")


if __name__ == "__main__":
    main()
