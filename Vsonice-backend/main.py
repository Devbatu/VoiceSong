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
import asyncio
import logging
import uvicorn
from pathlib import Path

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

for directory in [UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR, SEPARATED_DIR]:
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
# VOICE CLONING WITH DEMUCS AI
# ========================

@app.post("/api/clone-voice-sing")
async def clone_voice_and_sing(
    voice_file: UploadFile = File(...),
    song_file: UploadFile = File(...)
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
    """
    import librosa
    import soundfile as sf
    import numpy as np

    SR = 44100
    MAX_DURATION = 300

    try:
        print(f"\n{'='*60}")
        print(f"[INFO] 🎤 Ses dönüştürme başladı (Voice Conversion)...")
        print(f"[INFO] Ses kimliği kaynağı: {voice_file.filename}")
        print(f"[INFO] Şarkı (içerik kaynağı): {song_file.filename}")
        print(f"{'='*60}")

        # === Dosyaları kaydet ===
        voice_path = UPLOAD_DIR / f"voice_{voice_file.filename}"
        song_path = UPLOAD_DIR / f"song_{song_file.filename}"
        
        with open(voice_path, "wb") as f:
            f.write(await voice_file.read())
        with open(song_path, "wb") as f:
            f.write(await song_file.read())

        voice_path = convert_audio_to_wav(voice_path)
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
        # tau=0.2 → strong but natural conversion (0=max change, 1=no change)
        y_converted, conv_sr = convert_voice_chunked(
            source_audio_path=str(vocals_path),
            source_se=source_se,
            target_se=target_se,
            output_path=converted_vocal_path,
            tau=0.2,
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
        # STEP 4: Profesyonel Mastering Pipeline (v3 — Maximum Quality)
        # ============================================================
        print(f"\n[STEP 4/4] 🎛️ Profesyonel mastering pipeline (v3 - Max Quality)...")
        
        from scipy.signal import butter, sosfiltfilt, fftconvolve
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
        
        # ====== VOKAL İŞLEME ZİNCİRİ ======
        print(f"[INFO] 🔧 Vokal işleme zinciri başlıyor...")
        
        # 1) High-pass: Rumble ve uğultu temizle (<80Hz)
        sos_hp = butter(4, 80, btype='high', fs=SR, output='sos')
        y_converted = sosfiltfilt(sos_hp, y_converted).astype(np.float32)
        print(f"[INFO] ✅ High-pass filter (80Hz)")
        
        # 2) Warmth EQ: Add body/warmth (200-400Hz) — prevents thin/tinny sound
        sos_warm = butter(2, [200, 400], btype='band', fs=SR, output='sos')
        y_warmth = sosfiltfilt(sos_warm, y_converted).astype(np.float32)
        y_converted = y_converted + y_warmth * 0.15  # ~+1.2dB warmth
        print(f"[INFO] ✅ Warmth EQ (200-400Hz, +1.2dB)")
        
        # 3) Dynamic de-esser
        sos_sib = butter(2, 6000, btype='high', fs=SR, output='sos')
        y_sibilant = sosfiltfilt(sos_sib, y_converted).astype(np.float32)
        sib_env = np.abs(y_sibilant)
        sib_env = uf1d(sib_env, size=max(int(0.005 * SR), 1))
        sib_threshold = np.percentile(sib_env, 85)
        sib_mask = np.clip(sib_env / (sib_threshold + 1e-10), 0, 1)
        y_converted = y_converted - y_sibilant * sib_mask * 0.3
        print(f"[INFO] ✅ Dynamic de-esser (6kHz+)")
        
        # 4) Presence + Air EQ: Vokal netliği ve hava hissi
        sos_pres = butter(2, [2000, 5500], btype='band', fs=SR, output='sos')
        y_presence = sosfiltfilt(sos_pres, y_converted).astype(np.float32)
        y_converted = y_converted + y_presence * 0.18
        
        nyq_safe = min(13000, SR // 2 - 100)
        if nyq_safe > 9000:
            sos_air = butter(2, [9000, nyq_safe], btype='band', fs=SR, output='sos')
            y_air = sosfiltfilt(sos_air, y_converted).astype(np.float32)
            y_converted = y_converted + y_air * 0.10
        print(f"[INFO] ✅ Presence + Air EQ")
        
        # 5) Soft harmonic saturation — adds warmth and "analog" character
        def soft_saturate(signal, drive=0.3):
            """Soft-clip saturation: adds subtle harmonics like analog gear"""
            x = signal * (1.0 + drive)
            return np.tanh(x).astype(np.float32) * (1.0 / np.tanh(1.0 + drive))
        
        y_converted = soft_saturate(y_converted, drive=0.2)
        print(f"[INFO] ✅ Harmonic saturation (subtle analog warmth)")
        
        # 6) Block-based compressor (vectorized)
        threshold_comp = 10 ** (-20.0 / 20)
        ratio_comp = 2.5
        block_size = max(int(SR * 0.01), 1)
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
        
        smooth_n = max(int(SR * 0.015), 3)
        gain_curve = uf1d(gain_curve, size=smooth_n)
        y_converted = (y_converted * gain_curve).astype(np.float32)
        print(f"[INFO] ✅ Compressor (threshold=-20dB, ratio=2.5:1)")
        
        # 7) Reverb transfer — extract reverb from original vocal, apply to converted
        #    This makes the converted vocal sit naturally in the mix
        try:
            # Estimate reverb tail from original vocal
            # Use correlation between original and its delayed version
            orig_mono = y_original_vocal[:min(len(y_original_vocal), len(y_converted))]
            conv_len = min(len(y_converted), len(orig_mono))
            
            # Simple reverb estimation: spectral difference between original and dry
            S_orig = librosa.stft(orig_mono[:conv_len], n_fft=2048, hop_length=512)
            S_conv = librosa.stft(y_converted[:conv_len], n_fft=2048, hop_length=512)
            
            # Compute spectral envelope ratio (captures room response)
            mag_orig = np.abs(S_orig) + 1e-8
            mag_conv = np.abs(S_conv) + 1e-8
            
            # Smooth spectral envelope matching
            from scipy.ndimage import median_filter
            env_ratio = median_filter(mag_orig / mag_conv, size=(11, 5))
            env_ratio = np.clip(env_ratio, 0.5, 2.0)  # Gentle matching
            
            # Apply 30% of spectral matching (subtle, preserves converted character)
            S_matched = S_conv * (1.0 + 0.3 * (env_ratio - 1.0))
            y_converted_matched = librosa.istft(S_matched, hop_length=512, length=conv_len)
            y_converted[:conv_len] = y_converted_matched.astype(np.float32)
            
            print(f"[INFO] ✅ Spectral reverb matching (original vocal → converted)")
        except Exception as e:
            print(f"[INFO] ⚠️ Reverb matching skipped: {e}")
        
        # 8) Loudness normalize
        y_converted = loudness_normalize(y_converted, target_lufs=-11.0, sr=SR)
        print(f"[INFO] ✅ Loudness normalization (target=-11 LUFS)")
        
        # Peak limit vocal
        vpeak = np.abs(y_converted).max()
        if vpeak > 0.95:
            y_converted = y_converted / vpeak * 0.95
        
        # ====== ENSTRÜMANTAL İŞLEME ======
        for ch in range(y_instr_stereo.shape[0]):
            y_instr_stereo[ch] = loudness_normalize(y_instr_stereo[ch], target_lufs=-16.0, sr=SR)
        print(f"[INFO] ✅ Enstrümantal normalize (-16 LUFS)")
        
        # ====== MİKSAJ ======
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
        
        # Stereo mix — vokal ortada, enstrümantal stereo
        vocal_gain = 1.0
        instr_gain = 0.70
        
        y_mixed = np.zeros((2, min_len), dtype=np.float32)
        y_mixed[0] = y_converted * vocal_gain + y_instr_stereo[0] * instr_gain
        y_mixed[1] = y_converted * vocal_gain + y_instr_stereo[1] * instr_gain
        
        # ====== MASTER LİMİTER (Vectorized) ======
        ceiling = 10 ** (-0.3 / 20)
        peak_env = np.max(np.abs(y_mixed), axis=0)
        limiter_gain = np.where(peak_env > ceiling, ceiling / (peak_env + 1e-10), 1.0).astype(np.float32)
        la_samples = max(int(SR * 0.005), 1)
        limiter_gain = mf1d(limiter_gain, size=la_samples)
        rel_samples = max(int(SR * 0.05), 1)
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
            "voice_file": voice_file.filename,
            "song_file": song_file.filename,
            "method": "OpenVoice V2 (Speaker Embedding + Normalizing Flow + HiFi-GAN)",
            "status": "completed",
            "output_file": str(out_path),
            "download_url": f"/api/download/cloned/{output_name}.wav",
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
