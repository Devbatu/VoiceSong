# VoiceSong Backend — FastAPI + Seed-VC worker (GPU)
# Tek imajda iki ortam: /opt/venv (ana backend) + /opt/venv-neural (Seed-VC worker)
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 git build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Ana backend ortamı ---
COPY requirements-docker.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -U pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements-docker.txt \
    # OpenVoice librosa==0.9.1 dayatır; çalışan kurulum librosa 0.10.1 ile uyumlu -> deps atla
    && /opt/venv/bin/pip install --no-cache-dir --no-deps \
       "MyShell-OpenVoice @ git+https://github.com/myshell-ai/OpenVoice.git@74a1d147b17a8c3092dd5430504bd83ef6c7eb23"

# --- Seed-VC worker ortamı ---
RUN git clone --depth 1 https://github.com/Plachtaa/seed-vc /app/vendor/seed-vc
COPY vendor/seed-vc/requirements-worker.txt /app/vendor/seed-vc/requirements-worker.txt
RUN python -m venv /opt/venv-neural \
    && /opt/venv-neural/bin/pip install --no-cache-dir -U pip \
    && /opt/venv-neural/bin/pip install --no-cache-dir -r /app/vendor/seed-vc/requirements-worker.txt

# --- Uygulama kodu ---
COPY . .

ENV PATH="/opt/venv/bin:$PATH" \
    NEURAL_PYTHON=/opt/venv-neural/bin/python \
    PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
