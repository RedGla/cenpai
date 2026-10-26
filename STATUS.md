# CenpAI status

**Updated:** 2026-10-26 · **Milestone:** M3 (reproducible model) · **Next:** owner datasets → OWLv2 drafts → review → `ml.dataset` v1 → YOLO11n baseline.

## Done
- PRD revised to v2 (`docs/PRD.md`): YOLO fine-tune served as ONNX, OWLv2 for drafts and as a reference, classifiers rejected, unlicensed datasets allowed with AC07.
- History restarted on an orphan `main`; the old history is on local branch `old-main`.
- App (M2) kept: validation, ONNX detector, censoring, image and video pipelines, jobs and retention, Gradio UI, Docker, Render blueprint (not deployed).
- `ml/`: `dataset.py` (checks, dedupe, scene-grouped split), `autolabel.py` (OWLv2), `train.py` (fine-tune, ONNX export, val threshold), `evaluate.py` (metrics through the serving code). Plus a Colab notebook.
- Claude Code setup: `CLAUDE.md`, `.claude/agents`, `.claude/skills`, `.claude/hooks`.

## Tests
`pytest` → 114 passed (2026-10-26; 97 app + 17 ml). The ml tests cover pure logic only.

## Not yet verified
- `ml.train`, `ml.autolabel`, and the CLIs of `ml.dataset` and `ml.evaluate` have not been run: ultralytics, torch, and transformers aren't installed on this machine. Their logic is unit-tested in `tests/test_ml.py`.
- The Docker container has never been run locally; memory fit and CPU speed on Render are unmeasured (AC05).

## Environment quirks
- Low free RAM: run tests with `OPENBLAS_NUM_THREADS=1`; expect spurious `malloc failed` errors when memory runs out.
- Windows PowerShell 5.1 writes UTF-8 with a byte-order mark (BOM). Don't use it to write config or text files.

## Blockers
- No owner datasets yet, and no val/test source (both public sources are train-only).
- AC07 licensing; paid compute or hosting needs approval.
