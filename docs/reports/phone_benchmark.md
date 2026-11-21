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
| Samsung Galaxy S23+ (phone) | Chrome | | | | | | | |
| Windows laptop | Firefox | | | | | | | |

Earlier numbers measured during Phase 2 on the local dev server (not the deployed app) are in `STATUS.md`.
