"""
Neural Vocoder Service — Vocos (ISTFT-based Neural Waveform Generator)

V5: Back to Basics — Use Vocos Native Feature Extractor

CRITICAL FIX: V1-V4 used librosa.feature.melspectrogram to create mel input,
but Vocos was trained with torchaudio.transforms.MelSpectrogram.
These produce DIFFERENT mel filterbanks (mean diff ~4.3 on log scale).
This mismatch was the root cause of metallic/garbled audio.

V5 Pipeline:
  WORLD pw.synthesize → resample to 24kHz
  → Vocos feature_extractor (torchaudio mel + safe_log) — EXACT match
  → Vocos decode (ISTFT waveform)
  → resample back to original sr
  → Clean, natural sound — no mel-domain hacks needed
"""

import numpy as np
import torch
import librosa
from typing import Optional

# ═══════════════════════════════════════
# GLOBAL MODEL CACHE (singleton pattern)
# ═══════════════════════════════════════
_vocoder = None
_vocoder_device = None
_vocoder_sr = 24000  # Vocos-mel-24khz native sample rate


def get_device():
    """Best available PyTorch device."""
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_or_load_vocoder():
    """
    Load Vocos neural vocoder (singleton — cached after first load).
    Auto-downloads from HuggingFace on first use (~20MB).
    Returns None if loading fails (fallback to WORLD).
    """
    global _vocoder, _vocoder_device

    if _vocoder is not None:
        return _vocoder

    try:
        from vocos import Vocos

        _vocoder_device = get_device()
        print(f"[NeuralVocoder] Loading Vocos mel-24khz on {_vocoder_device.upper()}...")

        _vocoder = Vocos.from_pretrained("charactr/vocos-mel-24khz")
        _vocoder = _vocoder.to(_vocoder_device)
        _vocoder.eval()

        print(f"[NeuralVocoder] ✅ Vocos loaded! Device={_vocoder_device}")
        return _vocoder

    except Exception as e:
        print(f"[NeuralVocoder] ⚠️ Vocos yüklenemedi, WORLD fallback kullanılacak: {e}")
        _vocoder = None
        return None


def is_available() -> bool:
    """Neural vocoder kullanılabilir mi?"""
    return get_or_load_vocoder() is not None


def neural_resynthesize(world_audio: np.ndarray, sr: int) -> Optional[np.ndarray]:
    """
    WORLD sentez çıkışını Vocos neural vocoder ile yeniden sentezle.

    V5 Pipeline (Back to Basics):
    1. Normalize input
    2. Resample to Vocos native 24kHz
    3. Use Vocos's OWN feature_extractor for mel (torchaudio — exact match)
    4. Vocos decode (ISTFT) — single pass, no chunking needed for <30s
    5. Resample back to original sr
    """
    vocoder = get_or_load_vocoder()
    if vocoder is None:
        return None

    audio = world_audio.astype(np.float32)

    # Normalize for consistent mel levels
    peak = np.abs(audio).max()
    if peak < 1e-6:
        return audio
    scale = min(1.0, 0.95 / peak)
    audio_norm = audio * scale

    # 1) Resample to vocoder's native 24kHz
    print(f"[SR-AUDIT] neural_resynthesize INPUT: shape={audio_norm.shape}, sr={sr}, peak={np.abs(audio_norm).max():.4f}")
    if sr != _vocoder_sr:
        audio_24k = librosa.resample(audio_norm, orig_sr=sr, target_sr=_vocoder_sr)
    else:
        audio_24k = audio_norm.copy()
    print(f"[SR-AUDIT] after resample to 24k: shape={audio_24k.shape}, sr={_vocoder_sr}")

    # 2) Use Vocos's own feature extractor — EXACT mel match guaranteed
    audio_tensor = torch.FloatTensor(audio_24k).unsqueeze(0).to(_vocoder_device)

    with torch.no_grad():
        # feature_extractor: torchaudio MelSpectrogram + safe_log(clip=1e-7)
        mel_features = vocoder.feature_extractor(audio_tensor)
        print(f"[SR-AUDIT] mel_features: shape={mel_features.shape}, min={mel_features.min():.2f}, max={mel_features.max():.2f}")
        # decode: backbone + ISTFTHead → waveform
        audio_out = vocoder.decode(mel_features)

    audio_np = audio_out.squeeze(0).squeeze(0).cpu().numpy().astype(np.float32)
    print(f"[SR-AUDIT] Vocos decode output: shape={audio_np.shape}, sr={_vocoder_sr}")

    # 3) Resample back to original sr
    if sr != _vocoder_sr:
        audio_np = librosa.resample(audio_np, orig_sr=_vocoder_sr, target_sr=sr)
    print(f"[SR-AUDIT] neural_resynthesize OUTPUT: shape={audio_np.shape}, sr={sr}")

    # Restore original level
    if scale > 0:
        audio_np = audio_np / scale

    # Peak safety
    out_peak = np.abs(audio_np).max()
    if out_peak > 0.98:
        audio_np = audio_np / out_peak * 0.95

    return audio_np


def neural_synthesize_from_mel(mel_log: np.ndarray, sr_target: int = 22050) -> Optional[np.ndarray]:
    """
    Doğrudan mel-spectrogram'dan waveform üret.
    (İleride DiffSinger gibi mel üreten modellerle kullanılmak üzere)

    Args:
        mel_log: Log mel-spectrogram [n_mels, n_frames]
        sr_target: Target sample rate for output

    Returns:
        Audio waveform (float32) or None
    """
    vocoder = get_or_load_vocoder()
    if vocoder is None:
        return None

    mel_tensor = torch.FloatTensor(mel_log).unsqueeze(0).to(_vocoder_device)

    with torch.no_grad():
        audio_out = vocoder.decode(mel_tensor)

    audio_np = audio_out.squeeze(0).squeeze(0).cpu().numpy()

    if sr_target != _vocoder_sr:
        audio_np = librosa.resample(audio_np, orig_sr=_vocoder_sr, target_sr=sr_target)

    return audio_np.astype(np.float32)


def get_vocoder_info() -> dict:
    """Vocoder durum bilgisi."""
    vocoder = get_or_load_vocoder()
    return {
        "type": "vocos-mel-24khz" if vocoder else "world",
        "available": vocoder is not None,
        "device": _vocoder_device or "N/A",
        "native_sr": _vocoder_sr,
        "n_mels": _MEL_N_MELS,
    }
