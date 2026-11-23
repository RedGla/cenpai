# CenpAI status

**Updated:** 2026-11-23 · **Milestone:** v3 Phase 5 (fine-tuning study) done on `feat/phone-test`, PR #15 open into `develop` · **Scope:** license plates only (decision 29) · **Next:** merge PR #15; fix oversized masks in the tracker; then release R1c as the app's default model with `/model-release`.

## Done (Phases 0-4)
- v3 plan in `docs/PLAN.md`. `develop` is the integration branch; attribution off.
- Shipped detector is still **yolov8n v0** in `web/public/models/plate-640/` and `plate-416/` (`conf` 0.81 / 0.78, `mask_conf` 0.10). Report: `docs/reports/detector_v0.md`. Weights on Drive only (decision 30).
- Camera view with detector in a Web Worker, tracker, opaque masks, shutter, detect-before-release (step 10), recording, photo, share, Benchmark. Start-up tries WebGPU 640, then WebAssembly 416.
- Deployed to https://cenpai.vercel.app with service worker, install and offline; checked on the S23+ 2026-11-21/22 (installed WebAPK, airplane mode covered a plate on WebGPU 640). Benchmarks: `docs/reports/phone_benchmark.md`.

## Done (Phase 5, PRs #9, #10 merged; #15 open)
- Dataset v2 built from the manifest: 17,408 training images / 19,433 boxes, 1,545 validation, 2,876 test; 0 groups and 0 images in more than one split (`docs/datasets.md`).
- Four runs trained on Colab (R1c, S-all, C3-s0, R1, one seed each). **R1c** chosen on validation and locked 2026-11-23 (decision 32); ONNX 640 sha256 `f9ee2044cc48…` matches its `MODEL.json`.
- Locked test, run once 2026-11-23: Open Images recall at `mask_conf` R1c 0.8065 vs v0 0.3654; precision on both sets R1c 0.8765 vs v0 0.9580.
- Phone test, run once 2026-11-23 on 28 final clips, blind, frames sampled at 2/s (decision 33): leak rate R1c 2/34 (normal) and 3/48 (strict) vs v0 13/39 and 26/51. Masks cover over half the frame in 15.4% (R1c) and 17.3% (v0) of frames.
- `?model=r1c` loads R1c in the app (not precached); `tools/score_phone_test.py` summarises the scoring CSV. Report: `docs/reports/detector_comparison.md`; results also in the Deliverables Drive.
- Checks 2026-11-23 on `feat/phone-test`: `npm run typecheck`, `npm test` (109 passed), `npm run build` pass; `pytest tests/test_ml.py` passes (23 tests); PR #15 CI green.

## Not yet verified
- R1c on the phone itself: the phone test playback ran on the laptop GPU.
- R1c as the shipped default (not released yet).
- A printed plate (only plates on screens and real family cars in video).
- `ml.train`, `ml.autolabel`, and the CLIs of `ml.dataset` and `ml.evaluate` have never been run end to end.

## Environment quirks
- Phone over USB: `cd web && npx vite --host 127.0.0.1 --port 5175 --strictPort`, then `adb reverse tcp:5175 tcp:5175`. Plain `npm run dev` may listen only on `::1`.
- Chrome on Android gives the camera to one tab only.
- The desktop app's built-in browser pane blocks `drive.usercontent.google.com`; the Drive connector cannot download files over 10 MB or upload reliably. Large Drive files go by hand.
- Colab: the comparison notebook ran as a second Google account; the locked test marker on Drive blocks a rerun.
- In Git Bash, prefix adb commands that take phone paths with `MSYS_NO_PATHCONV=1`.

## Blockers
- AC07 dataset licensing is still open.
- Phone-test clips and recordings are in `Downloads\cenpai-phone-test`; they still need to be moved by hand to the private `CenpAI/phone-test/` Drive folder, and deleted when the project ends.
