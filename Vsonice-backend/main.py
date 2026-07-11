import warnings
# Suppress Pydantic V2 protected namespace warnings from third-party libs (e.g. OpenVoice)
warnings.filterwarnings("ignore", message="Field \"model_.*\" has conflict with protected namespace")

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
async def generate_music(request: Request):
    """
    Profesyonel Enstrümantal Müzik Üreteci

    Programatik beat + bas + akor jenratörü.
    Genre presetleri ile gerçek müzik yapısı oluşturur.
    """
    import numpy as np
    import soundfile as sf

    body = await request.json()
    genre = body.get("genre", "pop")
    bpm = int(body.get("bpm", 120))
    key = body.get("key", "C")
    duration_sec = min(int(body.get("duration", 30)), 120)
    sr = 44100

    try:
        # Nota frekansları
        NOTE_FREQS = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
        }
        root_freq = NOTE_FREQS.get(key, 261.63)

        # Genre preset'leri
        GENRE_CONFIGS = {
            'pop':             {'swing': 0.0,  'kick_p': [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], 'snare_p': [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'hat_p': [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], 'chords': [0,5,3,4], 'bass_oct': 2, 'pad_vol': 0.12},
            'rock':            {'swing': 0.0,  'kick_p': [1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0], 'snare_p': [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,1], 'hat_p': [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], 'chords': [0,3,5,4], 'bass_oct': 2, 'pad_vol': 0.10},
            'anatolian_rock':  {'swing': 0.05, 'kick_p': [1,0,0,1,0,0,1,0,0,1,0,0,1,0,1,0], 'snare_p': [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1], 'hat_p': [1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,0], 'chords': [0,3,5,7], 'bass_oct': 2, 'pad_vol': 0.14},
            'arabesk':         {'swing': 0.08, 'kick_p': [1,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0], 'snare_p': [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'hat_p': [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], 'chords': [0,1,3,5], 'bass_oct': 2, 'pad_vol': 0.16},
            'electronic':      {'swing': 0.0,  'kick_p': [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], 'snare_p': [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'hat_p': [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], 'chords': [0,5,7,3], 'bass_oct': 1, 'pad_vol': 0.18},
            'rnb':             {'swing': 0.10, 'kick_p': [1,0,0,0,0,0,1,0,0,1,0,0,0,0,1,0], 'snare_p': [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'hat_p': [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], 'chords': [0,5,3,7], 'bass_oct': 2, 'pad_vol': 0.14},
            'hiphop':          {'swing': 0.12, 'kick_p': [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0], 'snare_p': [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'hat_p': [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1], 'chords': [0,3,5,3], 'bass_oct': 1, 'pad_vol': 0.10},
            'ballad':          {'swing': 0.0,  'kick_p': [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], 'snare_p': [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'hat_p': [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], 'chords': [0,5,3,4], 'bass_oct': 2, 'pad_vol': 0.18},
        }
        cfg = GENRE_CONFIGS.get(genre, GENRE_CONFIGS['pop'])

        total_samples = int(duration_sec * sr)
        beat_dur = 60.0 / bpm  # seconds per beat
        sixteenth = beat_dur / 4  # 16th note

        # — Synth helpers —
        def sine(freq, dur, vol=0.5):
            t = np.arange(int(sr * dur)) / sr
            env = np.minimum(t / 0.005, 1.0) * np.minimum((dur - t) / 0.02, 1.0)
            env = np.clip(env, 0, 1)
            return (np.sin(2 * np.pi * freq * t) * vol * env).astype(np.float32)

        def noise_burst(dur, vol=0.3):
            n = int(sr * dur)
            t = np.arange(n) / sr
            env = np.exp(-t * 40)
            return (np.random.randn(n).astype(np.float32) * vol * env)

        def kick(vol=0.7):
            dur = 0.15
            t = np.arange(int(sr * dur)) / sr
            freq = 150 * np.exp(-t * 30) + 45
            env = np.exp(-t * 15)
            return (np.sin(2 * np.pi * np.cumsum(freq) / sr) * vol * env).astype(np.float32)

        def snare(vol=0.5):
            tone = sine(200, 0.08, 0.3)
            ns = noise_burst(0.1, 0.5)
            out = np.zeros(max(len(tone), len(ns)), dtype=np.float32)
            out[:len(tone)] += tone
            out[:len(ns)] += ns
            return out * vol

        def hihat(vol=0.25):
            return noise_burst(0.04, vol)

        # Scale intervals (major/minor)
        major = [0, 2, 4, 5, 7, 9, 11]
        minor = [0, 2, 3, 5, 7, 8, 10]
        is_minor = genre in ['arabesk', 'rock', 'anatolian_rock', 'rnb', 'hiphop']
        scale = minor if is_minor else major

        def scale_freq(degree, octave=4):
            """Get frequency from scale degree"""
            oct_shift = degree // len(scale)
            idx = degree % len(scale)
            semitones = scale[idx] + (octave - 4 + oct_shift) * 12
            return root_freq * (2.0 ** (semitones / 12.0))

        # — Generate tracks —
        drum_track = np.zeros(total_samples, dtype=np.float32)
        bass_track = np.zeros(total_samples, dtype=np.float32)
        pad_track = np.zeros(total_samples, dtype=np.float32)

        # Drums — loop the 16-step pattern
        steps_total = int(duration_sec / sixteenth)
        for step in range(steps_total):
            pos = int(step * sixteenth * sr)
            if pos >= total_samples:
                break
            si = step % 16
            swing_offset = int(cfg['swing'] * sixteenth * sr) if si % 2 == 1 else 0
            p = pos + swing_offset

            if cfg['kick_p'][si]:
                s = kick()
                end = min(p + len(s), total_samples)
                drum_track[p:end] += s[:end - p]
            if cfg['snare_p'][si]:
                s = snare()
                end = min(p + len(s), total_samples)
                drum_track[p:end] += s[:end - p]
            if cfg['hat_p'][si]:
                s = hihat()
                end = min(p + len(s), total_samples)
                drum_track[p:end] += s[:end - p]

        # Bass — follow chord progression (1 chord per bar)
        bar_dur = beat_dur * 4
        num_bars = int(duration_sec / bar_dur) + 1
        for bar in range(num_bars):
            chord_deg = cfg['chords'][bar % len(cfg['chords'])]
            bass_freq = scale_freq(chord_deg, cfg['bass_oct'])
            # 8th note bass pattern
            for eighth in range(8):
                t_start = bar * bar_dur + eighth * (beat_dur / 2)
                pos = int(t_start * sr)
                if pos >= total_samples:
                    break
                note_dur = beat_dur / 2 * 0.8
                s = sine(bass_freq, note_dur, 0.35)
                end = min(pos + len(s), total_samples)
                bass_track[pos:end] += s[:end - pos]

        # Pad/Chord — sustained chords, 1 per bar
        for bar in range(num_bars):
            chord_deg = cfg['chords'][bar % len(cfg['chords'])]
            # Triad: root + 3rd + 5th
            freqs = [
                scale_freq(chord_deg, 4),
                scale_freq(chord_deg + 2, 4),
                scale_freq(chord_deg + 4, 4),
            ]
            pos = int(bar * bar_dur * sr)
            if pos >= total_samples:
                break
            chord_dur = bar_dur * 0.95
            for f in freqs:
                s = sine(f, chord_dur, cfg['pad_vol'])
                end = min(pos + len(s), total_samples)
                pad_track[pos:end] += s[:end - pos]

        # — Mix all tracks —
        mixed = drum_track + bass_track + pad_track

        # Normalize
        peak = np.abs(mixed).max()
        if peak > 0:
            mixed = mixed / peak * 0.85

        # Stereo: slight pan
        stereo = np.column_stack([
            mixed * 0.95 + np.roll(pad_track, int(0.01 * sr)) * 0.06,
            mixed * 0.95 + np.roll(pad_track, int(0.015 * sr)) * 0.06,
        ])
        peak2 = np.abs(stereo).max()
        if peak2 > 0.95:
            stereo = stereo / peak2 * 0.9

        # Save & return
        output_path = OUTPUT_DIR / "cloned" / f"generated_{genre}_{bpm}bpm_{int(datetime.now().timestamp())}.wav"
        sf.write(str(output_path), stereo, sr)

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"[MUSIC-GEN] Generated: {genre} {bpm}BPM {key} {duration_sec}s ({file_size_mb:.1f}MB)")

        return {
            "status": "success",
            "genre": genre,
            "bpm": bpm,
            "key": key,
            "duration": duration_sec,
            "download_url": f"/api/download/cloned/{output_path.name}",
            "filename": output_path.name,
            "size_mb": round(file_size_mb, 2),
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Müzik üretim hatası: {str(e)}")


@app.post("/api/convert/voice")
async def convert_voice(
    audio_file: UploadFile = File(...),
    voice_profile_id: str = Form(None),
    voice_model_id: str = Form(None),
    voice_file: UploadFile = File(None),
):
    """
    Ses Dönüştürme — OpenVoice V2 ile tek vokal dönüştürme.
    Sadece gelen ses dosyasının kimliğini değiştirir (separation yapmaz).
    """
    import numpy as np
    import soundfile as sf
    import librosa

    SR = 44100

    if voice_profile_id is None and voice_model_id is None and voice_file is None:
        raise HTTPException(status_code=400, detail="voice_profile_id, voice_model_id veya voice_file gerekli")

    try:
        # 1) Read input audio
        audio_bytes = await audio_file.read()
        audio_data, orig_sr = sf.read(io.BytesIO(audio_bytes))
        audio_data = audio_data.astype(np.float32)
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
        if orig_sr != SR:
            audio_data = librosa.resample(audio_data, orig_sr=orig_sr, target_sr=SR)

        # 2) Determine voice source
        cached_target_se = None
        source_name = "custom"

        if voice_model_id:
            from services.voice_model_trainer import get_trainer
            trainer = get_trainer()
            cached_target_se = trainer.get_model_embedding(voice_model_id)
            model_meta = trainer._load_metadata(voice_model_id)
            source_name = model_meta.get("name", voice_model_id) if model_meta else voice_model_id

        if voice_profile_id:
            profile_dir = VOICE_PROFILES_DIR / voice_profile_id
            meta_file = profile_dir / "metadata.json"
            if meta_file.exists():
                import torch
                meta = json.loads(meta_file.read_text(encoding='utf-8'))
                source_name = meta.get("name", voice_profile_id)
                emb_file = profile_dir / "speaker_embedding.pt"
                if emb_file.exists():
                    cached_target_se = torch.load(str(emb_file), map_location='cpu')

        # Voice file path for pipeline
        voice_path = None
        if voice_file is not None:
            vf_bytes = await voice_file.read()
            voice_path = TEMP_DIR / f"vc_voice_{int(datetime.now().timestamp() * 1000)}.wav"
            vf_data, vf_sr = sf.read(io.BytesIO(vf_bytes))
            vf_data = vf_data.astype(np.float32)
            if vf_data.ndim > 1:
                vf_data = vf_data.mean(axis=1)
            if vf_sr != SR:
                vf_data = librosa.resample(vf_data, orig_sr=vf_sr, target_sr=SR)
            sf.write(str(voice_path), vf_data, SR)
        elif voice_profile_id:
            profile_dir = VOICE_PROFILES_DIR / voice_profile_id
            for ext in ['wav', 'mp3', 'webm', 'ogg']:
                p = profile_dir / f"audio.{ext}"
                if p.exists():
                    voice_path = p
                    break

        if voice_path is None and cached_target_se is None:
            raise HTTPException(status_code=400, detail="Ses kaynağı bulunamadı")

        # 3) Save input as temp WAV for OpenVoice
        input_path = TEMP_DIR / f"vc_input_{int(datetime.now().timestamp() * 1000)}.wav"
        sf.write(str(input_path), audio_data, SR)

        # 4) Neural conversion — Seed-VC birincil, OpenVoice V2 fallback
        output_path = OUTPUT_DIR / "cloned" / f"converted_{source_name}_{int(datetime.now().timestamp())}.wav"

        from services.neural_voice_service import neural_convert_singing, is_neural_available

        converted_audio = None
        if is_neural_available() and voice_path is not None:
            ref_wav = convert_audio_to_wav(Path(voice_path))
            if neural_convert_singing(
                source_path=str(input_path),
                reference_path=str(ref_wav),
                output_path=str(output_path),
                diffusion_steps=50,
                singing=True,
            ):
                converted_audio, _ = sf.read(str(output_path))
                converted_audio = converted_audio.astype(np.float32)

        if converted_audio is None:
            print("[CONVERT-VOICE] ⚠️ Seed-VC kullanılamadı, OpenVoice V2 fallback...")
            from services.openvoice_service import get_openvoice_service
            ov = get_openvoice_service()

            converted_audio = ov.convert_voice(
                source_audio_path=str(input_path),
                target_voice_path=str(voice_path) if voice_path else None,
                output_path=str(output_path),
                cached_target_se=cached_target_se,
                tau=0.12,
            )

        # 5) Normalize output
        if isinstance(converted_audio, np.ndarray):
            result_audio = converted_audio
        else:
            result_audio, _ = sf.read(str(output_path))
            result_audio = result_audio.astype(np.float32)

        result_audio = normalize_audio(result_audio)
        sf.write(str(output_path), result_audio, SR)

        file_size_mb = output_path.stat().st_size / (1024 * 1024)

        # Cleanup temp
        for tf in [input_path, voice_path if voice_file else None]:
            if tf and tf.exists() and TEMP_DIR in tf.parents:
                try: tf.unlink()
                except: pass

        return {
            "status": "success",
            "source_voice": source_name,
            "duration": round(len(result_audio) / SR, 2),
            "download_url": f"/api/download/cloned/{output_path.name}",
            "filename": output_path.name,
            "size_mb": round(file_size_mb, 2),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Ses dönüştürme hatası: {str(e)}")


@app.get("/api/models")
async def list_models():
    """List available models for all services"""
    # Get real voice profiles
    profiles = []
    if VOICE_PROFILES_DIR.exists():
        for d in sorted(VOICE_PROFILES_DIR.iterdir()):
            if d.is_dir():
                meta_file = d / "metadata.json"
                if meta_file.exists():
                    meta = json.loads(meta_file.read_text(encoding='utf-8'))
                    profiles.append({"id": d.name, "name": meta.get("name", d.name)})

    # Get real trained models
    trained = []
    tm_dir = OUTPUT_DIR / "trained_models"
    if tm_dir.exists():
        for d in sorted(tm_dir.iterdir()):
            if d.is_dir():
                meta_file = d / "metadata.json"
                if meta_file.exists():
                    meta = json.loads(meta_file.read_text(encoding='utf-8'))
                    trained.append({"id": d.name, "name": meta.get("name", d.name)})

    return {
        "voice_profiles": profiles,
        "trained_models": trained,
        "demucs_models": ["htdemucs", "htdemucs_ft", "htdemucs_6s"],
        "music_genres": ["pop", "rock", "anatolian_rock", "arabesk", "electronic", "rnb", "hiphop", "ballad"],
        "master_presets": ["balanced", "vocal_forward", "instrumental_forward", "radio", "cinematic", "raw"],
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
    voiceProfileId: Optional[str] = None
    voiceModelId: Optional[str] = None
    speed: str = "medium"
    language: str = "tr"
    melodyIntensity: float = 0.7  # 0-1 (V6 default: 0.7)
    key: str = "C"
    bpm: int = 120
    genre: str = "pop"
    style: str = ""     # Serbest stil tarifi: "türk pop, enerjik, duygusal"
    mood: str = ""      # Mood preset: energetic, melancholic, romantic, dark, happy, chill, powerful, dreamy
    sections: Optional[List[dict]] = None
    vocoder_type: str = "auto"  # "world", "neural", "auto"


@app.post("/api/generate/text-to-song")
async def generate_text_to_song(request: TextToSongRequest):
    """
    Metinden şarkı vokali oluştur (V7 Pipeline — WORLD Vocoder Singing).

    V7 Pipeline:
    1. Metin bölümleme + stil parsing
    2. Per-section TTS prosody ile ekspresif sentez
    3. WORLD vocoder ile gerçek şarkı sentezi (pitch replace + vowel stretch)
    4. OpenVoice V2 ile ses dönüşümü (opsiyonel)
    5. Stüdyo mastering (EQ → Kompresyon → De-Esser → Reverb → Limiter)
    """
    import edge_tts
    import soundfile as sf
    import numpy as np
    import librosa
    import torch

    if not request.text or len(request.text.strip()) < 2:
        raise HTTPException(status_code=400, detail="Lütfen en az 2 karakter girin")

    try:
        timestamp = int(datetime.now().timestamp() * 1000)

        # ============================================================
        # STEP 0: Metin bölümleme — V20: Sadece metin tagları kullanılır
        # ============================================================
        from services.melody_engine import (
            parse_sections, get_section_prosody,
            speech_to_singing, master_vocal, get_genre,
            get_performance_override, PERFORMANCE_TAGS, get_perf_tts_prosody,
            align_tts_to_bpm, syllabify_turkish_ex
        )

        # V20: Genre/mood/style devre dışı — tek preset kullanılır
        genre = 'pop'

        # BPM — kullanıcı ayarı doğrudan kullanılır
        bpm = max(60, min(200, request.bpm))

        # Parse sections — inline [tag]'lar ile bölümleme + performans etiketleri
        if request.sections and len(request.sections) > 0:
            sections = [(s.get('type', 'verse'), s.get('text', ''), s.get('perf_tag', None)) for s in request.sections if s.get('text', '').strip()]
        else:
            sections = parse_sections(request.text)
        if not sections:
            sections = [('verse', request.text.strip(), None)]

        has_voice = bool(request.voiceProfileId or request.voiceModelId)

        # Intensity — doğrudan kullanıcı ayarı
        melody_intensity = max(0.0, min(1.0, request.melodyIntensity))

        genre_info = get_genre()
        total_steps = 5 if has_voice else 4

        print(f"\n{'='*60}")
        print(f"[TEXT-TO-SONG V22] 🎤 Metin → Şarkı (Turkish Singing Quality Pipeline)")
        print(f"[INFO] Melodi: %{int(melody_intensity*100)} | Anahtar: {request.key} | BPM: {bpm}")
        print(f"[INFO] Bölümler: {', '.join(t + (f'({p})' if p else '') for t, _, p in sections)}")
        print(f"[INFO] Pipeline: TTS(prosody) → WORLD Singing → {'SesDönüşümü → ' if has_voice else ''}Mastering")
        print(f"{'='*60}")

        # ============================================================
        # STEP 1: Per-Section TTS Prosody ile ekspresif sentez
        # V6: Her bölüm farklı pitch/rate ile sentezlenir
        # Nakarat = yüksek enerji, kuple = sakin, köprü = farklı ton
        # ============================================================
        tts_voices = {
            "tr": "tr-TR-AhmetNeural", "tr-female": "tr-TR-EmelNeural",
            "en": "en-US-GuyNeural", "en-female": "en-US-JennyNeural",
        }
        tts_voice = tts_voices.get(request.language, "tr-TR-AhmetNeural")
        speed_map = {"slow": "-20%", "medium": "+0%", "fast": "+20%"}
        base_rate = speed_map.get(request.speed, "+0%")
        combine_sr = 22050

        print(f"[STEP 1/{total_steps}] 🗣️ Per-section TTS prosody ile sentez...")

        section_audios = []
        temp_tts_files = []
        pause_samples = int(0.15 * combine_sr)  # 150ms inter-section pause (şarkı akışı)

        for i, (sec_type, sec_text, sec_perf) in enumerate(sections):
            # Get genre-specific prosody for this section type
            prosody = get_section_prosody(sec_type, genre)

            # Combine base rate with prosody rate
            p_rate = prosody.get('rate', '+0%')
            p_pitch = prosody.get('pitch', '+0Hz')

            # V6: Performance tag TTS override — [rap] hızlı, [whisper] yavaş/alçak
            perf_tts = get_perf_tts_prosody(sec_perf)
            if perf_tts:
                p_rate = perf_tts.get('rate', p_rate)
                p_pitch = perf_tts.get('pitch', p_pitch)
                print(f"[PERF-TTS] [{sec_perf}] → rate={p_rate}, pitch={p_pitch}")

            # For rate: combine base_rate and prosody rate  
            # Simple approach: use prosody rate if non-zero, else base_rate
            effective_rate = p_rate if base_rate == '+0%' else base_rate
            effective_pitch = p_pitch

            # V3: Neural vocoder → genre/speed-based rate'i post-stretch için sakla
            # AMA perf-tag rate'ini TTS'e doğrudan ver (rap hızı, whisper yavaşlığı korunmalı)
            _original_rate_val = 0
            if request.vocoder_type in ('neural', 'auto'):
                import re as _re
                # Eğer perf_tag rate override varsa, TTS'e perf rate ver, genre rate'i sakla
                if perf_tts and perf_tts.get('rate'):
                    # Genre/speed rate → post-stretch olarak sakla
                    genre_rate = prosody.get('rate', '+0%')
                    if base_rate != '+0%':
                        genre_rate = base_rate
                    rate_match = _re.match(r'([+-]?\d+)%', genre_rate)
                    if rate_match:
                        _original_rate_val = int(rate_match.group(1))
                    # Perf tag rate doğrudan TTS'e gider (rap=+35%, whisper=-20%)
                    effective_rate = perf_tts['rate']
                else:
                    rate_match = _re.match(r'([+-]?\d+)%', effective_rate)
                    if rate_match:
                        _original_rate_val = int(rate_match.group(1))
                    effective_rate = '+0%'

            sec_mp3 = TEMP_DIR / f"tts_sec_{timestamp}_{i}.mp3"
            try:
                comm = edge_tts.Communicate(sec_text, tts_voice, rate=effective_rate, pitch=effective_pitch)
                await comm.save(str(sec_mp3))
                sec_wav = convert_audio_to_wav(sec_mp3)
                y_sec, _ = librosa.load(str(sec_wav), sr=combine_sr, mono=True)
                section_audios.append((sec_type, y_sec, sec_perf, sec_text, _original_rate_val))
                temp_tts_files.extend([sec_mp3, Path(sec_wav)])
                print(f"[INFO] ✅ {sec_type}{f'[{sec_perf}]' if sec_perf else ''} #{i+1}: {len(y_sec)/combine_sr:.1f}s (pitch={p_pitch}, rate={effective_rate}, original_rate={_original_rate_val}%)")
            except Exception as e:
                print(f"[WARNING] Section {i+1} TTS hatası: {e}, fallback...")
                # Fallback: no prosody
                comm = edge_tts.Communicate(sec_text, tts_voice, rate=base_rate)
                await comm.save(str(sec_mp3))
                sec_wav = convert_audio_to_wav(sec_mp3)
                y_sec, _ = librosa.load(str(sec_wav), sr=combine_sr, mono=True)
                section_audios.append((sec_type, y_sec, sec_perf, sec_text, 0))
                temp_tts_files.extend([sec_mp3, Path(sec_wav)])

        total_tts_dur = sum(len(y) for _, y, _, _, _ in section_audios) / combine_sr
        print(f"[INFO] ✅ TTS tamamlandı! Toplam: {total_tts_dur:.1f}s | {len(sections)} bölüm")

        # ============================================================
        # STEP 2: Singing Engine (TTS üzerinde, per-section)
        # V6: Her bölüm zaten ayrı audio → doğrudan işle
        # Phase vocoder doğal TTS harmonikleri üzerinde çalışır
        # ============================================================
        if melody_intensity > 0:
            print(f"\n[STEP 2/{total_steps}] 🎵 V11 Coupled Expressive WORLD Vocoder singing (per-section)...")

            melodic_sections = []
            for sec_type, y_sec, sec_perf, sec_text, sec_rate_pct in section_audios:
                if len(y_sec) < combine_sr * 0.2:
                    melodic_sections.append(y_sec)
                    continue
                try:
                    # V19: BPM pre-alignment — post-stretch kompanzasyonlu
                    if sec_text and sec_text.strip():
                        try:
                            syllables_bpm, is_word_last_bpm = syllabify_turkish_ex(sec_text)
                            if len(syllables_bpm) >= 2:
                                # V19: Neural path post-stretch'i hesaba kat
                                effective_bpm = bpm
                                if sec_rate_pct != 0 and request.vocoder_type in ('neural', 'auto'):
                                    post_stretch_rate = 1.0 + sec_rate_pct / 100.0
                                    if abs(post_stretch_rate - 1.0) > 0.005:
                                        effective_bpm = bpm / post_stretch_rate
                                y_sec = align_tts_to_bpm(
                                    y_sec, combine_sr, effective_bpm, syllables_bpm,
                                    is_word_last=is_word_last_bpm
                                )
                                print(f"[INFO] ⏱️ BPM pre-align: {len(syllables_bpm)} hece → {effective_bpm:.0f} BPM (effective) grid'e hizalandı")
                        except Exception as e:
                            print(f"[WARNING] BPM pre-align atlandı: {e}")

                    processed = speech_to_singing(
                        y_sec, combine_sr, sec_type, melody_intensity,
                        request.key, bpm, genre, perf_tag=sec_perf, text=sec_text,
                        vocoder_type=request.vocoder_type
                    )

                    # V3: Post-Vocos time stretch (formant-preserving)
                    # TTS'den normal hızda alındı, şimdi orijinal rate'i uygula
                    if sec_rate_pct != 0 and request.vocoder_type in ('neural', 'auto'):
                        # rate=-10% → %10 yavaşlama → stretch_rate=0.9 → dur×1.111
                        stretch_rate = 1.0 + sec_rate_pct / 100.0
                        if abs(stretch_rate - 1.0) > 0.005:
                            processed = librosa.effects.time_stretch(processed, rate=stretch_rate)
                            print(f"[INFO] ⏱️ Post-Vocos time-stretch: {sec_rate_pct:+d}% → rate={stretch_rate:.3f}")

                    melodic_sections.append(processed)
                    print(f"[INFO] ✅ {sec_type}{f'[{sec_perf}]' if sec_perf else ''}: {len(y_sec)/combine_sr:.1f}s → {len(processed)/combine_sr:.1f}s")
                except Exception as e:
                    print(f"[WARNING] {sec_type} melodi hatası: {e}")
                    melodic_sections.append(y_sec)

            # Concatenate with pauses
            all_parts = []
            pause = np.zeros(pause_samples, dtype=np.float32)
            for j, seg in enumerate(melodic_sections):
                all_parts.append(seg)
                if j < len(melodic_sections) - 1:
                    all_parts.append(pause)
            y_melodic = np.concatenate(all_parts) if all_parts else np.concatenate([y for _, y, _, _, _ in section_audios])
            print(f"[INFO] ✅ Melodi tamamlandı! {len(y_melodic)/combine_sr:.1f}s")
        else:
            parts = []
            pause = np.zeros(pause_samples, dtype=np.float32)
            for j, (_, y_sec, _, _, _) in enumerate(section_audios):
                parts.append(y_sec)
                if j < len(section_audios) - 1:
                    parts.append(pause)
            y_melodic = np.concatenate(parts)
            print(f"\n[STEP 2/{total_steps}] ⏭️ Melodi yoğunluğu 0, atlanıyor")

        # ============================================================
        # STEP 3: OpenVoice V2 ile ses dönüşümü (opsiyonel)
        # V6: HiFi-GAN EN SON çalışır → temiz ses
        # ============================================================
        voice_source_name = "TTS Orijinal"
        y_final = y_melodic
        final_sr = combine_sr

        if has_voice:
            print(f"\n[STEP 3/{total_steps}] 🧠 Neural ses dönüşümü...")

            from services.neural_voice_service import (
                neural_convert_singing, is_neural_available, find_reference_audio
            )

            # Referans ses dosyasını bul (Seed-VC için) + isim
            reference_audio = None
            if request.voiceModelId:
                from services.voice_model_trainer import get_trainer
                trainer = get_trainer()
                model_meta = trainer._load_metadata(request.voiceModelId)
                voice_source_name = model_meta.get("name", request.voiceModelId) if model_meta else request.voiceModelId
                model_dir = OUTPUT_DIR / "trained_models" / request.voiceModelId
                if model_dir.exists():
                    from services.neural_voice_service import best_model_reference
                    reference_audio = best_model_reference(model_dir) or find_reference_audio(model_dir)
                print(f"[INFO] 🎓 Eğitilmiş model: {voice_source_name}")
            elif request.voiceProfileId:
                profile_dir = VOICE_PROFILES_DIR / request.voiceProfileId
                if not profile_dir.exists():
                    raise HTTPException(status_code=404, detail=f"Ses profili bulunamadı: {request.voiceProfileId}")
                reference_audio = find_reference_audio(profile_dir)
                meta_path = profile_dir / "metadata.json"
                if meta_path.exists():
                    with open(meta_path, "r", encoding="utf-8") as mf:
                        meta = json.load(mf)
                    voice_source_name = meta.get("name", request.voiceProfileId)
                print(f"[INFO] 🎤 Ses profili: {voice_source_name}")

            melodic_path = TEMP_DIR / f"melodic_{timestamp}.wav"
            sf.write(str(melodic_path), y_melodic, combine_sr)

            converted_path = TEMP_DIR / f"converted_{timestamp}.wav"
            neural_ok = False

            # 1) Seed-VC (f0-conditioned singing model, 44.1kHz) — birincil yol
            if is_neural_available() and reference_audio is not None:
                ref_wav = convert_audio_to_wav(Path(reference_audio))
                neural_ok = neural_convert_singing(
                    source_path=str(melodic_path),
                    reference_path=str(ref_wav),
                    output_path=str(converted_path),
                    diffusion_steps=50,
                    singing=True,
                )
                if neural_ok:
                    y_final, final_sr = sf.read(str(converted_path))
                    y_final = y_final.astype(np.float32)
                    if y_final.ndim > 1:
                        y_final = y_final.mean(axis=1)
                    print(f"[INFO] ✅ Seed-VC ses dönüşümü tamamlandı! {len(y_final)/final_sr:.1f}s")

            # 2) Fallback: OpenVoice V2 (tone color transfer)
            if not neural_ok:
                print(f"[INFO] ⚠️ Seed-VC kullanılamadı, OpenVoice V2 fallback...")
                from services.openvoice_service import (
                    get_or_load_converter,
                    extract_speaker_embedding,
                    convert_voice_chunked
                )

                converter = get_or_load_converter()
                cached_target_se = None

                if request.voiceModelId:
                    cached_target_se = trainer.get_model_embedding(request.voiceModelId)
                elif request.voiceProfileId:
                    profile_dir = VOICE_PROFILES_DIR / request.voiceProfileId
                    embedding_path = profile_dir / "speaker_embedding.npy"
                    if embedding_path.exists():
                        cached_target_se = torch.from_numpy(np.load(str(embedding_path)))
                        if torch.cuda.is_available():
                            cached_target_se = cached_target_se.cuda()
                    elif reference_audio is not None:
                        cached_target_se = extract_speaker_embedding(str(reference_audio), converter, is_target=True)
                    else:
                        raise HTTPException(status_code=404, detail=f"Ses profili sesi bulunamadı: {request.voiceProfileId}")

                source_se = extract_speaker_embedding(str(melodic_path), converter, is_target=False)
                y_final, final_sr = convert_voice_chunked(
                    source_audio_path=str(melodic_path),
                    source_se=source_se,
                    target_se=cached_target_se,
                    output_path=str(converted_path),
                    tau=0.25,
                    converter=converter
                )
                print(f"[INFO] ✅ OpenVoice ses dönüşümü tamamlandı! {len(y_final)/final_sr:.1f}s")

        # ============================================================
        # STEP FINAL: Stüdyo Mastering (V6 — Suno-Quality)
        # EQ → Kompresyon → De-Esser → Reverb → LUFS → Peak Limiter
        # ============================================================
        mastering_step = total_steps
        print(f"\n[STEP {mastering_step}/{total_steps}] 🎛️ Stüdyo mastering...")
        print(f"[SR-AUDIT] pre-mastering: shape={y_final.shape}, sr={final_sr}, peak={np.abs(y_final).max():.4f}")

        SR = 44100
        if final_sr != SR:
            y_final = librosa.resample(y_final, orig_sr=final_sr, target_sr=SR, res_type='soxr_vhq')
            print(f"[SR-AUDIT] resampled to {SR}: shape={y_final.shape}")

        y_final = master_vocal(y_final, SR,
                               neural_vocoder=(request.vocoder_type in ('neural', 'auto')))
        print(f"[SR-AUDIT] post-mastering: shape={y_final.shape}, sr={SR}, peak={np.abs(y_final).max():.4f}")
        print(f"[INFO] ✅ Mastering tamamlandı! (EQ + Kompresyon + De-Esser + Reverb + Limiter)")

        # Save final
        final_filename = f"textsong_{timestamp}.wav"
        final_path = CLONED_DIR / final_filename
        sf.write(str(final_path), y_final, SR)

        duration = len(y_final) / SR
        file_size_mb = os.path.getsize(str(final_path)) / (1024 * 1024)

        # Temp cleanup
        temp_cleanup = list(temp_tts_files)
        if has_voice:
            temp_cleanup.extend([
                TEMP_DIR / f"melodic_{timestamp}.wav",
                TEMP_DIR / f"converted_{timestamp}.wav"
            ])
        for tmp in temp_cleanup:
            try:
                p = Path(tmp) if not isinstance(tmp, Path) else tmp
                if p.exists():
                    p.unlink()
            except Exception:
                pass

        print(f"\n{'='*60}")
        print(f"[SUCCESS] ✅ Metin → Şarkı tamamlandı! (V7 WORLD Vocoder Singing)")
        print(f"[INFO] Süre: {duration:.1f}s | Boyut: {file_size_mb:.1f}MB | Ses: {voice_source_name}")
        print(f"[INFO] Tür: {genre_info['name']} | BPM: {bpm}")
        print(f"{'='*60}")

        return {
            "message": "Şarkı vokali başarıyla oluşturuldu!",
            "status": "completed",
            "filename": final_filename,
            "download_url": f"/api/download/cloned/{final_filename}",
            "duration": round(duration, 1),
            "size_mb": round(file_size_mb, 2),
            "voice_name": voice_source_name,
            "text_length": sum(len(t) for _, t, _ in sections),
            "sections": [{"type": t, "text": txt[:50], "perf_tag": p} for t, txt, p in sections],
            "melody_intensity": round(melody_intensity, 2),
            "key": request.key,
            "bpm": bpm,
            "sections": [{"type": t, "text": txt[:50], "perf_tag": p} for t, txt, p in sections],
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Vokal oluşturma hatası: {str(e)}")


# ========================
# VOCAL EDITOR (DAW-style region-based effects)
# ========================

import time as _time

# In-memory editor sessions
_editor_sessions: dict = {}

class _EditorSession:
    def __init__(self, audio, sr: int, source_path: str):
        import numpy as np
        self.audio = audio.astype(np.float32).copy()
        self.sr = sr
        self.source_path = source_path
        self.history: list = []
        self.created_at = _time.time()

    def push_undo(self):
        if len(self.history) > 20:
            self.history.pop(0)
        self.history.append(self.audio.copy())

    def undo(self) -> bool:
        if self.history:
            self.audio = self.history.pop()
            return True
        return False


def _cleanup_old_editor_sessions():
    now = _time.time()
    to_remove = [sid for sid, s in _editor_sessions.items() if now - s.created_at > 1800]
    for sid in to_remove:
        del _editor_sessions[sid]


class VocalEditorInitRequest(BaseModel):
    audio_path: str


class VocalEditorEffectRequest(BaseModel):
    session_id: str
    start_time: float = 0
    end_time: float = -1
    effects: List[dict]
    crossfade_ms: int = 30


class VocalEditorUndoRequest(BaseModel):
    session_id: str


class VocalEditorExportRequest(BaseModel):
    session_id: str
    filename: str = ""


@app.post("/api/vocal-editor/init")
async def vocal_editor_init(req: VocalEditorInitRequest):
    """Initialize a vocal editor session from an existing audio file"""
    import numpy as np
    import soundfile as sf

    _cleanup_old_editor_sessions()

    # Resolve path — audio_path is relative to OUTPUT_DIR (e.g. "cloned/textsong_xxx.wav")
    audio_path = OUTPUT_DIR / req.audio_path
    if not audio_path.exists():
        raise HTTPException(404, f"Audio dosyası bulunamadı: {req.audio_path}")

    # Security: ensure path is within OUTPUT_DIR
    try:
        audio_path.resolve().relative_to(OUTPUT_DIR.resolve())
    except ValueError:
        raise HTTPException(400, "Geçersiz dosya yolu")

    audio, sr = sf.read(str(audio_path))
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float32)

    session_id = f"ve_{int(datetime.now().timestamp() * 1000)}"
    _editor_sessions[session_id] = _EditorSession(audio, sr, str(audio_path))

    print(f"[VOCAL-EDITOR] ✅ Session created: {session_id} ({len(audio)/sr:.1f}s @ {sr}Hz)")

    return {
        "session_id": session_id,
        "duration": round(len(audio) / sr, 3),
        "sample_rate": sr,
        "history_size": 0,
    }


@app.post("/api/vocal-editor/upload")
async def vocal_editor_upload(file: UploadFile = File(...)):
    """Upload an audio file and create an editor session"""
    import numpy as np
    import soundfile as sf

    _cleanup_old_editor_sessions()

    # Save to temp
    timestamp = int(datetime.now().timestamp() * 1000)
    temp_path = TEMP_DIR / f"ve_upload_{timestamp}_{file.filename}"
    content = await file.read()
    with open(str(temp_path), "wb") as f:
        f.write(content)

    try:
        audio, sr = sf.read(str(temp_path))
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(400, "Geçersiz ses dosyası")

    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float32)

    session_id = f"ve_{timestamp}"
    _editor_sessions[session_id] = _EditorSession(audio, sr, str(temp_path))

    print(f"[VOCAL-EDITOR] ✅ Upload session: {session_id} ({len(audio)/sr:.1f}s)")

    return {
        "session_id": session_id,
        "duration": round(len(audio) / sr, 3),
        "sample_rate": sr,
        "history_size": 0,
    }


@app.get("/api/vocal-editor/audio/{session_id}")
async def vocal_editor_get_audio(session_id: str):
    """Stream the current audio for a session"""
    import soundfile as sf

    session = _editor_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Editor oturumu bulunamadı")

    buf = io.BytesIO()
    sf.write(buf, session.audio, session.sr, format='WAV')
    buf.seek(0)

    return StreamingResponse(buf, media_type="audio/wav",
                             headers={"Content-Disposition": f"inline; filename=edit_{session_id}.wav"})


@app.post("/api/vocal-editor/apply-effect")
async def vocal_editor_apply_effect(req: VocalEditorEffectRequest):
    """Apply effects to a region of the audio"""
    import numpy as np

    session = _editor_sessions.get(req.session_id)
    if not session:
        raise HTTPException(404, "Editor oturumu bulunamadı")

    session.push_undo()

    audio = session.audio
    sr = session.sr
    end_time = req.end_time if req.end_time >= 0 else len(audio) / sr

    start_sample = max(0, int(req.start_time * sr))
    end_sample = min(len(audio), int(end_time * sr))

    if end_sample <= start_sample:
        raise HTTPException(400, "Geçersiz bölge")

    region = audio[start_sample:end_sample].copy()

    for effect in req.effects:
        etype = effect.get("type", "")
        params = effect.get("params", {})

        if etype == "volume":
            gain_db = float(params.get("gain_db", 0))
            region = region * (10 ** (gain_db / 20))

        elif etype == "fade_in":
            dur = min(float(params.get("duration", 0.5)), len(region) / sr)
            n = max(1, int(dur * sr))
            region[:n] *= np.linspace(0, 1, n, dtype=np.float32)

        elif etype == "fade_out":
            dur = min(float(params.get("duration", 0.5)), len(region) / sr)
            n = max(1, int(dur * sr))
            region[-n:] *= np.linspace(1, 0, n, dtype=np.float32)

        elif etype == "eq":
            from scipy.signal import butter, sosfiltfilt
            for band, freq_args in [
                ("bass", dict(N=2, Wn=300, btype='low')),
                ("mid", dict(N=2, Wn=[300, 4000], btype='band')),
                ("treble", dict(N=2, Wn=4000, btype='high')),
            ]:
                db = float(params.get(band, 0))
                if db == 0:
                    continue
                sos = butter(**freq_args, fs=sr, output='sos')
                band_sig = sosfiltfilt(sos, region).astype(np.float32)
                gain = 10 ** (db / 20) - 1
                region = region + band_sig * gain

        elif etype == "reverb":
            mix = float(params.get("mix", 0.3))
            decay = float(params.get("decay", 1.5))
            if mix > 0:
                ir_len = int(min(decay, 4) * sr)
                ir = np.random.RandomState(42).randn(ir_len).astype(np.float32)
                ir *= np.exp(-np.arange(ir_len, dtype=np.float32) / sr * (3.0 / max(decay, 0.1)))
                ir /= np.sqrt(np.sum(ir ** 2) + 1e-10)
                from scipy.signal import fftconvolve
                wet = fftconvolve(region, ir)[:len(region)].astype(np.float32)
                region = region * (1 - mix) + wet * mix

        elif etype == "compressor":
            threshold_db = float(params.get("threshold", -18))
            ratio = float(params.get("ratio", 4))
            threshold = 10 ** (threshold_db / 20)
            frame_size = max(1, int(0.01 * sr))
            for i in range(0, len(region), frame_size):
                chunk = region[i:i + frame_size]
                level = np.sqrt(np.mean(chunk ** 2) + 1e-10)
                if level > threshold:
                    target = threshold + (level - threshold) / ratio
                    region[i:i + frame_size] *= target / level

        elif etype == "pitch_shift":
            semitones = float(params.get("semitones", 0))
            if semitones != 0:
                import librosa
                region = librosa.effects.pitch_shift(region, sr=sr, n_steps=semitones).astype(np.float32)

        elif etype == "noise_reduction":
            strength = float(params.get("strength", 0.5))
            if strength > 0:
                try:
                    import noisereduce as nr
                    region = nr.reduce_noise(y=region, sr=sr, prop_decrease=strength).astype(np.float32)
                except ImportError:
                    pass

        elif etype == "de_esser":
            amount = float(params.get("amount", 0.5))
            if amount > 0:
                from scipy.signal import butter, sosfiltfilt
                sos = butter(4, [4000, 9000], btype='band', fs=sr, output='sos')
                sibilance = sosfiltfilt(sos, region).astype(np.float32)
                region = region - sibilance * amount * 0.7

        elif etype == "warmth":
            amount = float(params.get("amount", 0.5))
            if amount > 0:
                region = np.tanh(region * (1 + amount * 2)) / np.tanh(1 + amount * 2)
                from scipy.signal import butter, sosfiltfilt
                sos = butter(2, 300, btype='low', fs=sr, output='sos')
                low = sosfiltfilt(sos, region).astype(np.float32)
                region = (region + low * amount * 0.3).astype(np.float32)

        region = region.astype(np.float32)

    # Crossfade at boundaries for smooth transition
    cf = min(int(req.crossfade_ms / 1000 * sr), len(region) // 4)
    if cf > 0 and start_sample > 0:
        fade = np.linspace(0, 1, cf, dtype=np.float32)
        orig = audio[start_sample:start_sample + cf]
        region[:cf] = orig * (1 - fade) + region[:cf] * fade
    if cf > 0 and end_sample < len(audio):
        fade = np.linspace(1, 0, cf, dtype=np.float32)
        orig = audio[end_sample - cf:end_sample]
        region[-cf:] = region[-cf:] * fade + orig * (1 - fade)

    # Clip to prevent distortion
    peak = np.abs(region).max()
    if peak > 0.98:
        region = region / peak * 0.95

    session.audio = audio.copy()
    session.audio[start_sample:end_sample] = region

    effects_names = [e.get("type", "?") for e in req.effects]
    print(f"[VOCAL-EDITOR] ✅ Applied [{', '.join(effects_names)}] to {req.start_time:.1f}–{end_time:.1f}s (session {req.session_id})")

    return {
        "duration": round(len(session.audio) / sr, 3),
        "history_size": len(session.history),
    }


@app.post("/api/vocal-editor/undo")
async def vocal_editor_undo(req: VocalEditorUndoRequest):
    """Undo the last effect application"""
    session = _editor_sessions.get(req.session_id)
    if not session:
        raise HTTPException(404, "Editor oturumu bulunamadı")

    if not session.undo():
        raise HTTPException(400, "Geri alınacak işlem yok")

    print(f"[VOCAL-EDITOR] ↩ Undo (session {req.session_id}, remaining={len(session.history)})")

    return {
        "duration": round(len(session.audio) / session.sr, 3),
        "history_size": len(session.history),
    }


@app.post("/api/vocal-editor/export")
async def vocal_editor_export(req: VocalEditorExportRequest):
    """Export the edited audio as a final file"""
    import soundfile as sf

    session = _editor_sessions.get(req.session_id)
    if not session:
        raise HTTPException(404, "Editor oturumu bulunamadı")

    timestamp = int(datetime.now().timestamp() * 1000)
    filename = req.filename.strip() if req.filename else f"edited_{timestamp}.wav"
    if not filename.endswith('.wav'):
        filename += '.wav'

    # Sanitize filename
    safe_name = "".join(c for c in filename if c.isalnum() or c in "._- ").strip()
    if not safe_name:
        safe_name = f"edited_{timestamp}.wav"

    output_path = CLONED_DIR / safe_name
    sf.write(str(output_path), session.audio, session.sr)

    file_size_mb = os.path.getsize(str(output_path)) / (1024 * 1024)
    print(f"[VOCAL-EDITOR] 📥 Export: {safe_name} ({file_size_mb:.1f}MB)")

    return {
        "download_url": f"/api/download/cloned/{safe_name}",
        "filename": safe_name,
        "duration": round(len(session.audio) / session.sr, 3),
        "size_mb": round(file_size_mb, 2),
    }


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
            se = extract_speaker_embedding(str(audio_path), converter, is_target=True)
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
            # Kalite skoru x süre puanına göre en iyi örnek (varsa 44.1kHz HQ kopya)
            from services.neural_voice_service import best_model_reference
            voice_path = best_model_reference(model_dir)
            
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

        # htdemucs_ft: fine-tuned model — daha temiz vokal izolasyonu (4x yavaş ama kalite öncelikli)
        demucs_separate_stems(song_path, "htdemucs_ft", demucs_output)

        vocals_path = demucs_output / "vocals.wav"
        music_path = demucs_output / "music.wav"

        if not vocals_path.exists():
            raise Exception("Demucs vokal ayırma başarısız")

        # NOT: Vokal gate kaldırıldı — htdemucs_ft yeterince temiz ayırıyor ve
        # gate her türlü ayarda kelime içi kesiklik (kekeleme hissi) riski taşıyor.
        
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
        
        print(f"\n[STEP 2/4] 🧠 Neural Singing Voice Conversion...")

        from services.neural_voice_service import neural_convert_singing, is_neural_available

        converted_vocal_path = str(TEMP_DIR / "converted_vocal.wav")
        y_converted = None
        conv_sr = SR

        # Vokal ön işleme: Demucs artıkları RMVPE perde takibini yanıltıp
        # ses kısılması/cızırtı yaratıyor -> lowcut + normalize + gürültü tabanı temizliği
        vocals_clean_path = TEMP_DIR / "vocals_clean.wav"
        try:
            from scipy.signal import butter as _butter, sosfiltfilt as _sosff
            _sos = _butter(4, 60, btype='high', fs=SR, output='sos')
            y_vc_clean = _sosff(_sos, y_original_vocal).astype(np.float32)
            # RMS normalize (perde takibi düşük seviyede zayıflıyor)
            _rms = float(np.sqrt(np.mean(y_vc_clean ** 2)))
            if _rms > 1e-6:
                y_vc_clean *= min(0.15 / _rms, 10.0)
            _peak = float(np.abs(y_vc_clean).max())
            if _peak > 0.95:
                y_vc_clean *= 0.95 / _peak
            sf.write(str(vocals_clean_path), y_vc_clean, SR)
        except Exception as _e:
            print(f"[WARNING] Vokal ön işleme atlandı: {_e}")
            vocals_clean_path = Path(vocals_path)

        # Birincil yol: Seed-VC (f0-conditioned singing model, 44.1kHz, diffusion)
        if is_neural_available() and voice_path is not None:
            ref_wav = convert_audio_to_wav(Path(voice_path))
            if neural_convert_singing(
                source_path=str(vocals_clean_path),
                reference_path=str(ref_wav),
                output_path=converted_vocal_path,
                diffusion_steps=50,
                singing=True,
            ):
                y_converted, conv_sr = sf.read(converted_vocal_path)
                y_converted = y_converted.astype(np.float32)
                if y_converted.ndim > 1:
                    y_converted = y_converted.mean(axis=1)
                print(f"[INFO] ✅ Seed-VC singing conversion tamamlandı!")

        # Fallback: OpenVoice V2 (tone color transfer)
        if y_converted is None:
            print(f"[INFO] ⚠️ Seed-VC kullanılamadı, OpenVoice V2 fallback...")
            from services.openvoice_service import (
                get_or_load_converter,
                extract_speaker_embedding,
                convert_voice_chunked
            )

            converter = get_or_load_converter()

            if cached_target_se is not None:
                target_se = cached_target_se
            else:
                target_se = extract_speaker_embedding(str(voice_path), converter, is_target=True)

            source_se = extract_speaker_embedding(str(vocals_path), converter, is_target=False)

            print(f"\n[STEP 3/4] 🎵 Neural ses dönüşümü yapılıyor (OpenVoice)...")
            y_converted, conv_sr = convert_voice_chunked(
                source_audio_path=str(vocals_path),
                source_se=source_se,
                target_se=target_se,
                output_path=converted_vocal_path,
                tau=0.12,
                converter=converter
            )

        # High-quality resample to project sample rate (soxr = best available)
        if conv_sr != SR:
            y_converted = librosa.resample(y_converted, orig_sr=conv_sr, target_sr=SR, res_type='soxr_vhq')

        # Orijinal performansın dinamiklerini (vurgu/haykırma/crescendo) geri giydir
        # — dönüşüm tınıyı aktarır ama enerjiyi düzleştirir ('mırıldanma' hissi)
        try:
            from services.neural_voice_service import transfer_dynamics, enhance_vocal
            y_converted = transfer_dynamics(y_original_vocal, y_converted, SR)
            y_converted = enhance_vocal(y_converted, SR)
        except Exception as _e:
            print(f"[WARNING] Dinamik aktarımı/zenginleştirme atlandı: {_e}")

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
        
        # ====== VOKAL İŞLEME ZİNCİRİ (v6: Minimal — preserve neural output) ======
        # v6 Philosophy: The neural network already did the hard work.
        # Heavy post-processing DESTROYS the cloned voice quality.
        # Only apply essential surgical corrections.
        print(f"[INFO] 🔧 Vokal mastering zinciri (v6: minimal, preserve clone identity)...")
        
        # 1) High-pass: Only remove sub-bass rumble
        sos_hp = butter(3, 75, btype='high', fs=SR, output='sos')
        y_converted = sosfiltfilt(sos_hp, y_converted).astype(np.float32)
        print(f"[INFO] ✅ High-pass filter (75Hz, gentle)")
        
        # 2) Very subtle warmth (much less than before)
        sos_warm = butter(2, [180, 350], btype='band', fs=SR, output='sos')
        y_warmth = sosfiltfilt(sos_warm, y_converted).astype(np.float32)
        y_converted = y_converted + y_warmth * 0.06  # Half of before
        print(f"[INFO] ✅ Subtle warmth (180-350Hz, +0.5dB)")
        
        # 3) Gentle de-esser (only extreme sibilance)
        # v7: Longer envelope smoothing (20ms instead of 5ms) to prevent
        #     fast gain modulation that causes crackling artifacts
        sos_sib = butter(2, 6000, btype='high', fs=SR, output='sos')
        y_sibilant = sosfiltfilt(sos_sib, y_converted).astype(np.float32)
        sib_env = np.abs(y_sibilant)
        sib_env = uf1d(sib_env, size=max(int(0.020 * SR), 1))  # 20ms smoothing (was 5ms — too fast, caused crackle)
        sib_threshold = np.percentile(sib_env, 94)  # Only top 6% (was 8%)
        sib_mask = np.clip(sib_env / (sib_threshold + 1e-10), 0, 1)
        sib_mask = uf1d(sib_mask, size=max(int(0.015 * SR), 1))  # Extra smoothing on the mask itself
        y_converted = y_converted - y_sibilant * sib_mask * 0.10  # Gentler (was 0.15)
        print(f"[INFO] ✅ Gentle de-esser (6kHz+, smooth envelope)")
        
        # 4) Subtle presence (less than before)
        sos_pres = butter(2, [2500, 5000], btype='band', fs=SR, output='sos')
        y_presence = sosfiltfilt(sos_pres, y_converted).astype(np.float32)
        y_converted = y_converted + y_presence * 0.08  # Reduced
        
        nyq_safe = min(13000, SR // 2 - 100)
        if nyq_safe > 9000:
            sos_air = butter(2, [9000, nyq_safe], btype='band', fs=SR, output='sos')
            y_air = sosfiltfilt(sos_air, y_converted).astype(np.float32)
            y_converted = y_converted + y_air * 0.06  # Very subtle air
        print(f"[INFO] ✅ Presence + Air EQ (subtle)")
        
        # v6: SKIP saturation AND spectral environment matching
        #     Spectral matching was pulling the cloned voice BACK toward
        #     the original singer — completely counter-productive for cloning.
        #     The neural model output IS the clone; don't fight it.
        print(f"[INFO] ✅ No saturation (preserve natural harmonics)")
        print(f"[INFO] ✅ No spectral env matching (preserve clone identity)")
        
        # 6) Loudness normalize
        y_converted = loudness_normalize(y_converted, target_lufs=-11.0, sr=SR)
        print(f"[INFO] ✅ Loudness normalization (target=-11 LUFS)")
        
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
        
        # v6 Auto-balance: Vocal should sit ~4-5dB above instrumental
        # for clear "this person is singing" effect
        target_ratio = 1.8  # Vocal ~5dB louder than instrumental
        current_ratio = rms_v / rms_i
        if current_ratio < target_ratio * 0.8:
            # Vocal too quiet — boost vocal
            vocal_gain = min(target_ratio / current_ratio, 1.8)
            instr_gain = 0.65
        elif current_ratio > target_ratio * 1.5:
            # Vocal too loud — reduce vocal slightly
            vocal_gain = target_ratio / current_ratio
            instr_gain = 0.70
        else:
            vocal_gain = 1.0
            instr_gain = 0.65
        
        print(f"[INFO] Mix balance: vocal_gain={vocal_gain:.2f}, instr_gain={instr_gain:.2f}")
        
        # Stereo mix — vokal ortada, enstrümantal stereo
        y_mixed = np.zeros((2, min_len), dtype=np.float32)
        y_mixed[0] = y_converted * vocal_gain + y_instr_stereo[0] * instr_gain
        y_mixed[1] = y_converted * vocal_gain + y_instr_stereo[1] * instr_gain
        
        # ====== MASTER LİMİTER (True Peak, broadcast quality) ======
        # v7: Longer lookahead (5ms) and release (150ms) to avoid crackling at transients
        ceiling = 10 ** (-1.0 / 20)  # -1dB True Peak (broadcast standard)
        peak_env = np.max(np.abs(y_mixed), axis=0)
        limiter_gain = np.where(peak_env > ceiling, ceiling / (peak_env + 1e-10), 1.0).astype(np.float32)
        la_samples = max(int(SR * 0.005), 1)  # 5ms lookahead (was 3ms — too short, clipped transients causing crackle)
        limiter_gain = mf1d(limiter_gain, size=la_samples)
        rel_samples = max(int(SR * 0.15), 1)  # 150ms release (was 80ms — too fast, gain pumping artifact)
        limiter_gain = uf1d(limiter_gain, size=rel_samples)
        limiter_gain = np.minimum(limiter_gain, 1.0)
        # Extra: smooth the final gain curve to eliminate any micro-steps
        limiter_gain = uf1d(limiter_gain, size=max(int(SR * 0.002), 1))
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
# WORKFLOW: MIX & MASTER
# ========================

@app.post("/api/workflow/mix-master")
async def workflow_mix_master(
    vocal_file: UploadFile = File(...),
    instrumental_file: UploadFile = File(...),
    vocal_volume: float = Form(0.85),
    instrumental_volume: float = Form(0.75),
    preset: str = Form("balanced"),
):
    """
    Workflow Step 5: Profesyonel Mix & Master

    Vokal + enstrümantal birleştirme + mastering presetleri.
    Desteklenen presetler: balanced, vocal_forward, instrumental_forward, radio, cinematic, raw
    """
    import numpy as np
    import soundfile as sf
    import librosa

    SR = 44100

    try:
        # Read vocal
        voc_bytes = await vocal_file.read()
        voc_data, voc_sr = sf.read(io.BytesIO(voc_bytes))
        voc_data = voc_data.astype(np.float32)
        if voc_data.ndim > 1:
            voc_data = voc_data.mean(axis=1)
        if voc_sr != SR:
            voc_data = librosa.resample(voc_data, orig_sr=voc_sr, target_sr=SR)

        # Read instrumental
        inst_bytes = await instrumental_file.read()
        inst_data, inst_sr = sf.read(io.BytesIO(inst_bytes))
        inst_data = inst_data.astype(np.float32)
        if inst_data.ndim > 1:
            inst_data = inst_data.mean(axis=1)
        if inst_sr != SR:
            inst_data = librosa.resample(inst_data, orig_sr=inst_sr, target_sr=SR)

        # Match lengths
        max_len = max(len(voc_data), len(inst_data))
        if len(voc_data) < max_len:
            voc_data = np.pad(voc_data, (0, max_len - len(voc_data)))
        if len(inst_data) < max_len:
            inst_data = np.pad(inst_data, (0, max_len - len(inst_data)))

        # Mastering presets
        PRESETS = {
            'balanced':             {'voc_gain': 1.0, 'inst_gain': 0.85, 'hp_freq': 80,  'comp': True, 'reverb': 0.03, 'target_lufs': -14},
            'vocal_forward':        {'voc_gain': 1.15, 'inst_gain': 0.65, 'hp_freq': 75,  'comp': True, 'reverb': 0.02, 'target_lufs': -13},
            'instrumental_forward': {'voc_gain': 0.75, 'inst_gain': 1.0,  'hp_freq': 60,  'comp': True, 'reverb': 0.04, 'target_lufs': -14},
            'radio':                {'voc_gain': 1.1,  'inst_gain': 0.70, 'hp_freq': 100, 'comp': True, 'reverb': 0.01, 'target_lufs': -11},
            'cinematic':            {'voc_gain': 0.9,  'inst_gain': 0.95, 'hp_freq': 50,  'comp': False,'reverb': 0.08, 'target_lufs': -16},
            'raw':                  {'voc_gain': 1.0,  'inst_gain': 1.0,  'hp_freq': 0,   'comp': False,'reverb': 0.0,  'target_lufs': -14},
        }
        p = PRESETS.get(preset, PRESETS['balanced'])

        # Apply gains
        voc_processed = voc_data * vocal_volume * p['voc_gain']
        inst_processed = inst_data * instrumental_volume * p['inst_gain']

        # Mix
        mixed = voc_processed + inst_processed

        # High-pass filter (remove rumble)
        if p['hp_freq'] > 0:
            from scipy.signal import butter, sosfilt
            sos = butter(4, p['hp_freq'], btype='high', fs=SR, output='sos')
            mixed = sosfilt(sos, mixed).astype(np.float32)

        # Simple compression
        if p['comp']:
            threshold = 0.4
            ratio = 3.0
            above = np.abs(mixed) > threshold
            mixed[above] = np.sign(mixed[above]) * (threshold + (np.abs(mixed[above]) - threshold) / ratio)

        # Tiny reverb (stereo widening)
        reverb_mix = p['reverb']
        if reverb_mix > 0:
            delay_samples = int(0.03 * SR)
            reverb_l = np.zeros_like(mixed)
            reverb_r = np.zeros_like(mixed)
            reverb_l[delay_samples:] = mixed[:-delay_samples] * reverb_mix * 0.7
            reverb_r[int(delay_samples * 1.5):] = mixed[:-int(delay_samples * 1.5)] * reverb_mix * 0.5
            left = mixed + reverb_l
            right = mixed + reverb_r
        else:
            left = mixed
            right = mixed

        stereo = np.column_stack([left, right]).astype(np.float32)

        # Loudness normalization (simplified LUFS-like)
        rms = np.sqrt(np.mean(stereo ** 2))
        # -14 LUFS ≈ -14 dBFS RMS for speech-like signals
        target_rms = 10 ** (p['target_lufs'] / 20)
        if rms > 0:
            stereo = stereo * (target_rms / rms)

        # Peak limiter
        peak = np.abs(stereo).max()
        if peak > 0.95:
            stereo = stereo / peak * 0.95

        # Save
        output_name = f"mastered_{preset}_{int(datetime.now().timestamp())}.wav"
        output_path = OUTPUT_DIR / "cloned" / output_name
        sf.write(str(output_path), stereo, SR)

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        duration = len(stereo) / SR

        return {
            "status": "success",
            "preset": preset,
            "duration": round(duration, 2),
            "download_url": f"/api/download/cloned/{output_name}",
            "filename": output_name,
            "size_mb": round(file_size_mb, 2),
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Mix & Master hatası: {str(e)}")


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
@app.get("/api/download/cloned/{subdir}/{filename}")
async def download_cloned_subdir_file(subdir: str, filename: str):
    """Download a file from a subdirectory inside cloned (e.g. vocal_lab outputs)"""
    from urllib.parse import unquote
    import re as _re

    subdir = unquote(subdir)
    filename = unquote(filename)

    # Safety: only allow alphanumeric, underscore, dash in subdir name
    if not _re.match(r'^[a-zA-Z0-9_-]+$', subdir):
        raise HTTPException(status_code=400, detail="Geçersiz klasör adı")

    output_path = OUTPUT_DIR / "cloned" / subdir / filename
    if not output_path.exists():
        raise HTTPException(status_code=404, detail=f"Dosya bulunamadı: {subdir}/{filename}")

    return FileResponse(path=str(output_path), media_type="audio/wav", filename=filename)


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
# VOCAL LAB — Suno AI Kalite Test Aracı
# ========================

@app.post("/api/vocal-lab/analyze-reference")
async def vocal_lab_analyze_reference(audio_file: UploadFile = File(...)):
    """
    V22: Referans ses dosyasını analiz et.
    Yüklenen örnek sesin pitch, tempo, vibrato ve ifade özelliklerini çıkarır.
    Bu bilgiler VocalLab'da aynı tarzda ses üretmek için kullanılır.
    """
    import numpy as np
    import librosa
    import pyworld as pw

    try:
        timestamp = int(datetime.now().timestamp() * 1000)
        ref_path = TEMP_DIR / f"ref_{timestamp}_{audio_file.filename}"
        content = await audio_file.read()
        with open(str(ref_path), 'wb') as f:
            f.write(content)

        # WAV'a çevir
        wav_path = convert_audio_to_wav(ref_path)
        audio, sr = librosa.load(str(wav_path), sr=22050, mono=True)

        if len(audio) < sr * 0.5:
            raise HTTPException(status_code=400, detail="Ses çok kısa (min 0.5 saniye)")
        if len(audio) > sr * 60:
            audio = audio[:sr * 60]  # Max 60 saniye

        # WORLD Analysis
        audio_f64 = audio.astype(np.float64)
        f0, t = pw.dio(audio_f64, sr, f0_floor=65.0, f0_ceil=600.0, frame_period=5.0)
        f0 = pw.stonemask(audio_f64, f0, t, sr)

        voiced = f0 > 0
        if not np.any(voiced):
            raise HTTPException(status_code=400, detail="Sesli bölüm bulunamadı")

        voiced_f0 = f0[voiced]
        fr = 200.0  # frames per second (5ms period)

        # 1. Pitch analizi
        med_f0 = float(np.median(voiced_f0))
        min_f0 = float(np.percentile(voiced_f0, 5))
        max_f0 = float(np.percentile(voiced_f0, 95))
        pitch_range_st = 12.0 * np.log2(max_f0 / max(min_f0, 1))

        # 2. Vibrato analizi — voiced segment'lerde pitch oscillation tespit et
        vibrato_detected = False
        vibrato_rates = []
        vibrato_depths_cents = []

        # Voiced run'ları bul
        runs = []
        in_run = False
        start = 0
        for i in range(len(f0) + 1):
            v = i < len(f0) and f0[i] > 0
            if v and not in_run:
                start = i
                in_run = True
            elif not v and in_run:
                if i - start >= int(0.3 * fr):  # Min 300ms run
                    runs.append((start, i))
                in_run = False

        for rs, re in runs:
            seg = f0[rs:re]
            if len(seg) < int(0.3 * fr):
                continue
            # Cent cinsinden pitch deviation
            med = np.median(seg)
            if med <= 0:
                continue
            cents = 1200 * np.log2(seg / med)
            # Simple peak detection for vibrato
            from scipy.signal import find_peaks
            peaks, _ = find_peaks(cents, distance=int(0.08 * fr))
            troughs, _ = find_peaks(-cents, distance=int(0.08 * fr))
            if len(peaks) >= 2 and len(troughs) >= 2:
                # Vibrato rate = peaks arası süre
                peak_intervals = np.diff(peaks) / fr
                if len(peak_intervals) > 0:
                    avg_interval = float(np.median(peak_intervals))
                    if 0.1 < avg_interval < 0.35:  # 3-10 Hz range
                        rate = 1.0 / avg_interval
                        vibrato_rates.append(rate)
                        # Depth = peak-trough ortalama fark
                        peak_vals = cents[peaks]
                        trough_vals = cents[troughs]
                        depth = float(np.median(np.abs(peak_vals[:min(len(peak_vals), len(trough_vals))])) +
                                       np.median(np.abs(trough_vals[:min(len(peak_vals), len(trough_vals))])))
                        vibrato_depths_cents.append(depth)
                        vibrato_detected = True

        avg_vib_rate = float(np.median(vibrato_rates)) if vibrato_rates else 0
        avg_vib_depth = float(np.median(vibrato_depths_cents)) if vibrato_depths_cents else 0

        # 3. Tempo / BPM tahmini
        onset_env = librosa.onset.onset_strength(y=audio, sr=sr)
        tempo_arr = librosa.beat.tempo(onset_envelope=onset_env, sr=sr)
        estimated_bpm = int(float(tempo_arr[0]) if len(tempo_arr) > 0 else 120)

        # 4. Enerji profili
        rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=512)[0]
        avg_energy = float(np.mean(rms))
        dynamic_range = float(np.percentile(rms, 95) - np.percentile(rms, 5))

        # 5. Önerilen parametreler
        suggested_intensity = min(1.0, max(0.3, avg_energy * 12))
        suggested_snap = 0.95 if avg_vib_depth > 20 else (0.90 if avg_vib_depth > 10 else 0.85)
        suggested_vib_depth = max(0.5, min(3.0, avg_vib_depth / 30.0)) if avg_vib_depth > 5 else 1.0

        # Key tahmini — basit (median f0'a en yakın nota)
        note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        midi_note = 69 + 12 * np.log2(med_f0 / 440.0)
        estimated_key = note_names[int(round(midi_note)) % 12]

        # Ref audio'yu sakla (vokal lab'da kullanım için)
        ref_save_path = CLONED_DIR / f"ref_audio_{timestamp}.wav"
        import soundfile as sf
        sf.write(str(ref_save_path), audio, sr)

        # Cleanup
        try:
            Path(ref_path).unlink(missing_ok=True)
        except Exception:
            pass
        try:
            Path(wav_path).unlink(missing_ok=True)
        except Exception:
            pass

        result = {
            "ref_id": f"ref_audio_{timestamp}",
            "duration": round(len(audio) / sr, 2),
            "analysis": {
                "pitch": {
                    "median_hz": round(med_f0, 1),
                    "range_st": round(pitch_range_st, 1),
                    "estimated_key": estimated_key,
                },
                "vibrato": {
                    "detected": vibrato_detected,
                    "avg_rate_hz": round(avg_vib_rate, 1),
                    "avg_depth_cents": round(avg_vib_depth, 1),
                },
                "tempo": {
                    "estimated_bpm": estimated_bpm,
                },
                "energy": {
                    "avg_level": round(avg_energy, 4),
                    "dynamic_range": round(dynamic_range, 4),
                },
            },
            "suggested_params": {
                "key": estimated_key,
                "bpm": estimated_bpm,
                "intensity": round(suggested_intensity, 2),
                "snap": round(suggested_snap, 2),
                "vibrato_depth": round(suggested_vib_depth, 2),
                "vibrato_rate": round(avg_vib_rate, 1) if avg_vib_rate > 0 else None,
            },
            "url": f"/api/download/cloned/ref_audio_{timestamp}.wav",
        }
        print(f"[VocalLab] Referans analiz: key={estimated_key}, bpm={estimated_bpm}, "
              f"vibrato={avg_vib_depth:.0f}cent@{avg_vib_rate:.1f}Hz, pitch_range={pitch_range_st:.1f}st")
        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Referans analiz hatası: {str(e)}")


class VocalLabRequest(BaseModel):
    text: str = "Gözlerinde kayboldum bu gece"
    genre: str = "pop"
    key: str = "C"
    bpm: int = 120
    language: str = "tr"
    # Individual parameter overrides (0-1)
    snap: Optional[float] = None
    tonality: Optional[float] = None
    vibrato_depth: Optional[float] = None
    vibrato_rate: Optional[float] = None
    sustain: Optional[float] = None
    reverb_amount: Optional[float] = None
    eq_profile: Optional[str] = None
    compression: Optional[float] = None
    perf_tag: Optional[str] = None
    intensity: float = 0.7
    vocoder_type: str = "auto"  # "world", "neural", "auto"
    ref_id: Optional[str] = None  # V22: reference audio ID from analyze-reference


@app.post("/api/vocal-lab/generate")
async def vocal_lab_generate(request: VocalLabRequest):
    """
    Vocal Lab: Her pipeline adımının ara çıktısını döner.
    Her adımı ayrı ayrı dinleyerek Suno AI kalitesine ulaşmak için parametre ayarı yapılır.

    Döndürülen adımlar:
    1. raw_tts — Ham TTS çıktısı (konuşma)
    2. pitch_snap — Melodi notalarına snap (WORLD f0 replace)
    3. tonality — Aperiodicity azaltma (tonal ses)
    4. sustain — Ünlü uzatma (vowel elongation)
    5. vibrato — Vibrato ekleme
    6. world_synth — WORLD sentez (singing tamamlanmış)
    7. eq — EQ uygulanmış
    8. compression — Kompresyon uygulanmış
    9. deesser — De-esser uygulanmış
    10. reverb — Reverb uygulanmış
    11. final_master — Son master (LUFS + limiter)
    """
    import edge_tts
    import soundfile as sf
    import numpy as np
    import librosa
    import pyworld as pw

    from services.melody_engine import (
        get_genre, build_scale, get_performance_override,
        _apply_f0_vibrato, _apply_note_scoop,
        _stretch_vowel_only, _stretch_voiced_frames_legacy,
        _apply_amplitude_vibrato,
        _sigmoid_glide, _apply_consonant_onset, _apply_formant_shift_simple,
        _apply_expression_bus, _apply_phrase_expression, _detect_phrases,
        _apply_shaped_breath, _apply_turkish_prosody,
        _expr_to_params, _EXPR_PROFILES,
        apply_vocal_eq, apply_soft_compression, apply_deesser,
        apply_studio_reverb, MOOD_PRESETS, PERFORMANCE_TAGS,
        syllabify_turkish, syllabify_turkish_ex, detect_syllable_onsets, build_note_events,
        _align_notes_to_audio, NoteEvent,
        align_tts_to_bpm, _quantize_onsets_to_grid,
        parse_vocal_markup, apply_elongation_to_note_events, generate_breath_audio,
        VocalSegment,
    )
    from scipy.signal import butter, sosfiltfilt

    if not request.text or len(request.text.strip()) < 2:
        raise HTTPException(status_code=400, detail="En az 2 karakter girin")

    try:
        timestamp = int(datetime.now().timestamp() * 1000)
        lab_dir = CLONED_DIR / f"vocal_lab_{timestamp}"
        lab_dir.mkdir(parents=True, exist_ok=True)

        steps = {}
        sr = 22050
        fp = 5.0

        # ═════════ V22: VOKAL MARKUP PARSE ═════════
        raw_text = request.text.strip()
        has_markup = bool(
            '[' in raw_text or '|' in raw_text or
            any(ch * 3 in raw_text.lower() for ch in 'aeıioöuü')
        )
        markup_segments = None
        markup_tempo = None
        if has_markup:
            markup_segments, markup_tempo = parse_vocal_markup(raw_text)
            # Filter out empty/breath-only checks
            text_segs = [s for s in markup_segments if not s.is_breath and s.clean_text]
            if text_segs:
                print(f"[VocalLab] V22 Markup detected: {len(markup_segments)} segments ({len(text_segs)} text, "
                      f"{sum(1 for s in markup_segments if s.is_breath)} breath)")
                for i, seg in enumerate(markup_segments):
                    if seg.is_breath:
                        print(f"  [{i}] [NEFES]")
                    else:
                        print(f"  [{i}] perf={seg.perf_tag}, timing={seg.timing_mult:.1f}x, "
                              f"elong={seg.elongation_map}, text='{seg.clean_text}'")
            else:
                markup_segments = None  # No useful segments, fall back to normal

        # ═════════ STEP 1: TTS ═════════
        tts_voices = {
            "tr": "tr-TR-AhmetNeural", "tr-female": "tr-TR-EmelNeural",
            "en": "en-US-GuyNeural", "en-female": "en-US-JennyNeural",
        }
        tts_voice = tts_voices.get(request.language, "tr-TR-AhmetNeural")

        # V22: TTS prosody — daha yavaş konuşma = şarkı motoru için çok daha fazla materyal
        from services.melody_engine import get_perf_tts_prosody
        _lab_tts_rate = '-25%'
        _lab_tts_pitch = '+0Hz'

        # Markup tempo override
        if markup_tempo:
            tempo_rates = {'slow': '-30%', 'medium': '-20%', 'fast': '-10%', 'yavaş': '-30%', 'hızlı': '-10%'}
            _lab_tts_rate = tempo_rates.get(markup_tempo, _lab_tts_rate)

        perf_tts = get_perf_tts_prosody(request.perf_tag)
        if perf_tts:
            _lab_tts_rate = perf_tts.get('rate', _lab_tts_rate)
            _lab_tts_pitch = perf_tts.get('pitch', _lab_tts_pitch)

        # ═════════ V22: Multi-segment TTS (markup mode) ═════════
        if markup_segments:
            # Her segment için ayrı TTS üret, sonra birleştir
            all_seg_audios = []
            temp_files = []
            combined_elongation_map = {}  # Global syllable index → multiplier
            combined_perf_override = None  # İlk text segment'in perf tag'i global olarak kullanılır
            global_syl_offset = 0

            for seg_i, seg in enumerate(markup_segments):
                if seg.is_breath:
                    # Nefes sesi ekle
                    breath = generate_breath_audio(sr=sr, duration=0.25)
                    all_seg_audios.append(breath)
                    continue

                if not seg.clean_text:
                    continue

                # Per-segment perf tag → TTS prosody
                seg_rate = _lab_tts_rate
                seg_pitch = _lab_tts_pitch
                if seg.perf_tag:
                    seg_perf_tts = get_perf_tts_prosody(seg.perf_tag)
                    if seg_perf_tts:
                        seg_rate = seg_perf_tts.get('rate', seg_rate)
                        seg_pitch = seg_perf_tts.get('pitch', seg_pitch)
                    if combined_perf_override is None:
                        combined_perf_override = seg.perf_tag

                # Timing multiplier → TTS rate adjustment
                if seg.timing_mult != 1.0:
                    # Daha yavaş = daha uzun ses (rate negatifleşir)
                    import re as _re_tts
                    base_pct = int(_re_tts.search(r'([+-]?\d+)', seg_rate).group(1)) if _re_tts.search(r'([+-]?\d+)', seg_rate) else -25
                    adjusted_pct = int(base_pct - (seg.timing_mult - 1.0) * 15)
                    adjusted_pct = max(-50, min(0, adjusted_pct))
                    seg_rate = f'{adjusted_pct:+d}%'

                seg_mp3 = TEMP_DIR / f"lab_tts_{timestamp}_seg{seg_i}.mp3"
                try:
                    comm = edge_tts.Communicate(seg.clean_text, tts_voice, rate=seg_rate, pitch=seg_pitch)
                    await comm.save(str(seg_mp3))
                    seg_wav = convert_audio_to_wav(seg_mp3)
                    seg_audio, _ = librosa.load(str(seg_wav), sr=sr, mono=True)
                    all_seg_audios.append(seg_audio)
                    temp_files.extend([seg_mp3, Path(seg_wav)])

                    # Elongation map'i global hece indeksine çevir
                    seg_syls = syllabify_turkish(seg.clean_text)
                    for local_idx, mult in seg.elongation_map.items():
                        combined_elongation_map[global_syl_offset + local_idx] = mult
                    global_syl_offset += len(seg_syls)

                    # Kısa pause segment'ler arası (50ms)
                    pause = np.zeros(int(0.05 * sr), dtype=np.float32)
                    all_seg_audios.append(pause)
                except Exception as e:
                    print(f"[VocalLab] Segment {seg_i} TTS hatası: {e}")

            # Birleştir
            if all_seg_audios:
                audio = np.concatenate(all_seg_audios)
                # Override perf tag from markup
                if combined_perf_override and not request.perf_tag:
                    request.perf_tag = combined_perf_override

            # Temp dosya temizliği
            for tmp in temp_files:
                try:
                    Path(tmp).unlink(missing_ok=True)
                except Exception:
                    pass

            tts_mp3 = None  # Markup mode'da tek mp3 yok
        else:
            # Normal tek-shot TTS
            tts_mp3 = TEMP_DIR / f"lab_tts_{timestamp}.mp3"
            comm = edge_tts.Communicate(raw_text, tts_voice, rate=_lab_tts_rate, pitch=_lab_tts_pitch)
            await comm.save(str(tts_mp3))
            tts_wav = convert_audio_to_wav(tts_mp3)
            audio, _ = librosa.load(str(tts_wav), sr=sr, mono=True)

            # V22-fix: Normal modda da tekrarlanan ünlü tespiti yap
            combined_elongation_map = {}
            from services.melody_engine import _count_elongation
            _norm_clean, _norm_elong = _count_elongation(raw_text)
            if _norm_elong:
                # char_position → syllable index çevirimi
                _norm_syls = syllabify_turkish(_norm_clean)
                _char_idx = 0
                for _si, _syl in enumerate(_norm_syls):
                    for _ci in range(len(_syl)):
                        for _epos, _emult in _norm_elong:
                            if _char_idx == _epos:
                                combined_elongation_map[_si] = _emult
                        _char_idx += 1
                if combined_elongation_map:
                    print(f"[VocalLab] Normal mode elongation detected: {combined_elongation_map}")

        # Save raw TTS
        raw_path = lab_dir / "01_raw_tts.wav"
        sf.write(str(raw_path), audio, sr)
        steps["raw_tts"] = {
            "order": 1, "label": "Ham TTS (Konuşma)" + (" — Markup" if markup_segments else ""),
            "desc": f"{'Markup segmentleri birleştirildi (' + str(len(markup_segments)) + ' segment)' if markup_segments else 'Edge TTS ile üretilen ham konuşma sesi'}. Henüz şarkı değil.",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/01_raw_tts.wav",
        }

        # ═════════ V17: BPM Pre-Alignment ═════════
        # V22: Markup modunda temiz metni kullan (tekrarlanan ünlüler kaldırılmış)
        if markup_segments:
            lab_text_raw = ' '.join(s.clean_text for s in markup_segments if not s.is_breath and s.clean_text)
        else:
            lab_text_raw = raw_text
        try:
            syl_bpm, iwl_bpm = syllabify_turkish_ex(lab_text_raw)
            if len(syl_bpm) >= 2:
                audio = align_tts_to_bpm(audio, sr, request.bpm, syl_bpm, is_word_last=iwl_bpm)
                bpm_aligned_path = lab_dir / "01b_bpm_aligned.wav"
                sf.write(str(bpm_aligned_path), audio, sr)
                steps["bpm_aligned"] = {
                    "order": 1.5, "label": f"BPM Hizalama ({request.bpm} BPM)",
                    "desc": f"TTS heceleri {request.bpm} BPM beat grid'ine hizalandı. {len(syl_bpm)} hece.",
                    "url": f"/api/download/cloned/vocal_lab_{timestamp}/01b_bpm_aligned.wav",
                }
                print(f"[VocalLab] V17 BPM pre-align: {len(syl_bpm)} hece → {request.bpm} BPM")
        except Exception as e:
            print(f"[VocalLab] BPM pre-align atlandı: {e}")

        # ═════════ WORLD Analysis ═════════
        g = get_genre(request.genre)
        perf = get_performance_override(request.perf_tag)

        # ═════════ V22: Reference Audio Parameter Override ═════════
        ref_analysis = None
        if request.ref_id:
            ref_wav_path = CLONED_DIR / f"{request.ref_id}.wav"
            if ref_wav_path.exists():
                try:
                    ref_audio_data, ref_sr = librosa.load(str(ref_wav_path), sr=sr, mono=True)
                    ref_f64 = ref_audio_data.astype(np.float64)
                    ref_f0, ref_t = pw.dio(ref_f64, ref_sr, f0_floor=65.0, f0_ceil=600.0, frame_period=fp)
                    ref_f0 = pw.stonemask(ref_f64, ref_f0, ref_t, ref_sr)
                    ref_voiced = ref_f0 > 0
                    if np.any(ref_voiced):
                        ref_med_f0 = float(np.median(ref_f0[ref_voiced]))
                        ref_analysis = {"median_f0": ref_med_f0, "f0": ref_f0, "voiced": ref_voiced}
                        print(f"[VocalLab] Reference audio loaded: {request.ref_id}, median_f0={ref_med_f0:.1f}Hz")
                except Exception as e:
                    print(f"[VocalLab] Reference audio load failed: {e}")

        audio_f64 = audio.astype(np.float64)

        f0_raw, t = pw.dio(audio_f64, sr, f0_floor=65.0, f0_ceil=600.0, frame_period=fp)
        f0_raw = pw.stonemask(audio_f64, f0_raw, t, sr)
        sp = pw.cheaptrick(audio_f64, f0_raw, t, sr)
        ap = pw.d4c(audio_f64, f0_raw, t, sr)

        nf = len(f0_raw)
        voiced = f0_raw > 0

        if not np.any(voiced):
            raise HTTPException(status_code=400, detail="Sesli segment bulunamadı")

        med_f0 = float(np.median(f0_raw[voiced]))
        base_oct = 3 if med_f0 < 180 else 4
        scale = build_scale(request.key, base_oct, g['scale_type'])
        root_idx = int(np.argmin([abs(freq - med_f0) for freq in scale]))
        fr = 1000.0 / fp

        # ═════════ STEP 2: Pitch Snap (V9 Note-Level) ═════════
        # V22: Daha yüksek default snap = güçlü nota kilidi = şarkı hissi
        snap_val = request.snap if request.snap is not None else (perf['snap'] if perf else min(1.0, g['pitch_snap'] + 0.05 * request.intensity))

        target_f0 = np.zeros(nf, dtype=np.float64)

        # V9: NoteEvent tabanlı pitch snap
        # V22: Markup modunda temiz metni kullan
        lab_text = lab_text_raw
        syllables = syllabify_turkish(lab_text)
        v9_mode = len(syllables) >= 2
        note_events = None

        if v9_mode:
            note_events = build_note_events(
                syllables, request.key, g['scale_type'], 'verse', request.genre,
                request.bpm, med_f0, scale, root_idx
            )
            onset_segments = detect_syllable_onsets(audio, sr, len(syllables))

            # V17: Grid quantize
            onset_segments = _quantize_onsets_to_grid(onset_segments, request.bpm, fr, nf)

            note_events = _align_notes_to_audio(note_events, onset_segments, nf, fr, request.bpm)

            # V22: Elongation map uygula — markup'ta tekrarlanan ünlüler daha uzun tutulur
            if combined_elongation_map:
                note_events = apply_elongation_to_note_events(note_events, combined_elongation_map)
                print(f"[VocalLab] V22 Elongation applied: {combined_elongation_map}")

            for ev in note_events:
                for i in range(ev.start_frame, min(ev.end_frame, nf)):
                    if voiced[i]:
                        target_f0[i] = f0_raw[i] * (1.0 - snap_val) + ev.freq_hz * snap_val
            # V17: Improved Sigmoid nota geçişleri (wider windows + consonant-aware)
            for idx in range(1, len(note_events)):
                ev = note_events[idx]
                prev_ev = note_events[idx - 1]
                if prev_ev.articulation == 'legato':
                    interval_st = 12.0 * np.log2(max(ev.freq_hz, 1) / max(prev_ev.freq_hz, 1))
                    prev_len = prev_ev.end_frame - prev_ev.start_frame
                    curr_len = ev.end_frame - ev.start_frame
                    # V21: Wide legato glide for singing
                    glide_before = max(4, int(0.65 * prev_len))
                    glide_after = max(3, int(0.45 * curr_len))
                    glide_start = max(prev_ev.start_frame, prev_ev.end_frame - glide_before)
                    glide_end = min(ev.start_frame + glide_after, nf)
                    actual_frames = glide_end - glide_start
                    if actual_frames < 3:
                        continue
                    for i in range(glide_start, glide_end):
                        if target_f0[i] > 0:
                            if not voiced[i]:
                                continue
                            progress = (i - glide_start) / max(1, actual_frames - 1)
                            s = _sigmoid_glide(progress, interval_st)
                            target_f0[i] = prev_ev.freq_hz * (1 - s) * snap_val + \
                                            ev.freq_hz * s * snap_val + \
                                            f0_raw[i] * (1.0 - snap_val)
        else:
            melody = g['verse_melody']
            beat_dur = 60.0 / max(request.bpm, 60)
            for i in range(nf):
                if not voiced[i]:
                    continue
                t_sec = i / fr
                beat_idx = int(t_sec / beat_dur) % len(melody)
                degree = melody[beat_idx]
                nidx = max(0, min(root_idx + degree, len(scale) - 1))
                target_note = scale[nidx]
                target_f0[i] = f0_raw[i] * (1.0 - snap_val) + target_note * snap_val
            # Fallback portamento
            port = max(3, int(0.035 * fr))
            raw_f0_copy = target_f0.copy()
            for i in range(nf):
                if raw_f0_copy[i] <= 0:
                    continue
                lo = max(0, i - port)
                hi = min(nf, i + port + 1)
                window = raw_f0_copy[lo:hi]
                voiced_vals = window[window > 0]
                if len(voiced_vals) > 0:
                    target_f0[i] = np.mean(voiced_vals)

        snap_result = pw.synthesize(target_f0.astype(np.float64), sp.astype(np.float64), ap.astype(np.float64), sr, frame_period=fp)
        snap_result = np.clip(snap_result / (np.abs(snap_result).max() + 1e-8) * 0.92, -1, 1).astype(np.float32)
        snap_path = lab_dir / "02_pitch_snap.wav"
        sf.write(str(snap_path), snap_result, sr)

        # V22: Expression bus + phrase arc + Turkish prosody + formant shift + note scoop
        if perf:
            _lab_expr_val = perf.get('expr_base', 0.5)
        else:
            _lab_expr_val = 0.6  # V22: mid-high expression (balanced with deeper vibrato_depth)
        _lab_expr = _expr_to_params(_lab_expr_val)
        _lab_expression = _lab_expr.get('expression', 0.5)

        # Initialize singing copies early
        singing_sp = sp.copy()
        singing_ap = ap.copy()

        # V22-fix: Expression bus — micro-pitch jitter + intonation scoop (doğallık)
        if note_events:
            target_f0 = _apply_expression_bus(target_f0, note_events, fr, _lab_expr)

        # Phrase-aware melodic arc
        if note_events:
            phrases = _detect_phrases(note_events, fr)
            if phrases:
                target_f0 = _apply_phrase_expression(
                    target_f0, note_events, phrases, fr, _lab_expr)
            # Turkish prosody (word stress contour)
            target_f0 = _apply_turkish_prosody(target_f0, note_events, fr, request.text)

        # V22: Note scoop — notaya aşağıdan yaklaşma (şarkı hissi)
        if note_events:
            _scoop_depth = 40 if not perf else max(15, int(40 * perf.get('vibrato_mult', 1.0) * 0.7))
            target_f0 = _apply_note_scoop(target_f0, note_events, fr,
                                           scoop_cents=_scoop_depth, scoop_ratio=0.12)

        # Consonant onset + formant shift
        if note_events:
            _onset_str = min(0.4, _lab_expr.get('onset_attack', 0.3))
            if _onset_str > 0.1:
                singing_sp, singing_ap = _apply_consonant_onset(
                    singing_sp, singing_ap, note_events, nf, _onset_str)
            _fs_amt = min(0.35, _lab_expr.get('formant_shift', 0.2))
            if _fs_amt > 0.05:
                singing_sp = _apply_formant_shift_simple(
                    singing_sp, target_f0, med_f0, note_events, _fs_amt)
        steps["pitch_snap"] = {
            "order": 2, "label": f"Pitch Snap V11 ({snap_val:.2f})",
            "desc": f"{'NoteEvent + sigmoid geçiş' if v9_mode else 'Beat-grid'} f0 snap. {len(syllables)} hece, formant-safe. snap={snap_val:.2f}",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/02_pitch_snap.wav",
            "param": "snap", "value": round(snap_val, 3),
        }

        # ═════════ STEP 3: Tonality ═════════
        # V21: tonality default uses expression bus value
        ton_val = request.tonality if request.tonality is not None else (perf['tonality'] if perf else _lab_expr.get('tonality', 0.25 + 0.45 * request.intensity))
        # singing_ap already created by consonant onset step above; apply tonality on top
        for i in range(nf):
            if target_f0[i] > 0:
                singing_ap[i] *= (1.0 - ton_val)
                # V21: per-tag breathiness
                _lab_breathiness = perf.get('ap_breathiness', 0.0) if perf else 0.0
                if _lab_breathiness > 0:
                    singing_ap[i] = singing_ap[i] + (1.0 - singing_ap[i]) * _lab_breathiness

        ton_result = pw.synthesize(target_f0.astype(np.float64), singing_sp.astype(np.float64), singing_ap.astype(np.float64), sr, frame_period=fp)
        ton_result = np.clip(ton_result / (np.abs(ton_result).max() + 1e-8) * 0.92, -1, 1).astype(np.float32)
        ton_path = lab_dir / "03_tonality.wav"
        sf.write(str(ton_path), ton_result, sr)
        steps["tonality"] = {
            "order": 3, "label": f"Tonality ({ton_val:.2f})",
            "desc": f"Aperiodicity azaltıldı → daha tonal/şarkılık ses. tonality={ton_val:.2f} (0=nefesli, 1=kristal tonal)",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/03_tonality.wav",
            "param": "tonality", "value": round(ton_val, 3),
        }

        # ═════════ STEP 4: Sustain ═════════
        # V22: Daha derin sustain — Türkçe şarkıda uzun ünlüler kritik
        sus_mult = request.sustain if request.sustain is not None else (perf['sustain_mult'] if perf else 1.0)
        sustain_val = 1.0 + (g['sustain_ratio'] - 1.0) * request.intensity * 1.6 * sus_mult
        sustain_val = max(1.0, min(sustain_val, 2.0))
        # V22-fix: Markup elongation varsa sustain tabanını yükselt
        if combined_elongation_map:
            sustain_val = max(sustain_val, 1.45)

        sus_f0 = target_f0.copy()
        sus_sp = singing_sp.copy()
        sus_ap = singing_ap.copy()
        if sustain_val > 1.08:
            sus_f0, sus_sp, sus_ap = _stretch_vowel_only(sus_f0, sus_sp, sus_ap, voiced, note_events, fr, sustain_val)

        sus_result = pw.synthesize(sus_f0.astype(np.float64), sus_sp.astype(np.float64), sus_ap.astype(np.float64), sr, frame_period=fp)
        sus_result = np.clip(sus_result / (np.abs(sus_result).max() + 1e-8) * 0.92, -1, 1).astype(np.float32)
        sus_path = lab_dir / "04_sustain.wav"
        sf.write(str(sus_path), sus_result, sr)
        steps["sustain"] = {
            "order": 4, "label": f"Vowel Sustain (×{sustain_val:.2f})",
            "desc": f"V11: Sadece ünlüler uzatıldı (ünsüzler kısa). sustain={sustain_val:.2f}×",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/04_sustain.wav",
            "param": "sustain", "value": round(sustain_val, 3),
        }

        # ═════════ STEP 5: Vibrato ═════════
        # V22: Expression bus multiplier eklendi — VocalLab artık derin vibrato üretir
        vib_mult = request.vibrato_depth if request.vibrato_depth is not None else (perf['vibrato_mult'] if perf else _lab_expr.get('vibrato_mult', 1.0))
        vib_rate = request.vibrato_rate if request.vibrato_rate is not None else g['vibrato_rate']
        _vib_expr_scale = 0.7 + _lab_expression * 1.3  # expression bus scaling
        # V22-fix: vibrato formulü güçlendirildi — 0.050*1200=60 base cents, intensity+expr ile 70-100 cent arası
        vib_cents = g['vibrato_depth'] * 1200 * max(0.6, request.intensity) * vib_mult * _vib_expr_scale * 1.3

        vib_f0 = sus_f0.copy()
        if vib_cents > 5:
            vib_f0 = _apply_f0_vibrato(vib_f0, fr, depth_cents=vib_cents, rate_hz=vib_rate, onset_ratio=g['vibrato_onset'])

        # V21: Per-tag f0 shift (belting +2st, falsetto +5st, etc.)
        _f0_shift_st = perf.get('f0_shift_st', 0) if perf else 0
        if _f0_shift_st != 0:
            _shift_ratio = 2.0 ** (_f0_shift_st / 12.0)
            _voiced_mask = vib_f0 > 0
            vib_f0[_voiced_mask] *= _shift_ratio

        vib_result = pw.synthesize(vib_f0.astype(np.float64), sus_sp.astype(np.float64), sus_ap.astype(np.float64), sr, frame_period=fp)
        vib_result = np.clip(vib_result / (np.abs(vib_result).max() + 1e-8) * 0.92, -1, 1).astype(np.float32)
        vib_path = lab_dir / "05_vibrato.wav"
        sf.write(str(vib_path), vib_result, sr)
        steps["vibrato"] = {
            "order": 5, "label": f"Vibrato ({vib_cents:.0f} cent, {vib_rate:.1f}Hz)",
            "desc": f"f0 üzerinde vibrato. depth={vib_cents:.0f} cent, rate={vib_rate:.1f}Hz",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/05_vibrato.wav",
            "param": "vibrato_depth", "value": round(vib_mult, 3),
        }

        # ═════════ STEP 6: Full WORLD Singing ═════════
        singing = vib_result.copy()
        dyn = g['dynamics_verse']
        dyn_mult = perf['dynamics'] if perf else 1.0
        singing = singing * ((1.0 + (dyn - 1.0) * request.intensity) * dyn_mult)
        peak = np.abs(singing).max()
        if peak > 0.95:
            singing = singing / peak * 0.92
        singing = singing.astype(np.float32)

        sing_path = lab_dir / "06_world_singing.wav"
        sf.write(str(sing_path), singing, sr)
        steps["world_singing"] = {
            "order": 6, "label": "WORLD Singing (Tüm Efekt)",
            "desc": "Snap + Tonality + Sustain + Vibrato + Dinamik = Final singing sesi (mastering ÖNCESİ)",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/06_world_singing.wav",
        }

        # ═════════ STEP 6.5: Neural Re-synthesis (Vocos) ═════════
        neural_used = False
        if request.vocoder_type in ('neural', 'auto'):
            try:
                from services.neural_vocoder import neural_resynthesize, is_available
                if is_available():
                    neural_result = neural_resynthesize(singing, sr)
                    if neural_result is not None:
                        if len(neural_result) > len(singing):
                            neural_result = neural_result[:len(singing)]
                        elif len(neural_result) < len(singing):
                            neural_result = np.pad(neural_result, (0, len(singing) - len(neural_result)))
                        singing = neural_result
                        neural_used = True

                        # V5: HPF kaldırıldı — Vocos native feature_extractor ile
                        # temiz çıkış üretiliyor, post-processing gereksiz

                        neural_path = lab_dir / "06b_neural_vocoder.wav"
                        sf.write(str(neural_path), singing, sr)
                        steps["neural_vocoder"] = {
                            "order": 6.5, "label": "Neural Vocoder (Vocos)",
                            "desc": "WORLD çıkışı Vocos neural vocoder ile yeniden sentezlendi + 120Hz HPF temizliği.",
                            "url": f"/api/download/cloned/vocal_lab_{timestamp}/06b_neural_vocoder.wav",
                        }
            except Exception as e:
                print(f"[VocalLab] Neural vocoder hatası: {e}")

        # V21: Amplitude vibrato — şarkı hissi için gerekli (neural + WORLD)
        if vib_cents > 5:
            _vib_mult_ampl = vib_mult
            _vib_expr_scale = 0.7 + _lab_expression * 1.3
            amp_vib_depth = 0.025 * _vib_mult_ampl * request.intensity * _vib_expr_scale
            if amp_vib_depth > 0.015:
                singing = _apply_amplitude_vibrato(
                    singing.astype(np.float32), sr, sus_f0, fr,
                    depth=min(amp_vib_depth, 0.05), rate_hz=vib_rate,
                    onset_ratio=g['vibrato_onset']
                )

        # ═════════ MASTERING STEPS at 44100 Hz ═════════
        SR = 44100
        y_master = librosa.resample(singing, orig_sr=sr, target_sr=SR, res_type='soxr_vhq')

        # STEP 7: EQ
        eq_prof = request.eq_profile or g.get('eq_profile', 'bright')
        y_eq = apply_vocal_eq(y_master, SR, profile=eq_prof)
        eq_path = lab_dir / "07_eq.wav"
        sf.write(str(eq_path), y_eq, SR)
        steps["eq"] = {
            "order": 7, "label": f"EQ ({eq_prof})",
            "desc": f"Genre-spesifik vokal EQ profili: {eq_prof}. High-pass 80Hz + frekans vurguları.",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/07_eq.wav",
            "param": "eq_profile", "value": eq_prof,
        }

        # STEP 7.5: Removed in V3 — Presence EQ 3-5kHz moved to Step 8.5 warm exciter
        # Ayrı bir boost yerine de-esser → 2-5kHz saturation zinciri kullanılıyor

        # STEP 8: Compression — V4: Multiband (neural) vs Single-band (WORLD)
        comp_val = request.compression if request.compression is not None else g.get('compression', 0.5)
        if neural_used:
            # Multiband Compressor: LOW / MID / HIGH
            from scipy.signal import butter as _mb_b, sosfiltfilt as _mb_sf
            _sos_lo = _mb_b(2, 300, btype='low', fs=SR, output='sos')
            _sos_md = _mb_b(2, [300, min(4000, SR * 0.4)], btype='band', fs=SR, output='sos')
            _sos_hi = _mb_b(2, min(4000, SR * 0.4), btype='high', fs=SR, output='sos')

            _y_lo = _mb_sf(_sos_lo, y_eq).astype(np.float32)
            _y_md = _mb_sf(_sos_md, y_eq).astype(np.float32)
            _y_hi = _mb_sf(_sos_hi, y_eq).astype(np.float32)

            _y_lo = apply_soft_compression(_y_lo, SR, threshold_db=-22, ratio=2.5)
            _y_md = apply_soft_compression(_y_md, SR, threshold_db=-16, ratio=5.0)
            _y_hi = apply_soft_compression(_y_hi, SR, threshold_db=-20, ratio=3.0)

            y_comp = (_y_lo + _y_md + _y_hi).astype(np.float32)
            comp_label = "Multiband Compression (Neural)"
            comp_desc = "Multiband: LOW 2.5:1 + MID 5:1 (vokal gövde) + HIGH 3:1. Kontrollü dinamik enerji."
        else:
            y_comp = y_eq.copy()
            if comp_val > 0.1:
                ratio = 2.0 + comp_val * 3.0
                y_comp = apply_soft_compression(y_eq, SR, threshold_db=-20, ratio=ratio)
            comp_label = f"Compression (ratio {2.0 + comp_val * 3.0:.1f}:1)"
            comp_desc = f"Soft-knee dinamik kompresyon. compression={comp_val:.2f} → ratio={2.0 + comp_val * 3.0:.1f}:1"
        comp_path = lab_dir / "08_compression.wav"
        sf.write(str(comp_path), y_comp, SR)
        steps["compression"] = {
            "order": 8, "label": comp_label,
            "desc": comp_desc,
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/08_compression.wav",
            "param": "compression", "value": round(comp_val, 3),
        }

        # STEP 8.5: V4 Suno-Elite Exciter (neural only)
        #   Sıra: De-esser 5-8kHz → Tube Saturator 2-5kHz → 12kHz+ Air Shelf → Hard Limiter
        if neural_used:
            # 8.5a) De-esser: 5-8kHz Vocos artefaktlarını bastır (4.0dB)
            y_comp = apply_deesser(y_comp, SR, reduction_db=4.0)

            # 8.5b) Tube Saturator: 2-5kHz presence — x/(1+|x|) formula
            from scipy.signal import butter as _butter_ex, sosfiltfilt as _sosfiltfilt_ex
            _sos_tube = _butter_ex(2, [2000, min(5000, SR * 0.4)], btype='band', fs=SR, output='sos')
            _y_tube_band = _sosfiltfilt_ex(_sos_tube, y_comp).astype(np.float32)
            _y_tube_sat = _y_tube_band / (1.0 + np.abs(_y_tube_band))
            y_comp = (y_comp + 0.20 * (_y_tube_sat - _y_tube_band)).astype(np.float32)

            # 8.5c) Air Shelf: 12kHz+ parlak hava katmanı (~+1.5dB)
            _air_freq = min(12000, SR * 0.45)
            _sos_air = _butter_ex(1, _air_freq, btype='high', fs=SR, output='sos')
            _y_air = _sosfiltfilt_ex(_sos_air, y_comp).astype(np.float32)
            y_comp = (y_comp + 0.08 * _y_air).astype(np.float32)

            # 8.5d) Hard Limiter: -0.1dB ceiling
            _ceiling = 10 ** (-0.1 / 20)  # ~0.9885
            _pk = np.abs(y_comp).max()
            if _pk > _ceiling:
                y_comp = y_comp / _pk * _ceiling

            exciter_path = lab_dir / "08b_exciter.wav"
            sf.write(str(exciter_path), y_comp, SR)
            steps["exciter"] = {
                "order": 8.5, "label": "Suno-Elite Exciter (De-ess → Tube 2-5kHz → Air 12kHz+ → Limiter)",
                "desc": "De-esser 5-8kHz (-4dB) → Tube Saturator 2-5kHz (presence) → 12kHz+ Air Shelf (+1.5dB) → Hard Limiter -0.1dB.",
                "url": f"/api/download/cloned/vocal_lab_{timestamp}/08b_exciter.wav",
            }

        # STEP 9: De-esser (non-neural only — neural de-ess step 8.5'te yapıldı)
        if neural_used:
            y_deess = y_comp  # zaten de-ess yapıldı step 8.5'te
            deess_label = "De-esser (Step 8.5'te yapıldı)"
        else:
            y_deess = apply_deesser(y_comp, SR)
            deess_label = "De-esser"
        deess_path = lab_dir / "09_deesser.wav"
        sf.write(str(deess_path), y_deess, SR)
        steps["deesser"] = {
            "order": 9, "label": deess_label,
            "desc": "Tiz sesleri (s, ş, z) azaltır. Sertliği yumuşatır." + (" (Neural mod: hafif)" if neural_used else ""),
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/09_deesser.wav",
        }

        # STEP 10: Reverb — neural vocoder modunda azaltılmış (Vocos doğal genişlik sağlar)
        rev_val = request.reverb_amount if request.reverb_amount is not None else g.get('reverb_amount', 0.08)
        if neural_used:
            rev_val = min(rev_val, 0.08)  # Neural: max %8 wet
        else:
            rev_val = min(rev_val, 0.25)  # WORLD: Lab allows slightly more for testing
        y_rev = y_deess.copy()
        if rev_val > 0.02:
            room = min(0.5, rev_val * 3.0)
            y_rev = apply_studio_reverb(y_deess, SR, room_size=room, wet=rev_val)
        rev_path = lab_dir / "10_reverb.wav"
        sf.write(str(rev_path), y_rev, SR)
        steps["reverb"] = {
            "order": 10, "label": f"Reverb (wet={rev_val:.2f})",
            "desc": f"Stüdyo reverb. reverb_amount={rev_val:.2f} (0=kuru, 0.12=normal, 0.25=geniş salon)",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/10_reverb.wav",
            "param": "reverb_amount", "value": round(rev_val, 3),
        }

        # STEP 11: Final Master (LUFS + Hard Limiter -0.1dB)
        sos_k = butter(2, min(1500, SR * 0.4), btype='high', fs=SR, output='sos')
        weighted = sosfiltfilt(sos_k, y_rev).astype(np.float32)
        rms = np.sqrt(np.mean(weighted ** 2)) + 1e-10
        current_lufs = 20 * np.log10(rms) - 0.691
        target_lufs = -14.0
        gain = min(10 ** ((target_lufs - current_lufs) / 20), 6.0)
        y_final = (y_rev * gain).astype(np.float32)
        _final_ceiling = 10 ** (-0.1 / 20)  # ~0.9885 (-0.1dB)
        peak = np.abs(y_final).max()
        if peak > _final_ceiling:
            y_final = y_final / peak * _final_ceiling

        final_path = lab_dir / "11_final_master.wav"
        sf.write(str(final_path), y_final, SR)
        steps["final_master"] = {
            "order": 11, "label": "Final Master",
            "desc": f"LUFS normalizasyon (-14 LUFS, gain={gain:.2f}×) + Hard Limiter (-0.1dB)",
            "url": f"/api/download/cloned/vocal_lab_{timestamp}/11_final_master.wav",
        }

        # Cleanup temp
        if tts_mp3:
            try:
                Path(tts_mp3).unlink(missing_ok=True)
            except Exception:
                pass
            try:
                Path(tts_wav).unlink(missing_ok=True)
            except Exception:
                pass

        return {
            "message": "Vocal Lab tamamlandı",
            "lab_id": f"vocal_lab_{timestamp}",
            "text": request.text,
            "genre": request.genre,
            "perf_tag": request.perf_tag,
            "params": {
                "snap": round(snap_val, 3),
                "tonality": round(ton_val, 3),
                "sustain": round(sustain_val, 3),
                "vibrato_cents": round(vib_cents, 1),
                "vibrato_rate": round(vib_rate, 1),
                "eq_profile": eq_prof,
                "compression": round(comp_val, 3),
                "reverb_amount": round(rev_val, 3),
                "intensity": request.intensity,
                "vocoder": "neural (Vocos)" if neural_used else "WORLD",
            },
            "steps": steps,
            "performance_tags": list(PERFORMANCE_TAGS.keys()),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Vocal Lab hatası: {str(e)}")


@app.delete("/api/vocal-lab/{lab_id}")
async def delete_vocal_lab(lab_id: str):
    """Vocal Lab sonuçlarını temizle"""
    import shutil
    lab_dir = CLONED_DIR / lab_id
    if lab_dir.exists():
        shutil.rmtree(str(lab_dir), ignore_errors=True)
        return {"message": "Lab sonuçları silindi"}
    raise HTTPException(status_code=404, detail="Lab bulunamadı")


@app.get("/api/vocoder/info")
async def vocoder_info():
    """Neural vocoder durum bilgisi."""
    try:
        from services.neural_vocoder import get_vocoder_info
        return get_vocoder_info()
    except Exception as e:
        return {"type": "world", "available": False, "error": str(e)}


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
