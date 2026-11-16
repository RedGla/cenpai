# CenpAI status

**Updated:** 2026-11-16 · **Milestone:** v3 Phase 0 (repo reset) · **Next:** Phases 1, 2, and 3 in parallel.

## Done (Phase 0)
- v3 plan added as `docs/PLAN.md`; PRD scope updated (live camera, mobile web app, and speech are in; the Render upload site is out).
- `docs/DECISIONS.md` records the v3 decisions, the lost raw data, notebook, weights and `old-main`, and the storage rule. `docs/datasets.md` lists the plate and profanity datasets (counts still to be measured).
- `develop` integration branch, attribution turned off in `.claude/settings.json`, `CONTRIBUTING.md`, commit and branch rules in `CLAUDE.md`.
- `web/` scaffolded (Vite, React, TypeScript, Vitest, Prettier): Camera tab shows the rear camera, Audio tab is a placeholder, one smoke test. CI has a `web` job beside the Python job.
- `cenpai/`, `ml/`, and `tests/` untouched.

## Next
1. Phase 1: plate detector v0 in Colab (`notebooks/train_detector_v0.ipynb`).
2. Phase 2: live plate censoring in `web/src/camera/`.
3. Phase 3: profanity classifier notebook (3a) and the Audio tab in `web/src/audio/` (3b).
Phases 1, 2, and 3 run in parallel; see `docs/PLAN.md` section 4.

## Not yet verified
- The Camera tab on the demo phone (Samsung Galaxy S23+).
- `ml.train`, `ml.autolabel`, and the CLIs of `ml.dataset` and `ml.evaluate` have never been run end to end.

## Blockers
- Raw data, the paper's weights and notebook are lost; the plate dataset must be downloaded again (Phase 1).
- AC07 dataset licensing is still open.
