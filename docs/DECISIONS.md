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

## Open
- AC07: licenses of the datasets in `docs/datasets.md`; final comparison set; owner datasets; Philippine test set; hosting tier; hypothesis test (with the instructor).
