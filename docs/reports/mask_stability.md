# Mask stability (Phase 4b)

Counters from the app's `?debug=1` overlay, read on the phone by hand. A blank cell means not measured yet. Never estimate a value.

## How to measure

1. Open the app with `?debug=1` on the Samsung Galaxy S23+ in Chrome. Leave **Backend** and **Input** on Auto and **Censor** on Solid.
2. Hold a printed plate by hand at arm's length, filling a normal part of the view.
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

| run | light | seconds | frames | shutter frames | drops | re-acquired | mask area change per frame | box jitter per detection | overlap frames | conf before drop | preview fps | twitch seen | date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before | room | | | | | | | | | | | | |
| before | dim | | | | | | | | | | | | |
| after | room | | | | | | | | | | | | |
| after | dim | | | | | | | | | | | | |

## Causes the counters confirm

To be filled from the "before" rows.
