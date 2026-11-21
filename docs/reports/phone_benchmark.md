# Phone and laptop benchmark

Speed numbers for the demo slides, read from the app's **Benchmark** button on the deployed, installed app. Every cell is filled by hand from a real run. A blank cell means not measured yet. Never estimate a value.

## How to measure

1. Update the browser first (Chrome on the phone, Firefox on the laptop) and write its version from the browser's About page.
2. Open the app from the deployed HTTPS address (on the phone, from the home-screen icon). Leave **Backend** and **Input** on Auto unless a row says otherwise.
3. Point the camera at a printed plate and wait about 10 seconds for the speed to settle. Read **preview frames per second** from the `fps` value on the status line.
4. Read **backend**, **input size** and **thread count** from the status line (`Backend: …, … px, isolated: …, threads: N`). `isolated` should say `yes`.
5. Press **Benchmark** (50 inferences). Copy the **median** and **95th percentile** milliseconds from the result line.

## Results

| device | browser and version | backend | input size (px) | median (ms) | 95th percentile (ms) | threads | preview fps | date |
|---|---|---|---|---|---|---|---|---|
| Samsung Galaxy S23+ (phone) | Chrome 157.0.8103.78 | WebGPU | 640 | 93.3 | 98.2 | 1 | 21-24 | 2026-11-21 |
| Windows laptop | Firefox 160.0.1 | WebGPU | 640 | 90.9 | 94.5 | 1 | | 2026-11-21 |

Notes on the 2026-11-21 runs (both on https://cenpai.vercel.app, cross-origin isolated, Backend and Input on Auto; the browsers were not updated first, so these are the versions installed):

- **Phone:** measured in a Chrome tab on the deployed address, just before installing the app, with the camera pointed at the room (no plate in view). The whole-frame median (including resize and decode) was 140.0 ms. Preview fps is the range of five readings 2 s apart over 10 s.
- **Laptop:** measured in Firefox 160.0.1 with a fresh profile driven over WebDriver BiDi. The laptop webcam opened but delivered no frames, so Firefox's built-in fake camera (`media.navigator.streams.fake`) fed the frames. The inference times are real; preview fps is left blank because it would only measure the fake camera. The whole-frame median was 100.6 ms.

Earlier numbers measured during Phase 2 on the local dev server (not the deployed app) are in `STATUS.md`.
