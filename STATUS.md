# CenpAI status

**Updated:** 2026-11-21 · **Milestone:** v3 Phase 4 (hosting, install, offline) on `chore/demo-hardening` · **Scope:** license plates only; speech and profanity censoring dropped 2026-11-21 (decision 29), Phase 3 dropped · **Next:** deploy, check install and airplane mode on the phone, then Phase 5.

## Done (Phases 0-1)
- v3 plan in `docs/PLAN.md` (Chrome on the phone, Firefox on the laptop). `develop` is the integration branch; attribution off.
- Plate detector **yolov8n v0** in `web/public/models/plate-640/` and `plate-416/`, with `conf` 0.81 / 0.78 and `mask_conf` 0.10 / 0.10 from validation (decision 24). Report: `docs/reports/detector_v0.md`. Weights on Drive only.

## Done (Phase 2, PRs #3 and #6 merged)
- Camera view (the only view; the Audio tab was removed in Phase 4): rear camera to canvas, detector in a Web Worker (`onnxruntime-web` 1.31.1), tracker, opaque masks, privacy shutter, recording (MP4 in Chrome), photo, Web Share, status line, 50-run Benchmark.
- Start-up tries WebGPU at 640, then threaded WebAssembly at 416 (15 s limit), then single-threaded 416, each in a fresh worker. Cross-origin isolation headers on the dev and preview servers.
- Step 10: frames are held until a detection exists for them or a later frame; frames held longer than 300 ms go out blurred. Censor style: solid (default), blur or pixelate. `?hold=0` turns it off; `?debug=1` outlines boxes; `?size=` and `?backend=` force a model.
- Checks 2026-11-17: `npm run typecheck`, `npm test` (49 passed, 9 files) and `npm run build` pass.
- Measured on the S23+ (read off its screen over USB), 2026-11-16/17:
  - Chrome 157, WebGPU 640: Benchmark median 108.1 ms, p95 111.5 ms (whole frame median 158.4 ms).
  - Chrome 157, WebAssembly 416, 4 threads: median 144.1 ms, p95 167.9 ms (whole frame 201.1 ms).
  - Firefox 160 on the phone has no WebGPU; single-threaded WebAssembly read about 413 ms (640) and 200-300 ms (416) live.
  - Firefox on the laptop, WebGPU 640: Benchmark median 92.7 ms, p95 95.9 ms (whole frame median 100.3 ms), 2026-11-17.
  - With step 10 on: "Holding 3-4 frames, 117-139 ms behind" at 21-23 fps. The shutter shows while the model loads.
- Recordings play back from the phone's Video Player. Frames with a readable plate (Python detector scan, checked by eye): 6/175 before step 10; 4/144 with step 10 on vs 22/174 with `?hold=0` (not a controlled pair).

- Plate on a phone screen (no printed plate available), Chrome WebGPU 640, step 10 on, every recorded frame checked, 2026-11-17:
  - Dark room, 120 frames: 2 uncovered frames on entry, then readable again for 7 frames while the detector lost it.
  - Lights on, plate held still in view, 133 frames: 0 readable (125 masked, 8 shutter-blurred).
  - Lights on, entry take, 140 frames: covered within about 1 frame once fully in view; 1 single-frame miss; about 17 frames of a plate cut off at the frame edge were never masked.

## Not yet verified
- A printed plate (only a plate image on a phone screen was used).
- Recording fully censored: plates cut off at the frame edge, and plates the live detector misses, still leak with step 10 on (a result with no boxes still releases frames).
- `ml.train`, `ml.autolabel`, and the CLIs of `ml.dataset` and `ml.evaluate` have never been run end to end.

## Environment quirks
- Phone over USB: `cd web && npx vite --host 127.0.0.1 --port 5175 --strictPort`, then `adb reverse tcp:5175 tcp:5175` and open `http://localhost:5175` on the phone. adb forwards to IPv4; plain `npm run dev` may listen only on `::1`. Old dev servers from earlier sessions may still hold 5173/5174.
- Chrome on Android gives the camera to one tab only; close older CenpAI tabs, or the new one shows 0 fps.
- `scrcpy --stay-awake --no-audio` mirrors the phone (installed with winget; adb ships with it).
- The desktop app's built-in browser pane hangs on threaded WebAssembly in a worker; real Chrome does not. The start-up time limit covers it.
- In Git Bash, prefix adb commands that take phone paths with `MSYS_NO_PATHCONV=1`.

## Blockers
- Raw data, the paper's weights and notebook are lost; the plate dataset was downloaded again in Phase 1.
- AC07 dataset licensing is still open.
