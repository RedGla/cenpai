"""PRD §7 (A): fine-tune a pretrained YOLO detector, export it to ONNX, and pick its threshold on val.

    python -m ml.train --data data/processed/<version> --model yolo11n.pt --name y11n-<version>-s0

Writes runs/<name>/ (Ultralytics outputs, gitignored) and runs/<name>/release/{<name>.onnx, MODEL.json, run.json}.
The threshold is chosen on val through the serving code path (ml.evaluate), never on test. Next step:
    python -m ml.evaluate --model-dir runs/<name>/release --data data/processed/<version> --split test
Comparison set (PRD §3): yolov8n.pt, yolov8s.pt, yolo11n.pt, yolo11s.pt with identical arguments.
"""
from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from cenpai.detector import CLASS_NAME, Detector, sha256_file
from ml.evaluate import collect, curve, pick_conf, pr_at


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, required=True, help="a prepared dataset version folder")
    ap.add_argument("--model", default="yolo11n.pt", help="pretrained weights to start from")
    ap.add_argument("--name", required=True)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--patience", type=int, default=20)
    ap.add_argument("--batch", type=int, default=8, help="8 fits a 4 GB GTX 1650 at 640")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default=None, help="0 for the first GPU, cpu, or empty for auto")
    ap.add_argument("--min-recall", type=float, default=0.95, help="val recall target for the threshold (AC02)")
    ap.add_argument("--runs", type=Path, default=Path("runs"))
    a = ap.parse_args()

    import ultralytics
    from ultralytics import YOLO
    model = YOLO(a.model)
    model.train(data=str((a.data / "data.yaml").resolve()), imgsz=a.imgsz, epochs=a.epochs, patience=a.patience,
                batch=a.batch, seed=a.seed, deterministic=True, single_cls=True, device=a.device,
                project=str(a.runs.resolve()), name=a.name, exist_ok=False, plots=True)
    best = Path(model.trainer.best)
    onnx_tmp = Path(YOLO(str(best)).export(format="onnx", imgsz=a.imgsz, dynamic=False, nms=False))

    release = a.runs / a.name / "release"
    release.mkdir(parents=True, exist_ok=False)
    onnx = release / f"{a.name}.onnx"
    shutil.copyfile(onnx_tmp, onnx)

    iou = 0.5
    s, tp, _, n_gt = curve(collect(Detector(onnx, a.imgsz, conf=0.001, iou=iou), a.data, "val"))
    conf, met = pick_conf(s, tp, n_gt, a.min_recall)
    p, r, f1 = pr_at(s, tp, n_gt, conf)
    meta = {"file": onnx.name, "sha256": sha256_file(onnx), "imgsz": a.imgsz, "conf": round(conf, 4), "iou": iou,
            "names": [CLASS_NAME], "version": a.name, "eval_report": f"docs/reports/eval_{a.name}_test.md"}
    (release / "MODEL.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    git = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    import torch
    run = {"args": {k: str(v) for k, v in vars(a).items()}, "command": " ".join(sys.argv), "git_commit": git,
           "python": platform.python_version(), "ultralytics": ultralytics.__version__, "torch": torch.__version__,
           "best_checkpoint": str(best), "best_sha256": sha256_file(best),
           "dataset_manifest_sha256": sha256_file(a.data / "manifest.csv"),
           "val_at_conf": {"precision": p, "recall": r, "f1": f1, "plates": n_gt}, "recall_target_met": met}
    (release / "run.json").write_text(json.dumps(run, indent=2) + "\n", encoding="utf-8")
    print(f"release: {release}  conf={conf:.4f}  val P={p:.3f} R={r:.3f}  recall target met: {met}")


if __name__ == "__main__":
    main()
