# Mask stability (Phase 4b)

Counters from the app's `?debug=1` overlay, read on the phone by hand. A blank cell means not measured yet. Never estimate a value.

## How to measure

1. Open the app with `?debug=1` on the Samsung Galaxy S23+ in Chrome. Leave **Backend** and **Input** on Auto and **Censor** on Solid.
2. Hold a printed plate by hand at arm's length, filling a normal part of the view. If no printed plate is at hand, show a made-up plate (`XQZ 0000`, white on a grey page, about 60% of the screen's short side) full-screen on the laptop and hold the phone at arm's length; the `scene` column says which was used, and before and after rows must use the same scene.
3. Press **Reset counters**, hold the scene for 60 s, then read the overlay line (`drops`, `re-acquired`, `mask area change`, `box jitter`, `overlap frames`, `conf before drop`, `canvas resizes`).
4. Repeat in dim light (room lights off, some light from a doorway or screen).
5. Write down which twitch you see: blink (mask gone for a moment), jump (mask moves around the plate), pulse (mask grows and snaps back), or fight (two masks on one plate).

What the counters mean:

- **drops**: a track's mask was drawn on one frame and not on the next (shutter frames excluded).
- **re-acquired**: a new track started within 1 s on a box overlapping a dropped one by IoU 0.3 or more.
- **mask area change**: mean frame-to-frame change in a drawn mask's area, as a share of its previous area.
- **box jitter**: mean move of a detected box's centre between two detections of the same track, as a share of its longer side.
- **overlap frames**: frames where two drawn masks overlapped by IoU 0.3 or more.
- **conf before drop**: mean confidence of a track's last detection before its mask dropped.

Settings in force for the "before" rows (configuration, not results): `mask_conf` 0.10 from `MODEL.json` (decision 24), track keep time 400 ms or 2.5 detection intervals if longer, shutter after 300 ms without a result, padding 10% of the longer side (minimum 4 px) plus 4% per 1/30 s unseen, frame hold (step 10) on.

## Results

| run | scene | light | seconds | frames | shutter frames | drops | re-acquired | mask area change per frame | box jitter per detection | overlap frames | conf before drop | preview fps | twitch seen | date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before | laptop screen | room | 61 | 677 | 9 | 32 | 6 | 54.9% | 8.6% | 8 | 0.57 | 20 (18 on the screenshot) | | 2026-11-22 |
| before | laptop screen | dim | 61 | 631 | 6 | 19 | 4 | 63.8% | 11.9% | 6 | 0.46 | 16 (21 on the screenshot) | | 2026-11-22 |
| after | laptop screen | room | 61 | 659 | 8 | 11 (8 uncovered) | 3 | 9.5% | 13.8% | 72 | 0.43 | 19 | | 2026-11-22 |
| after | laptop screen | dim | 61 | 661 | 17 | 4 (2 uncovered) | 0 | 7.4% | 7.4% | 47 | 0.68 | 18 | | 2026-11-22 |

Notes on the 2026-11-22 "before" runs: Chrome on the S23+ over USB (`adb reverse`, dev server from the `fix/mask-flicker` worktree), WebGPU 640, `isolated: yes`. The plate was the made-up `XQZ 0000` page full-screen on the laptop; the phone was propped and the laptop was held by hand, so the plate moved a little. The overlay was reset and read over Chrome remote debugging after 61 s. Preview fps is the status-line value at the end of the run; a phone screenshot taken a second later showed the value in brackets.

Notes on the 2026-11-22 "after" runs (branch `fix/mask-flicker` at the commit that added the uncovered-drop counter; same phone, browser, backend, page and method as the "before" runs):

- **uncovered** in the drops column counts drops where no other drawn mask still covered the dropped track's last box. The counter was added after the "before" runs, so those rows have no uncovered count. On a moving plate a drop can count as uncovered while another mask already covers the plate's new position, so it is an upper bound on drops that showed the plate.
- **Seen on the phone:** after the "after" runs the user confirmed the masks no longer visibly blink over the plate (2026-11-22). The "twitch seen" column was not reported for the individual runs and stays blank.
- **Room light:** the phone moved more than in the "before" run (box jitter 13.8% against 8.6%), and a low-confidence false detection sat next to the plate at the start.
- **Dim light:** the plate stayed under a mask in the start and end screenshots.
- **Overlap frames went up** (72 and 47, from 8 and 6): the detector often returned the plate as two side-by-side boxes (for example 0.81 and 0.57) that overlap too little to merge, so two steady masks sat over one plate. Neither was dropped while the other held.
- **Masks are larger** than before: the padding now covers the usual gap between detections from the start, and a track seen 3 or more times is held 1 s. Allowed by the rules (a mask may be too big, never too small), but a false detection now stays covered longer too.
- **Discarded runs** (not in the table): one "after" room run aimed past the plate at low-confidence false detections, one taken with the plate much closer, and one dim run where the laptop showed an older two-line version of the test page that the detector did not find at all (0 boxes, plate readable on screen). That last one is a detector miss the tracker cannot fix.
- **Benchmark button** after the dim run, on the dev server over USB: WebGPU 640, median 141.3 ms, 95th percentile 147.1 ms, whole frame median 187.3 ms, preview 15 fps while it ran. The Phase 4 benchmark on the deployed app read 93.3 ms median and 21-24 fps (`docs/reports/phone_benchmark.md`); the "before" runs here already read about 143 ms per inference live, so the slower inference was present before this change and is not caused by it.

## Causes the counters confirm

From the two "before" rows:

1. **Confidence dipping below `mask_conf`: not the main cause.** The last detection before a drop averaged 0.57 (room) and 0.46 (dim), far above `mask_conf` 0.10. Masks drop while the detector still sees the plate well.
2. **Box jitter: present, more in dim light.** Detected box centres moved 8.6% (room) and 11.9% (dim) of the box's longer side between detections, with the laptop held by hand.
3. **Padding pulse: confirmed, the largest effect.** The drawn mask's area changed 54.9% (room) and 63.8% (dim) per frame, five to six times the box jitter. The padding grows by 4% of the longer side per 1/30 s unseen and snaps back on each detection; with about 143 ms between results that is a cycle of roughly 20-25% padding swing several times a second.
4. **A track ending and a new one starting on the same plate: confirmed.** 6 (room) and 4 (dim) re-acquisitions, and 8 and 6 frames with two overlapping masks. Most drops happen with the plate still detected at high confidence, which fits a detection failing to match its old track (IoU 0.2 against the velocity-predicted box), starting a new track, and the old one expiring 400 ms later.
5. **Canvas cleared or resized: ruled out.** 0 canvas resizes during both runs; video and masks are already drawn in one callback from tracker state.
6. **Blur or pixelation shimmer: not tested.** Both runs used Solid.

Also found: only 677 and 631 frames were drawn in 61 s (about 10-11 a second) while the fps counter read 16-20. The fps counter counts camera frame callbacks; with the frame hold on, the hold queue releases frames in bursts after each detection and skips all but the newest 2 (`MAX_RELEASABLE`), so fewer frames reach the screen than the counter shows. That uneven release may itself look like a twitch.
