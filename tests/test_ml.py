"""ml/ pipeline logic. No torch, ultralytics or transformers needed: those are only imported by the CLIs."""
import csv
import json
import shutil

import cv2
import numpy as np
import pytest

from cenpai.detector import Detection
from ml import dataset as ds
from ml import evaluate as ev
from ml.autolabel import clip_dets, to_yolo_lines


# ---------------------------------------------------------------------------------------------- dataset
def test_label_path_swaps_last_images_folder(tmp_path):
    assert ds.label_path(tmp_path / "images" / "train" / "images" / "a.jpg") == tmp_path / "images" / "train" / "labels" / "a.txt"


def test_parse_label_boxes_polygons_and_class_filter():
    text = "7 0.5 0.5 0.2 0.1\n2 0.1 0.1 0.1 0.1\n7 0.1 0.1 0.3 0.1 0.3 0.3 0.1 0.3\n\n"
    boxes = ds.parse_label(text, {7})
    assert boxes[0] == pytest.approx((0.5, 0.5, 0.2, 0.1))
    assert boxes[1] == pytest.approx((0.2, 0.2, 0.2, 0.2))
    assert len(boxes) == 2


@pytest.mark.parametrize("bad", ["0 0.5 0.5", "0 0.5 0.5 0 0.1", "0 0.95 0.5 0.3 0.1", "x 1 1 1 1"])
def test_parse_label_rejects_malformed(bad):
    with pytest.raises(ValueError):
        ds.parse_label(bad, {0})


def test_scene_key_groups_video_frames_not_photos():
    assert ds.scene_key("clip3_mp4-0042_jpg.rf.ab12cd") == ds.scene_key("clip3_mp4-0043_jpg.rf.99ff00") == "clip3_mp4"
    assert ds.scene_key("IMG_1234_jpg.rf.ab12") != ds.scene_key("IMG_1235_jpg.rf.ab12")
    assert ds.scene_key("cam2_000123", r"^(cam\d+)") == "cam2"


def test_near_duplicates_are_merged_into_one_group():
    rng = np.random.default_rng(0)
    a = (rng.random((64, 64)) * 255).astype(np.uint8)
    b = a.copy()
    b[0, 0] ^= 1                                      # tiny change: same dHash
    c = (rng.random((64, 64)) * 255).astype(np.uint8)
    hashes = [ds.dhash(x) for x in (a, b, c)]
    assert ds.near_duplicate_pairs(hashes) == [(0, 1)]
    assert ds.union_groups(["s/a", "s/b", "s/c"], [(0, 1)]) == ["s/a", "s/a", "s/c"]


def test_assign_splits_by_group_and_train_only():
    groups = {f"g{i}": (10, False) for i in range(100)} | {"forced": (50, True)}
    out = ds.assign_splits(groups, seed=1)
    assert out["forced"] == "train"
    counts = {s: sum(groups[g][0] for g in groups if out[g] == s and g != "forced") for s in ds.SPLITS}
    assert counts["train"] == pytest.approx(700, abs=20) and counts["val"] == pytest.approx(150, abs=20)
    assert ds.assign_splits(groups, seed=1) == out         # deterministic


def _write(root, name, img, label):
    (root / "images").mkdir(parents=True, exist_ok=True)
    (root / "labels").mkdir(exist_ok=True)
    cv2.imwrite(str(root / "images" / name), img)
    if label is not None:
        (root / "labels" / name).with_suffix(".txt").write_text(label)


def test_prepare_end_to_end(tmp_path):
    rng = np.random.default_rng(0)
    src = tmp_path / "raw"
    for i in range(30):
        _write(src, f"photo{i}.png", (rng.random((48, 64, 3)) * 255).astype(np.uint8), "0 0.5 0.5 0.2 0.1\n")
    first = cv2.imread(str(src / "images" / "photo0.png"))
    _write(src, "copy.png", first, "0 0.5 0.5 0.2 0.1\n")                  # exact duplicate
    _write(src, "empty.png", (rng.random((48, 64, 3)) * 255).astype(np.uint8), "")   # negative
    _write(src, "nolabel.png", (rng.random((48, 64, 3)) * 255).astype(np.uint8), None)
    _write(src, "bad.png", (rng.random((48, 64, 3)) * 255).astype(np.uint8), "0 2 2 1 1\n")
    (src / "images" / "broken.jpg").write_bytes(b"not an image")
    (src / "labels" / "broken.txt").write_text("")
    cfg = {"version": "t1", "sources": [{"name": "s", "path": str(src)}]}
    rep = ds.prepare(cfg, tmp_path / "out")
    assert (rep["images"], rep["exact_duplicate"], rep["unlabeled"], rep["invalid_label"], rep["corrupt"]) == (31, 1, 1, 1, 1)
    assert rep["negatives"] == 1 and rep["boxes"] == 30
    out = tmp_path / "out" / "t1"
    rows = list(csv.DictReader(open(out / "manifest.csv", encoding="utf-8")))
    assert len(rows) == 31 and {r["split"] for r in rows} == {"train", "val", "test"}
    for r in rows:
        assert (out / "images" / r["split"] / r["file"]).is_file()
        assert "photo" not in r["file"]                                        # generated names only
    assert "license_plate" in (out / "data.yaml").read_text()
    with pytest.raises(SystemExit):
        ds.prepare(cfg, tmp_path / "out")                                      # never rebuilt in place


def test_prepare_refuses_drafts_and_skips_empties_when_required(tmp_path):
    src = tmp_path / "raw"
    _write(src, "a.png", np.zeros((8, 8, 3), np.uint8), "")
    with pytest.raises(SystemExit):
        ds.prepare({"version": "x", "sources": [{"name": "s", "path": str(src), "labels": "owlv2-draft"}]}, tmp_path / "o")
    rep = ds.prepare({"version": "y", "sources": [{"name": "s", "path": str(src), "require_boxes": True}]}, tmp_path / "o")
    assert rep["images"] == 0 and rep["unlabeled"] == 1


def test_resolve_path_reads_the_data_setting(tmp_path, monkeypatch):
    monkeypatch.delenv(ds.DATA_ENV, raising=False)
    assert ds.resolve_path(tmp_path / "a") == tmp_path / "a"                   # absolute: unchanged
    with pytest.raises(SystemExit):
        ds.resolve_path("raw/a")                                               # relative with no data folder
    assert ds.resolve_path("raw/a", tmp_path) == tmp_path / "raw" / "a"
    monkeypatch.setenv(ds.DATA_ENV, str(tmp_path / "d"))
    assert ds.resolve_path("raw/a") == tmp_path / "d" / "raw" / "a"


def test_datasets_yaml_paths_are_relative_to_the_data_setting(monkeypatch, tmp_path):
    import yaml
    from pathlib import Path
    cfg = yaml.safe_load((Path(__file__).parents[1] / "ml" / "datasets.yaml").read_text(encoding="utf-8"))
    monkeypatch.setenv(ds.DATA_ENV, str(tmp_path))
    names = [s["name"] for s in cfg["sources"]]
    assert len(names) == len(set(names)) and "license-plate-detection-ph-bb-v5" in names
    for s in cfg["sources"]:
        assert not Path(s["path"]).is_absolute() and ":" not in s["path"], s["name"]
        assert tmp_path in ds.resolve_path(s["path"]).parents
        assert not (s.get("train_only") and s.get("splits")), s["name"]
        assert set((s.get("splits") or {}).values()) <= set(ds.SPLITS)
    assert not any("phone" in str(v).lower() for s in cfg["sources"] for v in s.values())   # family-car test clips never enter


def test_label_kind_finds_polygons():
    assert ds.label_kind("0 0.5 0.5 0.2 0.1\n") == "box"
    assert ds.label_kind("0 0.1 0.1 0.3 0.1 0.3 0.3 0.1 0.3\n") == "polygon"
    assert ds.label_kind("0 0.5 0.5 0.2 0.1\n0 0.1 0.1 0.3 0.1 0.3 0.3\n") == "mixed"
    assert ds.label_kind("0 0.5 0.5\n") == ds.label_kind("0 a b c d\n") == "malformed"
    assert ds.label_kind("\n") == "empty"


def test_ccpd_label_reads_the_box_from_the_file_name():
    name = "025-95_113-154&383_386&473-386&473_177&454_154&383_363&402-0_0_22_27_27_33_16-37-15.jpg"
    assert ds.ccpd_label(name, 720, 1160) == "0 0.375000 0.368966 0.322222 0.077586\n"


def _img(rng):
    return (rng.random((48, 64, 3)) * 255).astype(np.uint8)


def test_fixed_splits_win_and_related_training_images_are_dropped(tmp_path):
    rng = np.random.default_rng(3)
    ph, oi, tr, kb = tmp_path / "ph", tmp_path / "oi", tmp_path / "tr", tmp_path / "kb"
    for i in range(40):
        _write(ph, f"p{i}_jpg.rf.{i:04x}.png", _img(rng), "0 0.5 0.5 0.2 0.1\n")
    (ph / "images" / "p0_jpg.rf.ffff.png").write_bytes(cv2.imencode(".png", np.flipud(_img(rng)))[1].tobytes())
    (ph / "labels" / "p0_jpg.rf.ffff.txt").write_text("0 0.5 0.5 0.2 0.1\n")   # augmented copy: same original name
    val_img = _img(rng)
    _write(oi / "validation", "v1.png", val_img, "0 0.5 0.5 0.2 0.1\n")
    near = val_img.copy()
    near[0, 0] ^= 1
    _write(oi / "train", "t1.png", near, "0 0.5 0.5 0.2 0.1\n")               # near duplicate of an official val image
    _write(oi / "train", "t2.png", _img(rng), "0 0.5 0.5 0.2 0.1\n")
    _write(oi / "test", "x1.png", _img(rng), "0 0.5 0.5 0.2 0.1\n")
    near2 = val_img.copy()
    near2[1, 1] ^= 1
    _write(tr, "a.png", near2, "0 0.5 0.5 0.2 0.1\n")                          # train-only copy of the val image
    _write(tr, "b.png", _img(rng), "0 0.5 0.5 0.2 0.1\n")
    kb_img = _img(rng)
    _write(kb, "k1.png", kb_img, "3 0.5 0.5 0.9 0.5\n")                       # keyboard box: dropped, image kept
    near3 = kb_img.copy()
    near3[2, 2] ^= 1
    _write(kb, "k2.png", near3, "3 0.5 0.5 0.9 0.5\n")                        # near duplicate within a dedupe source
    _write(kb, "k3.png", _img(rng), "")
    cfg = {"version": "v", "sources": [
        {"name": "ph", "path": "ph"},
        {"name": "oi", "path": "oi", "splits": {"train": "train", "validation": "val", "test": "test"}},
        {"name": "tr", "path": "tr", "train_only": True},
        {"name": "kb", "path": "kb", "train_only": True, "negatives": True, "dedupe": True, "exclude": ["images/k3.png"]}]}
    rep = ds.prepare(cfg, tmp_path / "out", data_root=tmp_path)
    out = tmp_path / "out" / "v"
    rows = {(r["source"], r["original"]): r for r in csv.DictReader(open(out / "manifest.csv", encoding="utf-8"))}
    assert rows[("oi", "validation/images/v1.png")]["split"] == "val"
    assert rows[("oi", "test/images/x1.png")]["split"] == "test"
    assert rows[("oi", "train/images/t2.png")]["split"] == "train"
    assert ("oi", "train/images/t1.png") not in rows and ("tr", "images/a.png") not in rows
    assert rep["dropped_split_conflict"] == 2 and rep["dropped_near_duplicate"] == 1 and rep["excluded"] == 1
    assert rows[("kb", "images/k1.png")]["boxes"] == "0" and ("kb", "images/k2.png") not in rows
    assert rows[("ph", "images/p0_jpg.rf.0000.png")]["split"] == rows[("ph", "images/p0_jpg.rf.ffff.png")]["split"]
    assert {r["split"] for r in rows.values() if r["source"] == "ph"} == set(ds.SPLITS)
    assert rep["sources"]["oi"]["val"] == {"images": 1, "boxes": 1, "negatives": 0}
    assert (out / "val_oi.txt").read_text().startswith("./images/val/oi__")
    assert ds.leak_report(out) == {"groups_in_more_than_one_split": 0, "eval_images_exactly_in_train": 0,
                                   "eval_images_near_duplicate_of_train": 0, "images_in_both_val_and_test": 0}
    extra = tmp_path / "synthetic"
    extra.mkdir()
    shutil.copy(out / "images" / "val" / rows[("oi", "validation/images/v1.png")]["file"], extra / "s.png")
    assert ds.leak_report(out, [extra])["eval_images_exactly_in_train"] == 1  # the check catches a leak


def test_max_images_samples_reproducibly(tmp_path):
    rng = np.random.default_rng(4)
    for i in range(20):
        _write(tmp_path / "s", f"i{i}.png", _img(rng), "0 0.5 0.5 0.2 0.1\n")
    cfg = {"version": "a", "sources": [{"name": "s", "path": str(tmp_path / "s"), "max_images": 7, "train_only": True}]}
    a = ds.prepare(cfg, tmp_path / "o1", seed=5)
    b = ds.prepare(cfg, tmp_path / "o2", seed=5)
    assert a["images"] == b["images"] == 7
    files = [sorted(r["original"] for r in csv.DictReader(open(o / "a" / "manifest.csv"))) for o in (tmp_path / "o1", tmp_path / "o2")]
    assert files[0] == files[1]


# ---------------------------------------------------------------------------------------------- evaluate
def test_match_is_greedy_by_score_and_one_to_one():
    gts = np.array([[0, 0, 10, 10], [20, 20, 30, 30]], float)
    preds = np.array([[0, 0, 10, 10, 0.9], [1, 1, 10, 10, 0.8], [50, 50, 60, 60, 0.7]], float)
    tp, gs = ev.match(preds, gts, 0.5)
    assert tp.tolist() == [True, False, False] and gs.tolist() == [0.9, -1.0]


def test_ap_perfect_and_half():
    assert ev.ap101(np.array([0.9, 0.8]), np.array([True, True]), 2) == pytest.approx(1.0)
    assert ev.ap101(np.array([0.9]), np.array([True]), 2) == pytest.approx(51 / 101)


def test_pick_conf_prefers_recall_target_then_f1():
    s = np.array([0.9, 0.8, 0.7, 0.6, 0.5])
    tp = np.array([True, True, False, True, False])
    assert ev.pick_conf(s, tp, 3, 0.95) == (0.6, True)
    conf, met = ev.pick_conf(s, tp, 4, 0.95)
    assert not met and conf == 0.6                                  # max F1: 0.75 at 0.6 (P .75, R .75) beats 0.8 (P 1, R .5)
    assert ev.pick_conf(np.array([]), np.array([], bool), 3, 0.95) == (0.25, False)


def test_pick_conf_keeps_tied_scores_together():
    s = np.array([0.9, 0.5, 0.5])
    tp = np.array([True, False, True])
    assert ev.pick_conf(s, tp, 2, 1.0) == (0.5, True)
    assert ev.pr_at(s, tp, 2, 0.5) == pytest.approx((2 / 3, 1.0, 0.8))


def test_collect_and_score_through_serving_loader(tmp_path, stub):
    d = tmp_path / "v"
    for split in ("test",):
        (d / "images" / split).mkdir(parents=True)
        (d / "labels" / split).mkdir(parents=True)
    cv2.imwrite(str(d / "images" / "test" / "a.png"), np.zeros((100, 200, 3), np.uint8))
    (d / "labels" / "test" / "a.txt").write_text("0 0.25 0.5 0.1 0.2\n")       # box 40..60 x 40..60
    cv2.imwrite(str(d / "images" / "test" / "b.png"), np.zeros((100, 200, 3), np.uint8))
    (d / "labels" / "test" / "b.txt").write_text("")
    run = ev.collect(stub([Detection(40, 40, 60, 60, 0.9)]), d, "test")
    res = ev.score(run, 0.5)
    assert (res["images"], res["gt_boxes"], res["negatives"]) == (2, 1, 1)
    assert res["recall"] == 1.0 and res["precision"] == 0.5               # the box on b.png is a false positive
    assert res["recall_by_size"]["small"] == (1.0, 1)
    assert res["worst"] == [("b.png", 0, 1)]
    ev.write_report(res, tmp_path / "r.md", "m", "abc", "test", d, 0.5)
    assert "| 2 | 1 | 1 | 0.500 | 1.000 |" in (tmp_path / "r.md").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------------------------- autolabel
def test_clip_dets_and_yolo_lines():
    dets = clip_dets(np.array([[-5, 10, 50, 30], [-4, 10, 50, 31], [90, 90, 120, 120], [5, 5, 5, 9]], float),
                     np.array([0.9, 0.8, 0.5, 0.4]), 100, 100, 0.5)
    assert dets == [Detection(0, 10, 50, 30, 0.9), Detection(90, 90, 100, 100, 0.5)]
    assert to_yolo_lines(dets[:1], 100, 100) == "0 0.250000 0.200000 0.500000 0.200000\n"
