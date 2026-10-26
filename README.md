# CenpAI: automatic license plate censoring

Upload a JPG/JPEG/PNG image or a short MP4. CenpAI finds license plates with a fine-tuned YOLO detector and covers them (solid mask by default; blur or pixelation optional) on every frame. You preview, review, then download or delete the result.

> **Status:** the app is complete; **no trained model is included yet.** Without a verified model in `models/`, `/healthz` returns 503 and uploads are refused. Detection accuracy has not been measured. Automatic detection can miss plates, so always review the output. Audio and faces are not anonymized.

## Run locally

Python 3.12 and FFmpeg/ffprobe on `PATH`.

```bash
python -m venv .venv && .venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
python -m cenpai.app                                     # http://localhost:7860
```

`CENPAI_DEV_STUB=1 python -m cenpai.app` draws a **fake** box on every frame, so you can try the interface without a model. It is not a detector, `/healthz` stays 503, and it is refused on Render.

Docker: `docker build -t cenpai . && docker run --rm -p 7860:7860 cenpai`.

## Train a model

```bash
pip install -r requirements-ml.txt
python -m ml.autolabel --images <unlabeled dir> --out <drafts dir>     # optional OWLv2 drafts; review before use
python -m ml.dataset   --config ml/datasets.yaml --out data/processed   # checks, de-duplicates, splits by scene
python -m ml.train     --data data/processed/v1 --model yolo11n.pt --name y11n-v1-s0
python -m ml.evaluate  --model-dir runs/y11n-v1-s0/release --data data/processed/v1 --split test
```

Or run `notebooks/train_colab.ipynb` on a Colab GPU. Raw data stays outside Git.

## Configuration

`CENPAI_<FIELD>` environment variables override the limits in `cenpai/config.py` (see `.env.example`). The defaults are proposed caps: images 20 MB / 20 MP; videos 100 MB / 60 s / 1920×1080 / 30 fps; queue of 8 with 1 job running; 20 uploads per IP per hour; files deleted on request or within 1 hour.

## Layout

| Path | Purpose |
|---|---|
| `cenpai/` | Website and inference (ONNX Runtime, no PyTorch) |
| `ml/` | Dataset preparation, OWLv2 drafts, training, evaluation |
| `models/` | Deployed `.onnx` + `MODEL.json` |
| `docs/` | PRD, decisions, dataset register, reports, source documents |

## Deploy

`render.yaml` defines one Docker web service on Render's free plan, prepared but **not deployed**. It needs a verified model in `models/` and a benchmark of the hosting instance first. To roll back, redeploy the previous commit, since the model files are versioned with the code.

## License

AGPL-3.0 (see `LICENSE`). Ultralytics YOLO is AGPL-3.0, so anyone using the hosted service can get its source.
