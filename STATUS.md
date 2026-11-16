# CenpAI status

**Updated:** 2026-11-17 · **Milestone:** v3 Phase 2 (live plate censoring) in review as PR #6 · **Next:** finish the Phase 2 phone checks, then Phase 3.

## Done (Phases 0-1)
- v3 plan in `docs/PLAN.md` (Chrome on the phone, Firefox on the laptop). `develop` is the integration branch; attribution off.
- Plate detector **yolov8n v0** in `web/public/models/plate-640/` and `plate-416/`, with `conf` 0.81 / 0.78 and `mask_conf` 0.10 / 0.10 from validation (decision 24). Report: `docs/reports/detector_v0.md`. Weights on Drive only.

## Done (Phase 2, PR #3 merged, follow-up PR #6 open)
- Camera tab: rear camera to canvas, detector in a Web Worker (`onnxruntime-web` 1.31.1), tracker, opaque masks, privacy shutter, recording (MP4 in Chrome), photo, Web Share, status line, 50-run Benchmark.
- Start-up tries WebGPU at 640, then threaded WebAssembly at 416 (15 s limit), then single-threaded 416, each in a fresh worker. Cross-origin isolation headers on the dev and preview servers.
- Step 10: frames are held until a detection exists for them or a later frame; more than 6 held go out blurred. `?hold=0` turns it off; `?debug=1` outlines boxes; `?size=` and `?backend=` force a model.
- Checks 2026-11-17: `npm run typecheck`, `npm test` (49 passed, 9 files) and `npm run build` pass.
- Measured on the S23+ (read off its screen over USB), 2026-11-16/17:
  - Chrome 157, WebGPU 640: Benchmark median 108.1 ms, p95 111.5 ms (whole frame median 158.4 ms).
  - Chrome 157, WebAssembly 416, 4 threads: median 144.1 ms, p95 167.9 ms (whole frame 201.1 ms).
  - Firefox 160 on the phone has no WebGPU; single-threaded WebAssembly read about 413 ms (640) and 200-300 ms (416) live.
  - Firefox on the laptop: WebGPU 640, about 75 ms per inference live, 20 fps.
  - With step 10 on: "Holding 3-4 frames, 117-139 ms behind" at 21-23 fps. The shutter shows while the model loads.
- Recordings play back from the phone's Video Player. Frames with a readable plate (Python detector scan, checked by eye): 6/175 before step 10; 4/144 with step 10 on vs 22/174 with `?hold=0` (not a controlled pair).

## Not yet verified
- Printed plate at arm's length covered within 2 frames (needs the user).
- Firefox laptop Benchmark numbers (Claude can only view Firefox, not click).
- Recording fully censored: mid-confidence plates (0.32-0.64) the live detector misses still leak with step 10 on.
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
