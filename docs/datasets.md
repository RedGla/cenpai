# Dataset register

One row per source version (PRD §6). Raw media lives in `C:\Users\rapha\CenpAI-data\raw\` and is never committed. Add rows with `/dataset-add`. `license: unstated` is allowed for training and research; it stays open under AC07 until cleared or accepted.

| Name (`ml/datasets.yaml`) | Source | License / attribution | Geography, layouts | Images / plate boxes | Format, label origin | Known issues | Decision |
|---|---|---|---|---|---|---|---|
| `usp-ph-plates-v2` | https://universe.roboflow.com/university-of-southeastern-philippines/philippine-license-plates/dataset/2 | CC BY 4.0 as stated on Roboflow; attribute University of Southeastern Philippines | Philippines; close-up plates | 38 distinct source images (augmented export) | YOLO; human | Stretched/equalized/augmented copies; ~30 are Facebook photos of private cars with readable plates | Train-only (owner allows use; v1.0 advice was to exclude) |
| `ph-plate-vehicle-v7` | https://universe.roboflow.com/research-3wj93/philippine-plate-and-vehicle/dataset/7 (`vehicle-detector-33bfo` is a copy) | CC BY 4.0 as stated on Roboflow; attribute research-3wj93 | Philippines; small plates in 2 third-party videos | 658 images; 101 plate boxes in 29 frames | YOLO, 13 classes (plate = 7); human | Plates unlabeled in other frames (`require_boxes`); 178 near-duplicate cross-split pairs | Train-only, plate-labelled frames only |

Overlap between the two: 0 exact, 0 near duplicates (dHash ≤ 4). Neither is a usable validation or test source, so the owner datasets are needed for a frozen test set.
