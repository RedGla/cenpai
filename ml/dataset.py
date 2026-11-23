"""PRD §6: build one versioned, single-class YOLO dataset from several sources.

Checks every image and label, drops exact duplicates, groups near duplicates and frames of the same video,
then splits by group (never by image) so related frames cannot leak across train/val/test.

    CENPAI_DATA=/content/work python -m ml.dataset --config ml/datasets.yaml --out data/processed

Each source is a folder of images with YOLO label files in a sibling `labels` folder (Roboflow's YOLO export
layout). An image with no label file is *unlabeled* and skipped; an empty label file is a negative image.
A relative source `path` is read under the data folder named by `--data-root` or the CENPAI_DATA setting.

Per-source options (ml/datasets.yaml):
  plate_classes  class ids that are plates; every other class is dropped
  train_only     every image goes to train
  splits         keep the source's own split: {folder name in the path: train|val|test}
  negatives      ignore the label files: every image is a no-plate image
  require_boxes  skip images without a plate box (their plates may be unlabeled)
  max_images     random sample of this many training images (seeded); fixed val and test images are all kept
  exclude        image paths, relative to the source folder, to leave out
  dedupe         drop an image when it is a near duplicate of an image kept from another source (sources listed
                 first win); near duplicates within the source are kept, because video frames chain into one group
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
LABEL_ORIGINS = {"human", "owlv2-reviewed"}       # unreviewed OWLv2 drafts are never accepted
NEAR_DUP_BITS = 4                                 # dHash Hamming distance that counts as the same scene
SPLITS = ("train", "val", "test")
DATA_ENV = "CENPAI_DATA"                          # folder that relative source paths are read under
SPLIT_RANK = {"train": 1, "val": 2, "test": 3}    # a group with a fixed split goes to the most protected one


def resolve_path(path: str | Path, data_root: str | Path | None = None) -> Path:
    """Absolute paths stay as they are; relative ones are read under `data_root`, else the CENPAI_DATA setting."""
    p = Path(path)
    if p.is_absolute():
        return p
    root = data_root or os.environ.get(DATA_ENV)
    if not root:
        raise SystemExit(f"{path} is relative: set {DATA_ENV} (or --data-root) to the data folder")
    return Path(root) / p


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


def label_kind(text: str) -> str:
    """Classifies a YOLO label file: empty, box (4 numbers per row), polygon (an even count of 6 or more), mixed
    (both kinds of row) or malformed."""
    kinds = set()
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        try:
            [float(v) for v in parts]
        except ValueError:
            return "malformed"
        n = len(parts) - 1
        kinds.add("box" if n == 4 else "polygon" if n >= 6 and n % 2 == 0 else "malformed")
    if not kinds:
        return "empty"
    if "malformed" in kinds:
        return "malformed"
    return kinds.pop() if len(kinds) == 1 else "mixed"


def inspect_labels(paths) -> Counter:
    """Counts label files by `label_kind`, to see what an earlier check rejected."""
    return Counter(label_kind(Path(p).read_text(encoding="utf-8")) for p in paths)


def ccpd_label(name: str, w: int, h: int) -> str:
    """CCPD keeps its box in the file name (area-tilt-x1&y1_x2&y2-vertices-plate-brightness-blur.jpg).
    Returns the YOLO line (class 0) for a w x h image."""
    (x1, y1), (x2, y2) = (map(int, v.split("&")) for v in Path(name).stem.split("-")[2].split("_"))
    x1, x2 = sorted((max(x1, 0), min(x2, w)))
    y1, y2 = sorted((max(y1, 0), min(y2, h)))
    return f"0 {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}\n"


def fixed_split(rel: str, mapping: dict | None) -> str | None:
    """The split a source fixes for an image: the first folder in its relative path that `mapping` names."""
    if not mapping:
        return None
    for part in Path(rel).parts[:-1]:
        if part in mapping:
            return mapping[part]
    raise SystemExit(f"{rel}: no folder named in `splits` {sorted(mapping)}")


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


def prepare(cfg: dict, out_root: Path, seed: int = 0, data_root: str | Path | None = None) -> dict:
    out = Path(out_root) / str(cfg["version"])
    if out.exists():
        raise SystemExit(f"{out} already exists: bump `version` instead of changing a dataset in place")
    stats = {k: 0 for k in ("images", "boxes", "negatives", "unlabeled", "invalid_label", "corrupt", "exact_duplicate",
                            "excluded", "dropped_split_conflict", "dropped_near_duplicate")}
    recs, seen_sha = [], set()
    for src in cfg["sources"]:
        name, root = src["name"], resolve_path(src["path"], data_root)
        if src.get("labels", "human") not in LABEL_ORIGINS:
            raise SystemExit(f"{name}: labels must be one of {sorted(LABEL_ORIGINS)}; review OWLv2 drafts first")
        if src.get("train_only") and src.get("splits"):
            raise SystemExit(f"{name}: use either train_only or splits, not both")
        if not root.is_dir():
            raise SystemExit(f"{name}: {root} is not a folder")
        classes = set(src.get("plate_classes", [0]))
        exclude = set(src.get("exclude") or [])
        imgs = sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTS)
        if src.get("max_images"):                         # sample training images only; fixed val/test stay whole
            mapping = src.get("splits")
            pool = [p for p in imgs if fixed_split(p.relative_to(root).as_posix(), mapping) in (None, "train")]
            if len(pool) > src["max_images"]:
                keep = set(random.Random(f"{seed}:{name}").sample(pool, src["max_images"]))
                pool_set = set(pool)
                imgs = [p for p in imgs if p in keep or p not in pool_set]
        for img in imgs:
            rel = img.relative_to(root).as_posix()
            if rel in exclude:
                stats["excluded"] += 1
                continue
            lbl = label_path(img)
            if src.get("negatives"):                      # no-plate source: its own labels mark other objects
                boxes = []
            elif not lbl.is_file():
                stats["unlabeled"] += 1
                continue
            else:
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
            fixed = "train" if src.get("train_only") else fixed_split(rel, src.get("splits"))
            recs.append(dict(source=name, img=img, original=rel, sha=sha, boxes=boxes, labels=src.get("labels", "human"),
                             fixed=fixed, dedupe=bool(src.get("dedupe")),
                             key=f"{name}/{scene_key(img.stem, src.get('group_regex'))}", hash=dhash(gray)))

    # Groups join images of one original (same source name) and near duplicates across all sources. A group holding an
    # image with a fixed split goes to the most protected such split (test, then val, then train). Images fixed to
    # another split are dropped, so nothing used for training is related to a validation or test image.
    groups = union_groups([r["key"] for r in recs], near_duplicate_pairs([r["hash"] for r in recs]))
    fixed_of: dict[str, str] = {}
    sizes: dict[str, int] = {}
    for r, g in zip(recs, groups):
        r["group"] = g
        sizes[g] = sizes.get(g, 0) + 1
        if r["fixed"] and SPLIT_RANK[r["fixed"]] > SPLIT_RANK.get(fixed_of.get(g), 0):
            fixed_of[g] = r["fixed"]
    free = {g: (n, False) for g, n in sizes.items() if g not in fixed_of}
    split_of = assign_splits(free, tuple(cfg.get("ratios", (0.70, 0.15, 0.15))), seed) | fixed_of
    kept, sources_in = [], defaultdict(set)              # group -> sources with a kept image in it
    for r in recs:
        if r["fixed"] and r["fixed"] != split_of[r["group"]]:
            stats["dropped_split_conflict"] += 1
        elif r["dedupe"] and sources_in[r["group"]] - {r["source"]}:
            stats["dropped_near_duplicate"] += 1
        else:
            kept.append(r)
            sources_in[r["group"]].add(r["source"])
    recs = kept

    for s in SPLITS:
        (out / "images" / s).mkdir(parents=True)
        (out / "labels" / s).mkdir(parents=True)
    per_split = {s: {"images": 0, "boxes": 0} for s in SPLITS}
    per_source = {src["name"]: {s: {"images": 0, "boxes": 0, "negatives": 0} for s in SPLITS} for src in cfg["sources"]}
    lists = defaultdict(list)
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
            c = per_source[r["source"]][s]
            c["images"] += 1
            c["boxes"] += len(r["boxes"])
            c["negatives"] += not r["boxes"]
            if s != "train":
                lists[f"{s}_{r['source']}.txt"].append(f"./images/{s}/{fname}\n")
            stats["images"] += 1
            stats["boxes"] += len(r["boxes"])
            stats["negatives"] += not r["boxes"]
    (out / "data.yaml").write_text(
        f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\n"
        "names:\n  0: license_plate\n", encoding="utf-8")
    for fname, lines in lists.items():                     # per-source eval lists, e.g. val_open-images-v7.txt
        (out / fname).write_text("".join(lines), encoding="utf-8")
    report = {"version": cfg["version"], "seed": seed, "groups": len({r["group"] for r in recs}), "splits": per_split,
              "sources": per_source, **stats}
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def leak_report(out: Path, extra_train=(), max_bits: int = NEAR_DUP_BITS) -> dict:
    """Re-checks a built version from its files; every count must be 0. Counts groups found in more than one split,
    and val or test images that are in training (the train split plus any `extra_train` folders, such as synthetic
    data), exactly (sha256) or as a near duplicate (dHash within `max_bits`)."""
    out = Path(out)
    rows = list(csv.DictReader(open(out / "manifest.csv", encoding="utf-8")))
    splits_of = defaultdict(set)
    for r in rows:
        splits_of[r["group"]].add(r["split"])
    files = {s: sorted((out / "images" / s).iterdir()) for s in SPLITS}
    files["train"] += sorted(p for d in extra_train for p in Path(d).rglob("*") if p.suffix.lower() in IMAGE_EXTS)

    def sha(p):
        return hashlib.sha256(p.read_bytes()).hexdigest()

    def dh(p):
        return dhash(cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_GRAYSCALE))
    train_sha = {sha(p) for p in files["train"]}
    train_hash = np.array([dh(p) for p in files["train"]], dtype=np.uint64)
    exact = near = 0
    eval_sha = {}
    for s in ("val", "test"):
        eval_sha[s] = {sha(p) for p in files[s]}
        exact += len(eval_sha[s] & train_sha)
        for p in files[s]:
            if len(train_hash):
                d = np.unpackbits((train_hash ^ np.uint64(dh(p))).view(np.uint8).reshape(-1, 8), axis=1).sum(axis=1)
                near += bool((d <= max_bits).any())
    return {"groups_in_more_than_one_split": sum(len(v) > 1 for v in splits_of.values()),
            "eval_images_exactly_in_train": exact,
            "eval_images_near_duplicate_of_train": near,
            "images_in_both_val_and_test": len(eval_sha["val"] & eval_sha["test"])}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("data/processed"))
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--data-root", type=Path, default=None, help=f"folder for relative source paths (default: ${DATA_ENV})")
    a = ap.parse_args()
    import yaml
    cfg = yaml.safe_load(a.config.read_text(encoding="utf-8"))
    rep = prepare(cfg, a.out, a.seed, a.data_root)
    rep["leaks"] = leak_report(a.out / str(cfg["version"]))
    print(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main()
