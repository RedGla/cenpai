"""FR01: validate an uploaded file by content, not just extension. File names are never trusted."""
from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from PIL import Image, UnidentifiedImageError

from .config import Limits

IMAGE_EXTS = {"jpg", "jpeg", "png"}
FFPROBE_TIMEOUT_S = 30


class RejectedMedia(ValueError):
    """Message is safe to show to the user."""


@dataclass(frozen=True)
class MediaInfo:
    kind: Literal["image", "video"]
    ext: str                       # lowercase, no dot, as uploaded (jpg / jpeg / png / mp4)
    width: int                     # display orientation for video
    height: int
    fps: float | None
    duration_s: float | None
    has_audio: bool
    audio_codec: str | None = None
    video_start_s: float = 0.0     # start_time of the video stream; keeps A/V offset when re-encoding


def _sniff(head: bytes) -> str | None:
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[4:8] == b"ftyp":
        return "mp4"
    return None


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    # list arguments only; user text is never interpolated into a shell.
    return subprocess.run(cmd, capture_output=True, timeout=FFPROBE_TIMEOUT_S)


def _validate_image(path: Path, ext: str, kind: str, limits: Limits) -> MediaInfo:
    if kind != ("jpeg" if ext in ("jpg", "jpeg") else "png"):
        raise RejectedMedia("The file content does not match its extension.")
    try:
        with Image.open(path) as im:
            w, h = im.size                      # header only; no full decode yet
            if w * h > limits.image_max_pixels:
                raise RejectedMedia(f"Image is too large ({w*h/1e6:.1f} MP). Limit is {limits.image_max_pixels/1e6:.0f} MP.")
        with Image.open(path) as im:
            im.verify()
    except RejectedMedia:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, ValueError):
        raise RejectedMedia("The image is corrupt or could not be read.") from None
    return MediaInfo("image", ext, w, h, None, None, False)


def _rotation(stream: dict) -> int:
    rot = stream.get("tags", {}).get("rotate")
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = sd["rotation"]
    try:
        return int(float(rot)) % 360 if rot is not None else 0
    except (TypeError, ValueError):
        return 0


def _fps(s: str) -> float:
    try:
        n, d = s.split("/")
        return float(n) / float(d) if float(d) else 0.0
    except (ValueError, AttributeError):
        return 0.0


def _validate_video(path: Path, limits: Limits) -> MediaInfo:
    ffprobe, ffmpeg = shutil.which("ffprobe"), shutil.which("ffmpeg")
    if not ffprobe or not ffmpeg:
        raise RuntimeError("ffmpeg/ffprobe not available")
    bad = RejectedMedia("The video is corrupt or could not be read.")
    try:
        p = _run([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
        if p.returncode != 0:
            raise bad
        info = json.loads(p.stdout)
        v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
        if v is None or "mp4" not in info.get("format", {}).get("format_name", ""):
            raise bad
        # a truncated file can probe fine; prove the first frame decodes
        if _run([ffmpeg, "-v", "error", "-i", str(path), "-frames:v", "1", "-f", "null", "-"]).returncode != 0:
            raise bad
        w, h = int(v["width"]), int(v["height"])
        duration = float(info["format"].get("duration") or v.get("duration") or 0)
    except RejectedMedia:
        raise
    except (subprocess.TimeoutExpired, ValueError, KeyError, StopIteration):
        raise bad from None
    if _rotation(v) in (90, 270):
        w, h = h, w
    fps = _fps(v.get("avg_frame_rate", "")) or _fps(v.get("r_frame_rate", ""))
    if duration <= 0 or fps <= 0:
        raise bad
    if duration > limits.video_max_seconds + 0.05:
        raise RejectedMedia(f"Video is too long ({duration:.0f}s). Limit is {limits.video_max_seconds:.0f}s.")
    if max(w, h) > limits.video_max_long_side or min(w, h) > limits.video_max_short_side:
        raise RejectedMedia(f"Video resolution {w}x{h} exceeds {limits.video_max_long_side}x{limits.video_max_short_side}.")
    if fps > limits.video_max_fps + 0.01:
        raise RejectedMedia(f"Video frame rate ({fps:.0f} fps) exceeds {limits.video_max_fps:.0f} fps.")
    audio = next((s for s in info["streams"] if s.get("codec_type") == "audio"), None)
    try:
        vstart = max(float(v.get("start_time", 0) or 0), 0.0)
    except ValueError:
        vstart = 0.0
    return MediaInfo("video", "mp4", w, h, fps, duration, audio is not None,
                     audio.get("codec_name") if audio else None, vstart)


def validate_upload(path: Path, limits: Limits) -> MediaInfo:
    path = Path(path)
    ext = path.suffix.lower().lstrip(".")
    if ext not in IMAGE_EXTS | {"mp4"}:
        raise RejectedMedia("Unsupported file type. Use JPG, JPEG, PNG or MP4.")
    size = path.stat().st_size
    with open(path, "rb") as f:
        kind = _sniff(f.read(16))
    if kind is None or (ext == "mp4") != (kind == "mp4"):
        raise RejectedMedia("The file content does not match its extension.")
    if ext == "mp4":
        if size > limits.video_max_bytes:
            raise RejectedMedia(f"Video is too large. Limit is {limits.video_max_mb:g} MB.")
        return _validate_video(path, limits)
    if size > limits.image_max_bytes:
        raise RejectedMedia(f"Image is too large. Limit is {limits.image_max_mb:g} MB.")
    return _validate_image(path, ext, kind, limits)
