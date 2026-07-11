"""
Singing Engine V5 — Pre-Conversion Clean Pipeline

V4: TTS → SesDönüşümü → Melodi  (çift vocoding → plak sesi artifact!)
V5: TTS → Melodi → SesDönüşümü  (temiz pipeline → doğal ses)

V4'TEN FARKLAR:
- Pipeline sırası değişti: melodi ÖNCE uygulanır, ses dönüşümü EN SON
  → Phase vocoder doğal TTS harmonikleri üzerinde çalışır (HiFi-GAN DEĞİL)
  → Plak/vinil sesi tamamen ortadan kalkar
- Kısa heceler birleştirilir (min 250ms — V4'te 50ms idi)
- Pitch shift ±4 yarım ton ile sınırlı (V4'te sınır yoktu)
- Daha yumuşak sustain (max 1.35x — V4'te 2.2x idi)
- Vibrato sadece yüksek yoğunlukta (intensity > 0.5)
- Enerji tabanlı bölüm sınırı algılama (karakter oranı DEĞİL)
- 30ms crossfade (V4'te 15ms)
"""

import numpy as np
import librosa


# ═══════════════════════════════════════════════════
# NOTA SİSTEMİ
# ═══════════════════════════════════════════════════
MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]


def build_scale(key='C', base_octave=4, scale_type='major'):
    root = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
            'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}.get(key, 0)
    intervals = MAJOR_INTERVALS if scale_type == 'major' else MINOR_INTERVALS
    freqs = []
    for oct_off in range(-1, 3):
        for iv in intervals:
            st = root + iv - 9 + (base_octave + oct_off - 4) * 12
            f = 440.0 * (2.0 ** (st / 12.0))
            if 65 < f < 1100:
                freqs.append(f)
    return sorted(set(freqs))


# ═══════════════════════════════════════════════════
# TÜR PREsetleri — V5 (konservatif, temiz ses)
# ═══════════════════════════════════════════════════

GENRE_PRESETS = {
    'pop': {
        'name': 'Pop',
        'scale_type': 'major',
        'sustain_ratio': 1.20,
        'vibrato_depth': 0.010,
        'vibrato_rate': 5.5,
        'vibrato_onset': 0.50,
        'dynamics_verse': 0.85,
        'dynamics_chorus': 1.0,
        'pitch_snap': 0.60,
        'max_shift_st': 3.5,
        'verse_melody': [0, 0, 2, 3, 2, 0, 1, 0, -1, 0, 2, 1, 0, 1, 0, -1],
        'chorus_melody': [4, 4, 5, 6, 5, 4, 3, 4, 5, 4, 3, 2, 3, 4, 3, 4],
    },
    'ballad': {
        'name': 'Balad',
        'scale_type': 'major',
        'sustain_ratio': 1.35,
        'vibrato_depth': 0.015,
        'vibrato_rate': 5.0,
        'vibrato_onset': 0.40,
        'dynamics_verse': 0.70,
        'dynamics_chorus': 1.0,
        'pitch_snap': 0.55,
        'max_shift_st': 3.0,
        'verse_melody': [0, -1, 0, 2, 3, 2, 0, -1, 0, 1, 2, 1, 0, -1, 0, 0],
        'chorus_melody': [3, 4, 5, 6, 5, 4, 3, 2, 3, 5, 6, 5, 4, 3, 4, 3],
    },
    'arabesk': {
        'name': 'Arabesk',
        'scale_type': 'minor',
        'sustain_ratio': 1.30,
        'vibrato_depth': 0.018,
        'vibrato_rate': 5.8,
        'vibrato_onset': 0.35,
        'dynamics_verse': 0.75,
        'dynamics_chorus': 1.0,
        'pitch_snap': 0.50,
        'max_shift_st': 3.0,
        'verse_melody': [0, -1, 0, 1, 3, 2, 0, -1, -2, -1, 0, 2, 3, 2, 0, -1],
        'chorus_melody': [3, 4, 5, 4, 3, 5, 6, 5, 3, 4, 5, 6, 5, 4, 3, 2],
    },
    'rock': {
        'name': 'Rock',
        'scale_type': 'minor',
        'sustain_ratio': 1.15,
        'vibrato_depth': 0.008,
        'vibrato_rate': 5.5,
        'vibrato_onset': 0.55,
        'dynamics_verse': 0.90,
        'dynamics_chorus': 1.0,
        'pitch_snap': 0.65,
        'max_shift_st': 4.0,
        'verse_melody': [0, 0, 2, 0, 3, 2, 0, 0, -1, 0, 2, 3, 2, 0, -1, 0],
        'chorus_melody': [4, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 4, 5, 4, 3, 4],
    },
    'turk_halk': {
        'name': 'Türk Halk',
        'scale_type': 'minor',
        'sustain_ratio': 1.25,
        'vibrato_depth': 0.012,
        'vibrato_rate': 5.0,
        'vibrato_onset': 0.40,
        'dynamics_verse': 0.80,
        'dynamics_chorus': 0.95,
        'pitch_snap': 0.50,
        'max_shift_st': 3.0,
        'verse_melody': [0, 1, 0, -1, 0, 2, 3, 2, 0, -1, 0, 1, 2, 1, 0, -1],
        'chorus_melody': [2, 3, 4, 5, 4, 3, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1],
    },
    'rnb': {
        'name': 'R&B / Soul',
        'scale_type': 'minor',
        'sustain_ratio': 1.30,
        'vibrato_depth': 0.016,
        'vibrato_rate': 5.5,
        'vibrato_onset': 0.35,
        'dynamics_verse': 0.75,
        'dynamics_chorus': 1.0,
        'pitch_snap': 0.45,
        'max_shift_st': 3.0,
        'verse_melody': [0, 2, 0, -1, 0, 3, 2, 0, 1, 0, -1, 0, 2, 3, 2, 0],
        'chorus_melody': [3, 5, 4, 3, 4, 5, 6, 5, 4, 3, 5, 4, 3, 2, 3, 4],
    },
}


def get_genre(genre_name):
    """Genre preset döndür, yoksa pop"""
    return GENRE_PRESETS.get(genre_name, GENRE_PRESETS['pop'])


# ═══════════════════════════════════════════════════
# V5 YARDIMCI FONKSİYONLAR
# ═══════════════════════════════════════════════════

def find_section_boundaries(audio, sr, num_sections):
    """
    Enerji analizi ile bölüm sınırlarını bul.
    Sessiz/düşük enerjili noktalarda böler.
    Karakter oranından ÇOK daha doğru (V4'teki ana sorunlardan biri buydu).
    """
    if num_sections <= 1:
        return [(0, len(audio))]

    # RMS energy, 50ms pencere
    frame_len = int(0.05 * sr)
    hop = frame_len // 2
    rms = librosa.feature.rms(y=audio, frame_length=frame_len, hop_length=hop)[0]

    # Enerji eğrisini yumuşat
    kernel_size = max(3, int(0.3 * sr / hop))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = np.ones(kernel_size) / kernel_size
    rms_smooth = np.convolve(rms, kernel, mode='same')

    # Düşük enerjili noktaları bul
    threshold = np.percentile(rms_smooth, 25)
    min_gap_frames = int(2.0 * sr / hop)  # Min 2s aralık

    candidates = []
    for i in range(min_gap_frames, len(rms_smooth) - min_gap_frames):
        if rms_smooth[i] < threshold:
            window_start = max(0, i - min_gap_frames // 2)
            window_end = min(len(rms_smooth), i + min_gap_frames // 2)
            window = rms_smooth[window_start:window_end]
            if rms_smooth[i] <= np.min(window) + 1e-7:
                candidates.append((float(rms_smooth[i]), i))

    candidates.sort(key=lambda x: x[0])

    # En uygun bölüm sınırlarını seç
    selected = []
    for _, idx in candidates:
        sample_pos = idx * hop
        if all(abs(sample_pos - s) > 2 * sr for s in selected):
            selected.append(sample_pos)
            if len(selected) >= num_sections - 1:
                break
    selected.sort()

    # Yeterince sınır bulunamadıysa eşit bölme ile tamamla
    while len(selected) < num_sections - 1:
        total = len(audio)
        best_pos = None
        best_gap = 0
        # Find the largest gap and split it
        points = [0] + selected + [total]
        for i in range(len(points) - 1):
            gap = points[i + 1] - points[i]
            if gap > best_gap:
                best_gap = gap
                best_pos = (points[i] + points[i + 1]) // 2
        if best_pos is not None and best_pos not in selected:
            selected.append(best_pos)
            selected.sort()
        else:
            break

    # Sınır çiftlerini oluştur
    boundaries = []
    prev = 0
    for pos in selected[:num_sections - 1]:
        boundaries.append((prev, pos))
        prev = pos
    boundaries.append((prev, len(audio)))

    return boundaries


def _find_voiced_groups(f0, voiced_flag, hop_length, sr, audio_len, min_group_ms=250):
    """
    V5: Sesli bölgeleri bul + kısa olanları birleştir.
    Min 250ms (V4'te 50ms idi) — kısa heceler birleştirilir,
    böylece phase vocoder daha uzun segmentlerde çalışır.
    """
    n_frames = len(f0)
    f0c = np.where(np.isnan(f0), 0.0, f0)
    vf = voiced_flag if voiced_flag is not None else (f0c > 0)

    # İlk geçiş: ham voiced/unvoiced segmentleri bul
    raw_segments = []
    in_voiced = False
    seg_start = 0

    for i in range(n_frames + 1):
        is_v = i < n_frames and vf[i] and f0c[i] > 0
        if is_v and not in_voiced:
            if i > seg_start:
                s = seg_start * hop_length
                e = min(i * hop_length, audio_len)
                if e > s:
                    raw_segments.append({'start': s, 'end': e, 'avg_f0': 0.0, 'voiced': False})
            seg_start = i
            in_voiced = True
        elif not is_v and in_voiced:
            s = seg_start * hop_length
            e = min(i * hop_length, audio_len)
            if e > s:
                vals = f0c[seg_start:i]
                voiced_vals = vals[vals > 0]
                avg = float(np.mean(voiced_vals)) if len(voiced_vals) > 0 else 0.0
                raw_segments.append({'start': s, 'end': e, 'avg_f0': avg, 'voiced': avg > 0})
            seg_start = i
            in_voiced = False

    if seg_start < n_frames:
        s = seg_start * hop_length
        e = audio_len
        if e > s:
            if in_voiced:
                vals = f0c[seg_start:n_frames]
                voiced_vals = vals[vals > 0]
                avg = float(np.mean(voiced_vals)) if len(voiced_vals) > 0 else 0.0
                raw_segments.append({'start': s, 'end': e, 'avg_f0': avg, 'voiced': avg > 0})
            else:
                raw_segments.append({'start': s, 'end': e, 'avg_f0': 0.0, 'voiced': False})

    # İkinci geçiş: kısa voiced segmentleri birleştir
    min_samples = int(min_group_ms / 1000.0 * sr)
    merged = []
    i = 0
    while i < len(raw_segments):
        seg = raw_segments[i].copy()
        if seg['voiced'] and (seg['end'] - seg['start']) < min_samples:
            # Kısa voiced segment: sonrakiyle birleştirmeye çalış
            while i + 2 < len(raw_segments):
                gap = raw_segments[i + 1]
                gap_dur = gap['end'] - gap['start']
                next_seg = raw_segments[i + 2]
                # Kısa boşluk + sonraki voiced → birleştir
                if not gap['voiced'] and gap_dur < min_samples and next_seg['voiced']:
                    seg['end'] = next_seg['end']
                    f0_list = [seg['avg_f0'], next_seg['avg_f0']]
                    f0_list = [f for f in f0_list if f > 0]
                    seg['avg_f0'] = float(np.mean(f0_list)) if f0_list else 0.0
                    i += 2
                    if (seg['end'] - seg['start']) >= min_samples:
                        break
                else:
                    break
        merged.append(seg)
        i += 1

    return merged


def _add_vibrato(audio, sr, depth_cents, rate_hz, onset_ratio=0.5):
    """Delay-line vibrato — V5: daha geç başlar, daha yumuşak."""
    n = len(audio)
    if n < int(sr * 0.3) or depth_cents < 3:
        return audio

    t = np.arange(n, dtype=np.float64) / sr
    onset_sample = int(onset_ratio * n)
    ramp_samples = min(int(0.4 * sr), n - onset_sample)

    envelope = np.zeros(n, dtype=np.float64)
    if ramp_samples > 0:
        envelope[onset_sample:onset_sample + ramp_samples] = np.linspace(0, 1, ramp_samples)
        envelope[onset_sample + ramp_samples:] = 1.0

    max_delay = depth_cents / 1200.0 * sr
    lfo = max_delay * np.sin(2 * np.pi * rate_hz * t) * envelope

    read_pos = np.arange(n, dtype=np.float64) - lfo
    read_pos = np.clip(read_pos, 0, n - 1.001)

    idx = read_pos.astype(np.intp)
    frac = (read_pos - idx).astype(np.float32)
    idx_next = np.minimum(idx + 1, n - 1)

    output = audio[idx] * (1.0 - frac) + audio[idx_next] * frac
    return output.astype(np.float32)


def _crossfade_concat(parts, sr, ms=30):
    """Crossfade birleştirme — V5: 30ms default (V4'te 15ms)."""
    if not parts:
        return np.array([], dtype=np.float32)
    if len(parts) == 1:
        return parts[0].astype(np.float32)

    cf = int(ms / 1000.0 * sr)
    result = parts[0].astype(np.float32).copy()

    for i in range(1, len(parts)):
        part = parts[i].astype(np.float32)
        overlap = min(cf, len(result), len(part))
        if overlap > 1:
            fade_out = np.linspace(1, 0, overlap, dtype=np.float32)
            fade_in = np.linspace(0, 1, overlap, dtype=np.float32)
            result[-overlap:] = result[-overlap:] * fade_out + part[:overlap] * fade_in
            result = np.concatenate([result, part[overlap:]])
        else:
            result = np.concatenate([result, part])

    return result


# ═══════════════════════════════════════════════════
# ANA FONKSİYON: KONUŞMA → ŞARKI V5
# ═══════════════════════════════════════════════════

def speech_to_singing(audio, sr, section_type='verse', intensity=0.5,
                      key='C', bpm=120, genre='pop'):
    """
    Konuşma sesini şarkıya dönüştür (V5 — Pre-Conversion Pipeline).

    V4'ten temel fark: Artık SADECE TTS çıkışı üzerinde çalışır.
    Phase vocoder doğal TTS harmonikleri üzerinde çalıştığı için
    metalik/plak sesi oluşmaz.

    Pipeline:
    1. librosa.pyin ile pitch algılama
    2. Sesli grupları bul (min 250ms — kısa heceler birleştirilir)
    3. Hedef melodi notalarını belirle (max ±4 yarım ton)
    4. Her grup: pitch_shift (sınırlı) + hafif time_stretch
    5. Vibrato (sadece intensity > 0.5)
    6. 30ms crossfade ile birleştir
    7. Dinamik kontrol + peak güvenliği
    """
    g = get_genre(genre)
    audio = audio.astype(np.float32)

    # ── 1) Pitch algılama ──
    hop = 512
    f0, voiced_flag, _ = librosa.pyin(
        audio, fmin=65, fmax=600, sr=sr,
        frame_length=2048, hop_length=hop
    )

    if f0 is None or len(f0) == 0:
        return audio

    # ── 2) Sesli grupları bul (birleştirilmiş, min 250ms) ──
    groups = _find_voiced_groups(f0, voiced_flag, hop, sr, len(audio), min_group_ms=250)
    voiced_groups = [gi for gi in groups if gi['voiced'] and gi['avg_f0'] > 0]

    if not voiced_groups:
        return audio

    # ── 3) Hedef melodi ──
    median_f0 = float(np.median([gi['avg_f0'] for gi in voiced_groups]))
    base_oct = 3 if median_f0 < 200 else 4
    scale = build_scale(key, base_oct, g['scale_type'])
    root_idx = int(np.argmin([abs(f - median_f0) for f in scale]))
    melody = g['chorus_melody'] if section_type == 'chorus' else g['verse_melody']

    snap = g['pitch_snap'] * intensity
    max_shift = g.get('max_shift_st', 4.0)
    sustain = 1.0 + (g['sustain_ratio'] - 1.0) * intensity
    sustain = min(sustain, 1.35)  # V5: max 1.35x (V4'te 2.2x idi — artifact kaynağı)

    # Vibrato: sadece yüksek intensity'de
    enable_vibrato = intensity > 0.5
    vib_depth_cents = g['vibrato_depth'] * 1200 * max(0, intensity - 0.3) if enable_vibrato else 0
    vib_rate = g['vibrato_rate']
    vib_onset = g['vibrato_onset']

    # ── 4) Her grup için pitch_shift + time_stretch ──
    parts = []
    v_idx = 0

    for seg in groups:
        start, end = seg['start'], seg['end']
        chunk = audio[start:end].copy()

        if not seg['voiced'] or seg['avg_f0'] <= 0:
            parts.append(chunk)
            continue

        degree = melody[v_idx % len(melody)]
        note_idx = max(0, min(int(root_idx) + degree, len(scale) - 1))
        target_f0 = scale[note_idx]
        v_idx += 1

        # Yarım ton farkı — sınırlı (±max_shift)
        raw_semitones = 12.0 * np.log2(target_f0 / seg['avg_f0']) * snap
        semitones = float(np.clip(raw_semitones, -max_shift, max_shift))

        processed = chunk

        # Pitch shift — sadece anlamlı fark ve yeterli uzunluk
        if abs(semitones) > 0.3 and len(processed) >= 2048:
            try:
                processed = librosa.effects.pitch_shift(
                    processed, sr=sr, n_steps=semitones
                ).astype(np.float32)
            except Exception:
                pass

        # Time stretch — hafif (sadece anlamlıysa ve yeterli uzunlukta)
        if sustain > 1.05 and len(processed) >= 4096:
            try:
                processed = librosa.effects.time_stretch(
                    processed, rate=1.0 / sustain
                ).astype(np.float32)
            except Exception:
                pass

        # Vibrato — sadece uzun segmentler + yüksek intensity
        if enable_vibrato and vib_depth_cents > 3 and len(processed) > int(sr * 0.35):
            processed = _add_vibrato(processed, sr, vib_depth_cents, vib_rate, vib_onset)

        parts.append(processed)

    # ── 5) 30ms crossfade birleştirme ──
    result = _crossfade_concat(parts, sr, ms=30)

    # ── 6) Dinamik kontrol ──
    dyn = g['dynamics_chorus'] if section_type == 'chorus' else g['dynamics_verse']
    result *= (1.0 + (dyn - 1.0) * intensity)

    # ── 7) Peak güvenliği ──
    peak = np.abs(result).max()
    if peak > 0.95:
        result = result / peak * 0.92

    return result.astype(np.float32)


# ═══════════════════════════════════════════════════
# METİN BÖLÜMLEME
# ═══════════════════════════════════════════════════

def parse_sections(text):
    """
    Metni bölümlere ayır.
    [kuple], [nakarat], [köprü] etiketleri veya otomatik.
    """
    import re

    tag_map = {
        'verse': 'verse', 'kuple': 'verse', 'küple': 'verse', 'mısra': 'verse',
        'chorus': 'chorus', 'nakarat': 'chorus', 'refren': 'chorus',
        'bridge': 'bridge', 'köprü': 'bridge', 'kopru': 'bridge',
        'intro': 'intro', 'giriş': 'intro', 'giris': 'intro',
        'outro': 'outro', 'çıkış': 'outro', 'cikis': 'outro', 'final': 'outro',
    }

    parts = re.split(r'\[([^\]]+)\]', text)
    sections = []

    if len(parts) > 1:
        current_type = 'verse'
        for part in parts:
            ps = part.strip()
            if not ps:
                continue
            if ps.lower() in tag_map:
                current_type = tag_map[ps.lower()]
            else:
                sections.append((current_type, ps))
    else:
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        if len(paragraphs) <= 1:
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            if len(lines) <= 2:
                sections.append(('verse', text.strip()))
            else:
                mid = len(lines) // 2
                sections.append(('verse', '\n'.join(lines[:mid])))
                sections.append(('chorus', '\n'.join(lines[mid:])))
        else:
            for i, para in enumerate(paragraphs):
                sections.append(('verse' if i % 2 == 0 else 'chorus', para))

    if not sections:
        sections.append(('verse', text.strip()))
    return sections
