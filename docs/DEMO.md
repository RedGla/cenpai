# CenpAI demo guide

How to run the live plate-censoring demo on the phone. The script comes from `docs/PLAN.md` section 6. No demo date is set (the 2026-11-17 demo has passed). When a date is set, do the rehearsal checklist at the end in the week before it.

Reference setup: Chrome on the Samsung Galaxy S23+ (the demo phone), Firefox on the Windows laptop (the backup).

## Before the day (once, online)

1. Update Chrome on the phone and Firefox on the laptop.
2. On the phone, open https://cenpai.vercel.app in Chrome. Allow the camera.
3. Install it: Chrome menu, then **Add to home screen** (or **Install app**). The app opens full screen from the home-screen icon.
4. Open the app once and wait until the status line shows an inference time. The service worker downloads the app, the `onnxruntime-web` files and **both** plate models (640 and 416) the first time the app is opened. Then set **Input** to 416 and wait for a result, so the fallback model has also run once.
5. Turn on airplane mode, close the app, open it from the home screen, and check that plates are covered. If anything fails to load, turn airplane mode off, open the app once more and repeat.
6. Check cross-origin isolation: the status line should say `isolated: yes`. To see it in the console, connect the phone over USB, open `chrome://inspect` in Chrome on the laptop, inspect the CenpAI tab and run `crossOriginIsolated`. It should print `true`.

## Props

A classroom has no cars, so bring:

- Four to six **printed** plate photos: the team's own cars or made-up plates. Print them about plate size, matte paper if possible.
- A toy car with a printed plate taped on.
- A second phone showing street photos with plates (a backup prop only: screens can cause moire patterns that hurt detection, so test it under the room's lights first).

Printed plates photographed for the demo may later go into the Phase 5 **training** data, never into its validation or test split.

## Mirror the phone to the projector

scrcpy over USB (installed on the laptop with winget; adb comes with it):

1. On the phone, turn on Developer options, then **USB debugging**. Connect the USB cable and accept the laptop's key.
2. On the laptop: `scrcpy --stay-awake --no-audio`
3. Put the scrcpy window on the projector screen. Airplane mode does not affect USB mirroring.

## Script (about 3 minutes)

1. Turn on airplane mode in front of the panel. Open CenpAI from the home screen.
2. Point at the printed plates and the toy car. Move the phone. Show the shield indicator ("Shield on"), the plates-covered count and the inference time on the status line.
3. Record 10 seconds. Stop. Open the file from the gallery: plates are covered.
4. Tap a plate to keep it visible, then tap again to cover it. **Skip this step until Phase 6 is built.** The current app has no tap-to-reveal.
5. One slide: measured numbers (from `docs/reports/phone_benchmark.md` and the pilot scores in `docs/reports/detector_v0.md`), known limits, what comes next.

## Fallback order

If the live demo struggles, move down this list without stopping to debug:

1. **Smaller model.** Set **Input** to 416 (or open the app with `?size=416`). The detector already skips frames while it is busy, so on a slow backend it detects on about every second or third frame, and masks are held between results.
2. **Firefox on the laptop.** Open the deployed address in Firefox on the laptop and point its webcam at the props.
3. **Backup video.** Play the recorded full run (see the checklist below).

## Limits to say out loud

- The detection scores are **pilot numbers**: the dataset split may put related images in both train and test, so they can be optimistic (`docs/reports/detector_v0.md`).
- When a plate first enters the view there can be a gap of one or two frames before it is covered. Frames are held until a detection exists for them, but a frame held longer than 300 ms is released blurred instead of masked. Closing this gap is Phase 6.
- Plates cut off at the edge of the frame and plates in a dark room can be missed (seen on the phone 2026-11-17).
- The detector sometimes masks laptop keyboards as plates.
- Sound is never censored. Recordings are video only.

## Rehearsal checklist (only when a demo date is set)

Do these in the last week before the demo and tick them off here:

- [ ] Chrome on the S23+ and Firefox on the laptop updated
- [ ] App installed to the home screen; app opened once with both backends so both models are cached
- [ ] Plates covered in airplane mode after one online load
- [ ] Printed plates tested under room lighting
- [ ] One full successful run recorded and saved as the backup video (location: ______)
- [ ] Script rehearsed twice
