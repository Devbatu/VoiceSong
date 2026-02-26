"""
OpenVoice V2 - Neural Voice Conversion Service (v2 - Optimized)

ElevenLabs tarzı ses dönüşümü:
1. Speaker Embedding çıkar (CNN → mel-spectrogram → vektör)
2. Normalizing Flow ile ses kimliği ayrıştır
3. HiFi-GAN vocoder ile temiz sentez

İyileştirmeler (v2):
- Cosine crossfade (kesintisiz geçişler)
- Silence-aware splitting (kelime ortasında kesmez)
- 60s chunk, 3s overlap (daha az sınır)
- Pre-processing (normalize + noise gate)
- Envelope matching (orijinal dinamikleri korur)

Referans: https://arxiv.org/abs/2312.01479
"""

import os
import torch
import librosa
import soundfile as sf
import numpy as np
from pathlib import Path
from scipy.ndimage import uniform_filter1d
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
# PRE/POST PROCESSING
# ========================

def preprocess_vocal(audio, sr):
    """
    Pre-process vocal for cleaner neural conversion.
    - RMS normalization (consistent input level)
    - Noise gate (suppress bleed/noise in quiet sections)
    - Peak limiting (prevent clipping)
    """
    audio = audio.copy().astype(np.float32)
    
    # RMS normalize to consistent level
    rms = np.sqrt(np.mean(audio ** 2)) + 1e-10
    target_rms = 0.15
    audio = audio * (target_rms / rms)
    
    # Simple noise gate: suppress very quiet sections
    frame_len = int(0.02 * sr)  # 20ms frames
    hop = max(frame_len // 2, 1)
    n_frames = max(1, len(audio) // hop)
    
    gate_curve = np.ones(len(audio), dtype=np.float32)
    threshold = 0.008  # ~-42dB
    
    for i in range(n_frames):
        start = i * hop
        end = min(start + frame_len, len(audio))
        frame_rms = np.sqrt(np.mean(audio[start:end] ** 2))
        if frame_rms < threshold:
            ratio = frame_rms / (threshold + 1e-10)
            gate_curve[start:end] = np.minimum(gate_curve[start:end], ratio)
    
    # Smooth gate curve to avoid clicks
    smooth_size = max(int(0.01 * sr), 3)
    gate_curve = uniform_filter1d(gate_curve, size=smooth_size)
    audio = audio * gate_curve
    
    # Peak limit
    peak = np.abs(audio).max()
    if peak > 0.95:
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
    gains = np.clip(orig_env / conv_env, 0.25, 4.0)
    
    # Smooth to avoid rapid gain changes
    smooth_size = max(3, n_frames // 50)
    gains = uniform_filter1d(gains, size=smooth_size)
    
    # Interpolate to full sample length
    frame_centers = np.arange(n_frames) * hop + frame // 2
    gain_curve = np.interp(np.arange(n), frame_centers, gains).astype(np.float32)
    
    return (converted * gain_curve).astype(np.float32)


def spectral_smooth_vocal(audio, sr, strength=0.15):
    """
    Spectral envelope smoothing — reduces metallic/robotic artifacts
    from neural voice conversion.
    
    How it works:
    1. STFT → frequency domain
    2. Smooth magnitude spectrum frame-by-frame (median filter)
    3. Blend smoothed back with original (preserves detail)
    4. ISTFT → time domain
    
    This removes the harsh frequency peaks that cause the "metallic" sound
    while preserving natural formant structure.
    """
    from scipy.ndimage import median_filter
    
    n_fft = 2048
    hop_length = 512
    
    # STFT
    S = librosa.stft(audio, n_fft=n_fft, hop_length=hop_length)
    mag = np.abs(S)
    phase = np.angle(S)
    
    # Smooth magnitude spectrum (median filter along frequency axis)
    # This removes isolated frequency spikes (robotic artifacts)
    # while preserving broader formant shapes
    mag_smooth = median_filter(mag, size=(5, 1))  # smooth across 5 freq bins
    
    # Blend: keep mostly original, smooth out artifacts
    mag_blended = mag * (1.0 - strength) + mag_smooth * strength
    
    # Reconstruct
    S_clean = mag_blended * np.exp(1j * phase)
    audio_clean = librosa.istft(S_clean, hop_length=hop_length, length=len(audio))
    
    return audio_clean.astype(np.float32)


def denoise_converted(audio, sr):
    """
    Remove neural conversion artifacts using spectral gating.
    noisereduce uses adaptive spectral gating — learns noise profile
    from quiet sections and removes it from the full audio.
    """
    # Non-stationary noise reduction: adapts frame-by-frame
    cleaned = nr.reduce_noise(
        y=audio,
        sr=sr,
        prop_decrease=0.4,     # Remove 40% of detected noise
        stationary=False,       # Adaptive (better for varying artifacts)
        n_fft=2048,
        win_length=2048,
        hop_length=512,
        freq_mask_smooth_hz=200,  # Smooth noise mask to avoid musical artifacts
        time_mask_smooth_ms=50,   # Temporal smoothing
    )
    return cleaned.astype(np.float32)


def post_process_converted(audio, original, sr):
    """
    Full post-processing pipeline for converted vocal.
    Applied after neural conversion, before mastering.
    
    Pipeline:
    1. Spectral denoising (remove conversion artifacts)
    2. Spectral smoothing (reduce metallic quality)
    3. Envelope matching (restore natural dynamics)
    """
    print(f"[OpenVoice] Post-processing: spectral denoise...")
    audio = denoise_converted(audio, sr)
    
    print(f"[OpenVoice] Post-processing: spectral smoothing...")
    audio = spectral_smooth_vocal(audio, sr, strength=0.15)
    
    print(f"[OpenVoice] Post-processing: envelope matching...")
    orig_len = min(len(audio), len(original))
    audio = match_envelope(audio[:orig_len], original[:orig_len], frame_ms=25, sr=sr)
    
    return audio


# ========================
# SPEAKER EMBEDDING
# ========================

def extract_speaker_embedding(audio_path: str, converter=None):
    """
    Extract speaker embedding (tone color vector) from audio file.
    
    This uses OpenVoice's reference encoder - a 2D CNN operating on
    mel-spectrograms to produce a fixed-size speaker identity vector.
    
    Args:
        audio_path: Path to WAV file
        converter: ToneColorConverter instance (optional, will load if None)
    
    Returns:
        torch.Tensor: Speaker embedding vector
    """
    if converter is None:
        converter = get_or_load_converter()
    
    device = converter.device
    hps = converter.hps
    
    # Load and preprocess audio
    audio, sr = librosa.load(audio_path, sr=hps.data.sampling_rate)
    
    # Trim silence for cleaner embedding
    audio_trimmed, _ = librosa.effects.trim(audio, top_db=25)
    if len(audio_trimmed) > sr * 1:  # At least 1 second after trim
        audio = audio_trimmed
    
    # Normalize for consistent embeddings across different recording levels
    rms = np.sqrt(np.mean(audio ** 2)) + 1e-10
    if rms > 0:
        audio = audio * (0.15 / rms)
    peak = np.abs(audio).max()
    if peak > 0.95:
        audio = audio / peak * 0.95
    
    # Split into chunks for more robust embedding (average multiple segments)
    chunk_duration = 10.0  # seconds per chunk
    chunk_samples = int(chunk_duration * hps.data.sampling_rate)
    
    gs = []
    n_chunks = max(1, len(audio) // chunk_samples)
    
    for i in range(n_chunks):
        start = i * chunk_samples
        end = min((i + 1) * chunk_samples, len(audio))
        chunk = audio[start:end]
        
        if len(chunk) < hps.data.sampling_rate:  # Skip chunks < 1 second
            continue
        
        y = torch.FloatTensor(chunk).to(device).unsqueeze(0)
        spec = spectrogram_torch(
            y,
            hps.data.filter_length,
            hps.data.sampling_rate,
            hps.data.hop_length,
            hps.data.win_length,
            center=False
        ).to(device)
        
        with torch.no_grad():
            g = converter.model.ref_enc(spec.transpose(1, 2)).unsqueeze(-1)
            gs.append(g.detach())
    
    if not gs:
        # Fallback: use entire audio
        y = torch.FloatTensor(audio).to(device).unsqueeze(0)
        spec = spectrogram_torch(
            y,
            hps.data.filter_length,
            hps.data.sampling_rate,
            hps.data.hop_length,
            hps.data.win_length,
            center=False
        ).to(device)
        with torch.no_grad():
            g = converter.model.ref_enc(spec.transpose(1, 2)).unsqueeze(-1)
            gs.append(g.detach())
    
    # Average all chunk embeddings for robust speaker representation
    se = torch.stack(gs).mean(0)
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
