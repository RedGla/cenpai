---
name: dataset-add
description: Add a new license-plate dataset (public or the owner's) to CenpAI - fetch or locate it, audit it, register it in docs/datasets.md and ml/datasets.yaml, draft labels with OWLv2 if it is unlabeled, and build a new dataset version. Use when the user provides a dataset or says /dataset-add.
argument-hint: "<folder path or dataset URL>"
---

1. **Place the data.** Raw media goes in `C:\Users\rapha\CenpAI-data\raw\<name>-v<N>\`, never inside the repo. For a Roboflow Universe source, export it in YOLO format through the Roboflow API or MCP. The API key is already in the user's environment: never print it or ask for it.
2. **Audit.** Delegate to the `dataset-auditor` subagent with the folder. It measures counts, checks class ids, duplicates, leakage and unlabeled plates, records the license (`unstated` is acceptable), and updates `docs/datasets.md` and `ml/datasets.yaml`.
3. **Unlabeled images?** Draft labels:
   `python -m ml.autolabel --images <raw folder> --out C:\Users\rapha\CenpAI-data\drafts\<name>`
   This needs about 2 GB of free RAM, so prefer Colab. Then the owner reviews the drafts (for example by importing into Roboflow and fixing boxes) and exports the reviewed set to `raw\<name>-reviewed\`, registered with `labels: owlv2-reviewed`. Unreviewed drafts never enter `ml/datasets.yaml`.
4. **Build a version.** Bump `version` in `ml/datasets.yaml` (never rebuild an existing one), then:
   `python -m ml.dataset --config ml/datasets.yaml --out data/processed`
   Show the printed report: images, boxes, negatives, and drops by reason for each split. If val or test is empty, say so; that means a train-only source can't be used for evaluation.
5. **Record it.** Add a `docs/DECISIONS.md` row if the source changes what val or test contain. Then run `/handoff` if this ends the stage.

Ask before any paid Roboflow action (the hooks will also ask).
