# VoiceSong Backend

AI-powered voice synthesis and music generation API with AudioCraft and RVC support.

## Features

- 🎵 Music Generation with AudioCraft (MusicGen)
- 🎤 Voice Conversion with RVC (Retrieval-based Voice Conversion)
- 🚀 Fast API with async support
- 📦 File upload and processing
- 🔧 Easy configuration with environment variables

## Setup

### 1. Create Virtual Environment

```bash
python -m venv venv
.\venv\Scripts\activate  # Windows
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment

Copy `.env.example` to `.env` and adjust settings:

```bash
copy .env.example .env
```

### 4. Run the Server

```bash
python main.py
```

Or using uvicorn directly:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

- `GET /` - API health check
- `GET /api/health` - Detailed health status
- `POST /api/upload` - Upload audio file
- `POST /api/generate/music` - Generate music with AudioCraft
- `POST /api/convert/voice` - Convert voice with RVC
- `GET /api/models` - List available models

## Development

API documentation available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Models

Place your models in the following directories:
- AudioCraft models: `./models/audiocraft/`
- RVC models: `./models/rvc/`
