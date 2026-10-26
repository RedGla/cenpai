---
name: model-release
description: Promote a trained CenpAI detector from runs/<name>/release into models/ so the website serves it - verify checksum and ONNX shape, require the test report, confirm the serving app loads it, update the model card. Use when a training run is chosen for deployment or when the user says /model-release.
argument-hint: "<run name>"
---

Stop at the first check that fails and report it. Never work around one.

1. **Release files.** `runs/<name>/release/` contains `<name>.onnx`, `MODEL.json` and `run.json`. Recompute the sha256 of the `.onnx` and compare it with `MODEL.json`. The `.onnx` must be under 50 MB.
2. **Evidence.** `docs/reports/eval_<name>_test.md` must exist and show the same sha256. If it's missing, run `python -m ml.evaluate --model-dir runs/<name>/release --data <dataset version> --split test`. The threshold in `MODEL.json` must be the one chosen on val (`run.json`), not tuned on test.
3. **Serving check.** Copy both files into `models/`, replacing any previous model files and keeping a note of the old `version`. Then:
   ```powershell
   .venv\Scripts\python -c "from cenpai.detector import load_detector; d=load_detector(); print(d.version, d.imgsz, d.conf)"
   ```
   Start `python -m cenpai.app` in the background and check that `/healthz` returns 200 with this version. Stop the app afterwards.
4. **Smoke test.** Run `/test`, then censor one generated image through the app. If the owner has supplied a permitted sample photo, use that as well. Look at the output to confirm a mask is drawn where the detector boxed a plate.
5. **Docs.** Ask the `eval-reporter` subagent to update `docs/reports/model_card.md` and `comparison.md`. Add a `docs/DECISIONS.md` row with the model, sha256, threshold, and why it was selected. Update `README.md`'s status line only to what was measured.
6. **Commit** `models/` together with the reports. Deploying is a separate step that needs the owner's approval: the hooks ask before `git push` and before any deploy.

Rollback: restore the previous `models/` files from git and redeploy that commit.
