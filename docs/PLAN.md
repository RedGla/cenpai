# CenpAI v3 build plan: phone-first live license plate censoring

Prepared 2026-11-16 for a working demo on Tuesday 2026-11-17. Revised 2026-11-21: speech and profanity censoring are out of scope; the project is license plates only.
Put this file in the repo as `docs/PLAN.md` and point each building session (Opus or Sonnet) at the phase it owns.

This plan replaces the scope of `docs/PRD.md` v2, which excluded live camera feeds and mobile. The paper already describes a phone app with live censoring, so v3 brings the repo in line with the paper.

---

## 1. Decisions locked on 2026-11-16

| Topic | Choice | What it means for the build |
|---|---|---|
| Deadline | Tue Nov 17, the demo must run live | Phases 0-4 happen tonight. Everything else is after the demo. |
| App form | Mobile web app that installs to the home screen (a PWA). Models run on the phone. | Camera needs HTTPS. Chrome on the S23+ is the reference. Firefox on the Windows laptop is the fallback. |
| Browser | Chrome on the phone, Firefox on the laptop (settled 2026-11-16) | Chrome for Android has WebGPU, so the phone can use its graphics chip. Firefox on Windows has WebGPU too. The app must work in both, so it detects features at run time. |
| "Live" | Live camera preview with plates covered, plus censored recording and photo | No broadcasting to Facebook/YouTube/TikTok in scope. |
| Speech | Out of scope (decided 2026-11-21) | No profanity censoring. Recordings are video only unless the user turns sound on, and sound is never censored. |
| Training | You fine-tune your own models (ML course requirement) | One fine-tuning study: plate detectors, trained on the secondary dataset plus your own primary dataset. |

Confirmed by the team on 2026-11-16 (section 8): the instructor accepts the web-app form, compute is free Colab or Kaggle only, and the Samsung Galaxy S23+ is the demo phone. On 2026-11-21 the team dropped speech censoring to focus on plates; tell the instructor, since they had agreed to the wider scope.

Two losses to plan around, because the previous laptop no longer works: the paper's trained weights and notebook are gone, and so is all raw data.

---

## 2. What we are building

CenpAI v3 is a phone app that covers license plates in the camera view before any frame is shown or saved. The detector runs on the phone. Nothing is uploaded. Models are downloaded once and cached, so the app works in airplane mode.

```
camera frame -> plate detector (ONNX, on phone) -> tracker + padding -> mask -> screen + recorder
```

What already exists and what happens to it:

| Asset | State | Plan |
|---|---|---|
| `ml/` (dataset checks, scene-grouped split, OWLv2 draft labels, train, evaluate) | Written and unit-tested, never run end to end | Keep. Use properly in Phase 5. Tonight's training uses a plain Ultralytics notebook to avoid debugging the pipeline under time pressure. |
| `cenpai/` (Python server: Gradio + FastAPI + ONNX Runtime) | Complete, not deployed, no model | Keep as the evaluation harness and as the reference the phone code is tested against. Do not deploy it. |
| `cenpai/detector.py` (letterbox, box decoding, NMS) | Tested | Port to TypeScript and check it gives the same boxes as Python. |
| Paper's YOLOv8n (5 epochs, Colab T4) | Lost: `best.pt` and `CenpAI_Final.ipynb` were on the dead laptop | Retrain tonight. The new run replaces the paper's pilot numbers, which can no longer be reproduced. |
| Paper's dataset (License Plate Detection PH BB v5, 4,956 images kept) | Local copy lost. Still public on Roboflow Universe under CC BY 4.0. Not in `docs/datasets.md`. | Download it again in Colab and register it. It is the main training source. |
| Raw data folder and the local `old-main` branch | Lost with the laptop | From now on, raw data and trained files live in Google Drive (mounted in Colab) and on your Hugging Face account, never on one laptop. |

---

## 3. What makes it novel, and what does not

Each piece exists somewhere. The combination, the guarantees, and the evaluation do not appear to. Keep the paper's current honesty: do not claim to be first at plate anonymization.

| Existing work | What it does | What it lacks for our case |
|---|---|---|
| iOS apps such as AutoBlur and Car Number Plate Blur | Blur plates in recorded video, on the device | Not live. |
| AXIS Live Privacy Shield | Masks plates in live video on security cameras | Enterprise camera hardware, not a phone. |

Our differentiators, in order of value for the effort:

1. **Detect before release.** A frame reaches the screen or the file only after the detector has made a decision for it. A short buffer of 3-6 frames (about 100-200 ms) lets the app also cover the frames just before a plate was first detected. The paper asks that "each displayed or exported frame has passed through processing"; this makes that true by construction and testable. (Phase 6; a light version is a stretch for tonight.)
2. **Fail closed.** When the detector is loading, stalled, or throttled by heat, the app blurs the whole frame instead of showing raw video. Masks stay for a short time after a plate is lost, and grow while it is unseen. (Basic version tonight.)
3. **Leak-centric evaluation.** Run a plate-reading model (OCR) as an attacker on the censored output. Report the share of plate appearances that remain readable and for how many milliseconds, instead of only box overlap. This answers the paper's research question 4 with a number. OCR is used only for evaluation, never in the app. (Phase 7.)
4. **Zero upload, trained on Philippine phone footage.** The detector runs on the phone, works in airplane mode, and is fine-tuned on your own S23+ photos of the conditions where it failed (Phase 5).
5. **Tap to keep.** Tap a tracked plate to leave it visible, for your own car. No plate reading needed. (Phase 6.)
6. **Censor report.** After a session: plates covered, frames released under the privacy shutter. No plate text is stored. (Phase 6.)

---

## 4. Phases

### Tonight at a glance (three people in parallel)

| Track | Owner | Order |
|---|---|---|
| A. Phone app | Person 1 with Opus | Phase 0, then 2, then 4 |
| B. Models in Colab | Person 2 with Sonnet | Phase 1 |
| C. Demo | Person 3 with Sonnet | Phase 4 |

Phases 0-2 are done. Phase 3 (speech) was dropped on 2026-11-21.

---

### Phase 0. Reset the repo for v3 (about 30 min; Sonnet, medium effort)

Tasks
- Branch `v3-mobile`. Add `web/` with Vite + React + TypeScript.
- Update `docs/PRD.md` scope (live camera and mobile web are in; the server upload flow is out), add rows to `docs/DECISIONS.md` for section 1 of this plan, update `STATUS.md`, add a pointer to this plan in `CLAUDE.md`.
- Add the paper's plate dataset to `docs/datasets.md` with source, license, and counts.
- Record in `docs/DECISIONS.md` that the raw data, the original notebook and weights, and the `old-main` branch were lost. The hardcoded data path in `ml/datasets.yaml` is fixed in Phase 5, because Phase 0 leaves `ml/` untouched.
- Set up the repo the same way as PSRR: a `develop` integration branch, commit and pull request attribution turned off in `.claude/settings.json`, a `CONTRIBUTING.md`, and commit rules in `CLAUDE.md`.
- Set up phone debugging: turn on USB debugging in Android, run `adb reverse tcp:5173 tcp:5173` on the laptop (`adb` comes with Android platform-tools), run `npm run dev` in `web/`, then open `localhost:5173` in Chrome on the phone. To read the phone's console, open `edge://inspect` in Edge on the laptop; Firefox cannot inspect Chrome on a phone. The browser treats `localhost` as secure, so the camera works without certificates.

Done when: a placeholder page from `web/` opens on the phone and shows the rear camera.

---

### Phase 1. Plate detector v0 (about 1.5-2 h, mostly waiting; Colab T4; Sonnet, medium effort, writes the notebook)

Tasks
1. Write a new notebook, `notebooks/train_detector_v0.ipynb`, because the original is lost. Mount Google Drive as the home for data and outputs. Download License Plate Detection PH BB v5 from Roboflow Universe in YOLO format. This needs a free Roboflow API key, kept in Colab secrets and never written into the notebook.
2. Repeat the paper's label check (five numeric fields, class 0, valid coordinates) and log the counts. Compare them with the paper's 4,956 images and 5,270 boxes and note any difference.
3. Smoke run first: 3 epochs of YOLO11n, export, hand the file to Phase 2. About 15 minutes including the download. This unblocks the app and proves the export path early.
4. Full runs in two Colab sessions at once, on two team accounts: YOLOv8n (the paper's baseline) and YOLO11n from COCO weights, 640 px, up to 50 epochs, patience 10, seed 0, on the same split as the paper. The paper's log gives about 45 s per epoch on a T4. Point the training output folder at Drive so a disconnected free session can resume from the last checkpoint. Kaggle is the backup GPU.
5. Export each to ONNX twice, at 640 and 416 input: static shape, opset 12, `nms=False`, `half=False`, simplified. The output shape is `(1, 5, N)`, the same contract `cenpai/detector.py` and `models/MODEL.json` already use.
6. Pick the confidence threshold on validation, never on test: the highest value that keeps recall at or above 0.95 (decision 5 in `docs/DECISIONS.md`).
7. Write `MODEL.json` (file, sha256, input size, threshold, version) next to each model.
8. Save right away: copy `best.pt`, the ONNX files, the training log, and the notebook to Drive, push the weights to a model repo on your Hugging Face account, and commit the notebook to Git.

Report only what was measured. Tonight's run is the new baseline: the paper's pilot numbers came from a notebook that no longer exists, so the slides show tonight's scores and mention the earlier pilot only as history. The split may still contain related images across train and test (the paper says so), so call tonight's scores pilot numbers too.

Done when: the Python `cenpai.detector` loads the exported file and finds plates in five sample photos, and the files sit in `web/public/models/`.

---

### Phase 2. Live plate censoring on the phone (about 3-4 h; Opus, high effort)

Build in this order. Each step can be checked before the next. Start with the 3-epoch smoke model from Phase 1 and swap in the full model when it is ready.

1. **Camera to canvas.** Rear camera at 1280x720. Draw each frame with `requestVideoFrameCallback`. Show an FPS counter.
2. **Detector in a Web Worker.** `onnxruntime-web`, using WebGPU (the graphics chip) where the browser has it and WebAssembly (CPU) otherwise. Chrome on the phone has WebGPU. Keep multi-threaded WebAssembly working as the fallback; it needs the cross-origin isolation headers from the dev server too. Port letterbox, box decoding, and NMS (the step that removes duplicate boxes) from `cenpai/detector.py`. Add a test: same image in, same boxes out as Python within 1 px.
3. **Never queue detections.** One inference at a time; skip camera frames while busy.
4. **Tracker and mask.** Match boxes between detections by overlap. Draw an opaque mask with 10% padding (minimum 4 px, per decision 8) in the same callback that draws the frame, so the canvas never shows an unmasked frame for a known plate. Keep a mask for 400 ms after the plate was last seen, growing the padding each frame. Use two thresholds: mask at `mask_conf` (the lowest confidence, not below 0.10, that keeps validation precision at or above 0.90) and count plates at `conf`. Phase 1 showed why: `conf` came out at 0.81, which discards detections the model does make. Until `mask_conf` is measured, the app masks at 0.25 and says so on screen.
5. **Privacy shutter.** Blur the whole frame until the first detection result arrives, and whenever no result has arrived for 300 ms.
6. **Record.** `canvas.captureStream(30)` into `MediaRecorder`. Choose MP4 if `isTypeSupported` says so, else WebM. Video only by default, because sound is never censored.
7. **Photo and share.** Save the censored frame. Offer the system share sheet through the Web Share API.
8. **Status display.** Shield state (censoring or shutter), plates covered, milliseconds per inference, which backend is running.
9. **Stretch for tonight: light detect-before-release.** Hold 2-3 frames and release each only once a detection exists for that frame or a later one. If the queue passes 6 frames, release them blurred.

Done when, on the demo phone: preview holds near 30 fps with at least 15 detections per second (targets to measure, not promises), a printed plate at arm's length is covered within 2 frames of entering view, and a 10 s recording plays back censored from the gallery.

Cut lines: if WebGPU fails on the phone, use WebAssembly with the 416 model. If that is too slow, use a 320 export and detect on every second or third frame, relying on the tracker in between. If it is still too slow, demo in Firefox on the laptop, which has WebGPU. If recording fails, demo photo mode and use the phone's screen recorder.

---

### Phase 3. Dropped (2026-11-21)

Speech and profanity censoring are out of scope. Any Audio tab code is removed in Phase 4. A classifier notebook or report already in the repo stays as history, marked out of scope in `docs/DECISIONS.md`.

---

### Phase 4. Hosting, install, offline (about 2 h; Sonnet, medium effort)

- Remove the Audio tab and any speech models from the app.

- Deploy to a free static host that lets you set headers (Vercel, Netlify, or Cloudflare Pages). Set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so WebAssembly can use several threads. Check the host's per-file size limit before bundling models; load large ones from your Hugging Face repos instead.
- Add the web app manifest and a service worker that caches the app and the models. Install to the home screen. Load every model once on the demo phone tonight, then test in airplane mode.
- Props, because a classroom has no cars: print four to six plate photos (your own cars or made-up plates), bring a toy car or a second phone showing street photos. Test under room lighting; screens can cause moire patterns that hurt detection.
- Mirror the phone to the projector with scrcpy over USB.
- Record a full successful run tonight as the backup video. Keep Firefox on the laptop ready as the second backup.
- Numbers for the slides: milliseconds per inference and FPS on the phone for each backend, and the v0 detection scores labelled as pilot numbers. Update Chrome on the S23+ and Firefox on the laptop before measuring. Nothing estimated.
- Rehearse the script in section 6 twice.

---

### Phase 5. The fine-tuning study (after the demo, 2-4 days) — the ML-course core

Opus at high effort designs the experiments, audits the split, and analyses errors. Sonnet at medium effort writes and runs the notebooks.

Plate detector
- Rebuild the dataset with `ml/dataset.py`: group images by their original source name before splitting, merge near-duplicates, 70/15/15 by group. This fixes the possible train/test overlap the paper flags.
- Recover the 576 rejected label files. They are probably polygons; convert them to boxes and re-check.
- Build the primary dataset with `primary-dataset-protocol.md`: 60-100 plates shot 6-10 ways on the S23+, plus photos with no plate, split 60/20/20 by plate. Its training split covers the conditions v0 failed on; its validation split chooses thresholds and synthetic data; its test split is scored once.
- Compare YOLOv8n, YOLOv8s, YOLO11n, YOLO11s (the paper's set) plus YOLO26n, a newer model built for edge devices that needs no NMS step. Same data, same budget, three seeds each.
- Ablations, each scored on accuracy and on phone latency: starting weights (COCO versus a public plate checkpoint such as `morsetechlab/yolov11-license-plate-detection`), input size (320, 416, 640), and number format (32-bit, 16-bit, 8-bit).

---

### Phase 6. Guaranteed-censoring engine (2-3 days; Opus, xhigh effort for the frame-buffer design, high for the rest)

- Full detect-before-release: 3-6 frame buffer, box interpolation between detections, back-fill onto the frames just before first detection.
- Fail-closed states with heat adaptation: lower the input size before lowering protection.
- Tap to keep, mask styles (solid default, pixelation optional), high-resolution photo mode that scans the image in tiles for small plates.
- Gallery import: censor an existing photo or video on the device.
- Optional sound in recordings: off by default, and labelled "sound is not censored" when on.
- Session censor report.

### Phase 7. Evaluation and paper (2-3 days; Opus, high effort for metric design and the paper; Sonnet, medium effort for scripts and tables)

- Plates: readable-leak rate with an OCR attacker, exposure time per plate appearance, first-appearance frames, on the independent phone test set.
- Device: FPS, latency (median and 95th percentile), memory, a 10-minute sustained run with temperature and battery, on the S23+.
- Revise the paper (section 7).

---

## 5. Technical notes for the building sessions

| Area | Guidance |
|---|---|
| ONNX in the browser | Pin the `onnxruntime-web` version. Serve its `.wasm` files from the app so it works offline. Order the backends WebGPU then WebAssembly. A 16-bit export has been reported to break WebGPU; export 32-bit. |
| Two browsers | Chrome on the phone, Firefox on the Windows laptop. Both have WebGPU and WebCodecs (checked 2026-11-16). Detect features at run time, never by browser name, and test in both. `MediaRecorder` in Firefox writes WebM; Chrome may also offer MP4. WebAssembly threads need the cross-origin isolation headers. |
| YOLO26 | Its default export has no NMS and a different output shape. Make the post-processing branch on shape. Not needed tonight. |
| Frames | If you hold frames (`VideoFrame` or `ImageBitmap`), close them when done or the phone runs out of memory. |
| Recording format | Ask `MediaRecorder.isTypeSupported` at run time. Do not assume MP4. |
| Privacy | No analytics, no network calls after models load, no logging of frames or plate crops. Reuse the repo's `privacy-reviewer` agent on the web code. |
| Thresholds | Chosen on validation only. The test set is used once per locked comparison. |
| Scores | Never write a number that was not measured (existing PRD rule). |
| License | Ultralytics models are AGPL-3.0. The repo is already public AGPL-3.0, which covers the web app too. |
| Storage | Raw data, checkpoints, and logs go to Google Drive. Released weights go to your Hugging Face account. Notebooks and manifests go to Git. Nothing important lives only on a laptop. |

### Model and reasoning effort for each phase

Set both when you start the session. Effort is how long the model thinks before it answers: higher is more careful and slower.

| Phase | Model | Effort | Why |
|---|---|---|---|
| 0. Repo reset | Sonnet | medium | Mechanical edits to docs and scaffolding. |
| 1. Detector notebook | Sonnet | medium | Standard training code, but the export settings must be exact. |
| 2. Live plate censoring | Opus | high | Frame timing, the worker thread, and the tracker all interact. Steps 1, 7, and 8 (camera page, share, status display) can go to a second Sonnet session at medium to save time. |
| 4. Hosting, install, offline | Sonnet | medium | Offline caching needs care; the rest is routine. |
| 5. Fine-tuning study | Opus for design and analysis, Sonnet for notebooks | high, medium | Split audits and comparisons need judgment; running them does not. |
| 6. Guaranteed-censoring engine | Opus | xhigh for the frame-buffer design, then high | A wrong release rule leaks plates. |
| 7. Evaluation and paper | Opus for metrics and text, Sonnet for scripts | high, medium | Claims must match what was measured. |

Rules of thumb:
- Tonight, stay at high or below. Higher effort answers more slowly, and time is the constraint.
- Raise effort one level only after a session fails its "Done when" check twice.
- Drop to low for renames and one-line fixes.
- Skip max. It costs the most and is not needed here.

### How each phase is run

Each phase has a brief in the same format as the PSRR project: a model and effort line, the repo details, Context, Sources, Rules, Steps, and a "Done when" list of checks. Paste one brief into a new session; it ends with "Execute this phase brief. Do only this phase." The briefs are in `C:\Users\Red\Downloads\cenpai-v3\phase-briefs\`.

Timeline

| Phase | Brief | When |
|---|---|---|
| 0. Repo reset | `phase-0-repo-reset.md` | Mon Nov 16 (tonight) |
| 1. Detector v0 | `phase-1-detector-v0.md` | Mon Nov 16 (tonight) |
| 2. Live plate censoring | `phase-2-live-plate-censor.md` | Mon Nov 16 (tonight) |
| 3. Speech censoring | moved to `phase-briefs/dropped/` | Dropped 2026-11-21 |
| Demo | | Tue Nov 17 (done) |
| 4. Hosting, install, offline | `phase-4-demo-hardening.md` | Next, before Phase 5 |
| 5. Fine-tuning study, with the primary dataset | `phase-5-fine-tuning-study.md`, `primary-dataset-protocol.md` | After Phase 4 |
| 6. Guaranteed-censoring engine | `phase-6-guaranteed-censoring.md` | After Phase 5 |
| 7. Evaluation and paper | `phase-7-evaluation-paper.md` | Last |

Dates after the demo are set once the course deadline is known. Shooting and labelling the primary dataset is the longest step, so start the instructor's ethics question now.

Repo rules, carried over from PSRR

- `develop` is the integration branch. Each phase works on its own branch and opens a pull request into `develop`. `main` holds released builds.
- Conventional commit messages, one logical change each, under the user's own git identity.
- No attribution trailers and no "generated by" lines in commits or pull requests. AI assistance is disclosed in the paper and the README instead.
- Commits keep their real timestamps.
- Every brief ends with checks that can be run, and the session stops there.

---

## 6. Demo script (about 3 minutes)

1. Turn on airplane mode in front of the panel. Open CenpAI from the home screen.
2. Point at the printed plates and the toy car. Move the phone. Show the shield indicator and the inference time.
3. Record 10 seconds. Stop. Open the file from the gallery: plates are covered.
4. Tap a plate to keep it visible, then tap again to cover it (once Phase 6 is built).
5. One slide: measured numbers, known limits, what comes next.

State the limits out loud: pilot detection scores on a split that may overlap, a possible one-or-two-frame gap when a plate first appears (closed in Phase 6), and sound is never censored.

---

## 7. Paper revisions

- **Title and scope:** add on-device live censoring. Speech censoring was considered and dropped; do not present it as a contribution.
- **Lost artifacts:** say plainly that the original notebook and weights were lost, and replace the training-settings and pilot-results tables with the rerun's settings and scores.
- **Platform wording:** "Android application" becomes "mobile web application evaluated on Android (Samsung Galaxy S23+)". If an APK is required, wrap the web app later.
- **Research questions:** extend question 4 with the readable-leak rate, and add the primary phone dataset to question 1.
- **Method fixes already flagged in the paper:** grouped split, recovered labels, a larger and independent test set, a real training schedule instead of 5 epochs, validation-chosen threshold.
- **Comparison set:** add YOLO26n and say why. Add v0 versus the model trained with the primary dataset.
- **Related work:** add the systems in section 3 after reading each source. Do not cite anything unread.
- **AI disclosure:** the paper names OpenAI Codex. Add Claude for planning and implementation, accurately.

---

## 8. Decisions confirmed on 2026-11-16

1. The instructor accepts the web-app form. (Speech censoring was accepted on 2026-11-16, then dropped by the team on 2026-11-21.)
2. `best.pt` and `CenpAI_Final.ipynb` are lost. Phase 1 retrains from a fresh download and becomes the new baseline.
3. Compute is free Colab or Kaggle only. Checkpoints go to Drive so a disconnect costs minutes, not the run.
4. The S23+ is the demo phone.
5. Speech censoring is out of scope (2026-11-21).
6. `ml/datasets.yaml` points to `C:\Users\rapha\CenpAI-data\`. That laptop no longer works, so the raw data is gone. Download the public datasets again into Google Drive.

---

## 9. Sources checked on 2026-11-16

- AutoBlur (iOS): https://apps.apple.com/us/app/id6766163185
- Car Number Plate Blur (iOS): https://appshunter.io/ios/app/car-number-plate-blur/id6789729821
- AXIS Live Privacy Shield: https://newsroom.axis.com/news/upgraded-live-privacy-shield
- YOLO26: https://docs.ultralytics.com/models/yolo26 and https://arxiv.org/html/2509.25164v3
- Ultralytics export options: https://docs.ultralytics.com/modes/export/
- Public plate checkpoint: https://huggingface.co/morsetechlab/yolov11-license-plate-detection
- ONNX Runtime Web with WebGPU: https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/
- WebGPU implementation status (Firefox for Android): https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- WebCodecs in Firefox (Android still open): https://bugzilla.mozilla.org/show_bug.cgi?id=1746557 and https://caniuse.com/webcodecs
- Firefox remote debugging: https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/
- Browser YOLO export pitfalls (opset 12, 16-bit): https://pranta-barua007.github.io/yolo11-onnx/guide
