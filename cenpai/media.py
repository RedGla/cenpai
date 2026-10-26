"""Image and video processing. Outputs carry no source metadata (EXIF/GPS/etc. are never copied)."""
from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from .censor import Mode, censor, pad_box
from .jobs import Job
from .validate import MediaInfo

JPEG_QUALITY = 95


class ProcessingError(RuntimeError):
    """Message is safe to show to the user."""


class JobCancelled(Exception):
    pass


class JobTimeout(Exception):
    pass


@dataclass(frozen=True)
class Result:
    output: Path
    plates: int              # total detections censored (all frames for video)
    frames: int              # 1 for images
    frames_with_plates: int
    seconds: float


def output_name(job: Job, ext: str) -> str:
    return f"cenpai_{job.id[:8]}.{ext}"


def _load_bgr(src: Path) -> tuple[np.ndarray, np.ndarray | None]:
    """Decode upright (EXIF orientation applied). Returns (BGR, alpha-or-None)."""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        has_alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
        arr = np.asarray(im.convert("RGBA" if has_alpha else "RGB"))
    if has_alpha:
        return cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2BGR), arr[:, :, 3].copy()
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), None


def process_image(src: Path, info: MediaInfo, job: Job, detector, mode: Mode) -> Result:
    t0 = time.perf_counter()
    try:
        bgr, alpha = _load_bgr(src)
    except (OSError, ValueError, SyntaxError):
        raise ProcessingError("The image could not be decoded.") from None
    dets = detector.detect(bgr)
    out = censor(bgr, dets, mode)
    if alpha is not None:
        # RGB under transparent pixels would still leak plate data: make masked regions opaque
        for d in dets:
            x1, y1, x2, y2 = pad_box(d, bgr.shape[:2])
            alpha[y1:y2, x1:x2] = 255
        out = np.dstack([out, alpha])
    dst = job.dir / output_name(job, info.ext)
    params = [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY] if info.ext in ("jpg", "jpeg") else []
    ok, buf = cv2.imencode(".jpg" if info.ext in ("jpg", "jpeg") else ".png", out, params)
    if not ok:
        raise ProcessingError("The censored image could not be encoded.")
    dst.write_bytes(buf.tobytes())
    return Result(dst, len(dets), 1, 1 if dets else 0, time.perf_counter() - t0)


# ------------------------------------------------------------------------------------ video

ENCODE_PRESET, ENCODE_CRF = "veryfast", "20"
EARLY_END_TOLERANCE = 0.98       # produced frames must cover at least this share of the probed duration


def _kill(*procs):
    for p in procs:
        if p and p.poll() is None:
            p.kill()
        if p:
            for s in (p.stdin, p.stdout):
                try:
                    s and s.close()
                except OSError:
                    pass
            try:
                p.wait(timeout=10)
            except Exception:
                pass


def process_video(src: Path, info: MediaInfo, job: Job, detector, mode: Mode, progress, cancel, deadline: float) -> Result:
    """Detect and censor EVERY frame, then encode browser-playable H.264/AAC MP4.

    The source is decoded by ffmpeg (display rotation applied, constant frame rate = source average fps), so every
    frame written to the output has been through detection and censoring. Audio is copied when it is AAC,
    otherwise re-encoded. No metadata is carried over. On any failure the partial file is removed.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ProcessingError("Video processing is not available on this server.")
    t0 = time.perf_counter()
    w, h, fps = info.width, info.height, info.fps
    frame_bytes = w * h * 3
    partial = job.dir / "out.partial.mp4"
    final = job.dir / output_name(job, "mp4")
    audio_opts = ["-map", "1:a:0?", "-c:a", "copy"] if info.audio_codec == "aac" else \
                 ["-map", "1:a:0?", "-c:a", "aac", "-b:a", "128k"]
    dec_cmd = [ffmpeg, "-v", "error", "-nostdin", "-i", str(src), "-map", "0:v:0",
               "-vf", f"fps={fps:.6f}", "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"]
    enc_cmd = [ffmpeg, "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
               "-framerate", f"{fps:.6f}", "-itsoffset", f"{info.video_start_s:.6f}", "-i", "pipe:0", "-i", str(src),
               "-map", "0:v:0", *audio_opts,
               "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",              # yuv420p needs even dimensions
               "-c:v", "libx264", "-preset", ENCODE_PRESET, "-crf", ENCODE_CRF, "-pix_fmt", "yuv420p",
               "-map_metadata", "-1", "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1", "-map_chapters", "-1",
               "-movflags", "+faststart", str(partial)]
    dec = enc = None
    frames = plates = with_plates = 0
    total_est = max(int(info.duration_s * fps), 1)
    try:
        dec = subprocess.Popen(dec_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        enc = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        while True:
            if cancel.is_set():
                raise JobCancelled()
            if time.time() > deadline:
                raise JobTimeout()
            raw = dec.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:       # EOF (a trailing partial frame is discarded, never written)
                break
            bgr = np.frombuffer(raw, np.uint8).reshape(h, w, 3)
            dets = detector.detect(bgr)
            enc.stdin.write(censor(bgr, dets, mode).tobytes())
            frames += 1
            if dets:
                plates += len(dets)
                with_plates += 1
            if frames % 5 == 0:
                progress(min(frames / total_est, 0.99), "Censoring frames")
        enc.stdin.close()
        if dec.wait(timeout=60) != 0 or enc.wait(timeout=120) != 0:
            raise ProcessingError("The video could not be fully decoded or encoded.")
        if frames < EARLY_END_TOLERANCE * total_est - 1:
            raise ProcessingError("The video ended early or could not be fully decoded.")
        partial.replace(final)               # only a fully processed file ever gets its final name
    except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
        raise ProcessingError("The video could not be fully decoded or encoded.") from None
    finally:
        _kill(dec, enc)
        partial.unlink(missing_ok=True)
    progress(1.0, "Done")
    return Result(final, plates, frames, with_plates, time.perf_counter() - t0)