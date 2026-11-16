# CenpAI status

**Updated:** 2026-11-16 · **Milestone:** v3 Phase 0 (repo reset) · **Next:** Phases 1, 2, and 3 in parallel.

## Done (Phase 0)
- v3 plan added as `docs/PLAN.md`; PRD scope updated (live camera, mobile web app, and speech are in; the Render upload site is out).
- `docs/DECISIONS.md` records the v3 decisions, the lost raw data, notebook, weights and `old-main`, and the storage rule. `docs/datasets.md` lists the plate and profanity datasets (counts still to be measured).
- `develop` integration branch, attribution turned off in `.claude/settings.json`, `CONTRIBUTING.md`, commit and branch rules in `CLAUDE.md`.
- `web/` scaffolded (Vite, React, TypeScript, Vitest, Prettier): Camera tab shows the rear camera, Audio tab is a placeholder, one smoke test. CI has a `web` job beside the Python job.
- `cenpai/`, `ml/`, and `tests/` untouched.
- Verified 2026-11-16: the Camera tab shows the live rear camera in Firefox on the Samsung Galaxy S23+ (SM-S916B, Android 17). Firefox needed an explicit `video.play()`; the `autoplay` attribute alone left the preview black.

## Phone testing (Firefox, USB)
`chrome://inspect` port forwarding is Chrome-only, so use `adb reverse` (adb ships with `scrcpy`, installed with `winget install Genymobile.scrcpy`):
1. Phone: turn on USB debugging, connect by USB, accept the prompt. Laptop: `adb devices` shows `device`.
2. `cd web && npm run dev -- --host 127.0.0.1` (adb forwards to IPv4; plain `npm run dev` may listen only on `::1`).
3. `adb reverse tcp:5173 tcp:5173`, then open `http://localhost:5173` in Firefox on the phone and allow the camera.
4. Optional: `scrcpy --no-audio` mirrors the phone screen on the laptop.

## Next
1. Phase 1: plate detector v0 in Colab (`notebooks/train_detector_v0.ipynb`).
2. Phase 2: live plate censoring in `web/src/camera/`.
3. Phase 3: profanity classifier notebook (3a) and the Audio tab in `web/src/audio/` (3b).
Phases 1, 2, and 3 run in parallel; see `docs/PLAN.md` section 4.

## Not yet verified
- The app in Chrome on Android. The team uses Firefox on the phone, while `docs/PLAN.md` names Chrome as the reference; Phase 2 should check WebGPU in Firefox for Android or fall back to WebAssembly.
- `ml.train`, `ml.autolabel`, and the CLIs of `ml.dataset` and `ml.evaluate` have never been run end to end.

## Blockers
- Raw data, the paper's weights and notebook are lost; the plate dataset must be downloaded again (Phase 1).
- AC07 dataset licensing is still open.
