from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.responses import StreamingResponse, Response
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Optional, List
import os
import io
import sys
import json
import asyncio
import logging
import uvicorn
from pathlib import Path
from datetime import datetime

# Windows ProactorEventLoop fix: suppress ConnectionResetError crashes
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Suppress noisy connection reset logs
logging.getLogger('uvicorn.error').setLevel(logging.WARNING)

# Load environment variables
load_dotenv()

# Import Demucs AI separation engine
from demucs_ai import demucs_separate_stems

# Initialize FastAPI app
app = FastAPI(
    title="VoiceSong API",
    description="AI-powered voice synthesis and music generation API with AudioCraft, RVC and Demucs",
    version="1.0.0"
)

# CORS Configuration - Allow all localhost ports for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create necessary directories
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("output")
TEMP_DIR = Path("temp")
SEPARATED_DIR = OUTPUT_DIR / "separated"
VOICE_PROFILES_DIR = OUTPUT_DIR / "voice_profiles"
CLONED_DIR = OUTPUT_DIR / "cloned"

for directory in [UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR, SEPARATED_DIR, VOICE_PROFILES_DIR, CLONED_DIR]:
    directory.mkdir(exist_ok=True, parents=True)


# ========================
# HELPER FUNCTIONS
# ========================

def convert_audio_to_wav(input_path: Path) -> Path:
    """Convert any audio format (including webm from browser recording) to WAV.
    Uses pydub + ffmpeg (bundled via imageio-ffmpeg or system ffmpeg).
    """
    if input_path.suffix.lower() == '.wav':
        return input_path

    try:
        from pydub import AudioSegment

        # Ensure pydub can find ffmpeg (use imageio-ffmpeg bundled binary as fallback)
        try:
            import imageio_ffmpeg
            ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
            AudioSegment.converter = ffmpeg_path
            AudioSegment.ffprobe = ffmpeg_path
        except ImportError:
            pass  # Will use system ffmpeg if available

        output_path = input_path.with_suffix('.wav')
        audio = AudioSegment.from_file(str(input_path))
        audio = audio.set_frame_rate(44100)  # Keep original channels (stereo for songs)
        audio.export(str(output_path), format='wav')
        print(f"[INFO] Converted {input_path.name} -> {output_path.name}")
        return output_path
    except Exception as e:
        print(f"[WARNING] pydub conversion failed: {e}, trying soundfile fallback...")
        try:
            import soundfile as sf
            data, sr = sf.read(str(input_path))
            output_path = input_path.with_suffix('.wav')
            sf.write(str(output_path), data, sr)
            return output_path
        except Exception as e2:
            print(f"[ERROR] All conversion methods failed: {e2}")
            return input_path


def normalize_audio(audio):
    """RMS-based audio normalization with peak limiting"""
    import numpy as np
    rms = float(np.sqrt(np.mean(audio ** 2)))
    if rms > 0:
        target_rms = 0.15  # ~-16 dB RMS
        audio = audio * (target_rms / rms)
    max_val = float(np.abs(audio).max())
    if max_val > 0.95:
        audio = audio / max_val * 0.95
    return audio


# ========================
# BASIC API ENDPOINTS
# ========================

@app.get("/")
async def root():
    """Root endpoint - API health check"""
    return {
        "message": "VoiceSong API is running",
        "version": "1.0.0",
        "status": "healthy"
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "services": {
            "api": "running",
            "audiocraft": "initializing",
            "rvc": "initializing",
            "demucs": "initializing"
        }
    }


@app.post("/api/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload audio file for processing"""
    try:
        allowed_formats = os.getenv(
            "ALLOWED_AUDIO_FORMATS", "mp3,wav,flac,ogg,webm,opus,m4a,aac"
        ).split(",")
        file_ext = file.filename.split(".")[-1].lower()

        if file_ext not in allowed_formats:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file format. Allowed: {', '.join(allowed_formats)}"
            )

        file_path = UPLOAD_DIR / file.filename
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        return {
            "message": "File uploaded successfully",
            "filename": file.filename,
            "size": len(content),
            "path": str(file_path)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate/music")
async def generate_music(
    prompt: str,
    duration: int = 10,
    temperature: float = 1.0
):
    """Generate music using AudioCraft MusicGen"""
    try:
        return {
            "message": "Music generation endpoint",
            "prompt": prompt,
            "duration": duration,
            "status": "pending_implementation"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/convert/voice")
async def convert_voice(
    audio_file: UploadFile = File(...),
    target_voice: str = "default"
):
    """Convert voice using RVC (Retrieval-based Voice Conversion)"""
    try:
        return {
            "message": "Voice conversion endpoint",
            "target_voice": target_voice,
            "status": "pending_implementation"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/models")
async def list_models():
    """List available voice models"""
    return {
        "audiocraft_models": ["musicgen-small", "musicgen-medium", "musicgen-large"],
        "rvc_models": ["model1", "model2"],
        "demucs_models": ["htdemucs", "htdemucs_ft", "htdemucs_6s", "mdx_extra"],
        "status": "mock_data"
    }


# ========================
# AUDIO SEPARATION
# ========================

class SeparateRequest(BaseModel):
    stems: Optional[List[str]] = ["vocals", "drums", "bass", "other"]
    model: Optional[str] = "htdemucs"


@app.post("/api/separate")
async def separate_audio(
    audio_file: UploadFile = File(...),
    model: str = "htdemucs"
):
    """Separate audio into stems using Demucs AI (GPU-accelerated)"""
    try:
        # Validate file
        allowed_formats = os.getenv(
            "ALLOWED_AUDIO_FORMATS", "mp3,wav,flac,ogg,webm,opus,m4a,aac"
        ).split(",")
        file_ext = audio_file.filename.split(".")[-1].lower()

        if file_ext not in allowed_formats:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file format. Allowed: {', '.join(allowed_formats)}"
            )

        # Save uploaded file
        input_path = UPLOAD_DIR / audio_file.filename
        with open(input_path, "wb") as buffer:
            content = await audio_file.read()
            buffer.write(content)

        # Convert to WAV if needed (handles webm, opus, etc.)
        input_path = convert_audio_to_wav(input_path)

        # Create output directory for this file
        file_base = audio_file.filename.rsplit(".", 1)[0]
        output_dir = OUTPUT_DIR / "separated" / file_base
        output_dir.mkdir(parents=True, exist_ok=True)

        # AI-POWERED DEMUCS SEPARATION
        try:
            sep_result = demucs_separate_stems(input_path, model, output_dir)
            stems = sep_result["stems"]
            device_used = sep_result["device"]
            print(f"[SUCCESS] 🎉 All stems saved to: {output_dir}")

        except Exception as e:
            error_msg = f"Demucs AI separation error: {str(e)}"
            print(f"[ERROR] {error_msg}")
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=error_msg)

        return {
            "message": "AI Audio separation completed",
            "filename": audio_file.filename,
            "model": model,
            "device": device_used,
            "stems": stems,
            "status": "completed",
            "input_path": str(input_path),
            "output_path": str(output_dir),
            "download_urls": {
                stem: f"/api/download/{file_base}/{stem}"
                for stem in stems
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/separate/models")
async def list_demucs_models():
    """List available Demucs AI separation models"""
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"

    return {
        "device": device,
        "gpu": gpu_name,
        "models": [
            {
                "name": "htdemucs",
                "description": "🧠 Demucs AI - Hibrit Transformer derin öğrenme modeli",
                "stems": ["vocals", "drums", "bass", "other", "music"],
                "recommended": True,
                "features": [
                    f"🚀 {gpu_name} GPU hızlandırma",
                    "🧠 Derin öğrenme sinir ağı (Hybrid Transformer)",
                    "🎤 Profesyonel vokal izolasyonu",
                    "🥁 Davul, bas, enstrümantal ayrıştırma",
                    "🎵 Tam enstrümantal (müzik) çıkışı",
                    "💎 44.1kHz 24-bit stereo çıkış"
                ]
            },
            {
                "name": "htdemucs_ft",
                "description": "⭐ Fine-tuned Demucs AI - En yüksek kalite ayrıştırma",
                "stems": ["vocals", "drums", "bass", "other", "music"],
                "recommended": False,
                "features": [
                    f"🚀 {gpu_name} GPU hızlandırma",
                    "⭐ Fine-tuned model (daha yüksek kalite)",
                    "🎤 En iyi vokal izolasyonu",
                    "🥁 Detaylı stem ayrıştırma",
                    "💎 44.1kHz 24-bit stereo çıkış"
                ]
            },
            {
                "name": "htdemucs_6s",
                "description": "🎹 6-Stem AI - Piyano ve gitar dahil ayrıştırma",
                "stems": ["vocals", "drums", "bass", "piano", "guitar", "other", "music"],
                "recommended": False,
                "features": [
                    f"🚀 {gpu_name} GPU hızlandırma",
                    "🎹 Piyano ayrıştırma",
                    "🎸 Gitar ayrıştırma",
                    "🎤 Vokal + 🥁 Davul + 🎵 Bas",
                    "💎 44.1kHz 24-bit stereo çıkış"
                ]
            }
        ]
    }


# ========================
# MULTI-STEM & MIX ENDPOINTS
# ========================

@app.post("/api/separate_multi")
async def separate_multi(file: UploadFile = File(...)):
    """Separate audio into multiple stems and return their URLs"""
    result = await separate_audio(audio_file=file)
    file_base = file.filename.rsplit('.', 1)[0]
    stems = result.get("stems", ["vocals", "music"])
    urls = result.get("download_urls", {})

    stem_objs = []
    for stem in stems:
        label = stem.capitalize()
        url = urls.get(stem, f"/api/download/{file_base}/{stem}")
        stem_objs.append({
            "name": stem,
            "label": label,
            "url": url
        })
    return JSONResponse({
        "message": "Separation complete",
        "stems": stem_objs
    })


class ExportMixRequest(BaseModel):
    stems: list
    filename: Optional[str] = None


@app.post("/api/export_mix")
async def export_mix(req: ExportMixRequest):
    """Mix selected stems and return as downloadable WAV"""
    import soundfile as sf
    import numpy as np

    stems = req.stems
    filename = req.filename or "mix.wav"

    sep_dirs = sorted(SEPARATED_DIR.glob("*"), key=os.path.getmtime, reverse=True)
    if not sep_dirs:
        raise HTTPException(status_code=404, detail="No separated stems found.")
    latest_dir = sep_dirs[0]

    audio_data = []
    sr = 44100
    for stem in stems:
        stem_path = latest_dir / f"{stem}.wav"
        if not stem_path.exists():
            continue
        data, stem_sr = sf.read(str(stem_path))
        if data.ndim == 1:
            data = np.stack([data, data])
        if stem_sr != sr:
            import librosa
            data = librosa.resample(data, orig_sr=stem_sr, target_sr=sr)
        audio_data.append(data)

    if not audio_data:
        raise HTTPException(status_code=404, detail="No valid stems found.")

    mix = np.sum(audio_data, axis=0)
    max_val = np.abs(mix).max()
    if max_val > 0:
        mix = mix / max_val * 0.95

    buf = io.BytesIO()
    sf.write(buf, mix.T, sr, subtype='PCM_24', format='WAV')
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type='audio/wav',
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ========================
# AI AUDIO EFFECTS
# ========================

class AudioEffectRequest(BaseModel):
    stem_name: str
    effect_type: str
    params: dict = {}


@app.post("/api/audio_effect")
async def apply_audio_effect(req: AudioEffectRequest):
    """Apply AI audio effect to a separated stem"""
    import numpy as np
    import soundfile as sf

    # Find the latest separated directory
    sep_dirs = sorted(SEPARATED_DIR.glob("*"), key=os.path.getmtime, reverse=True)
    if not sep_dirs:
        raise HTTPException(status_code=404, detail="Ayrıştırılmış stem bulunamadı. Önce bir dosya yükleyin.")
    latest_dir = sep_dirs[0]

    stem_path = latest_dir / f"{req.stem_name}.wav"
    if not stem_path.exists():
        raise HTTPException(status_code=404, detail=f"Stem bulunamadı: {req.stem_name}")

    try:
        audio, sr = sf.read(str(stem_path))
        if audio.ndim == 1:
            audio = np.stack([audio, audio], axis=-1)  # mono to stereo

        print(f"[EFFECT] Applying {req.effect_type} to {req.stem_name} (shape={audio.shape}, sr={sr})")

        # Apply the requested effect
        if req.effect_type == 'autotune':
            audio = _apply_autotune(audio, sr, req.params)
        elif req.effect_type == 'pitch_shift':
            audio = _apply_pitch_shift(audio, sr, req.params)
        elif req.effect_type == 'tempo_change':
            audio = _apply_tempo_change(audio, sr, req.params)
        elif req.effect_type == 'reverb':
            audio = _apply_reverb(audio, sr, req.params)
        elif req.effect_type == 'noise_reduction':
            audio = _apply_noise_reduction(audio, sr, req.params)
        elif req.effect_type == 'eq_preset':
            audio = _apply_eq_preset(audio, sr, req.params)
        elif req.effect_type == 'harmonizer':
            audio = _apply_harmonizer(audio, sr, req.params)
        elif req.effect_type == 'vocal_enhance':
            audio = _apply_vocal_enhance(audio, sr, req.params)
        else:
            raise HTTPException(status_code=400, detail=f"Bilinmeyen efekt: {req.effect_type}")

        # Normalize output
        max_val = np.abs(audio).max()
        if max_val > 0.95:
            audio = audio / max_val * 0.95

        # Save processed stem (overwrite)
        sf.write(str(stem_path), audio, sr, subtype='PCM_24')

        file_base = latest_dir.name
        print(f"[EFFECT] ✅ {req.effect_type} applied to {req.stem_name}")

        return {
            "message": f"{req.effect_type} efekti uygulandı",
            "url": f"/api/download/{file_base}/{req.stem_name}",
            "stem_name": req.stem_name,
            "effect": req.effect_type
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Efekt hatası: {str(e)}")


# --- AI Effect Implementations ---

def _apply_autotune(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """Pitch correction (AutoTune) using librosa pitch detection + correction"""
    import numpy as np
    import librosa

    key = params.get('key', 'C')
    speed = params.get('speed', 5)  # 1=slow/natural, 10=fast/T-Pain

    # Note frequencies for the target key (chromatic scale)
    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    key_idx = note_names.index(key) if key in note_names else 0

    # Major scale intervals from root
    major_intervals = [0, 2, 4, 5, 7, 9, 11]
    scale_notes = [(key_idx + interval) % 12 for interval in major_intervals]

    correction_strength = speed / 10.0  # 0.1 to 1.0

    # Process each channel
    result = np.zeros_like(audio)
    for ch in range(audio.shape[1] if audio.ndim > 1 else 1):
        channel = audio[:, ch] if audio.ndim > 1 else audio

        # Detect pitch using pyin
        f0, voiced_flag, voiced_probs = librosa.pyin(
            channel.astype(np.float32),
            fmin=librosa.note_to_hz('C2'),
            fmax=librosa.note_to_hz('C6'),
            sr=sr,
            frame_length=2048,
            hop_length=512
        )

        if f0 is None or len(f0) == 0:
            result[:, ch] = channel if audio.ndim > 1 else audio
            continue

        # Calculate pitch correction for each frame
        corrected = channel.copy()
        hop_length = 512

        for i in range(len(f0)):
            if np.isnan(f0[i]) or not voiced_flag[i]:
                continue

            # Find nearest scale note
            midi_note = librosa.hz_to_midi(f0[i])
            note_class = int(round(midi_note)) % 12

            # Find closest note in scale
            min_dist = 12
            target_class = note_class
            for sn in scale_notes:
                dist = min(abs(note_class - sn), 12 - abs(note_class - sn))
                if dist < min_dist:
                    min_dist = dist
                    target_class = sn

            # Calculate semitone shift needed
            shift = target_class - note_class
            if shift > 6:
                shift -= 12
            elif shift < -6:
                shift += 12

            # Apply fractional shift based on correction strength
            shift *= correction_strength

            if abs(shift) > 0.05:
                start = i * hop_length
                end = min(start + hop_length * 2, len(channel))
                segment = channel[start:end]

                if len(segment) > 256:
                    shifted = librosa.effects.pitch_shift(
                        segment.astype(np.float32), sr=sr, n_steps=shift
                    )
                    # Smooth crossfade
                    fade_len = min(64, len(shifted) // 4)
                    if fade_len > 0 and start > 0:
                        fade_in = np.linspace(0, 1, fade_len)
                        fade_out = np.linspace(1, 0, fade_len)
                        shifted[:fade_len] = shifted[:fade_len] * fade_in + corrected[start:start + fade_len] * fade_out

                    corrected[start:start + len(shifted)] = shifted

        if audio.ndim > 1:
            result[:, ch] = corrected
        else:
            result = corrected

    return result


def _apply_pitch_shift(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """Shift pitch by semitones using librosa"""
    import librosa
    import numpy as np

    semitones = params.get('semitones', 0)
    if semitones == 0:
        return audio

    result = np.zeros_like(audio)
    for ch in range(audio.shape[1] if audio.ndim > 1 else 1):
        channel = audio[:, ch] if audio.ndim > 1 else audio
        shifted = librosa.effects.pitch_shift(
            channel.astype(np.float32), sr=sr, n_steps=semitones
        )
        if audio.ndim > 1:
            result[:, ch] = shifted
        else:
            result = shifted

    return result


def _apply_tempo_change(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """Change tempo without changing pitch using librosa"""
    import librosa
    import numpy as np

    factor = params.get('factor', 1.0)
    if abs(factor - 1.0) < 0.01:
        return audio

    result_channels = []
    for ch in range(audio.shape[1] if audio.ndim > 1 else 1):
        channel = audio[:, ch] if audio.ndim > 1 else audio
        stretched = librosa.effects.time_stretch(
            channel.astype(np.float32), rate=factor
        )
        result_channels.append(stretched)

    if audio.ndim > 1:
        # Ensure same length
        min_len = min(len(c) for c in result_channels)
        result = np.stack([c[:min_len] for c in result_channels], axis=-1)
    else:
        result = result_channels[0]

    return result


def _apply_reverb(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """Apply convolution reverb using generated impulse response"""
    import numpy as np
    from scipy.signal import fftconvolve

    room_size = params.get('room_size', 0.5)
    damping = params.get('damping', 0.5)
    wet = params.get('wet', 0.3)

    # Generate synthetic impulse response
    ir_length = int(sr * room_size * 3)  # up to 1.5 seconds
    t = np.arange(ir_length) / sr
    decay = np.exp(-t * (3.0 + damping * 5.0))

    # Add early reflections
    ir = np.random.randn(ir_length) * decay
    # Early reflections at specific times
    for delay_ms in [15, 25, 35, 50, 70]:
        delay_samples = int(delay_ms * sr / 1000)
        if delay_samples < ir_length:
            ir[delay_samples] += 0.5 * decay[delay_samples]

    ir = ir / np.abs(ir).max()  # Normalize IR

    result = np.zeros_like(audio, dtype=np.float64)
    for ch in range(audio.shape[1] if audio.ndim > 1 else 1):
        channel = audio[:, ch] if audio.ndim > 1 else audio
        reverbed = fftconvolve(channel.astype(np.float64), ir, mode='full')[:len(channel)]
        mixed = channel * (1 - wet) + reverbed * wet
        if audio.ndim > 1:
            result[:, ch] = mixed
        else:
            result = mixed

    return result.astype(np.float32)


def _apply_noise_reduction(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """AI noise reduction using noisereduce"""
    import noisereduce as nr
    import numpy as np

    strength = params.get('strength', 0.7)

    result = np.zeros_like(audio)
    for ch in range(audio.shape[1] if audio.ndim > 1 else 1):
        channel = audio[:, ch] if audio.ndim > 1 else audio
        reduced = nr.reduce_noise(
            y=channel.astype(np.float32),
            sr=sr,
            prop_decrease=strength,
            stationary=False,
            n_fft=2048,
            hop_length=512
        )
        if audio.ndim > 1:
            result[:, ch] = reduced
        else:
            result = reduced

    return result


def _apply_eq_preset(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """Apply EQ preset using scipy filters"""
    import numpy as np
    from scipy.signal import butter, sosfiltfilt

    preset = params.get('preset', 'pop')

    # Define EQ profiles as (freq_low, freq_high, gain_db) bands
    presets = {
        'pop': [(60, 250, 2), (250, 1000, 0), (1000, 4000, 3), (4000, 8000, 4), (8000, 16000, 2)],
        'rock': [(60, 250, 4), (250, 1000, -1), (1000, 3000, 2), (3000, 6000, 3), (6000, 16000, 4)],
        'jazz': [(60, 250, 2), (250, 1000, 1), (1000, 3000, -1), (3000, 8000, 2), (8000, 16000, 3)],
        'rnb': [(60, 200, 5), (200, 800, 2), (800, 2000, 0), (2000, 5000, 3), (5000, 16000, 4)],
        'electronic': [(20, 100, 6), (100, 500, 2), (500, 2000, -2), (2000, 6000, 3), (6000, 16000, 5)],
        'vocal_clarity': [(80, 300, -2), (300, 1000, 1), (1000, 3000, 4), (3000, 6000, 5), (6000, 12000, 3)],
        'bass_boost': [(20, 80, 8), (80, 250, 5), (250, 1000, 0), (1000, 4000, 0), (4000, 16000, 0)],
        'warm': [(60, 300, 3), (300, 1000, 2), (1000, 3000, 0), (3000, 6000, -1), (6000, 16000, -2)],
    }

    eq_bands = presets.get(preset, presets['pop'])
    nyquist = sr / 2.0

    result = audio.copy().astype(np.float64)

    for low, high, gain_db in eq_bands:
        if gain_db == 0:
            continue

        # Clamp frequencies
        low = max(20, low)
        high = min(nyquist - 100, high)
        if low >= high:
            continue

        try:
            sos = butter(2, [low / nyquist, high / nyquist], btype='bandpass', output='sos')
            gain_linear = 10 ** (gain_db / 20.0) - 1.0

            for ch in range(result.shape[1] if result.ndim > 1 else 1):
                channel = result[:, ch] if result.ndim > 1 else result
                band = sosfiltfilt(sos, channel)
                if result.ndim > 1:
                    result[:, ch] = channel + band * gain_linear
                else:
                    result = channel + band * gain_linear
        except Exception:
            continue

    return result.astype(np.float32)


def _apply_harmonizer(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """Add harmony voice by pitch shifting and mixing"""
    import librosa
    import numpy as np

    interval = params.get('interval', 3)  # semitones
    mix = params.get('mix', 0.4)

    result = audio.copy().astype(np.float64)

    for ch in range(audio.shape[1] if audio.ndim > 1 else 1):
        channel = audio[:, ch] if audio.ndim > 1 else audio
        harmony = librosa.effects.pitch_shift(
            channel.astype(np.float32), sr=sr, n_steps=interval
        )
        mixed = channel * (1 - mix * 0.3) + harmony * mix
        if audio.ndim > 1:
            result[:, ch] = mixed
        else:
            result = mixed

    return result.astype(np.float32)


def _apply_vocal_enhance(audio: 'np.ndarray', sr: int, params: dict) -> 'np.ndarray':
    """Enhance vocal clarity, warmth and air"""
    import numpy as np
    from scipy.signal import butter, sosfiltfilt

    warmth = params.get('warmth', 0.5)
    presence = params.get('presence', 0.5)
    air = params.get('air', 0.3)

    nyquist = sr / 2.0
    result = audio.copy().astype(np.float64)

    for ch in range(result.shape[1] if result.ndim > 1 else 1):
        channel = result[:, ch] if result.ndim > 1 else result

        # Warmth: boost 200-400 Hz
        if warmth > 0:
            try:
                sos = butter(2, [200 / nyquist, 400 / nyquist], btype='bandpass', output='sos')
                warm_band = sosfiltfilt(sos, channel)
                channel = channel + warm_band * warmth * 0.5
            except Exception:
                pass

        # Presence: boost 2-5 kHz
        if presence > 0:
            try:
                sos = butter(2, [2000 / nyquist, 5000 / nyquist], btype='bandpass', output='sos')
                pres_band = sosfiltfilt(sos, channel)
                channel = channel + pres_band * presence * 0.6
            except Exception:
                pass

        # Air: boost 8-14 kHz
        if air > 0 and sr > 20000:
            try:
                high_freq = min(14000, nyquist - 100)
                sos = butter(2, [8000 / nyquist, high_freq / nyquist], btype='bandpass', output='sos')
                air_band = sosfiltfilt(sos, channel)
                channel = channel + air_band * air * 0.4
            except Exception:
                pass

        # Gentle harmonic saturation for vocal richness
        if warmth > 0.3:
            sat_amount = warmth * 0.15
            channel = np.tanh(channel * (1 + sat_amount)) / np.tanh(1 + sat_amount)

        if result.ndim > 1:
            result[:, ch] = channel
        else:
            result = channel

    return result.astype(np.float32)


# ========================
# TEXT-TO-SONG
# ========================

class TextToSongRequest(BaseModel):
    text: str
    voiceModel: str
    musicStyle: str
    tempo: int
    key: str


@app.post("/api/generate/text-to-song")
async def generate_text_to_song(request: TextToSongRequest):
    """Generate song from text with AI voice and music"""
    try:
        return {
            "message": "Text-to-song generation started",
            "text_length": len(request.text),
            "voice_model": request.voiceModel,
            "music_style": request.musicStyle,
            "tempo": request.tempo,
            "key": request.key,
            "status": "pending_implementation",
            "estimated_duration": len(request.text) // 10
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ========================
# YOUTUBE AUDIO EXTRACTION
# ========================

@app.post("/api/youtube/extract-audio")
async def extract_audio_from_youtube(url: str = Form(...)):
    """Download audio from a YouTube URL and return it as a file"""
    import re
    import asyncio
    
    # Validate YouTube URL
    yt_pattern = r'(https?://)?(www\.)?(youtube\.com/(watch\?v=|shorts/)|youtu\.be/|music\.youtube\.com/watch\?v=)[a-zA-Z0-9_-]+'
    if not re.match(yt_pattern, url.strip()):
        raise HTTPException(status_code=400, detail="Geçersiz YouTube URL'si. Lütfen geçerli bir YouTube linki girin.")
    
    # Clean URL — strip playlist/radio params (prevents yt-dlp from downloading entire playlist)
    clean_url = url.strip().split('&list=')[0].split('&start_radio=')[0]
    
    output_dir = TEMP_DIR / "youtube"
    output_dir.mkdir(exist_ok=True, parents=True)
    
    # Clean old files (older than 1 hour)
    import time
    now = time.time()
    for f in output_dir.iterdir():
        if f.is_file() and (now - f.stat().st_mtime) > 3600:
            try:
                f.unlink(missing_ok=True)
            except:
                pass
    
    # Use unique ID instead of timestamp (avoids race condition)
    unique_id = f"yt_{int(now * 1000)}"
    output_template = str(output_dir / unique_id)
    
    def _download_sync():
        """Run yt-dlp in a thread to avoid blocking the event loop"""
        import yt_dlp
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': output_template + '.%(ext)s',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
                'preferredquality': '192',
            }],
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 30,
            'retries': 3,
            'extract_flat': False,
            # Limit duration to 15 minutes
            'match_filter': yt_dlp.utils.match_filter_func("duration < 900"),
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(clean_url, download=True)
            return info
    
    try:
        print(f"[YOUTUBE] Downloading audio from: {clean_url}")
        
        # Run blocking yt-dlp in thread pool (non-blocking for FastAPI)
        loop = asyncio.get_event_loop()
        info = await loop.run_in_executor(None, _download_sync)
        
        title = info.get('title', 'youtube_audio')
        duration = info.get('duration', 0)
        
        # Find the output file using the unique_id prefix (no timestamp race)
        output_file = Path(output_template + '.wav')
        if not output_file.exists():
            # Search for any file with our unique ID prefix
            for f in output_dir.glob(f"{unique_id}*"):
                if f.suffix in ['.wav', '.mp3', '.m4a', '.webm', '.ogg']:
                    output_file = f
                    break
        
        if not output_file.exists():
            raise HTTPException(status_code=500, detail="Ses dosyası indirilemedi. Lütfen farklı bir URL deneyin.")
        
        file_size_mb = output_file.stat().st_size / (1024 * 1024)
        print(f"[YOUTUBE] Downloaded: {title} ({duration}s, {file_size_mb:.1f}MB)")
        
        # Clean the title for filename use (keep unicode for display)
        safe_title = re.sub(r'[^\w\s\-]', '', title)[:80].strip()
        # ASCII-safe version for HTTP headers (latin-1 compatible)
        from urllib.parse import quote
        ascii_title = safe_title.encode('ascii', 'ignore').decode('ascii').strip() or 'youtube_audio'
        header_title = quote(safe_title, safe=' ')
        
        return FileResponse(
            path=str(output_file),
            media_type="audio/wav",
            filename=f"{ascii_title}.wav",
            headers={
                "X-Audio-Title": header_title,
                "X-Audio-Duration": str(duration),
                "Access-Control-Expose-Headers": "X-Audio-Title, X-Audio-Duration",
                "Content-Disposition": f"attachment; filename=\"{ascii_title}.wav\"; filename*=UTF-8''{quote(safe_title)}.wav"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        print(f"[YOUTUBE] Error: {error_msg}")
        if "Video unavailable" in error_msg or "Private video" in error_msg:
            raise HTTPException(status_code=400, detail="Bu video kullanılamıyor (gizli veya kaldırılmış olabilir).")
        if "duration" in error_msg.lower():
            raise HTTPException(status_code=400, detail="Video çok uzun. Maksimum 15 dakika desteklenir.")
        if "Sign in" in error_msg:
            raise HTTPException(status_code=400, detail="Bu video yaş doğrulaması gerektiriyor, indirilemez.")
        raise HTTPException(status_code=500, detail=f"YouTube indirme hatası: {error_msg}")


# ========================
# VOICE PROFILES (Kişisel Ses Paketi)
# ========================


@app.post("/api/voice-profiles")
async def save_voice_profile(
    voice_file: UploadFile = File(...),
    name: str = Form("Ses Profilim"),
):
    """Save a voice recording as a reusable voice profile"""
    try:
        profile_id = f"vp_{int(datetime.now().timestamp() * 1000)}"
        profile_dir = VOICE_PROFILES_DIR / profile_id
        profile_dir.mkdir(parents=True, exist_ok=True)

        # Save audio file
        audio_path = profile_dir / f"voice.wav"
        raw_path = profile_dir / f"voice_raw{Path(voice_file.filename).suffix}"

        with open(raw_path, "wb") as f:
            content = await voice_file.read()
            f.write(content)

        # Convert to WAV
        converted = convert_audio_to_wav(raw_path)
        if converted != audio_path:
            import shutil
            shutil.copy2(str(converted), str(audio_path))

        # Get audio info
        import soundfile as sf_info
        info = sf_info.info(str(audio_path))
        duration = info.duration

        # Extract and save speaker embedding for fast reuse
        try:
            from services.openvoice_service import get_or_load_converter, extract_speaker_embedding
            import numpy as np
            converter = get_or_load_converter()
            se = extract_speaker_embedding(str(audio_path), converter)
            np.save(str(profile_dir / "speaker_embedding.npy"), se.cpu().numpy())
            has_embedding = True
            print(f"[INFO] ✅ Speaker embedding cached for profile '{name}'")
        except Exception as e:
            has_embedding = False
            print(f"[WARNING] Speaker embedding extraction failed: {e}")

        # Save metadata
        metadata = {
            "id": profile_id,
            "name": name,
            "created_at": datetime.now().isoformat(),
            "duration": round(duration, 1),
            "has_embedding": has_embedding,
            "original_filename": voice_file.filename,
        }

        with open(profile_dir / "metadata.json", "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        print(f"[SUCCESS] ✅ Voice profile saved: {name} ({duration:.1f}s)")

        return {
            "message": f"Ses profili kaydedildi: {name}",
            "profile": metadata,
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Profil kaydetme hatası: {str(e)}")


@app.get("/api/voice-profiles")
async def list_voice_profiles():
    """List all saved voice profiles"""
    profiles = []

    if not VOICE_PROFILES_DIR.exists():
        return {"profiles": []}

    for profile_dir in sorted(VOICE_PROFILES_DIR.iterdir(), key=os.path.getmtime, reverse=True):
        if not profile_dir.is_dir():
            continue
        meta_path = profile_dir / "metadata.json"
        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                # Check if audio file still exists
                audio_path = profile_dir / "voice.wav"
                meta["audio_exists"] = audio_path.exists()
                meta["audio_url"] = f"/api/voice-profiles/{meta['id']}/audio"
                profiles.append(meta)
            except Exception:
                continue

    return {"profiles": profiles}


@app.get("/api/voice-profiles/{profile_id}/audio")
async def get_voice_profile_audio(profile_id: str, request: Request):
    """Stream voice profile audio with Range support"""
    profile_dir = VOICE_PROFILES_DIR / profile_id
    audio_path = profile_dir / "voice.wav"

    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Ses profili bulunamadı")

    file_size = audio_path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        range_str = range_header.replace("bytes=", "")
        parts = range_str.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_file():
            with open(audio_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(), status_code=206, media_type="audio/wav",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes", "Content-Length": str(content_length),
            },
        )
    else:
        return FileResponse(path=str(audio_path), media_type="audio/wav",
                            headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)})


@app.delete("/api/voice-profiles/{profile_id}")
async def delete_voice_profile(profile_id: str):
    """Delete a voice profile"""
    import shutil
    profile_dir = VOICE_PROFILES_DIR / profile_id
    if not profile_dir.exists():
        raise HTTPException(status_code=404, detail="Profil bulunamadı")

    shutil.rmtree(str(profile_dir), ignore_errors=True)
    return {"message": "Profil silindi", "id": profile_id}


# ========================
# CLONED RESULTS HISTORY
# ========================

@app.get("/api/clone-history")
async def list_clone_history():
    """List all cloned song results"""
    results = []

    if not CLONED_DIR.exists():
        return {"results": []}

    # Find all main mix files (not _vocals or _instrumental)
    for wav_file in sorted(CLONED_DIR.glob("*.wav"), key=os.path.getmtime, reverse=True):
        fname = wav_file.stem
        if fname.endswith("_vocals") or fname.endswith("_instrumental"):
            continue

        size_mb = wav_file.stat().st_size / (1024 * 1024)
        import soundfile as sf_info2
        try:
            info = sf_info2.info(str(wav_file))
            duration = info.duration
        except Exception:
            duration = 0

        created = datetime.fromtimestamp(wav_file.stat().st_mtime)

        result = {
            "id": fname,
            "name": fname.replace("cloned_", "").replace("_", " "),
            "filename": wav_file.name,
            "created_at": created.isoformat(),
            "duration": round(duration, 1),
            "size_mb": round(size_mb, 1),
            "download_url": f"/api/download/cloned/{wav_file.name}",
            "components": {},
        }

        # Check for vocal/instrumental components
        vocal_path = CLONED_DIR / f"{fname}_vocals.wav"
        instr_path = CLONED_DIR / f"{fname}_instrumental.wav"
        if vocal_path.exists():
            result["components"]["vocals"] = f"/api/download/cloned/{vocal_path.name}"
        if instr_path.exists():
            result["components"]["instrumental"] = f"/api/download/cloned/{instr_path.name}"

        results.append(result)

    return {"results": results}


@app.delete("/api/clone-history/{result_id}")
async def delete_clone_result(result_id: str):
    """Delete a cloned result and its components"""
    deleted = []
    for suffix in ["", "_vocals", "_instrumental"]:
        fpath = CLONED_DIR / f"{result_id}{suffix}.wav"
        if fpath.exists():
            fpath.unlink()
            deleted.append(fpath.name)

    if not deleted:
        raise HTTPException(status_code=404, detail="Sonuç bulunamadı")

    return {"message": "Sonuç silindi", "deleted": deleted}


# ========================
# VOICE CLONING WITH DEMUCS AI
# ========================

@app.post("/api/clone-voice-sing")
async def clone_voice_and_sing(
    song_file: UploadFile = File(...),
    voice_file: UploadFile = File(None),
    voice_profile_id: str = Form(None),
    voice_model_id: str = Form(None),
):
    """
    Ses Dönüştürme — OpenVoice V2 Neural Voice Conversion
    
    ElevenLabs tarzı derin öğrenme yaklaşımı:
    1. Demucs AI ile şarkıyı ayır → vokal + enstrümantal
    2. OpenVoice V2 ile Speaker Embedding çıkar (CNN → tone color vektörü)
    3. Neural Voice Conversion:
       → Encoder (1D CNN) → feature maps
       → Normalizing Flow → kaynak ses kimliğini çıkar
       → Normalizing Flow (inverse) → hedef ses kimliğini ekle
       → HiFi-GAN Decoder → temiz yüksek kaliteli ses
    4. Dönüştürülmüş vokal + enstrümantal = final mix
    
    voice_file, voice_profile_id veya voice_model_id ile çalışır.
    voice_model_id: Eğitilmiş AI model ile klonlama (en yüksek kalite).
    """
    import librosa
    import soundfile as sf
    import numpy as np

    SR = 44100
    MAX_DURATION = 300

    # Validate: either voice_file, voice_profile_id, or voice_model_id required
    if voice_file is None and voice_profile_id is None and voice_model_id is None:
        raise HTTPException(status_code=400, detail="voice_file, voice_profile_id veya voice_model_id gerekli")

    # Pre-loaded speaker embedding from saved profile
    cached_target_se = None

    try:
        # Determine voice source (priority: trained model > profile > file)
        if voice_model_id:
            # Use trained AI model embedding (highest quality)
            from services.voice_model_trainer import get_trainer
            import torch
            
            trainer = get_trainer()
            cached_target_se = trainer.get_model_embedding(voice_model_id)
            
            # Get model metadata for display
            model_meta = trainer._load_metadata(voice_model_id)
            voice_source_name = model_meta.get("name", voice_model_id) if model_meta else voice_model_id
            quality_grade = model_meta.get("quality_grade", "?") if model_meta else "?"
            
            # We need a voice_path for the pipeline but trained model doesn't have a single file
            # Use the first sample as reference (for any fallback operations)
            model_dir = trainer._model_dir(voice_model_id)
            samples_dir = model_dir / "samples"
            sample_files = list(samples_dir.glob("*.wav")) if samples_dir.exists() else []
            if sample_files:
                voice_path = sample_files[0]
            else:
                # Fallback: create a dummy path (embedding is already loaded)
                voice_path = None
            
            print(f"\n{'='*60}")
            print(f"[INFO] 🎤 Ses dönüştürme başladı (Voice Conversion)...")
            print(f"[INFO] 🎓 Eğitilmiş AI Model: {voice_source_name} (Kalite: {quality_grade})")
            print(f"[INFO] Şarkı (içerik kaynağı): {song_file.filename}")
            print(f"{'='*60}")
        elif voice_profile_id:
            # Load from saved voice profile
            profile_dir = VOICE_PROFILES_DIR / voice_profile_id
            profile_audio = profile_dir / "voice.wav"
            if not profile_audio.exists():
                raise HTTPException(status_code=404, detail=f"Ses profili bulunamadı: {voice_profile_id}")
            
            voice_path = profile_audio
            voice_source_name = voice_profile_id
            
            # Try to load cached speaker embedding
            embedding_path = profile_dir / "speaker_embedding.npy"
            if embedding_path.exists():
                try:
                    import torch
                    cached_target_se = torch.from_numpy(np.load(str(embedding_path)))
                    if torch.cuda.is_available():
                        cached_target_se = cached_target_se.cuda()
                    print(f"[INFO] ⚡ Cached speaker embedding loaded from profile")
                except Exception as e:
                    print(f"[WARNING] Could not load cached embedding: {e}")
                    cached_target_se = None
            
            # Load profile name
            meta_path = profile_dir / "metadata.json"
            if meta_path.exists():
                with open(meta_path, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
                voice_source_name = meta.get("name", voice_profile_id)
            
            print(f"\n{'='*60}")
            print(f"[INFO] 🎤 Ses dönüştürme başladı (Voice Conversion)...")
            print(f"[INFO] Ses kimliği kaynağı: {voice_source_name} (kayıtlı profil)")
            print(f"[INFO] Şarkı (içerik kaynağı): {song_file.filename}")
            print(f"{'='*60}")
        else:
            # Use uploaded voice file
            voice_path = UPLOAD_DIR / f"voice_{voice_file.filename}"
            with open(voice_path, "wb") as f:
                f.write(await voice_file.read())
            voice_path = convert_audio_to_wav(voice_path)
            voice_source_name = voice_file.filename
            
            print(f"\n{'='*60}")
            print(f"[INFO] 🎤 Ses dönüştürme başladı (Voice Conversion)...")
            print(f"[INFO] Ses kimliği kaynağı: {voice_file.filename}")
            print(f"[INFO] Şarkı (içerik kaynağı): {song_file.filename}")
            print(f"{'='*60}")

        # === Şarkı dosyasını kaydet ===
        song_path = UPLOAD_DIR / f"song_{song_file.filename}"
        with open(song_path, "wb") as f:
            f.write(await song_file.read())
        song_path = convert_audio_to_wav(song_path)

        # Süre kontrolü
        song_info = sf.info(str(song_path))
        if song_info.duration > MAX_DURATION:
            print(f"[INFO] ⚡ Şarkı {song_info.duration:.0f}s → {MAX_DURATION}s'ye kısaltılıyor")
            y_full, sr_full = sf.read(str(song_path))
            y_full = y_full[:int(MAX_DURATION * sr_full)]
            sf.write(str(song_path), y_full, sr_full)

        # ============================================================
        # STEP 1: Demucs AI ile şarkıyı ayır
        # ============================================================
        print(f"\n[STEP 1/4] 🧠 Demucs AI ile şarkı ayrıştırılıyor...")
        
        demucs_output = TEMP_DIR / f"demucs_{song_file.filename.rsplit('.', 1)[0]}"
        demucs_output.mkdir(parents=True, exist_ok=True)
        
        demucs_separate_stems(song_path, "htdemucs", demucs_output)
        
        vocals_path = demucs_output / "vocals.wav"
        music_path = demucs_output / "music.wav"
        
        if not vocals_path.exists():
            raise Exception("Demucs vokal ayırma başarısız")
        
        # Enstrümantal yükle (stereo kalite)
        if music_path.exists():
            y_instr_stereo, _ = librosa.load(str(music_path), sr=SR, mono=False)
        else:
            parts = []
            for stem in ["drums", "bass", "other"]:
                sp = demucs_output / f"{stem}.wav"
                if sp.exists():
                    ys, _ = librosa.load(str(sp), sr=SR, mono=False)
                    parts.append(ys)
            if not parts:
                raise Exception("Enstrümantal bulunamadı")
            ml = max(p.shape[-1] for p in parts)
            y_instr_stereo = np.zeros((2, ml))
            for p in parts:
                if p.ndim == 1: p = np.stack([p, p])
                y_instr_stereo[:, :p.shape[-1]] += p
        
        if y_instr_stereo.ndim == 1:
            y_instr_stereo = np.stack([y_instr_stereo, y_instr_stereo])
        
        # ORİJİNAL VOKALİ yükle — bu ANA SES olacak (melodi, sözler, zamanlama)
        y_original_vocal, _ = librosa.load(str(vocals_path), sr=SR, mono=True)
        
        print(f"[INFO] ✅ Orijinal vokal: {len(y_original_vocal)/SR:.1f}s")
        print(f"[INFO] ✅ Enstrümantal: {y_instr_stereo.shape[-1]/SR:.1f}s")

        # ============================================================
        # STEP 2: OpenVoice V2 Neural Voice Conversion
        # ============================================================
        # ElevenLabs tarzı derin öğrenme yaklaşımı:
        #   1. Speaker Embedding: CNN → mel-spectrogram → ses kimliği vektörü
        #   2. Normalizing Flow: Ters çevrilebilir ağ ile ses kimliği ayrıştır
        #   3. HiFi-GAN Vocoder: Sinirsel vocoder ile temiz sentez
        
        print(f"\n[STEP 2/4] 🧠 OpenVoice V2 Neural Voice Conversion...")
        
        from services.openvoice_service import (
            get_or_load_converter,
            extract_speaker_embedding,
            convert_voice_chunked
        )
        
        # Load neural network model
        converter = get_or_load_converter()
        
        # Extract speaker embeddings (tone color vectors)
        if cached_target_se is not None:
            if voice_model_id:
                print(f"[INFO] ⚡ Eğitilmiş AI model embedding'i kullanılıyor (en yüksek kalite)")
            else:
                print(f"[INFO] ⚡ Kayıtlı profil embedding'i kullanılıyor (hızlı mod)")
            target_se = cached_target_se
        else:
            print(f"[INFO] 🎤 Kullanıcı ses kimliği çıkarılıyor (Speaker Embedding)...")
            target_se = extract_speaker_embedding(str(voice_path), converter)
        
        print(f"[INFO] 🎵 Orijinal şarkıcı ses kimliği çıkarılıyor...")
        source_se = extract_speaker_embedding(str(vocals_path), converter)
        
        print(f"[INFO] ✅ Speaker embeddings hazır!")

        # ============================================================
        # STEP 3: Neural Voice Conversion (Tone Color Transfer)
        # ============================================================
        print(f"\n[STEP 3/4] 🎵 Neural ses dönüşümü yapılıyor...")
        print(f"[INFO] Encoder → Normalizing Flow → HiFi-GAN Decoder")
        
        # Converted vocal path
        converted_vocal_path = str(TEMP_DIR / "converted_vocal.wav")
        
        # Convert voice using deep neural network
        # tau=0.3 → ElevenLabs-style balanced conversion
        #   - Low enough to transform voice identity
        #   - High enough to preserve prosody, expression, and natural quality
        #   - ElevenLabs uses similar range for their tone-color transfer
        y_converted, conv_sr = convert_voice_chunked(
            source_audio_path=str(vocals_path),
            source_se=source_se,
            target_se=target_se,
            output_path=converted_vocal_path,
            tau=0.3,
            converter=converter
        )
        
        # High-quality resample to project sample rate (soxr = best available)
        if conv_sr != SR:
            y_converted = librosa.resample(y_converted, orig_sr=conv_sr, target_sr=SR, res_type='soxr_vhq')
        
        # Variables for backward compatibility in logs
        user_pitch = 0.0
        ref_pitch = 0.0
        semitones = 0.0
        
        print(f"[INFO] ✅ Neural voice conversion tamamlandı!")
        print(f"[INFO] Çıkış: {len(y_converted)/SR:.1f}s")

        # ============================================================
        # STEP 4: ElevenLabs-Quality Mastering Pipeline (v5)
        # ============================================================
        # Key insight from ElevenLabs: Minimal, surgical processing.
        # Each step should PRESERVE the natural quality, not add effects.
        # Less processing = more natural sound.
        print(f"\n[STEP 4/4] 🎛️ ElevenLabs-Quality Mastering Pipeline (v5)...")
        
        from scipy.signal import butter, sosfiltfilt
        from scipy.ndimage import uniform_filter1d as uf1d, minimum_filter1d as mf1d
        
        # --- Helper: LUFS Loudness Normalization ---
        def loudness_normalize(signal, target_lufs=-14.0, sr=44100):
            """ITU-R BS.1770 tarzı loudness normalization"""
            sos_k = butter(2, 1500, btype='high', fs=sr, output='sos')
            weighted = sosfiltfilt(sos_k, signal).astype(np.float32)
            rms = np.sqrt(np.mean(weighted ** 2)) + 1e-10
            current_lufs = 20 * np.log10(rms) - 0.691
            gain = 10 ** ((target_lufs - current_lufs) / 20)
            gain = min(gain, 6.0)
            return (signal * gain).astype(np.float32)
        
        # ====== VOKAL İŞLEME ZİNCİRİ (ElevenLabs-style: minimal, surgical) ======
        print(f"[INFO] 🔧 Vokal mastering zinciri (ElevenLabs-quality)...")
        
        # 1) High-pass: Sadece alçak uğultuyu temizle
        sos_hp = butter(3, 75, btype='high', fs=SR, output='sos')
        y_converted = sosfiltfilt(sos_hp, y_converted).astype(np.float32)
        print(f"[INFO] ✅ High-pass filter (75Hz, gentle)")
        
        # 2) Body/Warmth EQ: Hafif sıcaklık ekle (vokal zayıflamasını önle)
        sos_warm = butter(2, [180, 350], btype='band', fs=SR, output='sos')
        y_warmth = sosfiltfilt(sos_warm, y_converted).astype(np.float32)
        y_converted = y_converted + y_warmth * 0.12  # Subtle warmth
        print(f"[INFO] ✅ Warmth EQ (180-350Hz, +1dB)")
        
        # 3) Dynamic de-esser (sadece gerçek sibilance'ı hedefle)
        sos_sib = butter(2, 6000, btype='high', fs=SR, output='sos')
        y_sibilant = sosfiltfilt(sos_sib, y_converted).astype(np.float32)
        sib_env = np.abs(y_sibilant)
        sib_env = uf1d(sib_env, size=max(int(0.005 * SR), 1))
        sib_threshold = np.percentile(sib_env, 88)  # Only top 12% (true sibilance)
        sib_mask = np.clip(sib_env / (sib_threshold + 1e-10), 0, 1)
        y_converted = y_converted - y_sibilant * sib_mask * 0.25  # Gentle
        print(f"[INFO] ✅ Dynamic de-esser (6kHz+, gentle)")
        
        # 4) Presence EQ: Vokal netliği (çok hafif)
        sos_pres = butter(2, [2500, 5000], btype='band', fs=SR, output='sos')
        y_presence = sosfiltfilt(sos_pres, y_converted).astype(np.float32)
        y_converted = y_converted + y_presence * 0.12  # Subtle presence
        
        nyq_safe = min(13000, SR // 2 - 100)
        if nyq_safe > 9000:
            sos_air = butter(2, [9000, nyq_safe], btype='band', fs=SR, output='sos')
            y_air = sosfiltfilt(sos_air, y_converted).astype(np.float32)
            y_converted = y_converted + y_air * 0.06  # Very subtle air
        print(f"[INFO] ✅ Presence + Air EQ (subtle)")
        
        # 5) SKIP saturation — ElevenLabs doesn't add harmonics artificially
        #    Neural vocoder (HiFi-GAN) already produces natural harmonics
        print(f"[INFO] ✅ No saturation (ElevenLabs approach: preserve natural harmonics)")
        
        # 6) Gentle compressor (preserve dynamics, just control peaks)
        threshold_comp = 10 ** (-16.0 / 20)  # -16dB (very gentle)
        ratio_comp = 1.8  # Soft ratio
        block_size = max(int(SR * 0.02), 1)  # 20ms blocks
        n_blocks = len(y_converted) // block_size + 1
        gain_curve = np.ones(len(y_converted), dtype=np.float32)
        
        for bi in range(n_blocks):
            bs = bi * block_size
            be = min(bs + block_size, len(y_converted))
            if bs >= len(y_converted):
                break
            block_rms = np.sqrt(np.mean(y_converted[bs:be] ** 2)) + 1e-10
            if block_rms > threshold_comp:
                over_db = 20 * np.log10(block_rms / threshold_comp)
                red_db = over_db * (1.0 - 1.0 / ratio_comp)
                gain_curve[bs:be] = 10 ** (-red_db / 20)
        
        smooth_n = max(int(SR * 0.02), 3)
        gain_curve = uf1d(gain_curve, size=smooth_n)
        y_converted = (y_converted * gain_curve).astype(np.float32)
        print(f"[INFO] ✅ Gentle compressor (threshold=-16dB, ratio=1.8:1)")
        
        # 7) Spectral environment matching — make converted vocal sit
        #    in the same acoustic space as the original
        try:
            orig_mono = y_original_vocal[:min(len(y_original_vocal), len(y_converted))]
            conv_len = min(len(y_converted), len(orig_mono))
            
            # Compare spectral envelopes at low resolution (captures room/mic character)
            S_orig = librosa.stft(orig_mono[:conv_len], n_fft=2048, hop_length=512)
            S_conv = librosa.stft(y_converted[:conv_len], n_fft=2048, hop_length=512)
            
            mag_orig = np.abs(S_orig) + 1e-8
            mag_conv = np.abs(S_conv) + 1e-8
            phase_conv = np.angle(S_conv)
            
            # Smooth spectral envelopes heavily (captures tonal balance, not detail)
            from scipy.ndimage import median_filter
            env_orig = median_filter(mag_orig, size=(15, 7))
            env_conv = median_filter(mag_conv, size=(15, 7))
            
            # Compute and apply gentle spectral matching
            env_ratio = np.clip(env_orig / env_conv, 0.6, 1.7)
            
            # Apply only 25% of the matching (subtle tonal balance correction)
            mag_matched = mag_conv * (1.0 + 0.25 * (env_ratio - 1.0))
            S_matched = mag_matched * np.exp(1j * phase_conv)
            y_matched = librosa.istft(S_matched, hop_length=512, length=conv_len)
            y_converted[:conv_len] = y_matched.astype(np.float32)
            
            print(f"[INFO] ✅ Spectral environment matching (acoustic space transfer)")
        except Exception as e:
            print(f"[INFO] ⚠️ Environment matching skipped: {e}")
        
        # 8) Loudness normalize
        y_converted = loudness_normalize(y_converted, target_lufs=-12.0, sr=SR)
        print(f"[INFO] ✅ Loudness normalization (target=-12 LUFS)")
        
        # Peak limit vocal
        vpeak = np.abs(y_converted).max()
        if vpeak > 0.95:
            y_converted = y_converted / vpeak * 0.95
        
        # ====== ENSTRÜMANTAL İŞLEME ======
        for ch in range(y_instr_stereo.shape[0]):
            y_instr_stereo[ch] = loudness_normalize(y_instr_stereo[ch], target_lufs=-15.0, sr=SR)
        print(f"[INFO] ✅ Enstrümantal normalize (-15 LUFS)")
        
        # ====== MİKSAJ (ElevenLabs-quality balance) ======
        target_len = y_instr_stereo.shape[-1]
        if len(y_converted) < target_len:
            y_converted = np.pad(y_converted, (0, target_len - len(y_converted)))
        else:
            y_converted = y_converted[:target_len]
        
        min_len = min(len(y_converted), y_instr_stereo.shape[-1])
        y_converted = y_converted[:min_len]
        y_instr_stereo = y_instr_stereo[:, :min_len]
        
        rms_v = float(np.sqrt(np.mean(y_converted**2))) + 1e-8
        rms_i = float(np.sqrt(np.mean(y_instr_stereo**2))) + 1e-8
        print(f"[INFO] Vokal RMS: {rms_v:.4f}, Enstrümantal RMS: {rms_i:.4f}, Oran: {rms_v/rms_i:.2f}")
        
        # Auto-balance: Ensure vocal sits 2-4dB above instrumental
        target_ratio = 1.5  # Vocal ~3.5dB louder than instrumental
        current_ratio = rms_v / rms_i
        if current_ratio < target_ratio * 0.8:
            # Vocal too quiet — boost vocal slightly
            vocal_gain = min(target_ratio / current_ratio, 1.5)
            instr_gain = 0.72
        elif current_ratio > target_ratio * 1.5:
            # Vocal too loud — reduce vocal slightly
            vocal_gain = target_ratio / current_ratio
            instr_gain = 0.75
        else:
            vocal_gain = 1.0
            instr_gain = 0.72
        
        print(f"[INFO] Mix balance: vocal_gain={vocal_gain:.2f}, instr_gain={instr_gain:.2f}")
        
        # Stereo mix — vokal ortada, enstrümantal stereo
        y_mixed = np.zeros((2, min_len), dtype=np.float32)
        y_mixed[0] = y_converted * vocal_gain + y_instr_stereo[0] * instr_gain
        y_mixed[1] = y_converted * vocal_gain + y_instr_stereo[1] * instr_gain
        
        # ====== MASTER LİMİTER (True Peak, broadcast quality) ======
        ceiling = 10 ** (-1.0 / 20)  # -1dB True Peak (broadcast standard)
        peak_env = np.max(np.abs(y_mixed), axis=0)
        limiter_gain = np.where(peak_env > ceiling, ceiling / (peak_env + 1e-10), 1.0).astype(np.float32)
        la_samples = max(int(SR * 0.003), 1)  # 3ms lookahead
        limiter_gain = mf1d(limiter_gain, size=la_samples)
        rel_samples = max(int(SR * 0.08), 1)  # 80ms release (smooth)
        limiter_gain = uf1d(limiter_gain, size=rel_samples)
        limiter_gain = np.minimum(limiter_gain, 1.0)
        y_mixed = y_mixed * limiter_gain[np.newaxis, :]
        
        dur = min_len / SR
        final_peak = float(np.abs(y_mixed).max())
        final_rms = float(np.sqrt(np.mean(y_mixed**2)))
        print(f"[INFO] 🎵 Final: peak={final_peak:.3f}, RMS={final_rms:.4f}, süre={dur:.1f}s")

        # === Kaydet ===
        output_name = f"cloned_{song_file.filename.rsplit('.', 1)[0]}"
        clone_dir = OUTPUT_DIR / "cloned"
        clone_dir.mkdir(parents=True, exist_ok=True)

        out_path = clone_dir / f"{output_name}.wav"
        sf.write(str(out_path), y_mixed.T, SR, subtype='PCM_24')

        voc_path = clone_dir / f"{output_name}_vocals.wav"
        sf.write(str(voc_path), y_converted, SR, subtype='PCM_24')

        inst_path = clone_dir / f"{output_name}_instrumental.wav"
        sf.write(str(inst_path), y_instr_stereo[:, :min_len].T, SR, subtype='PCM_24')

        mb = out_path.stat().st_size / (1024 * 1024)
        print(f"\n{'='*60}")
        print(f"[SUCCESS] ✅ OpenVoice V2 Neural Voice Conversion tamamlandı!")
        print(f"[INFO] Süre: {dur:.1f}s, Boyut: {mb:.1f}MB")
        print(f"[INFO] Yöntem: Speaker Embedding + Normalizing Flow + HiFi-GAN")
        print(f"{'='*60}\n")

        import shutil
        try: shutil.rmtree(str(demucs_output), ignore_errors=True)
        except: pass

        return {
            "message": "OpenVoice V2 Neural Voice Conversion tamamlandı!",
            "voice_file": voice_file.filename if voice_file else (voice_model_id or voice_profile_id or "saved_profile"),
            "song_file": song_file.filename,
            "method": "OpenVoice V2 (Speaker Embedding + Normalizing Flow + HiFi-GAN)" + (" + AI Trained Model" if voice_model_id else ""),
            "status": "completed",
            "output_file": str(out_path),
            "download_url": f"/api/download/cloned/{output_name}.wav",
            "voice_model_id": voice_model_id,
            "components": {
                "vocals": f"/api/download/cloned/{output_name}_vocals.wav",
                "instrumental": f"/api/download/cloned/{output_name}_instrumental.wav"
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Ses dönüştürme hatası: {str(e)}")


# ========================
# STUDIO ENDPOINTS
# ========================


@app.post("/api/studio/separate-stems")
async def studio_separate_stems(
    audio_file: UploadFile = File(...),
    model: str = Form("htdemucs"),
):
    """
    Separate an audio file into stems and return download URLs for each stem.
    Used by the Studio for loading stems as individual tracks.
    """
    import soundfile as sf
    
    try:
        print(f"\n[Studio] 🎛️ Stem separation requested: {audio_file.filename}")
        
        # Save uploaded file
        safe_name = audio_file.filename.replace(" ", "_").replace("(", "").replace(")", "")
        input_path = UPLOAD_DIR / f"studio_{safe_name}"
        with open(input_path, "wb") as f:
            f.write(await audio_file.read())
        
        input_path = convert_audio_to_wav(input_path)
        
        # Create output directory
        stem_name = Path(safe_name).stem
        output_dir = OUTPUT_DIR / "separated" / f"studio_{stem_name}"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Run Demucs separation
        from demucs_ai import demucs_separate_stems
        result = demucs_separate_stems(input_path, model, output_dir)
        
        # Build response with download URLs for each stem
        stems = []
        for stem in result["stems"]:
            stem_file = output_dir / f"{stem}.wav"
            if stem_file.exists():
                info = sf.info(str(stem_file))
                size_mb = stem_file.stat().st_size / (1024 * 1024)
                
                # Determine track type
                type_map = {
                    'vocals': 'vocal',
                    'drums': 'drums',
                    'bass': 'bass',
                    'other': 'instrumental',
                    'music': 'instrumental',
                }
                track_type = type_map.get(stem, 'other')
                
                stems.append({
                    "name": stem,
                    "type": track_type,
                    "duration": round(info.duration, 2),
                    "size_mb": round(size_mb, 2),
                    "download_url": f"/api/studio/stem-file/{stem_name}/{stem}",
                })
        
        print(f"[Studio] ✅ Separation complete: {len(stems)} stems")
        
        return {
            "message": f"{len(stems)} stem başarıyla ayrıldı",
            "stems": stems,
            "sample_rate": result["sample_rate"],
            "device": result["device"],
        }
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Stem ayrıştırma hatası: {str(e)}")


@app.get("/api/studio/stem-file/{song_name}/{stem_name}")
async def get_studio_stem_file(song_name: str, stem_name: str, request: Request):
    """Serve a separated stem file with Range support for seeking"""
    stem_path = OUTPUT_DIR / "separated" / f"studio_{song_name}" / f"{stem_name}.wav"
    
    if not stem_path.exists():
        raise HTTPException(status_code=404, detail=f"Stem bulunamadı: {stem_name}")
    
    file_size = stem_path.stat().st_size
    range_header = request.headers.get("range")
    
    if range_header:
        range_str = range_header.replace("bytes=", "")
        parts = range_str.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_file():
            with open(stem_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(), status_code=206, media_type="audio/wav",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )
    else:
        return FileResponse(
            path=str(stem_path), media_type="audio/wav",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)}
        )


# ========================
# PROFESSIONAL VOCAL PRESETS
# ========================

@app.post("/api/studio/apply-vocal-preset")
async def studio_apply_vocal_preset(
    audio_file: UploadFile = File(...),
    preset: str = Form("studio_polish"),
    params_json: str = Form("{}"),
):
    """
    Apply a professional multi-stage vocal processing chain.
    Each preset chains multiple high-quality effects in the correct order,
    mimicking real mixing engineer workflows.
    
    Presets:
    - studio_polish: Full studio vocal chain (HP filter → De-ess → Compress → EQ → Saturation → Exciter → Limiter)
    - natural_warmth: Warm natural vocal (Gentle HP → Warm EQ → Light compress → Tube saturation → Air)
    - radio_ready: Broadcast-quality (Aggressive HP → Heavy compress → Bright EQ → De-ess → Limiter)
    - soft_ballad: Gentle intimate vocal (HP → Light EQ → Gentle compress → Reverb space → Air shimmer)
    - pop_vocal: Modern pop vocal (HP → Tight compress → Presence EQ → De-ess → Exciter → Stereo width)
    - raw_clean: Minimal cleaning (HP filter → Normalize → Gentle de-ess)
    """
    import numpy as np
    import soundfile as sf
    from scipy.signal import butter, sosfiltfilt, lfilter

    try:
        params = json.loads(params_json)
        audio_bytes = await audio_file.read()
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        audio_data = audio_data.astype(np.float64)
        
        # Ensure stereo
        if audio_data.ndim == 1:
            audio_data = np.column_stack([audio_data, audio_data])
        
        nyquist = sr / 2.0
        intensity = params.get('intensity', 0.7)  # 0.0-1.0 overall intensity
        
        print(f"[Studio] Applying vocal preset: {preset} (intensity={intensity})")
        
        def _hp_filter(data, freq, order=4):
            """High-pass filter to remove rumble"""
            sos = butter(order, freq / nyquist, btype='highpass', output='sos')
            for ch in range(data.shape[1]):
                data[:, ch] = sosfiltfilt(sos, data[:, ch])
            return data
        
        def _lp_filter(data, freq, order=2):
            """Low-pass filter"""
            sos = butter(order, freq / nyquist, btype='lowpass', output='sos')
            for ch in range(data.shape[1]):
                data[:, ch] = sosfiltfilt(sos, data[:, ch])
            return data
        
        def _band_eq(data, low, high, gain_db):
            """Bandpass EQ boost/cut"""
            if abs(gain_db) < 0.1:
                return data
            low_n = max(20, low) / nyquist
            high_n = min(nyquist - 100, high) / nyquist
            if low_n >= high_n or low_n <= 0 or high_n >= 1:
                return data
            try:
                sos = butter(2, [low_n, high_n], btype='bandpass', output='sos')
                gain_linear = 10 ** (gain_db / 20.0) - 1.0
                for ch in range(data.shape[1]):
                    band = sosfiltfilt(sos, data[:, ch])
                    data[:, ch] = data[:, ch] + band * gain_linear
            except Exception:
                pass
            return data
        
        def _compressor(data, threshold_db=-18, ratio=3.0, attack_ms=10, release_ms=100, makeup_db=0):
            """Dynamic range compressor with attack/release envelope"""
            threshold = 10 ** (threshold_db / 20.0)
            makeup = 10 ** (makeup_db / 20.0)
            attack_coeff = np.exp(-1.0 / (sr * attack_ms / 1000.0))
            release_coeff = np.exp(-1.0 / (sr * release_ms / 1000.0))
            
            for ch in range(data.shape[1]):
                channel = data[:, ch]
                envelope = np.zeros(len(channel))
                env = 0.0
                for i in range(len(channel)):
                    level = abs(channel[i])
                    if level > env:
                        env = attack_coeff * env + (1 - attack_coeff) * level
                    else:
                        env = release_coeff * env + (1 - release_coeff) * level
                    envelope[i] = env
                
                # Apply gain reduction
                gain = np.ones(len(channel))
                above = envelope > threshold
                if np.any(above):
                    gain[above] = (threshold / envelope[above]) ** (1 - 1/ratio)
                
                data[:, ch] = channel * gain * makeup
            return data
        
        def _de_esser(data, freq=6000, threshold_db=-20, reduction=0.6):
            """Reduce sibilance in vocal"""
            threshold = 10 ** (threshold_db / 20.0)
            low_n = max(20, freq - 1500) / nyquist
            high_n = min(nyquist - 100, freq + 3000) / nyquist
            if low_n >= high_n or low_n <= 0 or high_n >= 1:
                return data
            try:
                sos = butter(2, [low_n, high_n], btype='bandpass', output='sos')
                for ch in range(data.shape[1]):
                    sib_band = sosfiltfilt(sos, data[:, ch])
                    sib_env = np.abs(sib_band)
                    # Smooth envelope
                    smooth_len = int(sr * 0.005)
                    if smooth_len > 1:
                        kernel = np.ones(smooth_len) / smooth_len
                        sib_env = np.convolve(sib_env, kernel, mode='same')
                    # Reduce where sibilance exceeds threshold
                    mask = sib_env > threshold
                    if np.any(mask):
                        gain = np.ones(len(data[:, ch]))
                        gain[mask] = 1.0 - reduction * np.minimum(1.0, (sib_env[mask] - threshold) / threshold)
                        # Only reduce the sibilant band, not the whole signal
                        data[:, ch] = data[:, ch] - sib_band * (1 - gain)
            except Exception:
                pass
            return data
        
        def _saturation(data, drive=0.3, mix=0.3):
            """Tube-style harmonic saturation for warmth"""
            for ch in range(data.shape[1]):
                driven = np.tanh(data[:, ch] * (1 + drive * 3))
                data[:, ch] = data[:, ch] * (1 - mix) + driven * mix
            return data
        
        def _exciter(data, freq=3000, amount=0.3):
            """Harmonic exciter — adds sparkle/presence"""
            low_n = freq / nyquist
            high_n = min(nyquist - 100, freq * 3) / nyquist
            if low_n >= high_n or low_n <= 0 or high_n >= 1:
                return data
            try:
                sos = butter(2, [low_n, high_n], btype='bandpass', output='sos')
                for ch in range(data.shape[1]):
                    band = sosfiltfilt(sos, data[:, ch])
                    # Generate harmonics via soft clipping
                    harmonics = np.tanh(band * 3) * amount
                    data[:, ch] = data[:, ch] + harmonics
            except Exception:
                pass
            return data
        
        def _stereo_width(data, width=1.3):
            """Adjust stereo width (>1 = wider, <1 = narrower)"""
            if data.shape[1] < 2:
                return data
            mid = (data[:, 0] + data[:, 1]) * 0.5
            side = (data[:, 0] - data[:, 1]) * 0.5
            side = side * width
            data[:, 0] = mid + side
            data[:, 1] = mid - side
            return data
        
        def _limiter(data, ceiling_db=-0.5):
            """Brick-wall limiter"""
            ceiling = 10 ** (ceiling_db / 20.0)
            peak = np.abs(data).max()
            if peak > ceiling:
                data = data * (ceiling / peak)
            return data
        
        def _normalize(data, target_db=-1.0):
            """Peak normalize"""
            target = 10 ** (target_db / 20.0)
            peak = np.abs(data).max()
            if peak > 0:
                data = data * (target / peak)
            return data
        
        # ========== PRESET CHAINS ==========
        
        if preset == 'studio_polish':
            # Professional studio vocal chain — the gold standard
            hp_freq = 80 + (1 - intensity) * 40  # 80-120 Hz
            audio_data = _hp_filter(audio_data, hp_freq)
            audio_data = _de_esser(audio_data, freq=6500, threshold_db=-22 + (1-intensity)*6, reduction=0.5 * intensity)
            audio_data = _compressor(audio_data, threshold_db=-20 + (1-intensity)*6, ratio=3.0 + intensity, attack_ms=8, release_ms=80, makeup_db=2 * intensity)
            # EQ: Cut mud, boost presence & air
            audio_data = _band_eq(audio_data, 200, 400, -2 * intensity)     # Cut mud
            audio_data = _band_eq(audio_data, 800, 1200, -1.5 * intensity)  # Cut boxiness
            audio_data = _band_eq(audio_data, 2500, 5000, 3 * intensity)    # Presence
            audio_data = _band_eq(audio_data, 8000, 12000, 2 * intensity)   # Air
            audio_data = _saturation(audio_data, drive=0.2 * intensity, mix=0.15 * intensity)
            audio_data = _exciter(audio_data, freq=4000, amount=0.2 * intensity)
            audio_data = _limiter(audio_data, ceiling_db=-0.5)
        
        elif preset == 'natural_warmth':
            # Warm, natural vocal — singer-songwriter / acoustic
            audio_data = _hp_filter(audio_data, 60, order=2)
            audio_data = _band_eq(audio_data, 150, 350, 2.5 * intensity)    # Warmth
            audio_data = _band_eq(audio_data, 600, 900, -1 * intensity)     # Reduce nasal
            audio_data = _band_eq(audio_data, 2000, 4000, 1.5 * intensity)  # Gentle presence  
            audio_data = _band_eq(audio_data, 10000, 14000, 1 * intensity)  # Airy top
            audio_data = _compressor(audio_data, threshold_db=-16 + (1-intensity)*4, ratio=2.0, attack_ms=20, release_ms=150, makeup_db=1.5 * intensity)
            audio_data = _saturation(audio_data, drive=0.35 * intensity, mix=0.2 * intensity)
            audio_data = _limiter(audio_data, ceiling_db=-0.8)
        
        elif preset == 'radio_ready':
            # Broadcast / radio vocal — loud, bright, in-your-face
            audio_data = _hp_filter(audio_data, 100)
            audio_data = _compressor(audio_data, threshold_db=-24 + (1-intensity)*8, ratio=5.0, attack_ms=3, release_ms=50, makeup_db=4 * intensity)
            audio_data = _de_esser(audio_data, freq=7000, threshold_db=-18, reduction=0.7 * intensity)
            audio_data = _band_eq(audio_data, 200, 500, -3 * intensity)     # Heavy mud cut
            audio_data = _band_eq(audio_data, 1500, 3500, 2 * intensity)    # Forward mid
            audio_data = _band_eq(audio_data, 3500, 6000, 4 * intensity)    # Brightness
            audio_data = _band_eq(audio_data, 8000, 12000, 3 * intensity)   # Sparkle
            audio_data = _exciter(audio_data, freq=5000, amount=0.35 * intensity)
            audio_data = _saturation(audio_data, drive=0.15 * intensity, mix=0.1 * intensity)
            # Second lighter compression for consistency
            audio_data = _compressor(audio_data, threshold_db=-12, ratio=2.0, attack_ms=15, release_ms=120, makeup_db=1)
            audio_data = _limiter(audio_data, ceiling_db=-0.3)
        
        elif preset == 'soft_ballad':
            # Gentle, intimate vocal — ballad / slow song
            audio_data = _hp_filter(audio_data, 70, order=2)
            audio_data = _band_eq(audio_data, 200, 500, 1.5 * intensity)    # Body
            audio_data = _band_eq(audio_data, 2000, 3500, 1 * intensity)    # Gentle clarity
            audio_data = _band_eq(audio_data, 8000, 13000, 2.5 * intensity) # Air shimmer
            audio_data = _compressor(audio_data, threshold_db=-14 + (1-intensity)*4, ratio=2.0, attack_ms=25, release_ms=200, makeup_db=1 * intensity)
            audio_data = _saturation(audio_data, drive=0.15 * intensity, mix=0.1 * intensity)
            audio_data = _de_esser(audio_data, freq=6500, threshold_db=-20, reduction=0.4 * intensity)
            audio_data = _stereo_width(audio_data, width=1.0 + 0.2 * intensity)
            audio_data = _limiter(audio_data, ceiling_db=-1.0)
        
        elif preset == 'pop_vocal':
            # Modern pop vocal — tight, present, excited
            audio_data = _hp_filter(audio_data, 90)
            audio_data = _compressor(audio_data, threshold_db=-22 + (1-intensity)*6, ratio=4.0, attack_ms=5, release_ms=60, makeup_db=3 * intensity)
            audio_data = _de_esser(audio_data, freq=7000, threshold_db=-20, reduction=0.6 * intensity)
            audio_data = _band_eq(audio_data, 200, 400, -2 * intensity)     # Tight low
            audio_data = _band_eq(audio_data, 1000, 2000, 1 * intensity)    # Body
            audio_data = _band_eq(audio_data, 3000, 6000, 3.5 * intensity)  # In-your-face presence
            audio_data = _band_eq(audio_data, 9000, 13000, 2 * intensity)   # Top sparkle
            audio_data = _exciter(audio_data, freq=3500, amount=0.3 * intensity)
            audio_data = _saturation(audio_data, drive=0.2 * intensity, mix=0.12 * intensity)
            audio_data = _stereo_width(audio_data, width=1.0 + 0.15 * intensity)
            audio_data = _limiter(audio_data, ceiling_db=-0.3)
        
        elif preset == 'raw_clean':
            # Minimal cleanup — just make it usable
            audio_data = _hp_filter(audio_data, 75, order=3)
            audio_data = _de_esser(audio_data, freq=6500, threshold_db=-18, reduction=0.3)
            audio_data = _normalize(audio_data, target_db=-1.0)
        
        elif preset == 'hiphop_vocal':
            # Hip-hop / rap vocal — aggressive, forward, punchy
            audio_data = _hp_filter(audio_data, 100)
            audio_data = _compressor(audio_data, threshold_db=-26 + (1-intensity)*8, ratio=6.0, attack_ms=2, release_ms=40, makeup_db=5 * intensity)
            audio_data = _de_esser(audio_data, freq=7500, threshold_db=-18, reduction=0.7 * intensity)
            audio_data = _band_eq(audio_data, 150, 350, -3 * intensity)     # Clean low
            audio_data = _band_eq(audio_data, 800, 1500, 2 * intensity)     # Weight
            audio_data = _band_eq(audio_data, 3000, 5000, 4 * intensity)    # Aggressive presence
            audio_data = _band_eq(audio_data, 7000, 10000, 2.5 * intensity) # Bite
            audio_data = _exciter(audio_data, freq=4000, amount=0.4 * intensity)
            audio_data = _saturation(audio_data, drive=0.3 * intensity, mix=0.2 * intensity)
            audio_data = _limiter(audio_data, ceiling_db=-0.2)
        
        elif preset == 'rnb_smooth':
            # R&B / Soul — smooth, warm, rich
            audio_data = _hp_filter(audio_data, 65, order=2)
            audio_data = _band_eq(audio_data, 150, 400, 3 * intensity)      # Full warmth
            audio_data = _band_eq(audio_data, 600, 1000, -1 * intensity)    # Clean mids
            audio_data = _band_eq(audio_data, 2000, 4000, 2 * intensity)    # Silky presence
            audio_data = _band_eq(audio_data, 8000, 13000, 2 * intensity)   # Airy
            audio_data = _compressor(audio_data, threshold_db=-18 + (1-intensity)*4, ratio=2.5, attack_ms=12, release_ms=120, makeup_db=2 * intensity)
            audio_data = _saturation(audio_data, drive=0.4 * intensity, mix=0.25 * intensity)
            audio_data = _de_esser(audio_data, freq=6000, threshold_db=-22, reduction=0.5 * intensity)
            audio_data = _stereo_width(audio_data, width=1.0 + 0.25 * intensity)
            audio_data = _limiter(audio_data, ceiling_db=-0.5)
        
        elif preset == 'rock_vocal':
            # Rock vocal — gritty, powerful, cutting
            audio_data = _hp_filter(audio_data, 100)
            audio_data = _compressor(audio_data, threshold_db=-24 + (1-intensity)*6, ratio=5.0, attack_ms=3, release_ms=50, makeup_db=4 * intensity)
            audio_data = _band_eq(audio_data, 200, 500, -2 * intensity)     # Tight bottom
            audio_data = _band_eq(audio_data, 1000, 2500, 2 * intensity)    # Midrange bark
            audio_data = _band_eq(audio_data, 3000, 6000, 3 * intensity)    # Cut through
            audio_data = _saturation(audio_data, drive=0.5 * intensity, mix=0.3 * intensity)  # Grit!
            audio_data = _de_esser(audio_data, freq=7000, threshold_db=-20, reduction=0.5 * intensity)
            audio_data = _exciter(audio_data, freq=4000, amount=0.25 * intensity)
            audio_data = _limiter(audio_data, ceiling_db=-0.3)
        
        else:
            raise HTTPException(status_code=400, detail=f"Bilinmeyen preset: {preset}")
        
        # Final safety limiter
        peak = np.abs(audio_data).max()
        if peak > 0.99:
            audio_data = audio_data / peak * 0.95
        
        audio_data = audio_data.astype(np.float32)
        
        output_buffer = io.BytesIO()
        sf.write(output_buffer, audio_data, sr, format='WAV', subtype='PCM_24')
        output_buffer.seek(0)
        
        print(f"[Studio] ✅ Vocal preset '{preset}' applied successfully")
        
        return StreamingResponse(
            output_buffer, media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=vocal_{preset}.wav"}
        )
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Vokal preset hatası: {str(e)}")


@app.get("/api/studio/vocal-presets")
async def list_vocal_presets():
    """Return available vocal presets with descriptions"""
    return {
        "presets": [
            {
                "id": "studio_polish",
                "name": "🎙️ Studio Polish",
                "description": "Profesyonel stüdyo vokal zinciri — HP, De-ess, Kompresör, EQ, Satürasyon, Exciter",
                "category": "professional",
                "tags": ["genel", "profesyonel", "önerilen"]
            },
            {
                "id": "natural_warmth",
                "name": "☀️ Doğal Sıcaklık",
                "description": "Sıcak, doğal vokal — akustik & singer-songwriter için ideal",
                "category": "style",
                "tags": ["akustik", "doğal", "sıcak"]
            },
            {
                "id": "radio_ready",
                "name": "📻 Radyo Kalitesi",
                "description": "Yayın kalitesinde vokal — parlak, güçlü, net",
                "category": "professional",
                "tags": ["radyo", "yayın", "parlak"]
            },
            {
                "id": "soft_ballad",
                "name": "🌙 Yumuşak Balad",
                "description": "Nazik, samimi vokal — balad & yavaş şarkılar için",
                "category": "style",
                "tags": ["balad", "romantik", "yumuşak"]
            },
            {
                "id": "pop_vocal",
                "name": "🎤 Modern Pop",
                "description": "Modern pop vokali — sıkı, parlak, enerjik",
                "category": "style",
                "tags": ["pop", "modern", "enerjik"]
            },
            {
                "id": "hiphop_vocal",
                "name": "🔥 Hip-Hop / Rap",
                "description": "Agresif, güçlü vokal — rap & hip-hop için",
                "category": "style",
                "tags": ["rap", "hip-hop", "agresif"]
            },
            {
                "id": "rnb_smooth",
                "name": "✨ R&B Smooth",
                "description": "Pürüzsüz, zengin vokal — R&B & soul müzik için",
                "category": "style",
                "tags": ["rnb", "soul", "pürüzsüz"]
            },
            {
                "id": "rock_vocal",
                "name": "🎸 Rock",
                "description": "Güçlü, keskin vokal — rock & alternatif için",
                "category": "style",
                "tags": ["rock", "güçlü", "keskin"]
            },
            {
                "id": "raw_clean",
                "name": "🧹 Temiz / Minimal",
                "description": "Sadece temel temizlik — HP filtre, normalize, hafif de-ess",
                "category": "utility",
                "tags": ["temiz", "doğal", "minimal"]
            },
        ]
    }


@app.post("/api/studio/apply-effect")
async def studio_apply_effect(
    audio_file: UploadFile = File(...),
    effect_type: str = Form(...),
    params_json: str = Form("{}"),
):
    """
    Apply a single audio effect server-side and return the processed audio.
    For high-quality processing that can't be done in Web Audio API.
    """
    import numpy as np
    import soundfile as sf
    
    try:
        params = json.loads(params_json)
        audio_bytes = await audio_file.read()
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        audio_data = audio_data.astype(np.float32)
        
        print(f"[Studio] Applying effect: {effect_type} with params: {params}")
        
        if effect_type == 'pitch_shift':
            import librosa
            semitones = params.get('semitones', 0)
            if audio_data.ndim == 1:
                audio_data = librosa.effects.pitch_shift(audio_data, sr=sr, n_steps=semitones)
            else:
                for ch in range(audio_data.shape[1]):
                    audio_data[:, ch] = librosa.effects.pitch_shift(audio_data[:, ch], sr=sr, n_steps=semitones)
        
        elif effect_type == 'tempo_change':
            import librosa
            rate = params.get('rate', 1.0)
            if audio_data.ndim == 1:
                audio_data = librosa.effects.time_stretch(audio_data, rate=rate)
            else:
                channels = []
                for ch in range(audio_data.shape[1]):
                    channels.append(librosa.effects.time_stretch(audio_data[:, ch], rate=rate))
                min_len = min(len(c) for c in channels)
                audio_data = np.column_stack([c[:min_len] for c in channels])
        
        elif effect_type == 'vocal_enhance':
            from scipy.signal import butter, sosfiltfilt
            # High-pass at 80Hz, presence boost at 3-6kHz
            sos_hp = butter(4, 80, btype='highpass', fs=sr, output='sos')
            sos_pres = butter(2, [2500, 6000], btype='bandpass', fs=sr, output='sos')
            amount = params.get('amount', 0.3)
            if audio_data.ndim == 1:
                filtered = sosfiltfilt(sos_hp, audio_data)
                presence = sosfiltfilt(sos_pres, audio_data)
                audio_data = filtered + presence * amount
            else:
                for ch in range(audio_data.shape[1]):
                    filtered = sosfiltfilt(sos_hp, audio_data[:, ch])
                    presence = sosfiltfilt(sos_pres, audio_data[:, ch])
                    audio_data[:, ch] = filtered + presence * amount
        
        elif effect_type == 'bass_boost':
            from scipy.signal import butter, sosfiltfilt
            sos = butter(2, 150, btype='lowpass', fs=sr, output='sos')
            amount = params.get('amount', 0.5)
            if audio_data.ndim == 1:
                bass = sosfiltfilt(sos, audio_data)
                audio_data = audio_data + bass * amount
            else:
                for ch in range(audio_data.shape[1]):
                    bass = sosfiltfilt(sos, audio_data[:, ch])
                    audio_data[:, ch] = audio_data[:, ch] + bass * amount
        
        elif effect_type == 'normalize':
            peak = np.abs(audio_data).max()
            if peak > 0:
                target = params.get('target', 0.95)
                audio_data = audio_data * (target / peak)
        
        # Limiter
        peak = np.abs(audio_data).max()
        if peak > 0.99:
            audio_data = audio_data / peak * 0.95
        
        output_buffer = io.BytesIO()
        sf.write(output_buffer, audio_data, sr, format='WAV', subtype='PCM_16')
        output_buffer.seek(0)
        
        return StreamingResponse(
            output_buffer, media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=processed.wav"}
        )
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Efekt uygulama hatası: {str(e)}")


@app.post("/api/studio/noise-reduce")
async def studio_noise_reduce(
    audio_file: UploadFile = File(...),
    strength: float = Form(0.5)
):
    """Apply noise reduction to an audio file using noisereduce library"""
    try:
        import numpy as np
        import soundfile as sf
        import noisereduce as nr

        # Read uploaded audio
        audio_bytes = await audio_file.read()
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))

        # Ensure float32
        audio_data = audio_data.astype(np.float32)

        # Clamp strength 0-1
        strength = max(0.0, min(1.0, strength))

        # Apply noise reduction
        # prop_decrease controls how much of the noise is removed (0=none, 1=all)
        if audio_data.ndim == 1:
            reduced = nr.reduce_noise(
                y=audio_data,
                sr=sr,
                prop_decrease=strength,
                stationary=True,
                n_std_thresh_stationary=1.5
            )
        else:
            # Process each channel separately for stereo
            channels = []
            for ch in range(audio_data.shape[1]):
                ch_reduced = nr.reduce_noise(
                    y=audio_data[:, ch],
                    sr=sr,
                    prop_decrease=strength,
                    stationary=True,
                    n_std_thresh_stationary=1.5
                )
                channels.append(ch_reduced)
            reduced = np.column_stack(channels)

        # Write to WAV buffer
        output_buffer = io.BytesIO()
        sf.write(output_buffer, reduced, sr, format='WAV', subtype='PCM_16')
        output_buffer.seek(0)

        print(f"[Studio] Noise reduction applied: strength={strength:.2f}, sr={sr}")

        return StreamingResponse(
            output_buffer,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=noise_reduced.wav"}
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Gürültü azaltma hatası: {str(e)}")


@app.post("/api/studio/autotune")
async def studio_autotune(
    audio_file: UploadFile = File(...),
    key: str = Form("C"),
    speed: float = Form(5.0)
):
    """Apply pitch correction (autotune) to an audio file using librosa"""
    try:
        import numpy as np
        import soundfile as sf
        import librosa

        # Read uploaded audio
        audio_bytes = await audio_file.read()
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))

        # Convert to mono for pitch detection
        if audio_data.ndim > 1:
            mono = np.mean(audio_data, axis=1)
        else:
            mono = audio_data.copy()

        mono = mono.astype(np.float32)

        # Define note frequencies for the key
        # Map key names to semitone offsets from C
        key_offsets = {
            'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
            'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
            'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
        }

        key_offset = key_offsets.get(key, 0)

        # Detect pitch using librosa
        f0, voiced_flag, voiced_probs = librosa.pyin(
            mono,
            fmin=librosa.note_to_hz('C2'),
            fmax=librosa.note_to_hz('C7'),
            sr=sr
        )

        # Calculate correction for each frame
        # Convert f0 to MIDI, quantize to nearest note in key, convert back
        corrected = mono.copy()

        if f0 is not None and np.any(~np.isnan(f0)):
            # Get valid pitch frames
            valid = ~np.isnan(f0)

            if np.sum(valid) > 0:
                # Convert to MIDI note numbers
                midi_notes = np.zeros_like(f0)
                midi_notes[valid] = 12 * np.log2(f0[valid] / 440.0) + 69

                # Major scale intervals from key root: 0,2,4,5,7,9,11
                major_scale = [0, 2, 4, 5, 7, 9, 11]
                scale_notes = [(n + key_offset) % 12 for n in major_scale]

                # Quantize each MIDI note to nearest scale note
                target_midi = np.zeros_like(midi_notes)
                for i in range(len(midi_notes)):
                    if valid[i]:
                        note_class = midi_notes[i] % 12
                        octave = int(midi_notes[i]) // 12

                        # Find nearest scale note
                        min_dist = 12
                        nearest = note_class
                        for sn in scale_notes:
                            dist = min(abs(note_class - sn), 12 - abs(note_class - sn))
                            if dist < min_dist:
                                min_dist = dist
                                nearest = sn

                        target_midi[i] = octave * 12 + nearest
                    else:
                        target_midi[i] = midi_notes[i]

                # Calculate pitch shift in semitones per frame
                shift_semitones = target_midi - midi_notes

                # Apply average pitch correction using librosa pitch_shift
                # Use weighted average shift based on speed parameter
                avg_shift = np.nanmean(shift_semitones[valid])

                # Speed controls how aggressively we correct (higher = more correction)
                correction_amount = min(speed / 10.0, 1.0)
                final_shift = avg_shift * correction_amount

                if abs(final_shift) > 0.05:  # Only shift if meaningful
                    corrected = librosa.effects.pitch_shift(
                        mono,
                        sr=sr,
                        n_steps=final_shift
                    )

        # Write output
        output_buffer = io.BytesIO()
        sf.write(output_buffer, corrected, sr, format='WAV', subtype='PCM_16')
        output_buffer.seek(0)

        print(f"[Studio] Autotune applied: key={key}, speed={speed}")

        return StreamingResponse(
            output_buffer,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=autotuned.wav"}
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Autotune hatası: {str(e)}")


@app.post("/api/studio/mix-export")
async def studio_mix_export(
    tracks: List[UploadFile] = File(...),
    volumes: str = Form("1.0"),
    pans: str = Form("0.0"),
    master_volume: float = Form(0.8)
):
    """Mix multiple audio tracks together and export as WAV"""
    try:
        import numpy as np
        import soundfile as sf

        # Parse comma-separated volume and pan values
        vol_list = [float(v.strip()) for v in volumes.split(",")]
        pan_list = [float(p.strip()) for p in pans.split(",")]

        # Read all tracks
        track_data = []
        target_sr = 44100
        max_length = 0

        for i, track_file in enumerate(tracks):
            audio_bytes = await track_file.read()
            data, sr = sf.read(io.BytesIO(audio_bytes))
            data = data.astype(np.float32)

            # Resample if needed
            if sr != target_sr:
                import librosa
                if data.ndim == 1:
                    data = librosa.resample(data, orig_sr=sr, target_sr=target_sr)
                else:
                    channels = []
                    for ch in range(data.shape[1]):
                        channels.append(librosa.resample(data[:, ch], orig_sr=sr, target_sr=target_sr))
                    data = np.column_stack(channels)

            # Convert mono to stereo
            if data.ndim == 1:
                data = np.column_stack([data, data])

            max_length = max(max_length, len(data))
            track_data.append(data)

        if not track_data:
            raise HTTPException(status_code=400, detail="No tracks provided")

        # Mix all tracks
        mixed = np.zeros((max_length, 2), dtype=np.float32)

        for i, data in enumerate(track_data):
            vol = vol_list[i] if i < len(vol_list) else 1.0
            pan = pan_list[i] if i < len(pan_list) else 0.0

            # Pad track to max length
            if len(data) < max_length:
                padded = np.zeros((max_length, 2), dtype=np.float32)
                padded[:len(data)] = data
                data = padded

            # Apply pan (constant-power panning)
            pan_norm = (pan + 1.0) / 2.0  # 0 to 1
            left_gain = np.cos(pan_norm * np.pi / 2)
            right_gain = np.sin(pan_norm * np.pi / 2)

            mixed[:, 0] += data[:, 0] * vol * left_gain
            mixed[:, 1] += data[:, 1] * vol * right_gain

        # Apply master volume
        mixed *= master_volume

        # Soft limiter to prevent clipping
        peak = np.max(np.abs(mixed))
        if peak > 0.95:
            mixed = mixed * (0.95 / peak)

        # Write output
        output_buffer = io.BytesIO()
        sf.write(output_buffer, mixed, target_sr, format='WAV', subtype='PCM_16')
        output_buffer.seek(0)

        print(f"[Studio] Mix exported: {len(track_data)} tracks, master_vol={master_volume}")

        return StreamingResponse(
            output_buffer,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=studio_mix.wav"}
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Mix export hatası: {str(e)}")


# ========================
# VOICE LIBRARY
# ========================

@app.get("/api/voice-library")
async def get_voice_library():
    """Get available voice models from library"""
    return {
        "voices": [
            {"id": "male-warm", "name": "Erkek - Sıcak Ses", "type": "ai", "language": "tr", "gender": "male"},
            {"id": "male-energetic", "name": "Erkek - Enerjik Ses", "type": "ai", "language": "tr", "gender": "male"},
            {"id": "female-soft", "name": "Kadın - Yumuşak Ses", "type": "ai", "language": "tr", "gender": "female"},
            {"id": "female-powerful", "name": "Kadın - Güçlü Ses", "type": "ai", "language": "tr", "gender": "female"},
            {"id": "narrator-professional", "name": "Profesyonel Anlatıcı", "type": "ai", "language": "tr", "gender": "neutral"}
        ]
    }


# ========================
# DOWNLOAD ENDPOINTS
# ========================

# IMPORTANT: Specific routes MUST come before generic {filename}/{stem} route
@app.get("/api/download/cloned/{filename}")
async def download_cloned_file(filename: str):
    """Download a cloned voice audio file"""
    from urllib.parse import unquote

    filename = unquote(filename)
    output_path = OUTPUT_DIR / "cloned" / filename

    print(f"Looking for cloned file: {output_path}")

    if not output_path.exists():
        if not filename.endswith('.wav'):
            output_path = OUTPUT_DIR / "cloned" / f"{filename}.wav"
        if not output_path.exists():
            raise HTTPException(status_code=404, detail=f"Cloned file not found: {filename}")

    return FileResponse(
        path=str(output_path),
        media_type="audio/wav",
        filename=filename
    )


@app.get("/api/download/generated/{filename}")
async def download_generated_file(filename: str):
    """Download a generated audio file"""
    output_path = OUTPUT_DIR / filename

    if not output_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    return FileResponse(
        path=str(output_path),
        media_type="audio/wav",
        filename=filename
    )


@app.get("/api/download/{filename}/{stem}")
async def download_separated_stem(filename: str, stem: str, request: Request):
    """Download a separated audio stem with HTTP Range support for seeking"""
    from urllib.parse import unquote

    filename = unquote(filename)
    output_path = OUTPUT_DIR / "separated" / filename / f"{stem}.wav"

    if not output_path.exists():
        parent_dir = OUTPUT_DIR / "separated" / filename
        if parent_dir.exists():
            available = list(parent_dir.glob("*.wav"))
            print(f"Available files: {available}")
        raise HTTPException(
            status_code=404,
            detail=f"Stem file not found: {stem}.wav at {output_path}"
        )

    file_size = output_path.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        # Parse Range: bytes=start-end
        range_str = range_header.replace("bytes=", "")
        parts = range_str.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_file():
            with open(output_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type="audio/wav",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
                "Content-Disposition": f'inline; filename="{filename}_{stem}.wav"',
            },
        )
    else:
        # Full file response with Accept-Ranges header
        return FileResponse(
            path=str(output_path),
            media_type="audio/wav",
            filename=f"{filename}_{stem}.wav",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
        )


# ========================
# VOICE AI TRAINING ENDPOINTS
# ========================

@app.post("/api/voice-training/train")
async def train_voice_model(
    voice_files: List[UploadFile] = File(None),
    model_name: str = Form("Yeni Model"),
    profile_ids: str = Form(None),
):
    """
    Ses modeli eğitimi — çok örnekli speaker embedding + adapter ağı.
    
    Eğitim aşamaları:
    1. Multi-sample embedding aggregation (kalite ağırlıklı)
    2. Speaker adapter network eğitimi (LoRA-style, self-reconstruction)
    3. Optimal post-processing parametre keşfi
    
    voice_files: Yeni ses dosyaları (opsiyonel)
    profile_ids: Mevcut ses profillerinin ID'leri (virgülle ayrılmış, opsiyonel)
    """
    from services.voice_model_trainer import get_trainer
    
    trainer = get_trainer()
    
    # Parse profile IDs
    parsed_profile_ids = []
    if profile_ids:
        parsed_profile_ids = [pid.strip() for pid in profile_ids.split(",") if pid.strip()]
    
    # Validate: at least one source needed
    has_files = voice_files is not None and len(voice_files) > 0 and voice_files[0].filename
    has_profiles = len(parsed_profile_ids) > 0
    
    if not has_files and not has_profiles:
        raise HTTPException(
            status_code=400,
            detail="En az bir ses dosyası veya ses profili gerekli"
        )
    
    try:
        # Create model
        model_id = trainer.create_model(model_name)
        
        # Save uploaded voice files to temp
        audio_paths = []
        sample_names = []
        
        if has_files:
            for vf in voice_files:
                if not vf.filename:
                    continue
                temp_path = UPLOAD_DIR / f"train_{vf.filename}"
                with open(temp_path, "wb") as f:
                    f.write(await vf.read())
                # Convert to WAV if needed
                temp_path = convert_audio_to_wav(temp_path)
                audio_paths.append(str(temp_path))
                sample_names.append(vf.filename.rsplit(".", 1)[0])
        
        # Run full training pipeline
        result = trainer.train_full(
            model_id=model_id,
            audio_paths=audio_paths if audio_paths else None,
            sample_names=sample_names if sample_names else None,
            profile_ids=parsed_profile_ids if parsed_profile_ids else None,
        )
        
        # Cleanup temp files
        for p in audio_paths:
            try:
                os.remove(p)
            except:
                pass
        
        return {
            "message": f"Model eğitimi tamamlandı: {model_name}",
            "model_id": model_id,
            "quality_grade": result.get("final", {}).get("quality_grade", "D"),
            "consistency_score": result.get("final", {}).get("consistency_score", 0),
            "num_samples": result.get("final", {}).get("num_samples", 0),
            "total_duration": result.get("final", {}).get("total_duration", 0),
            "has_adapter": result.get("final", {}).get("has_adapter", False),
            "details": result,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Eğitim hatası: {str(e)}")


@app.post("/api/voice-training/add-samples")
async def add_training_samples(
    model_id: str = Form(...),
    voice_files: List[UploadFile] = File(...),
):
    """Mevcut eğitilmiş modele yeni ses örnekleri ekle ve yeniden eğit"""
    from services.voice_model_trainer import get_trainer
    
    trainer = get_trainer()
    
    try:
        # Save uploaded files
        audio_paths = []
        sample_names = []
        
        for vf in voice_files:
            if not vf.filename:
                continue
            temp_path = UPLOAD_DIR / f"train_{vf.filename}"
            with open(temp_path, "wb") as f:
                f.write(await vf.read())
            temp_path = convert_audio_to_wav(temp_path)
            audio_paths.append(str(temp_path))
            sample_names.append(vf.filename.rsplit(".", 1)[0])
        
        if not audio_paths:
            raise HTTPException(status_code=400, detail="En az bir ses dosyası gerekli")
        
        # Add samples
        sample_result = trainer.add_samples(model_id, audio_paths, sample_names)
        
        # Re-train adapter if enough samples
        metadata = trainer._load_metadata(model_id)
        adapter_result = None
        if metadata and metadata.get("num_samples", 0) >= 2:
            adapter_epochs = min(30 + metadata["num_samples"] * 5, 100)
            try:
                adapter_result = trainer.train_adapter(model_id, epochs=adapter_epochs)
            except Exception as e:
                print(f"[WARNING] Adapter eğitimi başarısız: {e}")
        
        # Cleanup
        for p in audio_paths:
            try:
                os.remove(p)
            except:
                pass
        
        # Reload metadata
        metadata = trainer._load_metadata(model_id)
        
        return {
            "message": f"{sample_result['samples_added']} örnek eklendi, model güncellendi",
            "model_id": model_id,
            "samples_added": sample_result["samples_added"],
            "total_samples": metadata.get("num_samples", 0),
            "quality_grade": metadata.get("quality_grade", "D"),
            "consistency_score": metadata.get("consistency_score", 0),
            "has_adapter": metadata.get("has_adapter", False),
            "adapter_trained": adapter_result is not None,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Örnek ekleme hatası: {str(e)}")


@app.get("/api/voice-training/models")
async def list_trained_models():
    """Tüm eğitilmiş ses modellerini listele"""
    from services.voice_model_trainer import get_trainer
    
    trainer = get_trainer()
    models = trainer.list_models()
    
    return {"models": models}


@app.delete("/api/voice-training/models/{model_id}")
async def delete_trained_model(model_id: str):
    """Eğitilmiş ses modelini sil"""
    from services.voice_model_trainer import get_trainer
    
    trainer = get_trainer()
    success = trainer.delete_model(model_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Model bulunamadı: {model_id}")
    
    return {"message": f"Model silindi: {model_id}"}


# ========================
# MAIN
# ========================

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    debug = os.getenv("DEBUG", "True") == "True"

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
        timeout_keep_alive=120,
        log_level="warning"
    )
