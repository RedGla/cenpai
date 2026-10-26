import cv2
import numpy as np
from PIL import Image

from cenpai.censor import pad_box
from cenpai.detector import Detection
from cenpai.media import process_image
from cenpai.validate import validate_upload
from cenpai.config import Limits


def run(path, store, detector, mode="solid"):
    info = validate_upload(path, Limits())
    job = store.create("s")
    return process_image(path, info, job, detector, mode), job


def test_exif_rotated_jpeg_censored_upright(make_jpg, store, stub):
    p = make_jpg(w=320, h=240, exif_orientation=6)        # stored sideways; displays 240 wide x 320 tall
    box = Detection(40, 100, 120, 140, 0.9)
    s = stub([box])
    res, _ = run(p, store, s)
    assert s.last_shape[:2] == (320, 240)                  # detector saw the upright frame
    out = Image.open(res.output)
    assert out.size == (240, 320) and not out.getexif()    # upright, no orientation/EXIF
    x1, y1, x2, y2 = pad_box(box, (320, 240))
    arr = np.asarray(out.convert("L"))
    assert arr[y1 + 2:y2 - 2, x1 + 2:x2 - 2].max() < 12    # solid mask (JPEG-tolerant)


def test_output_format_matches_input(make_png, make_jpg, store, stub):
    assert run(make_png(), store, stub())[0].output.suffix == ".png"
    r = run(make_jpg(name="x.jpeg"), store, stub())[0]
    assert r.output.suffix == ".jpeg" and Image.open(r.output).format == "JPEG"


def test_multiple_plates_counted(make_png, store, stub):
    res, _ = run(make_png(), store, stub([Detection(10, 10, 60, 30, .9), Detection(150, 150, 220, 180, .8)]))
    assert res.plates == 2 and res.frames_with_plates == 1


def test_no_plates_png_is_pixel_identical(make_png, store, stub):
    p = make_png()
    res, _ = run(p, store, stub())
    assert res.plates == 0
    assert (np.asarray(Image.open(res.output)) == np.asarray(Image.open(p).convert("RGB"))).all()


def test_rgba_png_masked_region_is_opaque(tmp_path, store, stub):
    p = tmp_path / "t.png"
    rgba = np.zeros((100, 100, 4), np.uint8)
    rgba[..., :3] = 180
    rgba[..., 3] = 0                                       # fully transparent, RGB still holds data
    Image.fromarray(rgba, "RGBA").save(p)
    box = Detection(30, 40, 70, 60, .9)
    res, _ = run(p, store, stub([box]), "blur")
    a = np.asarray(Image.open(res.output).convert("RGBA"))
    x1, y1, x2, y2 = pad_box(box, (100, 100))
    assert (a[y1:y2, x1:x2, 3] == 255).all()               # no hidden pixels under the censored area
    assert a[0, 0, 3] == 0                                 # elsewhere transparency is preserved


def test_output_name_is_generated(make_png, store, stub):
    res, job = run(make_png(name="MY_PRIVATE_NAME.png"), store, stub())
    assert "MY_PRIVATE" not in res.output.name and res.output.parent == job.dir
