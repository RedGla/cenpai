FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    GRADIO_ANALYTICS_ENABLED=False \
    HF_HUB_DISABLE_TELEMETRY=1

# ffmpeg/ffprobe are separate programs invoked via subprocess (no shell, list arguments only)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY cenpai ./cenpai
COPY models ./models
COPY LICENSE README.md ./

USER app
# Render supplies PORT (the app falls back to 7860). Job files live in the container's temp dir and are
# wiped at every start; nothing is persisted.
EXPOSE 7860
CMD ["python", "-m", "cenpai.app"]
