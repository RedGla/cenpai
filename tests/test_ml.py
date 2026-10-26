"""ml/ pipeline logic. No torch, ultralytics or transformers needed: those are only imported by the CLIs."""
import csv
import json

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
