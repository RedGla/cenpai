# Decision log

| # | Decision | Why / status |
|---|---|---|
| 1 | Detector: fine-tune a pretrained YOLO (baseline YOLO11n), served as ONNX. Comparison set YOLOv8n/v8s/11n/11s. | PRD v2 §3. Same speed class as v8n, newer. Chapter 1 §1.7 lists this set. |
| 2 | OWLv2 (`google/owlv2-base-patch16`) only drafts labels and is a zero-shot reference row; never served. | Too slow on CPU for video. Drafts must be reviewed (`ml.dataset` refuses `owlv2-draft`). |
| 3 | Image classifiers (e.g. `google/vit-base-patch16-224`) rejected. | They can't localize plates, so they can't drive censoring. Owner agreed 2026-10-26. |
| 4 | Datasets without an official license may be used for training/research; license recorded as `unstated`; media never redistributed. | Owner decision 2026-10-26. Release blocker AC07 until cleared or accepted. |
| 5 | Threshold chosen on val as the highest confidence with recall ≥ 0.95, else max F1; evaluation runs through the serving code (`cenpai.detector`). | Recall first (PRD §8). Evaluated numbers belong to the exact deployed artifact. |
| 6 | Split by scene group: Roboflow video-frame names share a key; dHash ≤ 4 merges near duplicates; train-only sources never reach val/test. | PRD §6; the inspected Roboflow sources had leaking official splits. |
| 7 | One Render Docker web service, in-process bounded queue, local temp files. | A restart interrupts jobs; no durable-job claim. |
| 8 | Default censor: opaque black mask, 10 % padding (min 4 px), clipped. Blur/pixelate optional. | FR03; the UI says solid is safest. |
| 9 | Proposed caps: image 20 MB / 20 MP; video 100 MB / 60 s / 1920×1080 / 30 fps. Targets: recall ≥ 0.95, precision ≥ 0.90 @ IoU 0.50. | To be benchmarked (AC05); targets are not results. |
| 10 | Public repo, AGPL-3.0. | Ultralytics is AGPL-3.0; a hosted service must offer its source. |
| 11 | Retention 3300 s, sweeper every 60 s, hard max 1 h; Gradio's cached copies purged by `cenpai_<id8>` name. | FR07, AC04. `Limits` enforces retention + 2 × sweep ≤ 3600. |
| 12 | Video: constant frame rate = source average; AAC audio copied, other audio re-encoded; metadata stripped; ≥ 98 % duration or failed. | FR04, simplicity. |
| 13 | Gradio events `api_name=False`, `queue(api_open=False)`; telemetry off; uploads accepted only from the upload cache. | §11. `api_visibility="private"` alone did not block direct calls (found by test). |
| 14 | No model → app starts, `/healthz` 503, uploads refused. Dev stub (`CENPAI_DEV_STUB=1`) refused on Render. | FR02: no fabricated detections in production. |
| 15 | History restarted on 2026-10-26 (orphan `main`); previous history kept locally on branch `old-main`. | Owner request: start from scratch, keep good files. |
| 16 | Claude Code: project subagents on per-task models; hooks guard secrets/data and ask before push/deploy/paid actions. | Replaces v1.0's "Sonnet only, no parallel agents". |
| 17 | v3 deadline: working demo Tue 2026-11-17. | Plan §1. Phases 0-4 happen on 2026-11-16; the rest comes after the demo. |
| 18 | App form: mobile web app (PWA) with models running on the phone; Chrome on Android is the reference, laptop Chrome the fallback. | Plan §1. Camera needs HTTPS or `localhost`. Replaces the Render upload site. |
| 19 | "Live" means a live camera preview with plates covered, plus censored recording and photo. No broadcasting to social platforms. | Plan §1. |
| 20 | Audio: speech-to-text (pretrained Whisper), then a Tagalog profanity classifier we fine-tune. Strict is the default mode, Smart the toggle. | Plan §1, §8. |
| 21 | Training: we fine-tune our own models (ML course requirement): plate detectors and text classifiers. Compute is free Colab or Kaggle only. | Plan §1, §8. |
| 22 | Lost with the previous laptop: all raw data, the paper's `best.pt` and `CenpAI_Final.ipynb`, and the local `old-main` branch (decision 15). | Phase 1 retrains from a fresh download and becomes the new baseline; the paper's pilot numbers can no longer be reproduced. `ml/datasets.yaml` still points to the dead laptop's path; fixed in Phase 5. |
| 23 | Storage rule: raw data and checkpoints in Google Drive, released weights on Hugging Face, notebooks and manifests in Git. | Nothing important lives only on a laptop. |
| 24 | v3 plate detector is **yolov8n v0** (COCO weights fine-tuned on PH BB v5), served as ONNX from `web/public/models/plate-640/` and `plate-416/`. Two thresholds in each `MODEL.json`: `conf` 0.81 (640) / 0.78 (416) for detection, chosen by decision 5; `mask_conf` 0.10 / 0.10 for masking, the lowest confidence not below 0.10 with validation precision at least 0.90. | Replaces decision 1's YOLO11n baseline for v3. yolov8n and yolo11n tied on validation recall at 640; the yolo11n 640 file missed a plate on a sample image in the serving check (`cenpai.detector`), so yolov8n ships. Both thresholds come from validation only; test scores and the pilot caveat are in `docs/reports/detector_v0.md`. |
| 25 | The plate detector weights are not uploaded to Hugging Face. `best.pt`, every ONNX export and `results.csv` stay on Google Drive under `CenpAI/release/`; the served ONNX files are also in Git (`web/public/models/`). | Owner decision 2026-11-16. Narrows decision 23 for the detector. The notebook's upload step stays optional and runs only if the Hugging Face secret is set. |

## Open
- AC07: licenses of the datasets in `docs/datasets.md`; final comparison set; owner datasets; Philippine test set; hosting tier; hypothesis test (with the instructor).
