# CenpAI Product Requirements Document

Automatic license plate censoring for images and videos. ARC Inc. · Version 2.0 · 26 October 2026 (revises v1.0 of the same date).

## 0 What changed from v1.0

| Area | v1.0 | v2.0 |
|---|---|---|
| Model strategy | Fine-tune YOLOv8n first, then a four-model comparison | **A:** fine-tune a pretrained YOLO detector (baseline YOLO11n) on our datasets and serve it as ONNX. **B:** use the zero-shot detector OWLv2 (`google/owlv2-base-patch16`) offline, to draft labels for unlabeled data and as a no-training reference baseline. OWLv2 is never served. |
| Image classifiers | Not addressed | Rejected. A classifier such as `google/vit-base-patch16-224` labels the whole image and cannot locate a plate, so it cannot drive censoring. |
| Dataset licensing | Adopt a source only after verifying its terms | Sources **without an official license** may be used for training and research. Their license is recorded as `unstated`, their media is never redistributed, and the risk is listed as a release blocker for the owner to accept or clear. |
| Labels | Not addressed | OWLv2 labels are drafts. Validation and test labels must be human-reviewed; training data may use reviewed drafts only. |
| Tooling | Claude Code Pro, Sonnet by default, no parallel agents | Claude Code with project subagents, each on the model suited to its task. Paid compute and hosting still need owner approval. |
| Repository | Private | Public, AGPL-3.0 (Ultralytics is AGPL-3.0, and a hosted service must offer its source). |

## 1 Product objective

Build a deployed website that lets content creators, journalists, and everyday users upload media, automatically censor detected license plates, review the result, and download it. Deliver a reproducible training and evaluation workflow alongside it.

Prioritize detection recall and complete masking. Users must review results before sharing; the product never promises that every plate is detected.

## 2 Scope

**Required:** JPG, JPEG, and PNG images; short MP4 videos up to 1080p; automatic detection and censoring; processing status; preview and download; temporary file deletion; dataset ingestion (public and user-supplied); auto-labelling of unlabeled data; trained model artifacts; evaluation reports; a GitHub repository; a working hosted website.

**Excluded from the first release:** plate transcription or owner identification, face censoring, live camera feeds, mobile apps, accounts, billing, permanent media history, batch uploads, a manual video editor.

Google Colab stays available for training. The website must work without a Colab or Gradio share link.

## 3 Model strategy

**Served detector (A).** A pretrained YOLO detector, fine-tuned on our single-class `license_plate` data and exported to ONNX (input `(1,3,S,S)`, output `(1,5,N)`, no NMS in the graph). Start from COCO weights, or from a public plate checkpoint if its license allows and it beats COCO weights on validation. Baseline: YOLO11n. Comparison set (from Chapter 1 §1.7): YOLOv8n, YOLOv8s, YOLO11n, YOLO11s, all on identical splits, evaluation code, hardware, and a documented training budget.

**Labelling helper and reference (B).** OWLv2 is prompted with "license plate" to draft boxes for unlabeled images. Drafts are reviewed, for example in Roboflow, before use. OWLv2 is also evaluated zero-shot on the test set as a reference row in the comparison table. It is too slow on CPU for the website.

**Not used:** image classifiers (ViT and similar), because they cannot localize plates.

## 4 User workflow

Open the website → read the limits and privacy notice → upload one file → choose a censoring mode → process → preview the censored result → review it → download or delete it.

## 5 Functional requirements

- **FR01 Upload validation.** Accept JPG/JPEG/PNG and decodable MP4 only, checked by content as well as extension. Proposed caps: images 20 MB and 20 MP; videos 100 MB, 60 s, 1920 × 1080, 30 fps. Validate decoded dimensions, duration, and frame rate before processing. Benchmark the caps before release.
- **FR02 Detection.** Load an identified, checksum-verified plate detector and run it on every image and every decoded video frame. Support multiple, small, and absent plates. Never substitute a classifier or fabricated detections.
- **FR03 Censoring.** Default to an opaque solid mask with padding, clipped to the image. Gaussian blur and pixelation are optional and only at tested strengths. Keep coordinate transforms correct through resizing and rotation.
- **FR04 Video integrity.** Detect on every frame; tracking may supplement detection but never replace it. Preserve duration, orientation, and audio sync. Produce browser-playable MP4 and document any re-encoding.
- **FR05 Progress and errors.** Show queued, processing, complete, failed, and expired states, with progress where measurable. Handle corrupt files, timeouts, full queues, model-load failures, and cancellation. A partially processed video is never labelled complete.
- **FR06 Review and download.** Preview only the completed output; download in the original image format or MP4. Always show a review reminder. If nothing is detected, say so; never call the media safe.
- **FR07 Cleanup.** Provide a delete action. Remove inputs, intermediates, outputs, and framework caches on delete, failure, restart, or expiry. Hard maximum retention is one hour from upload; deletion takes effect within five minutes.
- **FR08 Interface.** Responsive, keyboard-accessible, visible labels, readable contrast, concise errors, a clear reset. Show limits before upload. Keep research controls out of the upload flow.

## 6 Datasets

- Combine public plate datasets with the owner's datasets. Prefer Philippine plates and report coverage gaps honestly.
- Keep a register (`docs/datasets.md`) with: source URL, version, license (`unstated` when none), attribution, permitted use, geography and plate layouts, image and box counts, annotation format and label origin (human, reviewed OWLv2 draft, unreviewed), known issues, and the decision.
- Use one class, `license_plate`. Check for corrupt media, invalid boxes, exact and near duplicates, label consistency, and negative images. Record the cleaned dataset version and provenance.
- Split by source video, capture session, or scene **before** extracting frames or augmenting, keeping duplicates and adjacent frames together. Fixed manifest, 70/15/15 unless a source's official split applies. Augment training data only. Sources flagged train-only never enter validation or test.
- Validation selects thresholds, hyperparameters, and the model; test is used once for the final locked comparison. New data means a new dataset version, never a silently changed test set. Include an independent Philippine test set where possible.
- Raw media and private annotations stay outside Git (`C:\Users\rapha\CenpAI-data\`). Website uploads are never used for training.

## 7 Training

Run a pipeline smoke test, then fine-tune the YOLO11n baseline, then the comparison set. Record seeds, image size, epochs, early stopping, batch size, augmentations, pretrained weights, package versions, and the exact command. Save checkpoints, configurations, logs, manifests, and artifact hashes outside Git. Export the chosen model and verify that the serving code reproduces the evaluated numbers.

Compute: the local GTX 1650 (4 GB) or Colab. No paid compute without owner approval. If data or compute is missing, finish runnable scripts and mark training incomplete. Never invent scores or ship an untrained placeholder.

## 8 Evaluation

- Report precision, recall, F1, mAP@0.50, and mAP@0.50:0.95, with the confidence and IoU thresholds, dataset counts, and matching protocol. Include false positives, false negatives, and incomplete-censoring examples.
- Prioritize recall and report the false-positive cost. Break results down by plate size, angle, lighting, occlusion, motion blur, and layout where labels allow, with sample counts. Don't over-interpret small groups.
- Measure detector-only FPS and full-pipeline time on the same declared hardware: cold start, warm image latency, video time relative to duration, peak memory.
- Assess censoring on the final encoded files, across consecutive video frames. A detector box is not proof of censoring.
- Justify the selected checkpoint with a comparison table and error analysis. Any hypothesis test must account for correlated frames and be confirmed with the instructor.

## 9 Acceptance gates

- **AC01 End to end.** On the deployed URL, every supported format completes upload, processing, preview, download, and deletion, including multiple plates, no plates, motion, small plates, corrupt and oversized files, and timeout or restart failures.
- **AC02 Detection target.** Proposed: recall ≥ 95 % and precision ≥ 90 % at IoU 0.50 on the frozen test set, at a threshold chosen on validation. Targets, not results. Report mAP and F1 even if missed.
- **AC03 Censoring target.** No readable plate in the declared, manually annotated release-check sample, including checked video frames. Publish sample counts and selection method.
- **AC04 Privacy and integrity.** No cross-session access; delete and expiry remove every copy; logs hold no media or plate text; failed jobs expose no download; output decodes correctly with A/V sync.
- **AC05 Performance.** Benchmark the actual hosting instance and set caps, queue size, and timeout from the measurements.
- **AC06 Reproducibility.** A fresh environment can run the tests, a sample inference, and the training and evaluation commands. Unmet gates are listed as blockers; a limited demo is labelled as one.
- **AC07 Licensing.** Before release, each dataset with an `unstated` license is either cleared or explicitly accepted by the owner in `docs/DECISIONS.md`.

## 10 Architecture and deployment

One Python app: Gradio inside FastAPI, ONNX Runtime inference (no PyTorch at serving time), OpenCV for images, FFmpeg for video. Dataset preparation, auto-labelling, training, and evaluation live in `ml/`, separate from serving. Deploy as one Docker web service on Render with one instance, bounded concurrency, and a bounded queue. Jobs are in memory, so a restart interrupts work. Add a worker, queue, or object storage only if a benchmark requires it. Pin dependencies, verify the model checksum on load, and expose a `/healthz` readiness check for the model and FFmpeg. No paid hosting without approval.

## 11 Privacy and operations

HTTPS, unguessable session-bound job access, private temporary files, no public media listing. Size, pixel, duration, concurrency, and rate limits. No unauthenticated bypass through framework API routes. Treat file names and media as untrusted: generated storage names, bounded decoding, list-argument subprocesses, no shell interpolation. Strip identifying metadata from outputs. Log timings, status, and model version only. Secrets live in environment settings; `.env.example` holds placeholders only. Explain that audio and faces are not anonymized.

## 12 Milestones

- **M1 Plan.** Done in v1.0.
- **M2 Working application.** Done: image and video pipelines, cleanup, tests, CI, Docker, Render blueprint.
- **M3 Reproducible model.** Dataset register and ingestion, OWLv2 drafts and review, fixed split, YOLO11n baseline, comparison set, evaluation reports.
- **M4 Release candidate.** Integrate the evaluated model, benchmark, verify privacy and failure cases, fix blockers.
- **M5 Hosted delivery.** Deploy to Render, run live acceptance checks, and hand over the URLs, model identity, measured results, limitations, and deploy and rollback steps.

## 13 Handoff

Repository: app and ML source, pinned dependencies, Dockerfile, Render config, tests and CI, a Colab notebook, the dataset register and split manifests, a model card, comparison and error-analysis reports, a README, `STATUS.md`, and `docs/DECISIONS.md`. Record AI assistance accurately.

Open decisions: datasets with `unstated` licenses (AC07), the final comparison set, the user datasets once supplied, any paid compute or hosting, and whether the acceptance targets fit the intended use.

## 14 References

- Context: `docs/source/ARC Inc_ML CenpAI CH1.docx` (Chapter 1, §1.5–1.10 and Methods).
- Render, Deploy a FastAPI App: https://render.com/docs/deploy-fastapi
- Ultralytics YOLO11: https://docs.ultralytics.com/models/yolo11/
- OWLv2: https://huggingface.co/google/owlv2-base-patch16
