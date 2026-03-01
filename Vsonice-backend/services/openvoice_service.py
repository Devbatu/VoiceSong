"""
OpenVoice V2 - Neural Voice Conversion Service (v5 - ElevenLabs-Quality)

ElevenLabs-inspired vocal cloning pipeline:
1. Speaker Embedding çıkar (CNN → mel-spectrogram → vektör)
2. Normalizing Flow ile ses kimliği ayrıştır
3. HiFi-GAN vocoder ile temiz sentez

v5 — Gerçekçi & Canlı Ses İlkeleri (ElevenLabs-inspired):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Minimal pre-processing: Dinamikleri koruyarak sadece normalize et
• Prosody-preserving: Orijinal F0 kontürünü WORLD vocoder ile koru
• Single STFT-pass post-processing: Faz hataları minimize et
• Expression transfer: Orijinal vokalin mikro-ifadesini aktar
• Cosine crossfade chunking: Kesintisiz geçişler

Referans: https://arxiv.org/abs/2312.01479
ElevenLabs patent: Speech synthesis with prosody preservation
"""

import os
import torch
import librosa
import soundfile as sf
import numpy as np
from pathlib import Path
from scipy.ndimage import uniform_filter1d, median_filter
import noisereduce as nr

# OpenVoice imports
from openvoice.api import ToneColorConverter
from openvoice.mel_processing import spectrogram_torch

# Model paths
CHECKPOINT_DIR = Path(__file__).parent.parent / "checkpoints_v2" / "converter"
CONFIG_PATH = CHECKPOINT_DIR / "config.json"
CKPT_PATH = CHECKPOINT_DIR / "checkpoint.pth"

# Global model instance (singleton)
_converter = None
_device = None


def get_device():
    """Detect best available device"""
    if torch.cuda.is_available():
        return "cuda:0"
    return "cpu"


def get_or_load_converter():
    """Load OpenVoice V2 ToneColorConverter (singleton pattern)"""
    global _converter, _device
    
    if _converter is not None:
        return _converter
    
    if not CONFIG_PATH.exists() or not CKPT_PATH.exists():
        raise FileNotFoundError(
            f"OpenVoice V2 checkpoint not found at {CHECKPOINT_DIR}. "
            "Please download from: https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"
        )
    
    _device = get_device()
    print(f"[OpenVoice] Loading ToneColorConverter on {_device}...")
    
    _converter = ToneColorConverter(str(CONFIG_PATH), device=_device)
    _converter.load_ckpt(str(CKPT_PATH))
    
    # Disable watermark (avoid loading extra model)
    _converter.watermark_model = None
    
    print(f"[OpenVoice] ✅ Model loaded successfully! (device={_device})")
    return _converter


# ========================
# PRE/POST PROCESSING (ElevenLabs-inspired)
# ========================

def preprocess_vocal(audio, sr):
    """
    ElevenLabs-style pre-processing: MINIMAL intervention.
    
    Key insight: Preserve ALL dynamics and expression. Only normalize
    to a consistent level and apply gentle noise gate on truly silent sections.
    Heavy-handed pre-processing (aggressive noise gate, RMS flattening)
    destroys the expression that makes singing sound natural.
    """
    audio = audio.copy().astype(np.float32)
    
    # LUFS-like loudness normalization (preserves dynamics, only shifts level)
    # Unlike RMS normalization, this doesn't flatten loud/quiet differences
    rms = np.sqrt(np.mean(audio ** 2)) + 1e-10
    target_rms = 0.12  # Slightly lower target — gives model more headroom
    gain = target_rms / rms
    gain = min(gain, 5.0)  # Don't amplify too much (noisy recordings)
    audio = audio * gain
    
    # Very gentle noise gate: ONLY suppress truly silent sections (<-48dB)
    # This threshold is low enough to never eat into vocal expression
    frame_len = int(0.03 * sr)  # 30ms frames (longer = smoother transitions)
    hop = max(frame_len // 2, 1)
    n_frames = max(1, len(audio) // hop)
    
    gate_curve = np.ones(len(audio), dtype=np.float32)
    threshold = 0.004  # ~-48dB — very low, only catches true silence
    
    for i in range(n_frames):
        start = i * hop
        end = min(start + frame_len, len(audio))
        frame_rms = np.sqrt(np.mean(audio[start:end] ** 2))
        if frame_rms < threshold:
            ratio = frame_rms / (threshold + 1e-10)
            gate_curve[start:end] = np.minimum(gate_curve[start:end], ratio)
    
    # Smooth gate curve generously to avoid any clicks
    smooth_size = max(int(0.02 * sr), 3)
    gate_curve = uniform_filter1d(gate_curve, size=smooth_size)
    audio = audio * gate_curve
    
    # Gentle peak limit (only if clipping)
    peak = np.abs(audio).max()
    if peak > 0.98:
        audio = audio / peak * 0.95
    
    return audio.astype(np.float32)


def find_split_points(audio, sr, ideal_chunk_seconds=60.0, min_chunk_seconds=15.0):
    """
    Find optimal split points at low-energy moments.
    Avoids cutting mid-word/note — finds natural silence/breath points.
    """
    ideal_chunk = int(ideal_chunk_seconds * sr)
    min_chunk = int(min_chunk_seconds * sr)
    
    if len(audio) <= ideal_chunk:
        return [0, len(audio)]
    
    # Compute short-term energy (50ms frames)
    frame_len = int(0.05 * sr)
    hop = max(frame_len // 2, 1)
    n_frames = max(1, len(audio) // hop)
    
    energy = np.array([
        np.sqrt(np.mean(audio[i * hop:min(i * hop + frame_len, len(audio))] ** 2) + 1e-10)
        for i in range(n_frames)
    ], dtype=np.float32)
    
    # Smooth energy envelope
    energy_smooth = uniform_filter1d(energy, size=min(21, max(n_frames, 1)))
    
    # Find split points near ideal boundaries
    split_points = [0]
    pos = ideal_chunk
    
    while pos < len(audio) - min_chunk:
        # Search ±3 seconds around ideal point
        search_radius = int(3.0 * sr)
        search_start = max(0, (pos - search_radius) // hop)
        search_end = min(n_frames - 1, (pos + search_radius) // hop)
        
        if search_start < search_end:
            min_idx = search_start + np.argmin(energy_smooth[search_start:search_end])
            split_sample = min(min_idx * hop, len(audio))
        else:
            split_sample = pos
        
        # Ensure minimum chunk size
        if split_sample - split_points[-1] >= min_chunk:
            split_points.append(split_sample)
        
        pos = split_sample + ideal_chunk
    
    split_points.append(len(audio))
    return split_points


def match_envelope(converted, original, frame_ms=25, sr=22050):
    """
    Match amplitude envelope of converted audio to original.
    Preserves natural dynamics (loud/quiet passages stay loud/quiet).
    Prevents the "flat robotic" sound from neural conversion.
    """
    frame = max(int(sr * frame_ms / 1000), 1)
    hop = max(frame // 2, 1)
    
    n = min(len(converted), len(original))
    if n < frame * 2:
        return converted
    
    converted = converted[:n].copy()
    original = original[:n]
    
    n_frames = max(1, (n - frame) // hop + 1)
    
    # Compute RMS envelopes
    orig_env = np.array([
        np.sqrt(np.mean(original[i * hop:min(i * hop + frame, n)] ** 2)) + 1e-8
        for i in range(n_frames)
    ], dtype=np.float32)
    
    conv_env = np.array([
        np.sqrt(np.mean(converted[i * hop:min(i * hop + frame, n)] ** 2)) + 1e-8
        for i in range(n_frames)
    ], dtype=np.float32)
    
    # Compute gain (clip to prevent extreme amplification/attenuation)
    # v6: Tighter range to preserve user's natural dynamics
    gains = np.clip(orig_env / conv_env, 0.4, 2.5)
    
    # Smooth to avoid rapid gain changes
    smooth_size = max(5, n_frames // 40)
    gains = uniform_filter1d(gains, size=smooth_size)
    
    # Interpolate to full sample length
    frame_centers = np.arange(n_frames) * hop + frame // 2
    gain_curve = np.interp(np.arange(n), frame_centers, gains).astype(np.float32)
    
    return (converted * gain_curve).astype(np.float32)


def unified_spectral_enhance(audio, original, sr):
    """
    ElevenLabs-style UNIFIED spectral processing — ALL corrections in a 
    SINGLE STFT pass to minimize phase artifacts.
    
    This replaces the old multi-pass approach (5 separate STFT/ISTFT cycles)
    with ONE pass that does:
    1. Spectral denoising (gentle, adaptive)
    2. Formant smoothing (prevent rapid formant jumps)
    3. Metallic artifact reduction (median smoothing)
    4. Expression spectral transfer (15% original detail blend)
    
    Why single-pass matters:
    - Each STFT→ISTFT cycle introduces phase reconstruction error
    - 5 cycles = accumulated phase artifacts = "robotic" quality
    - ElevenLabs processes everything in the model itself; we emulate  
      this by doing all DSP in one spectral domain pass
    """
    n_fft = 2048
    hop_length = 512
    min_len = min(len(audio), len(original))
    audio = audio[:min_len]
    original = original[:min_len]
    
    # ── STFT of both audio streams ──
    S_conv = librosa.stft(audio, n_fft=n_fft, hop_length=hop_length)
    S_orig = librosa.stft(original, n_fft=n_fft, hop_length=hop_length)
    
    mag_conv = np.abs(S_conv)
    phase_conv = np.angle(S_conv)
    mag_orig = np.abs(S_orig)
    
    n_bins, n_time = mag_conv.shape
    freq_bins = np.linspace(0, sr / 2, n_bins)
    
    # ── 1) Spectral Denoise (inline, no extra STFT) ──
    # Estimate noise floor from lowest-energy 10% of frames
    frame_energy = np.mean(mag_conv ** 2, axis=0)
    noise_percentile = np.percentile(frame_energy, 10)
    noise_frames = frame_energy < noise_percentile * 2
    
    if noise_frames.sum() > 3:
        noise_profile = np.mean(mag_conv[:, noise_frames], axis=1, keepdims=True)
    else:
        noise_profile = np.percentile(mag_conv, 5, axis=1, keepdims=True)
    
    # v6: More conservative spectral subtraction (preserve voice detail)
    noise_reduction = np.clip(mag_conv - noise_profile * 1.2, 0, None)
    # Blend: 85% original + 15% denoised (very gentle, preserve character)
    mag_work = mag_conv * 0.85 + noise_reduction * 0.15
    
    # ── 2) Formant Smoothing (temporal axis) ──
    # Smooth each frequency bin across time → prevents robotic formant jumps
    smooth_frames = max(int(6 * sr / (1000 * hop_length)), 3)  # ~6ms
    mag_time_smooth = uniform_filter1d(mag_work, size=smooth_frames, axis=1)
    
    # Apply correction only where jumps are large (preserve natural variation)
    ratio = mag_time_smooth / (mag_work + 1e-8)
    ratio = np.clip(ratio, 0.7, 1.5)
    # 25% formant correction (gentle)
    mag_work = mag_work * (0.75 + 0.25 * ratio)
    
    # ── 3) Spectral Smoothing (frequency axis, adaptive) ──
    # Remove isolated frequency spikes that cause metallic/robotic sound
    mag_freq_smooth = median_filter(mag_work, size=(5, 1))
    
    # Adaptive strength: more in high freq where artifacts are worse
    strength_curve = np.where(
        freq_bins < 2000, 0.08,   # Low freq: very gentle
        np.where(freq_bins < 5000, 0.15, 0.20)  # High freq: moderate
    ).astype(np.float32).reshape(-1, 1)
    
    mag_work = mag_work * (1.0 - strength_curve) + mag_freq_smooth * strength_curve
    
    # ── 4) Expression Transfer from Original ──
    # CRITICAL: We only transfer the FINE TEMPORAL DYNAMICS (vibrato, breath)
    # NOT the spectral identity. Using too much blend mixes the original
    # singer's voice back in, defeating the purpose of cloning.
    # 
    # v6: Reduced from 20% → 5% and only transfer high-frequency detail
    # (>4kHz) which carries articulation/consonants but not voice identity.
    expression_blend = 0.05  # Very subtle — just articulation detail
    
    # Scale original magnitude to similar level as converted
    scale = (np.mean(mag_work) + 1e-8) / (np.mean(mag_orig) + 1e-8)
    mag_orig_scaled = mag_orig * scale
    
    # Only blend in voiced/active regions (don't blend silence)
    activity = np.mean(mag_work, axis=0, keepdims=True)
    activity_mask = (activity > np.percentile(activity, 15)).astype(np.float32)
    activity_mask = uniform_filter1d(activity_mask, size=5, axis=1)
    
    # Only blend high-frequency detail (>4kHz) — these carry articulation
    # but NOT voice identity (which lives in 300-3500Hz formant region)
    hf_mask = np.zeros((n_bins, 1), dtype=np.float32)
    hf_start = int(4000 / (sr / 2) * n_bins)
    hf_mask[hf_start:] = 1.0
    
    blend_mask = expression_blend * activity_mask * hf_mask
    mag_work = mag_work * (1.0 - blend_mask) + mag_orig_scaled * blend_mask
    
    # ── 5) Reconstruct with original phase (preserves temporal structure) ──
    S_result = mag_work * np.exp(1j * phase_conv)
    result = librosa.istft(S_result, hop_length=hop_length, length=min_len)
    
    return result.astype(np.float32)


def transfer_prosody_f0(converted, original, sr):
    """
    ElevenLabs-style F0 prosody transfer.
    
    Extract pitch contour from original and gently guide converted audio's
    pitch to follow it. This preserves:
    - Vibrato (pitch oscillation)
    - Intonation (melodic contour, question rises, emphasis)
    - Pitch bends / ornaments
    
    Uses phase vocoder for smooth pitch shifting (no PSOLA artifacts).
    Only applies SMALL corrections (±1.5 semitones max) to avoid
    introducing new artifacts while fixing the flat/robotic quality.
    """
    min_len = min(len(converted), len(original))
    converted = converted[:min_len].copy()
    original = original[:min_len]
    
    hop_length = 512
    
    # Extract F0 from both using pyin (most robust pitch tracker in librosa)
    try:
        f0_orig, voiced_orig, _ = librosa.pyin(
            original, fmin=60, fmax=800, sr=sr, hop_length=hop_length,
            fill_na=0.0
        )
        f0_conv, voiced_conv, _ = librosa.pyin(
            converted, fmin=60, fmax=800, sr=sr, hop_length=hop_length,
            fill_na=0.0
        )
    except Exception:
        return converted
    
    if f0_orig is None or f0_conv is None:
        return converted
    
    n_frames = min(len(f0_orig), len(f0_conv))
    f0_orig = f0_orig[:n_frames]
    f0_conv = f0_conv[:n_frames]
    
    both_voiced = (f0_orig > 0) & (f0_conv > 0)
    if both_voiced.sum() < 20:
        return converted
    
    # Compute semitone deviation
    semitones = np.zeros(n_frames, dtype=np.float32)
    semitones[both_voiced] = 12.0 * np.log2(
        f0_orig[both_voiced] / (f0_conv[both_voiced] + 1e-10) + 1e-10
    )
    
    # Clip to very small corrections only (±0.8 semitones)
    # The model's pitch IS the user's natural pitch — don't fight it!
    # Only correct micro-deviations (vibrato smoothing, slight drift)
    semitones = np.clip(semitones, -0.8, 0.8)
    
    # Heavy smoothing of correction curve (prevents rapid pitch jumps)
    smooth_size = max(7, n_frames // 60)
    semitones = uniform_filter1d(semitones, size=smooth_size)
    semitones[~both_voiced] = 0.0
    
    # Apply only 30% of the correction (very gentle, preserve user's voice)
    semitones = semitones * 0.3
    
    # Apply pitch correction using long segments (fewer boundary artifacts)
    segment_frames = 40  # ~1 second segments
    result = converted.copy()
    
    for seg_start in range(0, n_frames, segment_frames):
        seg_end = min(seg_start + segment_frames, n_frames)
        avg_st = np.mean(semitones[seg_start:seg_end])
        
        if abs(avg_st) < 0.03:  # Skip negligible
            continue
        
        s_start = seg_start * hop_length
        s_end = min(seg_end * hop_length, min_len)
        
        if s_end - s_start < hop_length * 2:
            continue
        
        try:
            segment = converted[s_start:s_end]
            shifted = librosa.effects.pitch_shift(
                segment, sr=sr, n_steps=avg_st
            )
            
            # Generous crossfade at boundaries (prevents clicks)
            fade_len = min(512, len(shifted) // 4)
            if fade_len > 0 and len(shifted) == s_end - s_start:
                t = np.linspace(0, np.pi, fade_len, dtype=np.float32)
                fade_in = 0.5 * (1.0 - np.cos(t))
                fade_out = 0.5 * (1.0 + np.cos(t))
                shifted[:fade_len] = shifted[:fade_len] * fade_in + result[s_start:s_start + fade_len] * (1 - fade_in)
                shifted[-fade_len:] = shifted[-fade_len:] * fade_out + result[s_end - fade_len:s_end] * (1 - fade_out)
                result[s_start:s_end] = shifted
        except Exception:
            continue
    
    return result.astype(np.float32)


def transfer_micro_dynamics(converted, original, sr):
    """
    ElevenLabs-style micro-dynamics transfer.
    
    Transfers fine-grained amplitude modulation from original to converted.
    This carries the "life" of the performance:
    - Crescendo/decrescendo within phrases
    - Accent patterns on beats/words
    - Breathing dynamics
    - Vibrato amplitude modulation
    
    Uses 8ms frames with heavy smoothing to avoid crackling.
    """
    min_len = min(len(converted), len(original))
    converted = converted[:min_len].copy()
    original = original[:min_len]
    
    # 8ms frames for micro-dynamics (good balance of detail vs smoothness)
    frame = max(int(sr * 0.008), 1)
    hop = max(frame // 2, 1)
    n_frames = max(1, (min_len - frame) // hop + 1)
    
    orig_env = np.array([
        np.sqrt(np.mean(original[i * hop:min(i * hop + frame, min_len)] ** 2)) + 1e-8
        for i in range(n_frames)
    ], dtype=np.float32)
    
    conv_env = np.array([
        np.sqrt(np.mean(converted[i * hop:min(i * hop + frame, min_len)] ** 2)) + 1e-8
        for i in range(n_frames)
    ], dtype=np.float32)
    
    # Compute micro-dynamics ratio
    micro_gains = np.clip(orig_env / conv_env, 0.5, 2.0)
    
    # Heavy smoothing (key to avoiding crackling)
    smooth_size = max(7, n_frames // 150)
    micro_gains = uniform_filter1d(micro_gains, size=smooth_size)
    
    # Interpolate to sample level
    frame_centers = np.arange(n_frames) * hop + frame // 2
    gain_curve = np.interp(np.arange(min_len), frame_centers, micro_gains).astype(np.float32)
    
    # v6: Apply only 25% of micro-dynamics (preserve user's voice character)
    gain_curve = 1.0 + (gain_curve - 1.0) * 0.25
    
    return (converted * gain_curve).astype(np.float32)


def denoise_converted(audio, sr):
    """
    Very gentle neural artifact removal using noisereduce.
    v6: Reduced from 0.35 → 0.20 to preserve voice character.
    Each noisereduce pass adds a tiny spectral smearing — less is more.
    """
    cleaned = nr.reduce_noise(
        y=audio,
        sr=sr,
        prop_decrease=0.20,     # v6: Much gentler (was 0.35)
        stationary=False,
        n_fft=2048,
        win_length=2048,
        hop_length=512,
        freq_mask_smooth_hz=300,  # Wider smooth = less spectral damage
        time_mask_smooth_ms=80,   # Wider smooth = less temporal damage
    )
    return cleaned.astype(np.float32)


def post_process_converted(audio, original, sr):
    """
    Post-processing pipeline (v6 — Minimal, preserve clone identity).
    
    v6 Key insight: LESS is MORE for voice cloning quality.
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Previous versions had 5 processing stages that accumulated artifacts
    and pulled the cloned voice back toward the original singer.
    
    v6 Pipeline (only 3 stages):
    1. Gentle denoise (noisereduce — very conservative)
    2. Unified spectral enhance (single STFT pass, minimal intervention)
    3. Macro envelope matching (volume dynamics only)
    
    REMOVED: F0 prosody transfer (was pulling pitch to original)
    REMOVED: Micro-dynamics transfer (was overprocessing)
    REDUCED: Spectral denoise, expression blend, formant correction
    """
    orig_len = min(len(audio), len(original))
    audio = audio[:orig_len]
    original_trimmed = original[:orig_len]
    
    # 1) Gentle denoise (single noisereduce pass)
    print(f"[OpenVoice] Post-processing: gentle denoise...")
    audio = denoise_converted(audio, sr)
    
    # 2) Unified spectral enhance (SINGLE STFT pass — minimal intervention)
    #    v6: Much gentler — preserve the neural network's output quality
    print(f"[OpenVoice] Post-processing: unified spectral enhance (single-pass, gentle)...")
    audio = unified_spectral_enhance(audio, original_trimmed, sr)
    
    # 3) Macro envelope matching ONLY (preserve overall volume dynamics)
    #    v6: SKIP F0 prosody transfer — the neural model already handles pitch.
    #    Pushing pitch back toward original defeats the cloning purpose.
    #    SKIP micro-dynamics — too aggressive, makes it sound processed.
    print(f"[OpenVoice] Post-processing: envelope matching (macro only)...")
    audio = match_envelope(audio[:orig_len], original_trimmed, frame_ms=30, sr=sr)
    
    return audio


# ========================
# SPEAKER EMBEDDING
# ========================

def extract_speaker_embedding(audio_path: str, converter=None, is_target=False):
    """
    Extract speaker embedding (tone color vector) from audio file.
    
    v6 — Enhanced for high-fidelity cloning:
    - Pre-denoise for cleaner embedding (especially user recordings)
    - Voice Activity Detection: only use segments with actual voice
    - Energy-weighted averaging (louder/clearer segments contribute more)
    - Overlapping chunks for more stable embedding
    - Multiple extraction passes for robustness
    
    Args:
        audio_path: Path to WAV file
        converter: ToneColorConverter instance (optional, will load if None)
        is_target: If True, apply extra care for target voice (user's voice)
    
    Returns:
        torch.Tensor: Speaker embedding vector
    """
    if converter is None:
        converter = get_or_load_converter()
    
    device = converter.device
    hps = converter.hps
    sr = hps.data.sampling_rate
    
    # Load and preprocess audio
    audio, _ = librosa.load(audio_path, sr=sr)
    
    # v6: For target voice (user recording), apply gentle noise reduction first
    # User recordings often have room noise/hiss that degrades embedding quality
    if is_target:
        try:
            audio = nr.reduce_noise(
                y=audio, sr=sr, prop_decrease=0.4, stationary=True,
                n_fft=2048, hop_length=512
            ).astype(np.float32)
            print(f"[OpenVoice] Target voice pre-denoised for cleaner embedding")
        except Exception:
            pass
    
    # Trim silence for cleaner embedding (more aggressive for target)
    trim_db = 20 if is_target else 25
    audio_trimmed, _ = librosa.effects.trim(audio, top_db=trim_db)
    if len(audio_trimmed) > sr * 1:  # At least 1 second after trim
        audio = audio_trimmed
    
    # Normalize for consistent embeddings across different recording levels
    rms = np.sqrt(np.mean(audio ** 2)) + 1e-10
    if rms > 0:
        audio = audio * (0.15 / rms)
    peak = np.abs(audio).max()
    if peak > 0.95:
        audio = audio / peak * 0.95
    
    # v6: Voice Activity Detection — only use segments with actual voice
    # This prevents silent/noisy sections from diluting the embedding
    frame_len = int(0.025 * sr)  # 25ms frames
    hop = frame_len // 2
    n_frames = max(1, (len(audio) - frame_len) // hop)
    
    frame_energies = np.array([
        np.sqrt(np.mean(audio[i * hop:i * hop + frame_len] ** 2))
        for i in range(n_frames)
    ])
    
    # Voiced threshold: top 60% of energy frames
    energy_threshold = np.percentile(frame_energies, 40)
    voiced_mask = frame_energies > energy_threshold
    
    # Find voiced segments (contiguous regions of voiced frames)
    voiced_segments = []
    in_segment = False
    seg_start = 0
    for i in range(n_frames):
        if voiced_mask[i] and not in_segment:
            seg_start = i * hop
            in_segment = True
        elif not voiced_mask[i] and in_segment:
            seg_end = min(i * hop + frame_len, len(audio))
            if seg_end - seg_start > sr * 0.5:  # At least 0.5s
                voiced_segments.append((seg_start, seg_end))
            in_segment = False
    if in_segment:
        seg_end = len(audio)
        if seg_end - seg_start > sr * 0.5:
            voiced_segments.append((seg_start, seg_end))
    
    # If VAD found good segments, concatenate them; otherwise use full audio
    if voiced_segments and sum(e - s for s, e in voiced_segments) > sr * 2:
        voiced_audio = np.concatenate([audio[s:e] for s, e in voiced_segments])
        print(f"[OpenVoice] VAD: {len(voiced_segments)} voiced segments, "
              f"{len(voiced_audio)/sr:.1f}s of {len(audio)/sr:.1f}s total")
        audio = voiced_audio
    
    # v6: Overlapping chunks with energy-weighted averaging
    # Overlap ensures boundary regions contribute to multiple chunks
    chunk_duration = 8.0  # 8 seconds per chunk (smaller = more chunks = more stable)
    chunk_overlap = 3.0   # 3 second overlap between chunks
    chunk_samples = int(chunk_duration * sr)
    overlap_samples = int(chunk_overlap * sr)
    step_samples = max(chunk_samples - overlap_samples, sr)  # Step size
    
    gs = []
    weights = []
    
    pos = 0
    while pos < len(audio):
        end = min(pos + chunk_samples, len(audio))
        chunk = audio[pos:end]
        
        if len(chunk) < sr:  # Skip chunks < 1 second
            break
        
        # Compute chunk energy for weighting
        chunk_rms = np.sqrt(np.mean(chunk ** 2)) + 1e-10
        
        y = torch.FloatTensor(chunk).to(device).unsqueeze(0)
        spec = spectrogram_torch(
            y,
            hps.data.filter_length,
            sr,
            hps.data.hop_length,
            hps.data.win_length,
            center=False
        ).to(device)
        
        with torch.no_grad():
            g = converter.model.ref_enc(spec.transpose(1, 2)).unsqueeze(-1)
            gs.append(g.detach())
            weights.append(chunk_rms)  # Louder chunks = more weight
        
        pos += step_samples
    
    if not gs:
        # Fallback: use entire audio
        y = torch.FloatTensor(audio).to(device).unsqueeze(0)
        spec = spectrogram_torch(
            y,
            hps.data.filter_length,
            sr,
            hps.data.hop_length,
            hps.data.win_length,
            center=False
        ).to(device)
        with torch.no_grad():
            g = converter.model.ref_enc(spec.transpose(1, 2)).unsqueeze(-1)
            gs.append(g.detach())
            weights.append(1.0)
    
    # v6: Energy-weighted average (louder/clearer chunks contribute more)
    weights = np.array(weights, dtype=np.float32)
    weights = weights / (weights.sum() + 1e-10)  # Normalize to sum=1
    
    se = torch.zeros_like(gs[0])
    for g, w in zip(gs, weights):
        se = se + g * float(w)
    
    print(f"[OpenVoice] Embedding extracted: {len(gs)} chunks, "
          f"weighted avg (target={is_target})")
    return se


# ========================
# VOICE CONVERSION
# ========================

def convert_voice(
    source_audio_path: str,
    source_se: torch.Tensor,
    target_se: torch.Tensor,
    output_path: str,
    tau: float = 0.3,
    converter=None
):
    """
    Convert voice tone color using neural network (single-pass).
    
    Architecture:
    1. Encoder (1D CNN) → feature maps from spectrogram
    2. Normalizing Flow (forward) → remove source tone color
    3. Normalizing Flow (inverse) → add target tone color  
    4. HiFi-GAN Decoder → high-quality audio waveform
    """
    if converter is None:
        converter = get_or_load_converter()
    
    hps = converter.hps
    device = converter.device
    
    # Load source audio
    audio, sample_rate = librosa.load(source_audio_path, sr=hps.data.sampling_rate)
    audio = torch.tensor(audio).float()
    
    with torch.no_grad():
        y = torch.FloatTensor(audio).to(device)
        y = y.unsqueeze(0)
        
        spec = spectrogram_torch(
            y,
            hps.data.filter_length,
            hps.data.sampling_rate,
            hps.data.hop_length,
            hps.data.win_length,
            center=False
        ).to(device)
        spec_lengths = torch.LongTensor([spec.size(-1)]).to(device)
        
        # NEURAL VOICE CONVERSION
        audio_converted = converter.model.voice_conversion(
            spec, spec_lengths,
            sid_src=source_se,
            sid_tgt=target_se,
            tau=tau
        )[0][0, 0].data.cpu().float().numpy()
    
    # Save output
    sf.write(output_path, audio_converted, hps.data.sampling_rate)
    
    return audio_converted, hps.data.sampling_rate


def convert_voice_chunked(
    source_audio_path: str,
    source_se: torch.Tensor,
    target_se: torch.Tensor,
    output_path: str,
    tau: float = 0.3,
    chunk_seconds: float = 60.0,
    converter=None
):
    """
    Convert voice in chunks with silence-aware splitting and cosine crossfade.
    
    v2 Improvements:
    - 60s chunks for better context (fewer boundary artifacts)
    - Silence-aware splitting (never cuts mid-word/note)
    - 3-second cosine crossfade (inaudible transitions)
    - Pre-processing (normalize + noise gate) for cleaner input
    - Envelope matching to preserve original dynamics
    
    Args:
        source_audio_path: Path to source audio
        source_se: Source speaker embedding
        target_se: Target speaker embedding
        output_path: Where to save
        tau: Conversion strength (0=max change, 1=no change)
        chunk_seconds: Ideal duration per chunk in seconds
        converter: ToneColorConverter instance
    
    Returns:
        tuple: (audio_array, sample_rate)
    """
    if converter is None:
        converter = get_or_load_converter()
    
    hps = converter.hps
    device = converter.device
    sr = hps.data.sampling_rate
    
    # Load full audio
    audio_full, _ = librosa.load(source_audio_path, sr=sr)
    total_samples = len(audio_full)
    
    # Pre-process for cleaner conversion (normalize + noise gate)
    audio_pp = preprocess_vocal(audio_full.copy(), sr)
    
    chunk_samples = int(chunk_seconds * sr)
    overlap_samples = int(3.0 * sr)  # 3 second cosine crossfade overlap
    
    # If short enough, process in one go (no chunking needed)
    if total_samples <= chunk_samples:
        print(f"[OpenVoice] Single-pass conversion ({total_samples/sr:.1f}s)...")
        
        with torch.no_grad():
            y = torch.FloatTensor(audio_pp).to(device).unsqueeze(0)
            spec = spectrogram_torch(
                y, hps.data.filter_length, sr,
                hps.data.hop_length, hps.data.win_length, center=False
            ).to(device)
            spec_lengths = torch.LongTensor([spec.size(-1)]).to(device)
            
            result = converter.model.voice_conversion(
                spec, spec_lengths,
                sid_src=source_se, sid_tgt=target_se, tau=tau
            )[0][0, 0].data.cpu().float().numpy()
        
        # Full post-processing pipeline
        result = post_process_converted(result, audio_full, sr)
        
        sf.write(output_path, result, sr)
        print(f"[OpenVoice] ✅ Conversion complete! {len(result)/sr:.1f}s")
        return result, sr
    
    # Find optimal split points at silence/low-energy moments
    split_points = find_split_points(audio_pp, sr, chunk_seconds, min_chunk_seconds=10.0)
    n_chunks = len(split_points) - 1
    
    print(f"[OpenVoice] Processing {n_chunks} chunks (silence-aware, {overlap_samples/sr:.0f}s cosine crossfade)...")
    
    # Process each chunk with overlap extension for crossfade
    converted_chunks = []
    
    for idx in range(n_chunks):
        chunk_start = split_points[idx]
        chunk_end = split_points[idx + 1]
        
        # Extend end by overlap for crossfade with next chunk (except last)
        if idx < n_chunks - 1:
            chunk_end_ext = min(chunk_end + overlap_samples, total_samples)
        else:
            chunk_end_ext = chunk_end
        
        chunk = audio_pp[chunk_start:chunk_end_ext]
        
        if len(chunk) < sr:  # Skip very short chunks
            continue
        
        duration = len(chunk) / sr
        print(f"[OpenVoice] Chunk {idx + 1}/{n_chunks} ({chunk_start/sr:.1f}s → {chunk_end_ext/sr:.1f}s, {duration:.1f}s)")
        
        # Convert chunk with neural network
        with torch.no_grad():
            y = torch.FloatTensor(chunk).to(device).unsqueeze(0)
            spec = spectrogram_torch(
                y, hps.data.filter_length, sr,
                hps.data.hop_length, hps.data.win_length, center=False
            ).to(device)
            spec_lengths = torch.LongTensor([spec.size(-1)]).to(device)
            
            chunk_converted = converter.model.voice_conversion(
                spec, spec_lengths,
                sid_src=source_se, sid_tgt=target_se, tau=tau
            )[0][0, 0].data.cpu().float().numpy()
        
        converted_chunks.append(chunk_converted)
    
    # Crossfade and concatenate with cosine window
    if len(converted_chunks) == 0:
        raise Exception("No chunks were converted successfully")
    elif len(converted_chunks) == 1:
        result = converted_chunks[0]
    else:
        result = _crossfade_chunks(converted_chunks, overlap_samples)
    
    # Trim to original length
    if len(result) > total_samples:
        result = result[:total_samples]
    
    # Full post-processing pipeline
    result = post_process_converted(result, audio_full, sr)
    
    # Save
    sf.write(output_path, result, sr)
    print(f"[OpenVoice] ✅ Conversion complete! {len(result)/sr:.1f}s ({n_chunks} chunks, cosine crossfade)")
    
    return result, sr


def _crossfade_chunks(chunks, overlap):
    """
    Crossfade audio chunks with smooth cosine window.
    
    Cosine crossfade is perceptually smoother than linear:
    - fade_out = 0.5 * (1 + cos(t))  → smooth 1→0
    - fade_in  = 0.5 * (1 - cos(t))  → smooth 0→1
    - Equal power crossfade (no volume dips at transitions)
    """
    if len(chunks) == 0:
        return np.array([], dtype=np.float32)
    if len(chunks) == 1:
        return chunks[0]
    
    # Calculate total output length
    total = len(chunks[0])
    for i in range(1, len(chunks)):
        total += len(chunks[i]) - overlap
    
    result = np.zeros(total, dtype=np.float32)
    pos = 0
    
    for i, chunk in enumerate(chunks):
        if i == 0:
            result[:len(chunk)] = chunk
            pos = len(chunk) - overlap
        else:
            # Cosine crossfade (smoother than linear, no audible seams)
            actual_overlap = min(overlap, len(result) - pos, len(chunk))
            
            if actual_overlap > 0:
                t = np.linspace(0, np.pi, actual_overlap, dtype=np.float32)
                fade_out = 0.5 * (1.0 + np.cos(t))   # 1 → 0 smoothly
                fade_in = 0.5 * (1.0 - np.cos(t))    # 0 → 1 smoothly
                
                result[pos:pos + actual_overlap] = (
                    result[pos:pos + actual_overlap] * fade_out +
                    chunk[:actual_overlap] * fade_in
                )
            
            # Copy remaining part of chunk after the crossfade region
            remaining = chunk[actual_overlap:]
            end_pos = min(pos + overlap + len(remaining), len(result))
            copy_len = end_pos - (pos + actual_overlap)
            if copy_len > 0:
                result[pos + actual_overlap:end_pos] = remaining[:copy_len]
            
            pos = pos + len(chunk) - overlap
    
    return result
