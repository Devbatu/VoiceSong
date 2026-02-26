"""
Demucs AI Audio Separation Engine
Uses Meta's Demucs deep learning model for professional-quality stem separation.
GPU-accelerated with NVIDIA CUDA support.
"""
import os
from pathlib import Path
from typing import Optional

# Global model cache
_demucs_model = None
_demucs_model_name = None


def get_or_load_demucs_model(model_name: str = "htdemucs"):
    """Load and cache Demucs AI model for audio separation.
    Model is downloaded on first use (~80MB) and cached for subsequent calls.
    """
    global _demucs_model, _demucs_model_name

    if _demucs_model is not None and _demucs_model_name == model_name:
        print(f"[INFO] Using cached Demucs model: {model_name}")
        return _demucs_model

    import torch
    from demucs.pretrained import get_model

    device = "cuda" if torch.cuda.is_available() else "cpu"
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    print(f"[INFO] 🧠 Loading Demucs AI model '{model_name}' on {device.upper()} ({gpu_name})...")

    model = get_model(model_name)
    model.to(device)
    model.eval()

    _demucs_model = model
    _demucs_model_name = model_name
    print(f"[SUCCESS] ✅ Demucs model '{model_name}' loaded on {device.upper()}")

    return model


def demucs_separate_stems(input_path: Path, model_name: str, output_dir: Path) -> dict:
    """
    Separate audio into stems using Demucs AI neural network.
    
    Args:
        input_path: Path to input audio file (WAV format preferred)
        model_name: Demucs model name (htdemucs, htdemucs_ft, htdemucs_6s)
        output_dir: Directory to save separated stems
    
    Returns:
        dict with keys: stems (list), sample_rate (int), device (str)
    """
    import torch
    import torchaudio
    from demucs.apply import apply_model
    import numpy as np
    import soundfile as sf

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[INFO] 🚀 Starting Demucs AI separation on {device.upper()}")
    print(f"[INFO] Model: {model_name}, File: {input_path.name}")

    # Load model (cached after first load)
    demucs_model = get_or_load_demucs_model(model_name)
    model_sr = demucs_model.samplerate  # Usually 44100
    stem_names = list(demucs_model.sources)  # e.g., ['drums', 'bass', 'other', 'vocals']

    print(f"[INFO] Model stems: {stem_names}")
    print(f"[INFO] Model sample rate: {model_sr}")

    # Load audio
    wav, sr = torchaudio.load(str(input_path))
    print(f"[INFO] Audio loaded: shape={wav.shape}, sr={sr}, duration={wav.shape[1]/sr:.2f}s")

    # Ensure stereo (Demucs expects 2 channels)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    elif wav.shape[0] > 2:
        wav = wav[:2]

    # Resample if needed
    if sr != model_sr:
        print(f"[INFO] Resampling {sr} → {model_sr}...")
        resampler = torchaudio.transforms.Resample(sr, model_sr)
        wav = resampler(wav)

    # Normalize for model input
    ref = wav.mean(0)
    wav_mean = ref.mean()
    wav_std = ref.std()
    wav = (wav - wav_mean) / (wav_std + 1e-8)

    # Apply Demucs AI model
    print(f"[INFO] 🧠 Running AI neural network separation...")
    with torch.no_grad():
        sources = apply_model(
            demucs_model,
            wav.unsqueeze(0).to(device),
            device=device,
            shifts=3,
            split=True,
            overlap=0.5,
            progress=True
        )[0]  # Shape: [num_sources, channels, samples]

    # Denormalize
    sources = sources * wav_std + wav_mean

    print(f"[INFO] ✅ AI separation complete! Sources shape: {sources.shape}")

    # Save each stem as high-quality WAV
    saved_stems = []
    for i, stem_name in enumerate(stem_names):
        stem_audio = sources[i].cpu().numpy()

        # Peak limiting
        max_val = np.abs(stem_audio).max()
        if max_val > 0.95:
            stem_audio = stem_audio / max_val * 0.95

        stem_path = output_dir / f"{stem_name}.wav"
        sf.write(str(stem_path), stem_audio.T, model_sr, subtype='PCM_24')

        size_mb = stem_path.stat().st_size / (1024 * 1024)
        print(f"[SUCCESS] ✅ {stem_name}.wav ({size_mb:.2f}MB)")
        saved_stems.append(stem_name)

    # Create "music" stem (instrumental = everything except vocals)
    if 'vocals' in stem_names:
        vocals_idx = stem_names.index('vocals')
        music_sources = [sources[i] for i in range(len(stem_names)) if i != vocals_idx]
        music_audio = sum(music_sources).cpu().numpy()
        max_val = np.abs(music_audio).max()
        if max_val > 0.95:
            music_audio = music_audio / max_val * 0.95
        music_path = output_dir / "music.wav"
        sf.write(str(music_path), music_audio.T, model_sr, subtype='PCM_24')
        saved_stems.append("music")
        size_mb = music_path.stat().st_size / (1024 * 1024)
        print(f"[SUCCESS] ✅ music.wav - instrumental mix ({size_mb:.2f}MB)")

    return {
        "stems": saved_stems,
        "sample_rate": model_sr,
        "device": device
    }
