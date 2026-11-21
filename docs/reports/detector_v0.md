# Plate detector v0 (Phase 1)

Measured on 2026-11-16 with `notebooks/train_detector_v0.ipynb` on a free Colab T4. Every number below is copied from that notebook's printed output.

**These are pilot numbers.** The dataset split may put related images (near-duplicates or augmented copies of one photo) in both train and test, so test scores can be optimistic. The earlier paper numbers came from a notebook that was lost; this run is the new baseline.

## Data

License Plate Detection PH BB, version 5 (Roboflow Universe, CC BY 4.0, by Alyssa Marie), YOLOv8 export. The label check keeps an image only if it decodes and every label row has five numeric fields, class 0, a centre inside 0 to 1, and positive width and height.

| split | images in export | images kept | boxes kept | excluded (row without 5 fields) | paper images | paper boxes |
|---|---|---|---|---|---|---|
| train | 4842 | 4335 | 4599 | 507 | 4335 | 4599 |
| val | 460 | 418 | 445 | 42 | 418 | 445 |
| test | 230 | 203 | 226 | 27 | 203 | 226 |
| total | 5532 | 4956 | 5270 | 576 | 4956 | 5270 |

The kept counts match the paper exactly. No kept image was empty.

## Training

All runs start from the Ultralytics COCO weights, at 640 px, batch 16, seed 0.

| run | weights | epochs | result |
|---|---|---|---|
| smoke | `yolo11n.pt` | 3 | training wall time 4.1 min |
| full | `yolov8n.pt` | up to 50, patience 10 | 50 epochs completed in 0.880 hours; best epoch 46 |
| full | `yolo11n.pt` | up to 50, patience 10 | 50 epochs completed in 0.927 hours; best epoch 49 |

## Results

The threshold is chosen on validation only: the highest confidence that keeps recall at or above 0.95. Test precision, recall and F1 use the notebook's matching rule: each prediction, highest score first, takes at most one unused ground-truth box at IoU 0.50 or more. mAP comes from the Ultralytics validator on the test split. The ONNX rows are the exported files the app serves (opset 12, static shape, no NMS in the graph, `half=False`).

| model | imgsz | conf | val P | val R | test P | test R | test F1 | TP | FP | FN | mAP@0.50 | mAP@0.50:0.95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| smoke yolo11n onnx | 640 | 0.68 | 0.9860 | 0.9528 | 0.9817 | 0.9469 | 0.9640 | 214 | 4 | 12 | 0.9799 | 0.7562 |
| smoke yolo11n onnx | 416 | 0.62 | 0.9748 | 0.9551 | 0.9725 | 0.9381 | 0.9550 | 212 | 6 | 14 | 0.9656 | 0.7387 |
| yolov8n best.pt | 640 | 0.81 | 0.9953 | 0.9551 | 0.9909 | 0.9646 | 0.9776 | 218 | 2 | 8 | 0.9934 | 0.9101 |
| yolov8n onnx | 640 | 0.81 | 0.9953 | 0.9551 | 0.9909 | 0.9646 | 0.9776 | 218 | 2 | 8 | 0.9940 | 0.9115 |
| yolov8n onnx | 416 | 0.78 | 0.9953 | 0.9506 | 0.9909 | 0.9646 | 0.9776 | 218 | 2 | 8 | 0.9935 | 0.8969 |
| yolo11n best.pt | 640 | 0.84 | 0.9930 | 0.9551 | 1.0000 | 0.9469 | 0.9727 | 214 | 0 | 12 | 0.9948 | 0.9109 |
| yolo11n onnx | 640 | 0.84 | 0.9930 | 0.9551 | 1.0000 | 0.9469 | 0.9727 | 214 | 0 | 12 | 0.9949 | 0.9040 |
| yolo11n onnx | 416 | 0.77 | 0.9907 | 0.9528 | 1.0000 | 0.9558 | 0.9774 | 216 | 0 | 10 | 0.9948 | 0.9077 |

Speed on the phone has not been measured yet (Phase 2).

## Masking threshold (`mask_conf`)

`conf` is the detection threshold: the highest confidence that keeps validation recall at 0.95 or more. `mask_conf` is a second, lower threshold for masking. It is the lowest confidence, not below 0.10, at which validation precision is still 0.90 or more. It was measured with section 11 of the notebook on the shipped yolov8n ONNX files, with the same matching rule as above. That run re-measured `conf` and got the same values (0.81 and 0.78) and the same test scores as the table above. The ONNX files did not change, so their `sha256` values are unchanged.

| model | imgsz | conf | mask_conf | val P @ mask_conf | val R @ mask_conf | test P @ mask_conf | test R @ mask_conf |
|---|---|---|---|---|---|---|---|
| yolov8n onnx | 640 | 0.81 | 0.1 | 0.9801 | 0.9955 | 0.9781 | 0.9867 |
| yolov8n onnx | 416 | 0.78 | 0.1 | 0.9845 | 0.9978 | 0.9825 | 0.9912 |

At both sizes, validation precision is already above 0.90 at the 0.10 floor, so `mask_conf` sits at the floor.

## Choice for the app

`web/public/models/plate-640/` and `plate-416/` hold the **yolov8n** files.

- **Validation recall.** At 640 the two full runs tie on validation recall at their thresholds; at 416, yolo11n is slightly higher.
- **Serving check.** Each folder was also loaded with `cenpai.detector.load_detector` and run on sample images from the dataset's test split. The yolo11n 640 file missed a plate on one sample image, scoring just under its threshold. The smoke model missed on more than one. yolov8n found a plate in every sample image at both sizes.
- **Decision.** With validation tied at 640, the serving check decided it, so the app ships yolov8n. Test scores were not used to choose.

| folder | file | sha256 | conf | mask_conf | version |
|---|---|---|---|---|---|
| `plate-640` | `plate_640.onnx` | `7190eb398899a34d09064a4c46522188cdd5fc9784862bfeef3f4bba49f8907c` | 0.81 | 0.1 | `v0-yolov8n-640` |
| `plate-416` | `plate_416.onnx` | `41d576d4d7315068f87cda60d643d7a494b4c47f75c82614d6ad3b6d50191ce8` | 0.78 | 0.1 | `v0-yolov8n-416` |

The weights (`best.pt`), the other exports, and `results.csv` for each run are on the owner's Google Drive under `CenpAI/release/`. They are not uploaded to Hugging Face (decision 30 in `docs/DECISIONS.md`).
