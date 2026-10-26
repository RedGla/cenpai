# models/

Deployed detector artifacts. **No trained model is committed yet**; until one is added the app reports `/healthz` 503
and refuses uploads. `python -m ml.train` writes both files to `runs/<name>/release/`; copy them here only after
`ml.evaluate` has produced the test report (the `/model-release` skill walks through it).

Required files:

- `<name>.onnx`: single-class Ultralytics detect export, input `(1,3,S,S)`, output `(1,5,N)`, no NMS in the graph. Keep under 50 MB.
- `MODEL.json`:

```json
{
  "file": "<name>.onnx",
  "sha256": "<hex digest of the .onnx file>",
  "imgsz": 640,
  "conf": 0.25,
  "iou": 0.5,
  "names": ["license_plate"],
  "version": "<run name / date>",
  "eval_report": "docs/reports/eval_<name>_test.md"
}
```

`conf`/`iou`/`imgsz` must be the values chosen on the validation split and used in the evaluation report. The app
verifies the checksum and the input size on startup. PyTorch checkpoints (`*.pt`) are never committed.
