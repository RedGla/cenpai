import cv2
import numpy as np
import pytest

from cenpai.censor import censor, pad_box
from cenpai.detector import Detection


@pytest.fixture
def img():
    im = np.full((200, 300, 3), 200, np.uint8)
    cv2.putText(im, "ABC 1234", (80, 110), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    return im


D = Detection(70, 80, 230, 125, 0.9)


def lap_var(a):
    return cv2.Laplacian(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()


def test_pad_box_expands_and_clips():
    assert pad_box(D, (200, 300)) == (70 - 16, 80 - 4, 230 + 16, 125 + 4)
    assert pad_box(Detection(0, 0, 10, 10, 1), (50, 50)) == (0, 0, 14, 14)


def test_solid_covers_padded_box(img):
    out = censor(img, [D])
    x1, y1, x2, y2 = pad_box(D, img.shape[:2])
    assert (out[y1:y2, x1:x2] == 0).all()
    assert (out[:y1] == img[:y1]).all() and (out[:, :x1] == img[:, :x1]).all()


def test_box_clipped_at_edges(img):
    out = censor(img, [Detection(-5, -5, 20, 20, 0.9), Detection(280, 180, 400, 300, 0.9)])
    assert out.shape == img.shape and (out[:10, :10] == 0).all() and (out[-5:, -5:] == 0).all()


def test_blur_removes_detail(img):
    out = censor(img, [D], "blur")
    x1, y1, x2, y2 = pad_box(D, img.shape[:2])
    assert lap_var(out[y1:y2, x1:x2]) <= 0.05 * lap_var(img[y1:y2, x1:x2])


def test_pixelate_block_size(img):
    out = censor(img, [D], "pixelate")
    x1, y1, x2, y2 = pad_box(D, img.shape[:2])
    roi = out[y1:y2, x1:x2]
    distinct_rows = 1 + int((np.abs(np.diff(roi.astype(int), axis=0)).sum(axis=(1, 2)) > 0).sum())
    assert distinct_rows <= 8   # ~6 blocks (+ rounding)
    assert (roi[:4, :4] == roi[0, 0]).all()          # blocks are flat
    assert (roi != img[y1:y2, x1:x2]).any()           # content changed
    # readability of each strength is judged by the M3 censor audit, not by this test


def test_no_detections_unchanged_and_input_not_mutated(img):
    before = img.copy()
    assert (censor(img, []) == before).all()
    censor(img, [D])
    assert (img == before).all()


def test_unknown_mode_rejected(img):
    with pytest.raises(ValueError):
        censor(img, [D], "rainbow")
