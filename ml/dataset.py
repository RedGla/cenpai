"""PRD §6: build one versioned, single-class YOLO dataset from several sources.

Checks every image and label, drops exact duplicates, groups near duplicates and frames of the same video,
then splits by group (never by image) so related frames cannot leak across train/val/test.

    python -m ml.dataset --config ml/datasets.yaml --out data/processed

Each source is a folder of images with YOLO label files in a sibling `labels` folder (Roboflow's YOLO export
layout). An image with no label file is *unlabeled* and skipped; an empty label file is a negative image.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
import shutil
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
LABEL_ORIGINS = {"human", "owlv2-reviewed"}       # unreviewed OWLv2 drafts are never accepted
NEAR_DUP_BITS = 4                                 # dHash Hamming distance that counts as the same scene
SPLITS = ("train", "val", "test")


def label_path(img: Path) -> Path:
    """.../images/x.jpg -> .../labels/x.txt (the last `images` folder in the path is swapped)."""
    parts = list(img.parts)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "images":
            parts[i] = "labels"
            return Path(*parts).with_suffix(".txt")
    return img.with_suffix(".txt")


def parse_label(text: str, plate_classes: set[int]) -> list[tuple[float, float, float, float]]:
    """YOLO lines -> plate boxes (cx, cy, w, h), normalised. Polygons become their bounding box.
    Raises ValueError on any malformed line: a half-read label file would teach the model to miss plates."""
    boxes = []
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        cls, vals = int(float(parts[0])), [float(v) for v in parts[1:]]
        if len(vals) == 4:
            cx, cy, w, h = vals
        elif len(vals) >= 6 and len(vals) % 2 == 0:
            xs, ys = vals[0::2], vals[1::2]
            cx, cy, w, h = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(xs) - min(xs), max(ys) - min(ys)
        else:
            raise ValueError("bad label line")
        if cls not in plate_classes:
            continue
        x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
        if w <= 0 or h <= 0 or x1 < -0.01 or y1 < -0.01 or x2 > 1.01 or y2 > 1.01:
            raise ValueError("box outside the image")
        x1, y1, x2, y2 = max(x1, 0), max(y1, 0), min(x2, 1), min(y2, 1)
        boxes.append(((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1))
    return boxes


def scene_key(stem: str, group_regex: str | None = None) -> str:
    """Frames of one video share a key. Roboflow names look like `clip3_mp4-0042_jpg.rf.<hash>`."""
    s = re.sub(r"\.rf\.[0-9a-f]+$", "", stem)
    s = re.sub(r"_(jpe?g|png)$", "", s)
    if group_regex:
        m = re.match(group_regex, s)
        return m.group(1) if m else s
    m = re.match(r"^(.*?(?:mp4|mov|avi|frame))", s, re.IGNORECASE)
    return m.group(1) if m else s


def dhash(gray: np.ndarray) -> int:
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    return int.from_bytes(np.packbits(small[:, 1:] > small[:, :-1]).tobytes(), "big")


def near_duplicate_pairs(hashes: list[int], max_bits: int = NEAR_DUP_BITS) -> list[tuple[int, int]]:
    h = np.array(hashes, dtype=np.uint64)
    pairs = []
    for i in range(len(h) - 1):
        x = (h[i + 1:] ^ h[i]).view(np.uint8).reshape(-1, 8)
        dist = np.unpackbits(x, axis=1).sum(axis=1)
        pairs += [(i, i + 1 + int(j)) for j in np.nonzero(dist <= max_bits)[0]]
    return pairs


def union_groups(keys: list[str], pairs: list[tuple[int, int]]) -> list[str]:
    """Merge scene keys connected by near-duplicate pairs; returns each record's final group name."""
    parent = {k: k for k in keys}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k
    for i, j in pairs:
        a, b = find(keys[i]), find(keys[j])
        if a != b:
            parent[max(a, b)] = min(a, b)
    return [find(k) for k in keys]


def assign_splits(groups: dict[str, tuple[int, bool]], ratios=(0.70, 0.15, 0.15), seed: int = 0) -> dict[str, str]:
    """groups: name -> (image count, train_only). Shuffled groups fill train, then val, then test by image share."""
    out = {g: "train" for g, (_, train_only) in groups.items() if train_only}
    eligible = sorted(g for g in groups if g not in out)
    random.Random(seed).shuffle(eligible)
    total = sum(groups[g][0] for g in eligible) or 1
    seen = 0
    for g in eligible:
        pos = seen / total
        out[g] = "train" if pos < ratios[0] else "val" if pos < ratios[0] + ratios[1] else "test"
        seen += groups[g][0]
    return out


def prepare(cfg: dict, out_root: Path, seed: int = 0) -> dict:
    out = Path(out_root) / str(cfg["version"])
    if out.exists():
        raise SystemExit(f"{out} already exists: bump `version` instead of changing a dataset in place")
    stats = {k: 0 for k in ("images", "boxes", "negatives", "unlabeled", "invalid_label", "corrupt", "exact_duplicate")}
    recs, seen_sha = [], set()
    for src in cfg["sources"]:
        name, root = src["name"], Path(src["path"])
        if src.get("labels", "human") not in LABEL_ORIGINS:
            raise SystemExit(f"{name}: labels must be one of {sorted(LABEL_ORIGINS)}; review OWLv2 drafts first")
        classes = set(src.get("plate_classes", [0]))
        for img in sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTS):
            lbl = label_path(img)
            if not lbl.is_file():
                stats["unlabeled"] += 1
                continue
            try:
                boxes = parse_label(lbl.read_text(encoding="utf-8"), classes)
            except ValueError:
                stats["invalid_label"] += 1
                continue
            if not boxes and src.get("require_boxes"):    # source has unlabeled plates: its empties aren't negatives
                stats["unlabeled"] += 1
                continue
            data = img.read_bytes()
            gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
            if gray is None:
                stats["corrupt"] += 1
                continue
            sha = hashlib.sha256(data).hexdigest()
            if sha in seen_sha:
                stats["exact_duplicate"] += 1
                continue
            seen_sha.add(sha)
            recs.append(dict(source=name, img=img, original=img.relative_to(root).as_posix(), sha=sha, boxes=boxes,
                             labels=src.get("labels", "human"), train_only=bool(src.get("train_only", False)),
                             key=f"{name}/{scene_key(img.stem, src.get('group_regex'))}", hash=dhash(gray)))

    groups = union_groups([r["key"] for r in recs], near_duplicate_pairs([r["hash"] for r in recs]))
    sizes: dict[str, list] = {}
    for r, g in zip(recs, groups):
        r["group"] = g
        n, t = sizes.get(g, (0, False))
        sizes[g] = (n + 1, t or r["train_only"])          # a group touching a train-only source stays in train
    split_of = assign_splits(sizes, tuple(cfg.get("ratios", (0.70, 0.15, 0.15))), seed)

    for s in SPLITS:
        (out / "images" / s).mkdir(parents=True)
        (out / "labels" / s).mkdir(parents=True)
    per_split = {s: {"images": 0, "boxes": 0} for s in SPLITS}
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["split", "file", "source", "original", "group", "sha256", "boxes", "labels"])
        for r in recs:
            s = split_of[r["group"]]
            fname = f"{r['source']}__{r['sha'][:12]}{r['img'].suffix.lower()}"   # generated: no name clashes
            shutil.copyfile(r["img"], out / "images" / s / fname)
            (out / "labels" / s / fname).with_suffix(".txt").write_text(
                "".join(f"0 {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n" for cx, cy, bw, bh in r["boxes"]), encoding="utf-8")
            w.writerow([s, fname, r["source"], r["original"], r["group"], r["sha"], len(r["boxes"]), r["labels"]])
            per_split[s]["images"] += 1
            per_split[s]["boxes"] += len(r["boxes"])
            stats["images"] += 1
            stats["boxes"] += len(r["boxes"])
            stats["negatives"] += not r["boxes"]
    (out / "data.yaml").write_text(
        f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\n"
        "names:\n  0: license_plate\n", encoding="utf-8")
    report = {"version": cfg["version"], "seed": seed, "groups": len(sizes), "splits": per_split, **stats}
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("data/processed"))
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    import yaml
    print(json.dumps(prepare(yaml.safe_load(a.config.read_text(encoding="utf-8")), a.out, a.seed), indent=2))


if __name__ == "__main__":
    main()
