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

## Locked test comparison (run once, 2026-11-23)

Scored once by the notebook's locked cell after the choice above was committed. ONNX at 640, CPU, thresholds read from each model's `MODEL.json`: v0 `conf` 0.81, `mask_conf` 0.10; R1c `conf` 0.31, `mask_conf` 0.15. Test splits: PH BB v5 test (817 images, 863 plates) and Open Images test (2059 images, 2827 plates).

At `mask_conf` (what the app masks):

| model | set | P | R | TP / FP / FN | mAP@0.50 | mAP@0.50:0.95 |
|---|---|---|---|---|---|---|
| v0 | PH BB | 0.9977 | 0.9965 | 860 / 2 / 3 | 0.9950 | 0.8885 |
| v0 | Open Images | 0.9273 | 0.3654 | 1033 / 81 / 1794 | 0.4654 | 0.2727 |
| v0 | both | 0.9580 | 0.5130 | 1893 / 83 / 1797 | 0.6019 | 0.4329 |
| R1c | PH BB | 0.9411 | 1.0000 | 863 / 54 / 0 | 0.9949 | 0.7893 |
| R1c | Open Images | 0.8543 | 0.8065 | 2280 / 389 / 547 | 0.8335 | 0.5237 |
| R1c | both | 0.8765 | 0.8518 | 3143 / 443 / 547 | 0.8773 | 0.5941 |

At `conf`:

| model | set | P | R |
|---|---|---|---|
| v0 | PH BB | 1.0000 | 0.9548 |
| v0 | Open Images | 0.9879 | 0.1153 |
| v0 | both | 0.9965 | 0.3117 |
| R1c | PH BB | 0.9663 | 0.9954 |
| R1c | Open Images | 0.9193 | 0.7658 |
| R1c | both | 0.9322 | 0.8195 |

v0's PH BB test score is optimistic: v0 trained on part of that split. Open Images test is clean for both models. On it, R1c finds 2280 of 2827 plates at `mask_conf` against v0's 1033, at lower precision (0.8543 against 0.9273). On both sets together, R1c's precision at `mask_conf` (0.8765) is below the 0.90 target that held on validation (0.9029).

The first attempt at this cell stopped on a missing import before any test image was predicted and wrote no marker; the import was fixed (aca9eb2) and the cell then ran once.

## Phone test

Not yet run.

## Limitations

- One seed per run; no spread.
- Wall times for R1c and C3-s0 cover only the epochs after a resume.
- The matrix was cut down to fit the free-GPU quota.
- Internet data comes from other countries.
