# Detector experiment matrix (Phase 5)

The training runs for the fine-tuning study, in the order to run them. Each run is one setting of `notebooks/train_detector_compare.ipynb` (Phase 5 step 6). Data is dataset v2 (`docs/datasets.md`), built by `notebooks/build_dataset_v2.ipynb`. The rules are in `docs/protocols/data_and_phone_test.md`.

## Rules for every run

- **Choices come from validation only:** PH BB v5 val (re-split) and Open Images val, reported separately and together. Test splits and the final phone clips are used once, after the choice is locked.
- **Main score:** validation recall at `mask_conf`. `mask_conf` is the lowest confidence, not below 0.10, at which validation precision is at least 0.90 (decision 24). Also report precision, mAP@0.50 and mAP@0.50:0.95, and the recall at `conf` (decision 5).
- **Keep a change** (a data source, a synthetic kind, an augmentation) only if it raises validation recall at `mask_conf` without a large precision loss. A difference smaller than the seed spread measured in block C is not evidence. Until block C has run, treat ablation differences as provisional.
- **Same budget** within a block: same epochs, input size, batch, and augmentation unless that is what the block varies. Early stopping is off in blocks C and D (`patience` equal to `epochs`), so every model gets the same number of epochs and the best checkpoint is picked on validation.
- **Record with every model:** the ONNX output shape (YOLOv8 and YOLO11 give `(1, 5, N)`; YOLO26 exports end-to-end without NMS and gives a different shape), the `MODEL.json` sha256, and the training wall time.

## Leak warning: weights started from v0

v0 was trained on Roboflow's PH BB v5 train split. Dataset v2 re-splits PH BB v5 by group, so some images v0 trained on are now in v2's PH BB **val and test**. Any model started from v0 weights has seen them:

- Its PH BB val and test scores are optimistic. Its Open Images val and test scores are clean, because v0 never saw Open Images.
- So run R1 is judged on **Open Images val**, with PH BB val shown only as a caveated column. v0 itself is shown the same way.
- The model locked for the phone must start from COCO weights (or a public checkpoint whose training data is checked, block D), not from v0. That keeps both test splits clean.

## Hour estimates

Measured base: yolov8n, 50 epochs at 640 on 4,335 training images took 0.880 h on a free Colab T4; yolo11n took 0.927 h (`docs/reports/detector_v0.md`). Estimates scale from that:

`hours ≈ 0.88 × (training images / 4,335) × (epochs / 50) × model factor × (input size / 640)²`

- **Assumed:** 10,000 v2 training images. Replace this with the count from the dataset notebook. At that count, yolov8n for 50 epochs at 640 is about 2.0 h.
- **Model factors:** yolov8n 1.0 and yolo11n 1.05 (measured ratio). yolo26n 1.1, and yolov8s and yolo11s 2.0, are guesses; correct them after the first run of each.
- **Input size:** the `(size / 640)²` term overstates the saving at 320 and 416, because data loading does not shrink. Treat those two estimates as floors.

These are estimates, not results. Replace each one with the measured wall time once the run is done.

## Runs, in priority order

### A. First: does the new data help? (about 4 h)

| ID | Start from | Training data | Augmentation | Epochs, size | Seeds | Compared with | Est. h |
|---|---|---|---|---|---|---|---|
| R1 | v0 `best.pt` | v2 train: PH BB v5 + PH train-only sets + internet sets + keyboard images | strong (below) | 50, 640 | 0 | v0 on Open Images val (main) and PH BB val (caveated) | 2.0 |
| R1c | COCO `yolov8n.pt` | same as R1 | strong | 50, 640 | 0 | R1 and v0 | 2.0 |

Strong augmentation, the protocol's starting point: `hsv_v=0.6, hsv_s=0.7, degrees=10, perspective=0.0008, scale=0.6, translate=0.2, mosaic=1.0, mixup=0.1, close_mosaic=10`.

R1c is the same recipe started from COCO. It is the clean counterpart of R1 and the reference for the ablations.

### B. Ablations, each on or off (about 15 h)

These use a shorter budget than the comparison: yolov8n from COCO, 30 epochs at 640, seed 0. The reference is B0, which has every source on and no synthetic data. Each row changes one thing from B0. Synthetic rows add one kind on top of the best data mix found by the source rows.

| ID | Change from B0 | Question | Est. h |
|---|---|---|---|
| B0 | none (all sources, strong augmentation, no synthetic) | reference | 1.2 |
| B1 | PH sources only (PH BB v5, usp, ph-plate-vehicle) | do internet sets help at all? | 0.5 |
| B2 | without Open Images train | — | 0.9 |
| B3 | without CCPD sample | — | 1.0 |
| B4 | without ZeroExperiments motorcycles | — | 1.1 |
| B5 | without Hanoi motorcycles | — | 1.1 |
| B6 | without keyboard images | do no-plate images cut false masks? Also check precision | 1.2 |
| B7 | default augmentation instead of strong | does strong augmentation help? | 1.2 |
| S1 | + offline variants (dark, backlit, motion blur, noise, compression) | night and backlight | 1.6 |
| S2 | + copy-paste plates onto no-plate images, including half off the edge | edge plates, false masks | 1.6 |
| S3 | + screen effect (moiré, glare, colour shift) | plates on screens | 1.6 |
| S4 | + rendered Philippine-style plates (made-up text) | more PH layouts | 1.6 |

The synthetic folders come from `notebooks/make_synthetic.ipynb` (step 7) and are switched on or off per run. They are made from training images only. Rerun `ml.dataset.leak_report(v2, extra_train=[...])` with the synthetic folders before training on them.

If the internet share of training images is above half (the dataset notebook prints it), oversample PH BB v5 in the training list rather than dropping sources.

### C. Comparison set (about 43 h)

Same data (the best mix from block B), same augmentation, 50 epochs at 640, batch 16, early stopping off, from COCO weights.

| ID | Model | Seeds | Est. h per seed | Est. h total |
|---|---|---|---|---|
| C1 | YOLOv8n | 0, 1, 2 | 2.0 | 6.1 |
| C2 | YOLOv8s | 0, 1, 2 | 4.1 | 12.2 |
| C3 | YOLO11n | 0, 1, 2 | 2.1 | 6.4 |
| C4 | YOLO11s | 0, 1, 2 | 4.1 | 12.2 |
| C5 | YOLO26n | 0, 1, 2 | 2.2 | 6.7 |

Report one row per seed, then the mean and spread. Choose the phone model by the mean validation recall at `mask_conf`. If two models are within one seed spread of each other, take the faster one on the phone (the app's Benchmark).

### D. Starting weights, input size, number format (about 4 h)

Run on the model chosen in block C.

| ID | What changes | How | Est. h |
|---|---|---|---|
| D1 | Start from a public plate checkpoint (for example `morsetechlab/yolov11-license-plate-detection`) instead of COCO | Train as in C, seed 0. First check what data it was trained on: if it includes Open Images or PH BB images, its scores on those validation and test splits are not clean, and it cannot be the locked model | 2.1 |
| D2 | Input size 416 | Train at 416, seed 0. Also score the C model exported at 416 without retraining | 0.9 (floor) |
| D3 | Input size 320 | As D2 at 320 | 0.5 (floor) |
| D4 | Number format 32-bit, 16-bit, 8-bit | Export only, no training. Score each on validation, and time it on the phone with the app's Benchmark. 16-bit has been reported to break WebGPU (`docs/PLAN.md` §5) | 0.3 |

### E. Locked comparison, once (about 0.5 h)

After the choice is locked and written down: v0 and the chosen model on the PH BB v5 test split and the Open Images test split (precision and recall at `mask_conf`, mAP), scored once. v0's PH BB test score carries the leak caveat above. Then the final phone clips go through video-file mode, once per locked model (protocol, "How a clip is scored").

## Totals and quota

All blocks add up to about 66 GPU hours at the assumed 10,000 training images. Free Colab sessions disconnect and have no fixed quota. Kaggle shows a weekly GPU quota on its settings page. Plan on two accounts in parallel for about two weeks, and let the training notebook resume from `last.pt` on Drive.

## What to drop first if the quota runs out

Drop from the top of this list. Never drop R1, R1c, B0, B1, seeds 0-2 of C1, C3 and C5, or block E.

1. Seeds 1 and 2 of C2 and C4 (the "s" models). Report them as single-seed rows and say so. Saves about 16 h.
2. D2 and D3 retraining. Keep the export-only size comparison. Saves about 1.4 h.
3. D1, the plate checkpoint start. Saves about 2 h.
4. B4 and B5: merge them into one "without motorcycle sets" run. Saves about 1 h.
5. S1 to S4: merge them into one "all synthetic kinds" run, and split them only if it helps. Saves about 5 h.
6. C2 and C4 entirely, so only the "n" models are compared. Saves about 8 h more. The paper then says the "s" models were not compared.
