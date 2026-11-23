# Data and phone test protocol

Used by Phases 5, 6 and 7. Targets are recommendations, not measured requirements. Revised 2026-11-22: the team does not photograph real vehicles for the dataset. Family-car videos are used for testing only.

## Why this matters

The v0 detector scores well on PH BB v5 (validation and test both about 0.99 precision and 0.95-0.96 recall, best epoch 46 of 50), so the evidence does not show overfitting. On the phone it failed in conditions PH BB v5 barely covers: dark rooms, plates cut off at the frame edge, plates on a screen, a backlit paper plate. It also masked laptop keyboards. The PH BB test split may also contain photos related to training ones, so its scores are optimistic.

The fix has two parts: more varied training data from licensed public sources, and an honest test on the phone.

## Where each kind of data goes

| Data | Train | Validation (choices) | Test (scored once) | In the dataset? |
|---|---|---|---|---|
| PH BB v5 (secondary, Philippine) | Train split | Validation split | Test split, box metrics | Yes |
| Licensed internet sets (secondary) | Yes | Open Images' official validation split only | Open Images' official test split, box metrics | Yes, training and public evaluation only |
| Synthetic images | Yes | Never | Never | Training folders only |
| Family-car videos (S23+) | **Never** | **Never** | Phone leak test, "final" clips only | **No.** Not labelled, no frames extracted |

"Validation" is where every choice is made: `conf`, `mask_conf`, epochs, model size, and which internet or synthetic data to keep. The family-car videos never influence a choice, except the "look" clips described below.

## Family-car videos (phone test only)

### Rules

- Record only family vehicles whose owners agree. Do not record strangers' cars or plates. Record in places where other cars are not in view, or keep them out of frame.
- Record in `docs/DECISIONS.md` that the co-developers decided this on 2026-11-22: family vehicles with the owners' agreement, used for testing only, never for training.
- Store the clips privately on Google Drive under `CenpAI/phone-test/`, never in Git. No plate text in file names, notes or results.
- Never extract frames, draw boxes, or feed these clips to training or to threshold selection.
- Delete the raw clips when the project ends, and keep only the counts.

### What to record

Record 15-30 second clips on the S23+ rear camera, at the app's capture resolution (1280x720). Cover each condition with each available vehicle:

| # | Condition | How |
|---|---|---|
| 1 | Approach | Walk from about 5 m to 1 m, straight on |
| 2 | Pan in from the edge | Start pointed away, then pan until the plate enters from the side |
| 3 | Angles | Walk an arc from 45 degrees left to 45 degrees right |
| 4 | Night | Under a street lamp or porch light only |
| 5 | Backlight | Sun or a bright window behind the plate |
| 6 | Shake | Walk quickly or shake the phone |
| 7 | Partly covered | A hand or object over part of the plate |
| 8 | Motorcycle | If the family has one |
| 9 | Plate on a screen | A photo of a family car shown on a laptop or phone screen |
| 10 | No plate | Laptop keyboards, signs, printed text, a car front with the plate covered |

Name clips `c007_v2_night.mp4`: clip number, vehicle number, condition. Vehicle numbers are a private list kept with the clips, not plate text.

### Look clips and final clips

Split the clips before anyone watches the results:

- **Look clips (about a third, one of each condition):** may be watched at any time, to see where the model fails and decide what training data to add.
- **Final clips (the rest):** stay unwatched through the app until every model choice is locked. They are then run once through each locked model and scored.

If the final clips are watched and a model or threshold is changed afterwards, they are no longer a test. Record new final clips and score those instead.

### How a clip is scored

1. **Play the raw clip into the app.** The app gets a "video file as camera" mode (Phase 5 step 5), so each model runs the exact live pipeline (detector, tracker, masks, shutter) on the same footage. Record the censored output.
2. **List the plate appearances from the raw clip.** An appearance runs from when a plate first becomes readable to when it leaves view or stops being readable. Note its condition number.
3. **Two reviewers step through the censored output** at full frame rate. For each appearance, record whether any frame showed a readable plate, and how many frames did. Settle disagreements by watching together.
4. **Write one row per appearance** to `phone_test_results.csv`: clip, appearance number, condition, model version, leaked (yes or no), uncovered frames. No plate text.
5. **Count false masks on the no-plate clips:** the number of seconds a mask covered something that is not a plate.

### What to report

- **Leak rate per model:** appearances with at least one readable frame, over all appearances, with the counts (for example 3 of 41) and a 95% confidence interval.
- **Leak rate per condition,** with counts. Groups this small support no claims, only examples.
- **Uncovered frames per leak, and false-mask seconds** on the no-plate clips.

Box-level recall and mAP are not available on the phone footage, because it is not labelled. Report them on the public test splits and state this limitation in the paper.

## Internet sources (training, plus public validation and test)

Checked on 2026-11-22 on Roboflow Universe and the dataset owners' pages. Before adopting any source, the Phase 5 session must:

1. Open the source page and confirm the license.
2. Look at 20 random images to confirm they match the description.
3. Remove images that duplicate PH BB v5 or each other (dHash 4 or less, as `ml/dataset.py` already does).
4. Keep only the plate class, renamed `license_plate`.
5. Add a row to `docs/datasets.md`.

| Source | What it adds | Size | License (as listed) | Notes |
|---|---|---|---|---|
| [Open Images V7](https://storage.googleapis.com/openimages/web/index.html), class "Vehicle registration plate" | Everyday photos: phones, night, odd angles, partial plates. The closest match to phone footage. | Several thousand images; count them when downloading | Annotations CC BY 4.0; images listed by Google as CC BY 2.0. Confirm both on the download page. | Keep Google's official train, validation and test splits. Download only that class (FiftyOne or the OIDv4 toolkit). Credit image authors as CC BY requires. |
| [CCPD](https://github.com/detectRecog/CCPD), Blur, Tilt, Rotate, FN, Challenge subsets | Hard blur, strong tilt, small and distant plates | 250k+ in total; sample a few thousand | MIT per the official repository; cite the ECCV 2018 paper | Chinese plates (different colours and layout). Training only, a small share. |
| [Motorcycle License Plate (ZeroExperiments)](https://universe.roboflow.com/zeroexperiments/motorcycle-license-plate-skrdr) | Motorcycle plates | 1,845 | Public Domain | Country not stated; check the images. Training only. |
| [Motorcycle license plate (Hanoi University of Industry)](https://universe.roboflow.com/hanoi-university-of-industry/motorcycle-license-plate) | Motorcycle plates | 1,748 | MIT | Vietnamese plates. Training only. |
| [Keyboard (Rover)](https://universe.roboflow.com/rover-hdxdc/keyboard-dx28x), [KEYBOARD (test)](https://universe.roboflow.com/test-m8ckl/keyboard-ataj7) | No-plate photos of keyboards, the false positive v0 shows | 1,003 and 1,000 | CC BY 4.0 | Drop the keyboard labels and use them as images with no boxes. Remove any image that shows a plate. Training only. |
| `usp-ph-plates-v2`, `ph-plate-vehicle-v7` | Philippine plates | Already in `docs/datasets.md` | CC BY 4.0 | Already registered as train-only. |

Leave out:

- **Images from a web search or social media.** They have no license, show strangers' plates, and their owners never agreed.
- **Sets marked ND** (no derivatives), such as [TrainingDataPro license_plates](https://huggingface.co/datasets/TrainingDataPro/license_plates/blob/main/README.md). Relabelling and cropping make a derivative.
- **Small student sets of 40-100 Philippine images.** They add little and often copy PH BB v5.
- **Infrared camera sets.** They look nothing like a phone camera.

Mix: keep internet data to at most about half of the training images. Philippine plates (PH BB v5, oversampled if needed) stay the larger share.

## Synthetic data (training only)

No source was found for plates on screens, and the team will not photograph plates, so synthetic data fills those gaps. Keep it to at most about a third to a half of the training images.

1. **Training augmentation** (no new files). In Ultralytics: `hsv_v` (brightness), `degrees`, `perspective`, `scale`, `translate` and `mosaic` (these make plates cut off at the edge), `mixup`, `close_mosaic`. Start near `hsv_v=0.6, hsv_s=0.7, degrees=10, perspective=0.0008, scale=0.6, translate=0.2, mosaic=1.0, mixup=0.1, close_mosaic=10` and tune on validation.
2. **Offline variants with Albumentations:** darker and backlit copies (`RandomBrightnessContrast`), `MotionBlur`, `Perspective`, `GaussNoise`, `ImageCompression`, with `bbox_params` in YOLO format and `min_visibility=0.3` so partly visible plates keep their boxes. Check argument names against the installed version.
3. **Copy-paste:** cut labelled plates out of training images and paste them onto the keyboard and other no-plate images at random size, angle, brightness and position, including half off the edge. The box comes from where the plate was pasted.
4. **Screen effect:** paste training plates into photos of screens, or add a moire pattern, screen glare and a slight colour shift, to imitate a plate shown on a screen.
5. **Rendered plates:** draw Philippine-style plates (colours, a font close to the LTO one, random `ABC 1234` text) and warp them onto backgrounds. Made-up text only, and keep them a small share.

## How to decide what helps

Each internet source and each kind of synthetic data is an ablation: train with and without it, and compare on validation (PH BB v5 validation plus Open Images validation), mainly recall at `mask_conf`. Keep it only if it raises validation recall without a large precision loss. The look clips can show *why* a choice helps; they never decide it.

Only the locked final models are scored on the public test splits and the final phone clips, once each. Choosing by test results would make the test score optimistic.
