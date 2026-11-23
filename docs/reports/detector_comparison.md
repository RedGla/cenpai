# Detector comparison (Phase 5)

Status: model choice locked on 2026-11-23, before any test split was read. The locked test comparison and the phone test were each run once after that.

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

Run once on 2026-11-23, after the model choice was locked.

How it was run:

1. 36 usable family-car clips were split before any playback: 8 look clips (one per car condition plus one motorcycle clip) and 28 final clips. One clip was unusable (over-exposed). Only the final clips are scored here.
2. Each final clip was played once through each locked model in video-file mode (`?video=1` for v0, `?video=1&model=r1c` for R1c), on a laptop in Chromium, WebGPU, 640 px, solid masks, with a fresh page load per clip. The censored output was recorded by the app's own recorder: 56 recordings.
3. The recordings were relabelled with shuffled names, so scoring was blind to the model. Frames sampled at 2 per second were scored twice under two thresholds:
   - normal: a plate counts as readable if most of its characters can be read in the frame;
   - strict: readable if two or more characters can be made out, or any legible part of the plate is outside the mask; when unsure, it counts as leaked.
4. One row per plate appearance per model went into `phone_test_results.csv` (kept with the clips, never in Git), and `python tools/score_phone_test.py` produced the tables below. Uncovered frames are estimated as leaked samples times the recording's frame rate over 2.

Each recording starts with one frame (sample s000) left over from the playback setup: the clip was paused and rewound before recording started, so the first recorded frame is the last frame painted during that pause, followed by a short all-black run. A clip that plays straight through, or the live camera, does not produce it. The main tables leave s000 out; the second pair counts it.

Leak rate, s000 left out:

| threshold | model | leaked / appearances | leak rate | 95% CI | uncovered frames per leak |
|---|---|---|---|---|---|
| normal | v0 | 13 / 39 | 0.333 | 0.206-0.490 | 33.6 (median 27, max 106) |
| normal | R1c | 2 / 34 | 0.059 | 0.016-0.191 | 22.0 (median 29, max 29) |
| strict | v0 | 26 / 51 | 0.510 | 0.377-0.641 | 27.8 (median 17, max 106) |
| strict | R1c | 3 / 48 | 0.062 | 0.021-0.168 | 21.7 (median 21, max 29) |

Leak rate with s000 counted:

| threshold | model | leaked / appearances | leak rate | 95% CI |
|---|---|---|---|---|
| normal | v0 | 17 / 39 | 0.436 | 0.293-0.590 |
| normal | R1c | 6 / 34 | 0.176 | 0.083-0.335 |
| strict | v0 | 35 / 51 | 0.686 | 0.550-0.797 |
| strict | R1c | 13 / 48 | 0.271 | 0.166-0.410 |

The two thresholds split plate appearances differently (the strict pass counted more re-entries of the same plate), so the denominators differ.

Leaks per condition, s000 left out (counts only; groups this small support no claims):

| condition | normal v0 | normal R1c | strict v0 | strict R1c |
|---|---|---|---|---|
| 1 Approach | 2 / 3 | 0 / 3 | 2 / 3 | 0 / 3 |
| 2 Pan in from the edge | 4 / 9 | 0 / 8 | 11 / 20 | 0 / 15 |
| 3 Angles | 3 / 3 | 2 / 3 | 3 / 3 | 2 / 4 |
| 4 Night | 0 / 3 | 0 / 3 | 0 / 3 | 0 / 3 |
| 5 Backlight | 0 / 2 | 0 / 2 | 0 / 2 | 0 / 2 |
| 6 Shake | 0 / 3 | 0 / 3 | 1 / 3 | 0 / 3 |
| 7 Partly covered | 1 / 3 | 0 / 3 | 2 / 3 | 1 / 3 |
| 8 Motorcycle | 3 / 12 | 0 / 8 | 5 / 11 | 0 / 14 |
| 9 Plate on a screen | 0 / 1 | 0 / 1 | 2 / 3 | 0 / 1 |

False masks on the no-plate clip (one clip per model, 2 samples per second): v0 17.5 s, R1c 3.0 s, the same under both thresholds.

### Mask size

Measured on every frame of the 56 recordings, not sampled: a frame counts when solid black box-shaped regions (the app's mask) cover more than half of it.

| model | frames | frames with masks over half the frame | fully black frames | frames with the shutter closed | clips with any frame over half |
|---|---|---|---|---|---|
| v0 | 10,625 | 1,843 (17.3%) | 274 (2.6%) | 264 (2.5%) | 24 / 28 |
| R1c | 11,497 | 1,772 (15.4%) | 229 (2.0%) | 207 (1.8%) | 24 / 28 |

Shutter frames are found by a sharpness threshold, so that column is an estimate. Most of the oversized masks are not the shutter: in `web/src/track/tracker.ts`, `maskRect` paints the union of the detected box and the box moved along the estimated motion, then pads it by a margin that grows for every frame since the last detection, and long-held tracks keep growing. Close plates, fast pans and plates that leave view end with masks far larger than the plate, sometimes the whole frame. Both models show it about equally; it is a tracker setting, not a detector result.

## Limitations

- One seed per run; no spread.
- Wall times for R1c and C3-s0 cover only the epochs after a resume.
- The matrix was cut down to fit the free-GPU quota.
- Internet data comes from other countries.
- No box-level scores on the phone footage: it is not labelled, so the phone test counts leaks only.
- Few phone clips, recorded by the family with their own vehicles; per-condition groups are examples, not evidence.
- The phone test was scored from frames sampled at 2 per second, not every frame, so a leak shorter than half a second can be missed and uncovered frames are estimates.
- Playback ran on a laptop GPU, not the phone; the phone runs the detector more slowly, so masks may lag more there.
