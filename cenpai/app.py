"""Web app: Gradio UI mounted in FastAPI, plus /healthz. Run with `python -m cenpai.app`.

No `from __future__ import annotations` here: Gradio recognises `request: gr.Request` by its real annotation.
"""
import logging
import os
import shutil
import tempfile
from pathlib import Path

# A privacy tool must not phone home: disable Gradio / Hugging Face telemetry and version checks.
os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .config import Limits, load_limits
from .detector import Detection, ModelLoadError, load_detector
from .jobs import GRADIO_SUBDIR, JobStore
from .service import REMINDER, Service

log = logging.getLogger("cenpai.app")
SOURCE_URL = "https://github.com/RedGla/cenpai"


class DevStub:
    """DEVELOPMENT ONLY: draws one fixed fake box. Enabled by CENPAI_DEV_STUB=1, never on Render,
    and /healthz stays 503 while it is active, so it cannot pass a deploy health check."""
    version = "DEV-STUB-NOT-A-MODEL"

    def detect(self, bgr: np.ndarray) -> list[Detection]:
        h, w = bgr.shape[:2]
        return [Detection(w * 3 // 8, h * 7 // 16, w * 5 // 8, h * 9 // 16, 1.0)]


def _client_ip(request) -> str:
    # Render appends the client address to X-Forwarded-For; use the last entry (the one a client cannot forge).
    xff = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    return parts[-1] if parts else (request.client.host if request.client else "unknown")


def _intro(limits: Limits) -> str:
    return (
        "Upload one image (JPG, JPEG, PNG) or one short MP4 video. Plates found by the detector are covered; "
        "you can then preview, review, and download the result.\n\n"
        f"**Limits (proposed):** images up to {limits.image_max_mb:g} MB / {limits.image_max_pixels/1e6:g} MP; "
        f"videos up to {limits.video_max_mb:g} MB, {limits.video_max_seconds:g} s, "
        f"{limits.video_max_long_side}×{limits.video_max_short_side}, {limits.video_max_fps:g} fps.\n\n"
        "**Privacy:** files are used only to censor plates, kept in private temporary storage, and deleted when you "
        "press Delete or within 1 hour at the latest. Audio and faces are not anonymized.\n\n"
        f"**{REMINDER}**"
    )


def build_ui(service: Service, limits: Limits, banner: str = ""):
    import gradio as gr

    with gr.Blocks(title="CenpAI — license plate censoring") as demo:
        gr.Markdown("# CenpAI — license plate censoring")
        if banner:
            gr.Markdown(banner, elem_id="model-banner")
        gr.Markdown(_intro(limits))
        state = gr.State({})
        with gr.Row():
            with gr.Column():
                file_in = gr.File(label="Image or video to censor", file_types=[".jpg", ".jpeg", ".png", ".mp4"],
                                  type="filepath")
                mode = gr.Radio(
                    [("Solid mask (recommended)", "solid"), ("Gaussian blur", "blur"), ("Pixelation", "pixelate")],
                    value="solid", label="Censoring mode",
                    info="Blur and pixelation can leave a plate partly readable; the solid mask is the safest option.")
                go = gr.Button("Censor plates", variant="primary")
                with gr.Row():
                    cancel = gr.Button("Cancel")
                    reset = gr.Button("Delete files and reset")
            with gr.Column():
                status = gr.Markdown("**Ready.** Choose a file and press “Censor plates”.", elem_id="status")
                img_out = gr.Image(label="Censored image (preview)", visible=False, interactive=False, type="filepath")
                vid_out = gr.Video(label="Censored video (preview)", visible=False, interactive=False)
                dl = gr.File(label="Download", visible=False, interactive=False)
        gr.Markdown(f"CenpAI is free software under the AGPL-3.0. [Source code]({SOURCE_URL}).")

        def _clear(msg):
            return (msg, gr.update(value=None, visible=False), gr.update(value=None, visible=False),
                    gr.update(value=None, visible=False), {})

        def on_start():
            return "**Queued / processing…** This can take a while for videos; keep this tab open."

        def on_process(file_path, mode_v, st, request: gr.Request, progress=gr.Progress()):
            sid = request.session_hash
            out = service.process(file_path, mode_v, sid, _client_ip(request),
                                  lambda frac, desc="": progress(frac, desc=desc))
            if out.state != "complete":
                return _clear(out.message)
            show_img, show_vid = out.kind == "image", out.kind == "video"
            return (out.message,
                    gr.update(value=str(out.output) if show_img else None, visible=show_img),
                    gr.update(value=str(out.output) if show_vid else None, visible=show_vid),
                    gr.update(value=str(out.output), visible=True),
                    {"job_id": out.job_id})

        def on_reset(st, request: gr.Request):
            service.delete((st or {}).get("job_id"), request.session_hash)
            return (*_clear("**Deleted.** All files for this job were removed. Ready for a new upload."),
                    gr.update(value=None))

        def on_cancel(request: gr.Request):
            service.cancel(request.session_hash)

        def on_tick(st, request: gr.Request):
            jid = (st or {}).get("job_id")
            if jid and not service.job_alive(jid, request.session_hash):
                return _clear("**Expired.** Your files were deleted automatically. Upload again to retry.")
            return (gr.skip(),) * 5

        def on_unload(request: gr.Request):
            service.store.delete_owner(request.session_hash)

        outs = [status, img_out, vid_out, dl, state]
        go.click(on_start, None, status, queue=False, api_name=False).then(
            on_process, [file_in, mode, state], outs, api_name=False)
        reset.click(on_reset, state, outs + [file_in], queue=False, api_name=False)
        cancel.click(on_cancel, None, None, queue=False, api_name=False)
        timer = gr.Timer(30)
        timer.tick(on_tick, state, outs, queue=False, api_name=False)
        demo.unload(on_unload)
        demo.queue(max_size=limits.queue_max, default_concurrency_limit=limits.concurrency, api_open=False)
    return demo


def create_app(models_dir: Path = Path("models"), work_root: Path | None = None) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    limits = load_limits()
    root = Path(work_root or os.environ.get("CENPAI_WORK_DIR") or Path(tempfile.gettempdir()) / "cenpai")
    os.environ["GRADIO_TEMP_DIR"] = str(root / GRADIO_SUBDIR)   # must be set before Blocks are created
    store = JobStore(root, limits.retention_s)
    store.wipe_all()                                             # nothing survives a restart
    store.start_sweeper(limits.sweep_interval_s)

    detector, banner, problems = None, "", []
    if os.environ.get("CENPAI_DEV_STUB") == "1" and not os.environ.get("RENDER"):
        detector = DevStub()
        banner = "> **DEVELOPMENT STUB — NOT A REAL MODEL.** Detections are fake. Do not use for real media."
        problems.append("dev stub active")
    else:
        try:
            detector = load_detector(models_dir)
            log.info("model loaded: %s", detector.version)
        except ModelLoadError as e:
            log.error("model not loaded: %s", e)
            problems.append("model unavailable")
            banner = ("> **The detection model is not available on this server.** "
                      "Uploads are disabled until a verified model is installed.")
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            problems.append(f"{tool} missing")

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/healthz")
    def healthz():
        if problems:
            return JSONResponse({"status": "unavailable", "reasons": problems}, status_code=503)
        return {"status": "ok", "model": detector.version}

    import gradio as gr
    service = Service(detector, store, limits)
    demo = build_ui(service, limits, banner)
    max_mb = int(max(limits.image_max_mb, limits.video_max_mb)) + 1
    app.state.service = service
    return gr.mount_gradio_app(app, demo, path="/", max_file_size=f"{max_mb}mb", footer_links=[], ssr_mode=False)


def main() -> None:
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", 7860)), access_log=False)


if __name__ == "__main__":
    main()
