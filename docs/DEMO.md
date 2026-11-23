# CenpAI demo guide

How to run the live plate-censoring demo for the **v0.4** build, presented on 2026-11-24 at 7 am with `docs/presentation/cenpai_2026-11-24.pptx` (the demo is slide 8). The script comes from `docs/PLAN.md` section 6.

Reference setup: Chrome on the Samsung Galaxy S23+ (the demo phone), Firefox on the Windows laptop (the backup).

## What v0.4 changes

- **R1c is the default detector** (decision 32). The installed app caches R1c (640 and 416) for offline use.
- **v0 stays reachable with `?model=v0`**, but its files are not cached: it needs the network, so it does not work in airplane mode.
- If v0.4 is not live (the release was not merged, or `main` was reverted to `v0.3-demo`), the site runs v0 as the default. The demo order below still works; only the model differs.

## Before the day (once, online)

1. Update Chrome on the phone and Firefox on the laptop.
2. On the phone, open https://cenpai.vercel.app in Chrome. Allow the camera.
3. Install it: Chrome menu, then **Add to home screen** (or **Install app**). The app opens full screen from the home-screen icon.
4. **After the v0.4 deploy, open the installed app twice while online.** The first open can still show the cached older build while the new service worker downloads v0.4 in the background; close the app, open it again and wait until the status line shows an inference time. The service worker downloads the app, the `onnxruntime-web` files and both R1c models (640 and 416). Then set **Input** to 416 and wait for a result, so the fallback size has also run once.
5. Check that R1c is the default: the app does not show the model name, so connect the phone over USB, open `chrome://inspect` in Chrome on the laptop, inspect the CenpAI tab and run `fetch('models/plate-640/MODEL.json').then(r => r.json()).then(j => j.version)`. It should print `R1c-640` (v0 prints `v0-yolov8n-640`).
6. In the same console run `crossOriginIsolated`. It should print `true`, and the status line should say `isolated: yes`.
7. Turn on airplane mode, close the app, open it from the home screen, and check that a printed plate is covered. If anything fails to load, turn airplane mode off, open the app once more and repeat.

## Props

A classroom has no cars, so bring:

- Four to six **printed** plate photos: the team's own cars or made-up plates. Print them about plate size, matte paper if possible.
- A toy car with a printed plate taped on.
- A second phone showing street photos with plates (a backup prop only: screens can cause moire patterns that hurt detection, so test it under the room's lights first).

Printed plates photographed for the demo may later go into the **training** data, never into its validation or test split.

## Mirror the phone to the projector

scrcpy over USB (installed on the laptop with winget; adb comes with it):

1. On the phone, turn on Developer options, then **USB debugging**. Connect the USB cable and accept the laptop's key.
2. On the laptop: `scrcpy --stay-awake --no-audio`
3. Put the scrcpy window on the projector screen. Airplane mode does not affect USB mirroring.

## Demo order (about 3 minutes, slide 8)

1. Turn on airplane mode in front of the panel. Open CenpAI from the home screen.
2. Point at the printed plates and the toy car. Move the phone. Show the shield indicator ("Shield on"), the plates-covered count and the inference time on the status line.
3. Record 10 seconds. Stop. Open the file from the gallery: plates are covered.
4. Back to the slides: limitations (slide 9), then next steps (slide 10).

Tap-to-keep is **not** in v0.4: do not try it, and present it only as planned.
## Fallback order

If the live demo struggles, move down this list without stopping to debug:

1. **Backup video.** Play the recorded full run of v0.4 (location: ______).
2. **The older model, `?model=v0`.** Turn airplane mode off first (v0 is not cached), then open `https://cenpai.vercel.app/?model=v0` in Chrome on the phone. Say that this is the earlier model, which leaked more on the phone test.
3. **Firefox on the laptop.** Open the deployed address in Firefox on the laptop and point its webcam at the props.

If the preview is only slow, try setting **Input** to 416 (or open the app with `?size=416`) before leaving the live demo.

## Limits to say out loud

- **Angled plates** are the weakest case: on the phone test R1c still leaked 2 of 3 angled plate appearances (`docs/reports/detector_comparison.md`).
- **Masks can be much larger than the plate**, sometimes most of the screen, after close plates, fast pans or a plate leaving view. It is a tracker setting, not the detector, and both models show it.
- **R1c finds more plates but adds more false masks:** its test precision at `mask_conf` (0.8765) is below v0's (0.9580) and below its own validation value (0.9029).
- **Small evidence:** 28 final phone clips, scored from frames sampled at 2 per second, one training seed per run. The leak counts are strong signs, not proof.
- **Training data comes partly from other countries** (Open Images, Indonesia, Vietnam, China).
- When a plate first enters the view there can be a frame or two before it is covered. Closing this gap is a planned next step.
- Sound is never censored. Recordings are video only.

## On the day (owner, about 6 am)

- [ ] Phone charged; USB cable for scrcpy packed
- [ ] Airplane mode checked once on the installed app with a printed plate
- [ ] Backup video of a good v0.4 run on the laptop, ready to play (location: ______)
- [ ] Talk and demo rehearsed twice
