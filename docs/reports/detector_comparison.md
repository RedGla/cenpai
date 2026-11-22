# Detector comparison (Phase 5)

Status: model choice locked on 2026-11-23, before any test split was read. Test and phone sections follow once they are measured.

All numbers below are copied from `notebooks/train_detector_compare.ipynb` output on validation (PH BB v5 val plus Open Images val). Thresholds come from validation by the notebook's rule: `conf` is the highest confidence with recall at least 0.95, else best F1; `mask_conf` is the lowest confidence not below 0.10 with precision at least 0.90.

## Runs (one seed each)

The quota allowed one seed per run, so there is no mean or spread yet.

| run | start | data | mask_conf | R (all) | P (all) | R (OI) | R (PH BB) | wall h | ONNX 640 sha256[:12] |
|---|---|---|---|---|---|---|---|---|---|
| R1c | yolov8n.pt (COCO) | PH BB v5 + internet sets + keyboards, strong aug | 0.15 | 0.9069 | 0.9029 | 0.8308 | 0.9976 | 0.909 (resumed part) | f9ee2044cc48 |
| S-all | yolov8n.pt (COCO) | R1c data + synthetic (capped) | 0.17 | 0.9035 | 0.9011 | 0.8247 | 0.9976 | 2.624 | ef756b874fec |
| C3-s0 | yolo11n.pt (COCO) | R1c data | 0.21 | 0.8997 | 0.9012 | 0.8175 | 0.9976 | 1.266 (resumed part) | f18943b934d3 |
| R1 | v0 | R1c data | 0.14 | 0.8975 | 0.9009 | 0.8124 | 0.9988 | 2.026 | 4f8a9803ba4d |

R1's PH BB score is optimistic: v0 trained on part of the old PH BB split.

Open Images validation at `mask_conf`, ONNX at 640:

| run | P | R | TP / FP / FN | mAP@0.50 | mAP@0.50:0.95 |
|---|---|---|---|---|---|
| R1c | 0.8402 | 0.8308 | 815 / 155 / 166 | 0.8525 | 0.5421 |
| S-all | 0.8454 | 0.8247 | 809 / 148 / 172 | 0.8565 | 0.5589 |
| C3-s0 | 0.8514 | 0.8175 | 802 / 140 / 179 | 0.8418 | 0.5417 |
| R1 | 0.8372 | 0.8124 | 797 / 155 / 184 | 0.8365 | 0.5308 |

## Choice (locked 2026-11-23)

**R1c**: yolov8n from COCO weights, fine-tuned on PH BB v5 plus the internet sets plus the keyboard images, with strong augmentation, no synthetic data.

Reason, from validation only: R1c has the highest recall at `mask_conf` on both sets together (0.9069) and on Open Images (0.8308), with precision at least 0.90 on both sets together (0.9029). No other run beat it on recall. The synthetic data (S-all) did not raise recall at `mask_conf`, so it is not kept. The gaps between runs are small and come from one seed each, so this is a pilot result, not a significant difference.

Release files: `MyDrive/CenpAI/release/compare/R1c/plate-640/` and `plate-416/`, each with a `MODEL.json` (ONNX 640 sha256 `f9ee2044cc483a1e1ea9f0791104097cd46e6b949a6ed2f76958c99e9455536e`).

## Locked test comparison

Not yet run.

## Phone test

Not yet run.

## Limitations

- One seed per run; no spread.
- Wall times for R1c and C3-s0 cover only the epochs after a resume.
- The matrix was cut down to fit the free-GPU quota.
- Internet data comes from other countries.
