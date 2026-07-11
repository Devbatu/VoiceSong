"""
Singing Engine V12 — Phrase-Aware Controlled Imperfection

V11 → V12 DEĞİŞİKLİKLER:
- Phrase-Aware Engine: frame-based → phrase-based processing
- Controlled Imperfection: deterministic phrase-based micro drift (random jitter DEĞİL)
- Vowel Clustering: bright/dark vowel groups → karakter geri gelir (per-bin complexity YOK)
- Energy Envelope Coupling: expression → amplitude + vibrato depth birlikte
- Shaped Breath: lowpass-filtered, envelope-shaped breath (noise DEĞİL, %3 mix)
- Consonant Transients: plosive (k,t,p) + fricative transient boost
- Turkish Prosody: son hece vurgusu, uzun ünlü sustain artışı
- Pipeline: Syllabify → NoteEvent grid → Phrase detection → Onset align
           → f0 assign → Sigmoid transitions → Phrase-aware expression
           → Energy coupling → Tonality → Consonant onset+transient
           → Vowel-clustered formant shift → Turkish prosody
           → Vowel stretch → Coupled vibrato → WORLD synth
           → Shaped breath → Amplitude vibrato → Dynamics
"""

import numpy as np
import librosa
import pyworld as pw
from scipy.signal import butter, sosfiltfilt, lfilter


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
# TÜR PREsetleri — V6 (Suno-Quality + Mastering)
# ═══════════════════════════════════════════════════

_MELODY_V = [0, 0, 2, 3, 2, 0, 1, 0, -1, 0, 2, 1, 0, 1, 0, -1]
_MELODY_C = [4, 4, 5, 6, 5, 4, 3, 4, 5, 4, 3, 2, 3, 4, 3, 4]

GENRE_PRESETS = {
    'pop': {
        'name': 'Pop', 'scale_type': 'major',
        # V22: Turkish singing quality — deep vibrato + tight pitch lock + slow TTS
        'sustain_ratio': 1.65, 'vibrato_depth': 0.050, 'vibrato_rate': 5.8, 'vibrato_onset': 0.15,
        'dynamics_verse': 0.82, 'dynamics_chorus': 1.0, 'pitch_snap': 0.95, 'max_shift_st': 4.0,
        'verse_melody': _MELODY_V, 'chorus_melody': _MELODY_C,
        'reverb_amount': 0.03, 'eq_profile': 'bright', 'compression': 0.5,
        # V22: Even slower TTS = much more singing material
        'prosody': {'verse': ('+0Hz', '-25%'), 'chorus': ('+6Hz', '-18%'), 'bridge': ('+3Hz', '-28%')},
    },
    'ballad': {
        'name': 'Balad', 'scale_type': 'major',
        'sustain_ratio': 1.55, 'vibrato_depth': 0.018, 'vibrato_rate': 5.0, 'vibrato_onset': 0.35,
        'dynamics_verse': 0.70, 'dynamics_chorus': 1.0, 'pitch_snap': 0.75, 'max_shift_st': 3.5,
        'verse_melody': [0, -1, 0, 2, 3, 2, 0, -1, 0, 1, 2, 1, 0, -1, 0, 0],
        'chorus_melody': [3, 4, 5, 6, 5, 4, 3, 2, 3, 5, 6, 5, 4, 3, 4, 3],
        'reverb_amount': 0.04, 'eq_profile': 'warm', 'compression': 0.3,
        'prosody': {'verse': ('-2Hz', '-18%'), 'chorus': ('+3Hz', '-8%'), 'bridge': ('+0Hz', '-22%')},
    },
    'arabesk': {
        'name': 'Arabesk', 'scale_type': 'minor',
        'sustain_ratio': 1.50, 'vibrato_depth': 0.020, 'vibrato_rate': 5.8, 'vibrato_onset': 0.30,
        'dynamics_verse': 0.75, 'dynamics_chorus': 1.0, 'pitch_snap': 0.70, 'max_shift_st': 3.5,
        'verse_melody': [0, -1, 0, 1, 3, 2, 0, -1, -2, -1, 0, 2, 3, 2, 0, -1],
        'chorus_melody': [3, 4, 5, 4, 3, 5, 6, 5, 3, 4, 5, 6, 5, 4, 3, 2],
        'reverb_amount': 0.03, 'eq_profile': 'warm', 'compression': 0.4,
        'prosody': {'verse': ('-2Hz', '-12%'), 'chorus': ('+3Hz', '-5%'), 'bridge': ('+0Hz', '-18%')},
    },
    'rock': {
        'name': 'Rock', 'scale_type': 'minor',
        'sustain_ratio': 1.30, 'vibrato_depth': 0.010, 'vibrato_rate': 5.5, 'vibrato_onset': 0.50,
        'dynamics_verse': 0.90, 'dynamics_chorus': 1.0, 'pitch_snap': 0.82, 'max_shift_st': 4.5,
        'verse_melody': [0, 0, 2, 0, 3, 2, 0, 0, -1, 0, 2, 3, 2, 0, -1, 0],
        'chorus_melody': [4, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 4, 5, 4, 3, 4],
        'reverb_amount': 0.02, 'eq_profile': 'bright', 'compression': 0.6,
        'prosody': {'verse': ('+0Hz', '-5%'), 'chorus': ('+5Hz', '+0%'), 'bridge': ('+2Hz', '-10%')},
    },
    'turk_halk': {
        'name': 'Türk Halk', 'scale_type': 'minor',
        'sustain_ratio': 1.45, 'vibrato_depth': 0.015, 'vibrato_rate': 5.0, 'vibrato_onset': 0.35,
        'dynamics_verse': 0.80, 'dynamics_chorus': 0.95, 'pitch_snap': 0.70, 'max_shift_st': 3.5,
        'verse_melody': [0, 1, 0, -1, 0, 2, 3, 2, 0, -1, 0, 1, 2, 1, 0, -1],
        'chorus_melody': [2, 3, 4, 5, 4, 3, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1],
        'reverb_amount': 0.03, 'eq_profile': 'warm', 'compression': 0.35,
        'prosody': {'verse': ('+0Hz', '-12%'), 'chorus': ('+2Hz', '-5%'), 'bridge': ('+0Hz', '-18%')},
    },
    'rnb': {
        'name': 'R&B / Soul', 'scale_type': 'minor',
        'sustain_ratio': 1.50, 'vibrato_depth': 0.018, 'vibrato_rate': 5.5, 'vibrato_onset': 0.30,
        'dynamics_verse': 0.75, 'dynamics_chorus': 1.0, 'pitch_snap': 0.65, 'max_shift_st': 3.5,
        'verse_melody': [0, 2, 0, -1, 0, 3, 2, 0, 1, 0, -1, 0, 2, 3, 2, 0],
        'chorus_melody': [3, 5, 4, 3, 4, 5, 6, 5, 4, 3, 5, 4, 3, 2, 3, 4],
        'reverb_amount': 0.04, 'eq_profile': 'airy', 'compression': 0.4,
        'prosody': {'verse': ('-2Hz', '-15%'), 'chorus': ('+3Hz', '-5%'), 'bridge': ('+1Hz', '-20%')},
    },
    'hiphop': {
        'name': 'Hip-Hop / Rap', 'scale_type': 'minor',
        'sustain_ratio': 1.12, 'vibrato_depth': 0.004, 'vibrato_rate': 5.0, 'vibrato_onset': 0.7,
        'dynamics_verse': 0.95, 'dynamics_chorus': 1.0, 'pitch_snap': 0.40, 'max_shift_st': 2.5,
        'verse_melody': [0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, -1, 0, 0, 0],
        'chorus_melody': [2, 3, 2, 0, 2, 3, 4, 3, 2, 0, 2, 3, 2, 0, -1, 0],
        'reverb_amount': 0.02, 'eq_profile': 'bright', 'compression': 0.7,
        'prosody': {'verse': ('+0Hz', '+0%'), 'chorus': ('+4Hz', '+5%'), 'bridge': ('+0Hz', '-5%')},
    },
    'electronic': {
        'name': 'Elektronik / EDM', 'scale_type': 'minor',
        'sustain_ratio': 1.30, 'vibrato_depth': 0.006, 'vibrato_rate': 6.0, 'vibrato_onset': 0.55,
        'dynamics_verse': 0.85, 'dynamics_chorus': 1.0, 'pitch_snap': 0.85, 'max_shift_st': 4.5,
        'verse_melody': [0, 2, 0, 3, 5, 3, 0, 2, 0, -2, 0, 3, 5, 3, 2, 0],
        'chorus_melody': [5, 7, 5, 3, 5, 7, 8, 7, 5, 3, 5, 7, 5, 3, 2, 3],
        'reverb_amount': 0.03, 'eq_profile': 'airy', 'compression': 0.6,
        'prosody': {'verse': ('+0Hz', '-5%'), 'chorus': ('+6Hz', '+0%'), 'bridge': ('+3Hz', '-10%')},
    },
    'jazz': {
        'name': 'Jazz', 'scale_type': 'major',
        'sustain_ratio': 1.50, 'vibrato_depth': 0.022, 'vibrato_rate': 5.2, 'vibrato_onset': 0.25,
        'dynamics_verse': 0.70, 'dynamics_chorus': 0.90, 'pitch_snap': 0.60, 'max_shift_st': 4.0,
        'verse_melody': [0, 2, 4, 2, 0, -1, 2, 0, 3, 2, 0, -2, 0, 2, 3, 0],
        'chorus_melody': [4, 5, 7, 5, 4, 2, 4, 5, 7, 5, 4, 2, 0, 2, 4, 2],
        'reverb_amount': 0.04, 'eq_profile': 'warm', 'compression': 0.25,
        'prosody': {'verse': ('-2Hz', '-15%'), 'chorus': ('+2Hz', '-5%'), 'bridge': ('+0Hz', '-20%')},
    },
    'klasik': {
        'name': 'Klasik / Opera', 'scale_type': 'major',
        'sustain_ratio': 1.55, 'vibrato_depth': 0.025, 'vibrato_rate': 5.5, 'vibrato_onset': 0.25,
        'dynamics_verse': 0.65, 'dynamics_chorus': 1.0, 'pitch_snap': 0.75, 'max_shift_st': 4.5,
        'verse_melody': [0, 2, 4, 5, 4, 2, 0, -1, 0, 2, 4, 5, 7, 5, 4, 2],
        'chorus_melody': [5, 7, 8, 7, 5, 4, 5, 7, 8, 10, 8, 7, 5, 4, 2, 0],
        'reverb_amount': 0.05, 'eq_profile': 'full', 'compression': 0.2,
        'prosody': {'verse': ('-3Hz', '-20%'), 'chorus': ('+4Hz', '-5%'), 'bridge': ('+0Hz', '-15%')},
    },
}


def get_genre(genre_name=None):
    """
    V20: Tek iyi ayarlanmış preset döndürür.
    Genre/mood seçicileri kaldırıldı — tüm stil kontrolü metin içi [tag]'lar ile yapılır.
    """
    return GENRE_PRESETS['pop']


# ═══════════════════════════════════════════════════
# MOOD PREsetleri — V20: Devre dışı (backward compat için boş kalır)
# ═══════════════════════════════════════════════════

MOOD_PRESETS = {}


def parse_style_prompt(style_text):
    """V20: Artık kullanılmıyor — boş dict döndürür."""
    return {}


def get_section_prosody(section_type, genre_name='pop'):
    """Get Edge TTS pitch/rate params for a section type."""
    g = get_genre()
    prosody = g.get('prosody', {})
    pitch, rate = prosody.get(section_type, prosody.get('verse', ('+0Hz', '+0%')))
    return {'pitch': pitch, 'rate': rate}


# ═══════════════════════════════════════════════════
# SUNO-STYLE PERFORMANCE TAGS — Vokal teslimatını değiştiren etiketler
# ═══════════════════════════════════════════════════

PERFORMANCE_TAGS = {
    # V22: Turkish singing quality — zengin vibrato + güçlü nota kilidi
    # snap: pitch snap (0=konuşma, 1=tam nota kilidi)
    # tonality: aperiodicity (0=nefesli, 1=temiz tonal ses)
    # vibrato_mult: vibrato derinlik çarpanı (genre base × bu)
    # sustain_mult: ünlü uzatma çarpanı
    # intensity_mult: genel yoğunluk
    # dynamics: ses seviyesi çarpanı
    # f0_shift_st: perde kaydırma (yarım ton)
    # ap_breathiness: nefes katkısı (0=temiz, 1=nefesli)

    'soft':     {'snap': 0.88, 'tonality': 0.55, 'vibrato_mult': 0.9, 'sustain_mult': 1.3, 'intensity_mult': 0.55, 'dynamics': 0.75, 'f0_shift_st': 0,  'ap_breathiness': 0.06},
    'whisper':  {'snap': 0.55, 'tonality': 0.22, 'vibrato_mult': 0.3, 'sustain_mult': 0.9, 'intensity_mult': 0.30, 'dynamics': 0.50, 'f0_shift_st': 0,  'ap_breathiness': 0.35},
    'belting':  {'snap': 0.97, 'tonality': 0.92, 'vibrato_mult': 1.8, 'sustain_mult': 1.5, 'intensity_mult': 1.00, 'dynamics': 1.20, 'f0_shift_st': 2,  'ap_breathiness': 0.0},
    'rap':      {'snap': 0.15, 'tonality': 0.15, 'vibrato_mult': 0.0, 'sustain_mult': 0.5, 'intensity_mult': 0.85, 'dynamics': 1.00, 'f0_shift_st': 0,  'ap_breathiness': 0.0},
    'spoken':   {'snap': 0.12, 'tonality': 0.10, 'vibrato_mult': 0.0, 'sustain_mult': 0.5, 'intensity_mult': 0.50, 'dynamics': 0.85, 'f0_shift_st': 0,  'ap_breathiness': 0.05},
    'falsetto': {'snap': 0.94, 'tonality': 0.72, 'vibrato_mult': 1.0, 'sustain_mult': 1.4, 'intensity_mult': 0.55, 'dynamics': 0.68, 'f0_shift_st': 5,  'ap_breathiness': 0.10},
    'powerful': {'snap': 0.97, 'tonality': 0.90, 'vibrato_mult': 1.7, 'sustain_mult': 1.3, 'intensity_mult': 1.00, 'dynamics': 1.22, 'f0_shift_st': 1,  'ap_breathiness': 0.0},
    'adlib':    {'snap': 0.78, 'tonality': 0.58, 'vibrato_mult': 2.0, 'sustain_mult': 1.5, 'intensity_mult': 0.70, 'dynamics': 0.88, 'f0_shift_st': 0,  'ap_breathiness': 0.0},
    'building': {'snap': 0.85, 'tonality': 0.58, 'vibrato_mult': 1.0, 'sustain_mult': 1.2, 'intensity_mult': 0.70, 'dynamics': 0.78, 'f0_shift_st': 0,  'ap_breathiness': 0.0},
    'crescendo':{'snap': 0.92, 'tonality': 0.68, 'vibrato_mult': 1.3, 'sustain_mult': 1.3, 'intensity_mult': 0.85, 'dynamics': 1.05, 'f0_shift_st': 1,  'ap_breathiness': 0.0},
    'emotional':{'snap': 0.92, 'tonality': 0.62, 'vibrato_mult': 2.0, 'sustain_mult': 1.45, 'intensity_mult': 0.80, 'dynamics': 0.95, 'f0_shift_st': 0,  'ap_breathiness': 0.02},
}

# V22: Per-tag TTS prosody — daha yavaş TTS = daha fazla şarkı materyali
_PERF_TTS_PROSODY = {
    'soft':      {'rate': '-22%', 'pitch': '-2Hz', 'volume': '-3dB'},
    'whisper':   {'rate': '-18%', 'pitch': '-3Hz', 'volume': '-6dB'},
    'belting':   {'rate': '-18%', 'pitch': '+6Hz', 'volume': '+3dB'},
    'rap':       {'rate': '+10%', 'pitch': '-1Hz', 'volume': '+0dB'},
    'spoken':    {'rate': '+0%',  'pitch': '+0Hz', 'volume': '-2dB'},
    'falsetto':  {'rate': '-15%', 'pitch': '+8Hz', 'volume': '-2dB'},
    'powerful':  {'rate': '-15%', 'pitch': '+5Hz', 'volume': '+3dB'},
    'adlib':     {'rate': '-20%', 'pitch': '+3Hz', 'volume': '+0dB'},
    'building':  {'rate': '-10%', 'pitch': '+0Hz', 'volume': '+0dB'},
    'crescendo': {'rate': '-12%', 'pitch': '+3Hz', 'volume': '+0dB'},
    'emotional': {'rate': '-25%', 'pitch': '+2Hz', 'volume': '-1dB'},
}


def get_perf_tts_prosody(perf_tag):
    """Performance tag'e göre TTS rate/pitch/volume override döndürür."""
    if not perf_tag:
        return None
    tag = _PERF_TAG_ALIASES.get(perf_tag.lower().strip(), perf_tag.lower().strip())
    return _PERF_TTS_PROSODY.get(tag)

# V20: Turkish + English aliases for performance tags
_PERF_TAG_ALIASES = {
    # Türkçe
    'yumuşak': 'soft', 'fısıltı': 'whisper', 'güçlü': 'belting',
    'bağırma': 'belting', 'rap': 'rap', 'konuşma': 'spoken',
    'falsetto': 'falsetto', 'falseto': 'falsetto', 'falset': 'falsetto',
    'güçlü ses': 'powerful', 'adlib': 'adlib', 'ad-lib': 'adlib',
    'artarak': 'building', 'crescendo': 'crescendo', 'duygusal': 'emotional',
    'yükseliş': 'crescendo', 'yükselme': 'crescendo',
    'fısıldama': 'whisper', 'kuvvetli': 'powerful',
    'hisli': 'emotional', 'doğaçlama': 'adlib',
    # English pass-through
    'soft': 'soft', 'whisper': 'whisper', 'belting': 'belting',
    'spoken': 'spoken', 'powerful': 'powerful', 'building': 'building',
    'emotional': 'emotional',
}


# V11: Expression Bus — tek sinyal → clean vokal parametreleri
# expression ∈ [0,1]: 0=whisper/spoken, 0.5=normal, 1.0=belting/powerful
# NOT: breathiness/noise_grit devre dışı — TTS üzerinde noise injection bulanıklık yaratır.
# V21: Expression profiles — daha agresif ifade
_EXPR_PROFILES = {
    'soft':     {'expr_base': 0.35},
    'whisper':  {'expr_base': 0.15},
    'belting':  {'expr_base': 0.95},
    'rap':      {'expr_base': 0.45},
    'spoken':   {'expr_base': 0.15},
    'falsetto': {'expr_base': 0.60},
    'powerful': {'expr_base': 0.92},
    'adlib':    {'expr_base': 0.70},
    'building': {'expr_base': 0.55},
    'crescendo':{'expr_base': 0.65},
    'emotional':{'expr_base': 0.70},
}


def _expr_to_params(expr):
    """
    V11 Expression Bus: tek float → temiz vokal parametreleri (coupled).
    Sadece pitch/tonality/vibrato/dynamics kontrolü — noise injection YOK.
    """
    # V21: More expressive parameters for musical singing
    e = max(0.0, min(1.0, expr))
    return {
        'vibrato_mult':  0.5 + e * 1.5,               # 0.5 → 2.0 (daha derin vibrato)
        'onset_attack':  0.1 + e * 0.5,               # 0.1 → 0.6
        'formant_shift': 0.1 + e * 0.4,               # 0.1 → 0.5
        'expression':    0.25 + e * 0.55,              # 0.25 → 0.80 (daha geniş ifade aralığı)
        'jitter_depth':  1.0 + e * 3.0,               # 1 → 4 cent
        'tonality':      0.30 + e * 0.55,             # 0.30 → 0.85 (daha temiz ton)
    }


def get_performance_override(perf_tag):
    """V11: Performance tag → expression bus üzerinden temiz parametre seti."""
    if not perf_tag:
        return None
    tag = perf_tag.lower().strip()
    tag = _PERF_TAG_ALIASES.get(tag, tag)
    base = PERFORMANCE_TAGS.get(tag, None)
    if base is None:
        return None
    result = dict(base)
    # Expression bus: clean parameters only
    profile = _EXPR_PROFILES.get(tag, {'expr_base': 0.5})
    expr_params = _expr_to_params(profile['expr_base'])
    expr_params['expr_base'] = profile['expr_base']
    result.update(expr_params)
    return result


# ═══════════════════════════════════════════════════
# V6 YARDIMCI FONKSİYONLAR
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
# V9: NOTE-LEVEL ŞARKI SENTEZİ
# ═══════════════════════════════════════════════════

# Türkçe ünlüler (vowel-only stretching için)
_TR_VOWELS = set('aeıioöuüAEIİOÖUÜ')


def syllabify_turkish(text):
    """
    Türkçe hece ayırma (kural tabanlı).
    Türkçe fonolojik kuralları:
    - İki ünlü arası tek ünsüz → sonraki heceye: a-ra-ba
    - İki ünlü arası iki ünsüz → ilki önceki heceye: al-tın
    - Hece yapıları: V, CV, VC, CVC, VCC, CVCC
    Döndürür: hece listesi (noktalama hariç, sadece harf heceler).
    """
    clean = ''.join(ch for ch in text if ch.isalpha() or ch == ' ')
    words = clean.split()
    all_syllables = []

    for word in words:
        if not word:
            continue
        vpos = [i for i, ch in enumerate(word) if ch.lower() in 'aeıioöuü']

        if not vpos:
            if word:
                all_syllables.append(word)
            continue

        if len(vpos) == 1:
            all_syllables.append(word)
            continue

        prev_cut = 0
        for vi in range(len(vpos) - 1):
            v1, v2 = vpos[vi], vpos[vi + 1]
            n_cons = v2 - v1 - 1

            if n_cons <= 1:
                cut = v1 + 1
            elif n_cons == 2:
                cut = v1 + 2
            else:
                # V19: 3+ ünsüz → son ünsüz hariç hepsi önceki heceye
                # Türkçe kural: "Türk-çe", "eks-tre", "alt-rın"
                cut = v1 + n_cons

            all_syllables.append(word[prev_cut:cut])
            prev_cut = cut

        all_syllables.append(word[prev_cut:])

    return [s for s in all_syllables if s] or ['']


def syllabify_turkish_ex(text):
    """
    V14: Türkçe hece ayırma + kelime sınır bilgisi.
    Döndürür: (syllables, is_word_last) — is_word_last[i]=True ise syllables[i] kelimenin son hecesi.
    """
    clean = ''.join(ch for ch in text if ch.isalpha() or ch == ' ')
    words = clean.split()
    all_syllables = []
    is_word_last = []

    for word in words:
        if not word:
            continue
        vpos = [i for i, ch in enumerate(word) if ch.lower() in 'aeıioöuü']

        if not vpos:
            if word:
                all_syllables.append(word)
                is_word_last.append(True)
            continue

        if len(vpos) == 1:
            all_syllables.append(word)
            is_word_last.append(True)
            continue

        prev_cut = 0
        word_syls = []
        for vi in range(len(vpos) - 1):
            v1, v2 = vpos[vi], vpos[vi + 1]
            n_cons = v2 - v1 - 1
            if n_cons <= 1:
                cut = v1 + 1
            elif n_cons == 2:
                cut = v1 + 2
            else:
                # V19: 3+ ünsüz → son ünsüz hariç hepsi önceki heceye
                cut = v1 + n_cons
            word_syls.append(word[prev_cut:cut])
            prev_cut = cut
        word_syls.append(word[prev_cut:])
        word_syls = [s for s in word_syls if s]

        for k, syl in enumerate(word_syls):
            all_syllables.append(syl)
            is_word_last.append(k == len(word_syls) - 1)

    if not all_syllables:
        return [''], [True]
    return all_syllables, is_word_last


def _syllable_has_vowel(syl):
    """Hece ünlü içeriyor mu?"""
    return any(ch in _TR_VOWELS for ch in syl)


def _syllable_vowel_ratio(syl):
    """Hecedeki ünlü oranı (0.0-1.0). Uzatma miktarını belirler."""
    if not syl:
        return 0.0
    vowel_count = sum(1 for ch in syl if ch in _TR_VOWELS)
    return vowel_count / len(syl)


class NoteEvent:
    """V14: Müzikal nota + Türkçe vurgu bilgisi."""
    __slots__ = ('syllable', 'freq_hz', 'duration_beats', 'articulation',
                 'vowel_ratio', 'start_frame', 'end_frame',
                 'stress', 'word_pos')

    def __init__(self, syllable, freq_hz, duration_beats=0.5,
                 articulation='legato', stress=0.0, word_pos='mid'):
        self.syllable = syllable
        self.freq_hz = freq_hz
        self.duration_beats = duration_beats
        self.articulation = articulation  # 'legato' | 'staccato'
        self.vowel_ratio = _syllable_vowel_ratio(syllable)
        self.start_frame = 0
        self.end_frame = 0
        self.stress = stress          # 0.0-1.0: vurgu seviyesi
        self.word_pos = word_pos      # 'first'|'mid'|'last'|'only'

    def __repr__(self):
        return (f"Note({self.syllable!r}, {self.freq_hz:.1f}Hz, "
                f"{self.duration_beats:.2f}beat, {self.articulation}, "
                f"stress={self.stress:.1f}, {self.word_pos})")


def detect_syllable_onsets(audio, sr, num_syllables):
    """
    Audio'daki hece sınırlarını tespit et.
    Onset detection + enerji analizi ile N heceye bölme.
    Döndürür: [(start_frame, end_frame), ...] — WORLD frame indeksleri.
    """
    fp = 5.0
    hop_w = int(fp / 1000.0 * sr)
    n_world = int(len(audio) / hop_w) + 1

    if num_syllables <= 1:
        return [(0, n_world)]

    # 1. librosa onset detection
    hop = 512
    try:
        onset_env = librosa.onset.onset_strength(y=audio, sr=sr, hop_length=hop)
        raw_onsets = librosa.onset.onset_detect(
            y=audio, sr=sr, hop_length=hop,
            onset_envelope=onset_env,
            backtrack=True,
            delta=0.05,
            wait=max(1, int(0.06 * sr / hop))
        )
    except Exception:
        raw_onsets = np.array([], dtype=int)

    # 2. Convert to WORLD frame indices
    if len(raw_onsets) > 0:
        onset_samples = raw_onsets * hop
        onset_wf = np.unique(np.clip(onset_samples // hop_w, 0, n_world - 1).astype(int))
    else:
        onset_wf = np.array([], dtype=int)

    # 3. Merge close onsets (< 40ms = 8 WORLD frames at fp=5ms)
    min_gap = max(1, int(0.04 * 1000 / fp))
    merged = []
    for o in onset_wf:
        o_int = int(o)
        if not merged or o_int - merged[-1] >= min_gap:
            merged.append(o_int)

    # 4. Ensure starts at 0
    if not merged or merged[0] != 0:
        merged = [0] + merged

    # 5. Prune to target count: need exactly num_syllables boundaries
    while len(merged) > num_syllables:
        min_seg = float('inf')
        min_idx = 1
        for i in range(1, len(merged)):
            seg_end = merged[i + 1] if i + 1 < len(merged) else n_world
            seg_len = seg_end - merged[i]
            if seg_len < min_seg:
                min_seg = seg_len
                min_idx = i
        merged.pop(min_idx)

    while len(merged) < num_syllables:
        max_seg, max_idx = 0, 0
        for i in range(len(merged)):
            seg_end = merged[i + 1] if i + 1 < len(merged) else n_world
            seg_len = seg_end - merged[i]
            if seg_len > max_seg:
                max_seg = seg_len
                max_idx = i
        seg_start = merged[max_idx]
        seg_end = merged[max_idx + 1] if max_idx + 1 < len(merged) else n_world
        merged.insert(max_idx + 1, (seg_start + seg_end) // 2)

    # 6. Build segments
    segments = []
    for i in range(len(merged)):
        start = merged[i]
        end = merged[i + 1] if i + 1 < len(merged) else n_world
        segments.append((start, end))

    return segments


# ═══════════════════════════════════════════════════
# V17: BPM-SYNCED TIMING — "Sarhoş ses" çözümü
# ═══════════════════════════════════════════════════

def _build_beat_grid(bpm, total_frames, fr, subdivisions=4):
    """
    BPM'e göre beat subdivision grid'i oluştur.
    subdivisions=4 → 16th note grid (en yaygın şarkı grid'i).
    Döndürür: frame indekslerinden oluşan sorted array.
    """
    beat_dur_sec = 60.0 / max(bpm, 60)
    subdiv_dur_sec = beat_dur_sec / subdivisions
    subdiv_dur_frames = subdiv_dur_sec * fr

    grid = []
    pos = 0.0
    while pos < total_frames:
        grid.append(int(round(pos)))
        pos += subdiv_dur_frames
    return np.array(grid, dtype=int)


def _snap_to_grid(frame_idx, grid):
    """Frame indeksini en yakın grid noktasına snap et."""
    if len(grid) == 0:
        return frame_idx
    diffs = np.abs(grid - frame_idx)
    return int(grid[np.argmin(diffs)])


def align_tts_to_bpm(audio, sr, bpm, syllables, is_word_last=None):
    """
    V19: TTS çıkışını BPM grid'ine YUMUŞAK hizala.

    V17/V18 rigid beat-grid forcing Türkçe doğal prozodiyiyi bozuyordu:
    - Kelimeler kısa kesiliyordu
    - Cümleler hızlı akıyordu
    - Türkçe okunuş kuralları bozuluyordu

    V19 yaklaşım: "Soft nudging" — %60 orijinal süre + %40 BPM hedef süre.
    Doğal Türkçe konuşma ritmini korurken tempo hissini hafifçe verir.
    Minimum hece süresi: 100ms (Türkçe fonoloji minimum).
    Max stretch: ±20% (kelime bütünlüğü korunur).
    """
    n_syl = len(syllables)

    if n_syl <= 1:
        return audio

    # 1) Onset detection ile hece sınırlarını bul
    hop = 512
    try:
        onset_env = librosa.onset.onset_strength(y=audio, sr=sr, hop_length=hop)
        raw_onsets = librosa.onset.onset_detect(
            y=audio, sr=sr, hop_length=hop, onset_envelope=onset_env,
            backtrack=True, delta=0.05,
            wait=max(1, int(0.06 * sr / hop))
        )
        onset_samples = (raw_onsets * hop).tolist()
    except Exception:
        onset_samples = []

    # Merge close onsets
    min_gap_samples = int(0.04 * sr)
    merged_samples = [0]
    for o in onset_samples:
        if o - merged_samples[-1] >= min_gap_samples:
            merged_samples.append(o)

    # Prune/expand to n_syl boundaries
    while len(merged_samples) > n_syl:
        min_seg = float('inf')
        min_idx = 1
        for i in range(1, len(merged_samples)):
            seg_end = merged_samples[i + 1] if i + 1 < len(merged_samples) else len(audio)
            seg_len = seg_end - merged_samples[i]
            if seg_len < min_seg:
                min_seg = seg_len
                min_idx = i
        merged_samples.pop(min_idx)

    while len(merged_samples) < n_syl:
        max_seg, max_idx = 0, 0
        for i in range(len(merged_samples)):
            seg_end = merged_samples[i + 1] if i + 1 < len(merged_samples) else len(audio)
            seg_len = seg_end - merged_samples[i]
            if seg_len > max_seg:
                max_seg = seg_len
                max_idx = i
        seg_start = merged_samples[max_idx]
        seg_end = merged_samples[max_idx + 1] if max_idx + 1 < len(merged_samples) else len(audio)
        merged_samples.insert(max_idx + 1, (seg_start + seg_end) // 2)

    # 2) BPM hedef süreleri
    beat_dur_sec = 60.0 / max(bpm, 60)
    eighth_note_sec = beat_dur_sec / 2.0

    if is_word_last is None:
        is_word_last = [False] * n_syl
        is_word_last[-1] = True

    target_durations = []
    for i in range(n_syl):
        syl = syllables[i]
        vr = _syllable_vowel_ratio(syl)
        if is_word_last[i]:
            target_durations.append(beat_dur_sec * 0.75)
        elif vr >= 0.4:
            target_durations.append(eighth_note_sec)
        else:
            target_durations.append(eighth_note_sec)

    # V19: Minimum hece süresi — Türkçe fonoloji
    MIN_SYL_DUR = 0.10  # 100ms — hiçbir hece bundan kısa olamaz

    # 3) V19: Soft nudging — %60 orijinal + %40 hedef (doğal Türkçe prozodi korunur)
    BLEND_ORIGINAL = 0.60  # Orijinal TTS süresini koru
    BLEND_TARGET = 0.40    # BPM grid'e hafifçe çek

    segments = []
    for i in range(n_syl):
        seg_start = merged_samples[i]
        seg_end = merged_samples[i + 1] if i + 1 < len(merged_samples) else len(audio)
        seg = audio[seg_start:seg_end]

        if len(seg) < int(0.02 * sr):
            segments.append(seg)
            continue

        current_dur = len(seg) / sr
        target_dur = target_durations[i]

        # V19: Blended hedef — orijinal ritmi büyük ölçüde koru
        blended_dur = current_dur * BLEND_ORIGINAL + target_dur * BLEND_TARGET

        # Minimum süre koruması
        blended_dur = max(blended_dur, MIN_SYL_DUR)

        stretch_rate = current_dur / blended_dur
        # V19: Max ±20% stretch (eskiden ±60% — kelimeleri bozuyordu)
        stretch_rate = max(0.83, min(1.20, stretch_rate))

        if abs(stretch_rate - 1.0) < 0.08:
            # %8 içindeyse dokunma — doğal bırak
            segments.append(seg)
        else:
            try:
                stretched = librosa.effects.time_stretch(seg, rate=stretch_rate)
                # RMS normalization
                rms_orig = np.sqrt(np.mean(seg ** 2)) + 1e-10
                rms_new = np.sqrt(np.mean(stretched ** 2)) + 1e-10
                stretched = stretched * (rms_orig / rms_new)
                segments.append(stretched.astype(np.float32))
            except Exception:
                segments.append(seg)

    # 4) Crossfade ile birleştir
    result = _crossfade_concat(
        [s.astype(np.float32) for s in segments], sr, ms=20
    )

    # Peak safety
    peak = np.abs(result).max()
    if peak > 0.95:
        result = result / peak * 0.92

    return result.astype(np.float32)


def _quantize_onsets_to_grid(onset_segments, bpm, fr, nf):
    """
    V17: Onset segment sınırlarını BPM grid'ine snap et.
    Her segment başlangıcını en yakın beat subdivision'a taşır.
    Segment süreleri de grid'e uyumlu hale gelir.
    """
    grid = _build_beat_grid(bpm, nf, fr, subdivisions=4)
    if len(grid) < 2:
        return onset_segments

    quantized = []
    for i, (start, end) in enumerate(onset_segments):
        q_start = _snap_to_grid(start, grid)
        if i + 1 < len(onset_segments):
            q_end = _snap_to_grid(onset_segments[i + 1][0], grid)
        else:
            q_end = nf

        # Ensure minimum segment length (30ms)
        min_frames = max(2, int(0.03 * fr))
        if q_end - q_start < min_frames:
            q_end = min(q_start + min_frames, nf)

        # Ensure no overlap with previous
        if quantized and q_start < quantized[-1][1]:
            q_start = quantized[-1][1]

        if q_start < q_end:
            quantized.append((q_start, q_end))
        else:
            quantized.append((start, end))  # fallback

    return quantized


def build_note_events(syllables, key, scale_type, section_type,
                      genre_name, bpm, med_f0, scale, root_idx,
                      is_word_last=None):
    """
    V14: Her hece için NoteEvent üret — Türkçe kelime vurgusuyla.

    Kelime vurgusu:
    - Son hece (is_word_last): +1 scale degree, +50% süre, stress=1.0
    - İlk hece: hafif attack, stress=0.3
    - Orta hece: legato, stress=0.1
    - Tek heceli kelime: stress=0.7

    Süre ataması:
    - Ünlü oranlı + vurgu çarpanı
    - Son hece 1.5x süre
    """
    g = get_genre(genre_name)
    pattern = g['chorus_melody'] if section_type in ('chorus', 'refren') else g['verse_melody']
    n_syl = len(syllables)

    if n_syl == 0:
        return []

    # Default word_last flags: only very last syllable
    if is_word_last is None:
        is_word_last = [False] * n_syl
        is_word_last[-1] = True

    # Detect word positions: first/mid/last/only
    word_positions = []
    for i in range(n_syl):
        is_last = is_word_last[i]
        # Is this the first syllable of its word?
        is_first = (i == 0) or is_word_last[i - 1]
        if is_first and is_last:
            word_positions.append('only')
        elif is_first:
            word_positions.append('first')
        elif is_last:
            word_positions.append('last')
        else:
            word_positions.append('mid')

    plen = len(pattern)

    # Melodi dereceleri: genre pattern → hece sayısına dağıt
    if n_syl == 1:
        degrees = [pattern[0]]
    elif n_syl <= plen:
        indices = np.linspace(0, plen - 1, n_syl)
        degrees = [pattern[min(int(round(idx)), plen - 1)] for idx in indices]
    else:
        degrees = [pattern[i % plen] for i in range(n_syl)]

    # V14: Son hece vurgusu — +1 scale degree yükselme
    for i in range(n_syl):
        if word_positions[i] in ('last', 'only'):
            degrees[i] = degrees[i] + 1  # Melodic peak at word end

    # Formant-safe pitch limit
    max_shift_st = min(g.get('max_shift_st', 4.0), 6.0)
    f0_lo = med_f0 * (2.0 ** (-max_shift_st / 12.0))
    f0_hi = med_f0 * (2.0 ** (max_shift_st / 12.0))

    events = []
    for i, (syl, deg) in enumerate(zip(syllables, degrees)):
        nidx = max(0, min(root_idx + deg, len(scale) - 1))
        freq = scale[nidx]
        freq = max(f0_lo, min(f0_hi, freq))

        # V14: Süre ataması — ünlü oranı + vurgu çarpanı
        vr = _syllable_vowel_ratio(syl)
        if vr >= 0.5:
            dur = 1.0
        elif vr > 0:
            dur = 0.5
        else:
            dur = 0.25

        # Vurgulu hece: +50% süre
        wp = word_positions[i]
        if wp in ('last', 'only'):
            dur *= 1.5
            stress = 1.0 if wp == 'last' else 0.7
        elif wp == 'first':
            stress = 0.3
        else:
            stress = 0.1

        # Artikülasyon: aynı kelimenin heceleri legato, kelime sonu staccato
        if is_word_last[i]:
            art = 'staccato'
        else:
            art = 'legato'

        events.append(NoteEvent(syl, freq, dur, art, stress=stress, word_pos=wp))

    return events


def _align_notes_to_audio(events, onset_segments, nf, fr, bpm):
    """
    NoteEvent'leri audio onset'lerine hizala.
    Onset detection sonuçları birincil, tempo grid ikincil düzeltme yapar.
    Her event'e start_frame ve end_frame atar.
    """
    beat_dur_frames = int((60.0 / max(bpm, 60)) * fr)

    for idx, ev in enumerate(events):
        if idx < len(onset_segments):
            ev.start_frame = onset_segments[idx][0]
            ev.end_frame = onset_segments[idx][1]
        else:
            # Ekstra heceler → son segment'ten sonra yerleştir
            prev_end = events[idx - 1].end_frame if idx > 0 else 0
            note_frames = max(1, int(ev.duration_beats * beat_dur_frames))
            ev.start_frame = prev_end
            ev.end_frame = min(prev_end + note_frames, nf)

    # Quantize: kısa notaları minimum genişliğe çek
    min_note_frames = max(2, int(0.03 * fr))  # 30ms minimum
    for ev in events:
        if ev.end_frame - ev.start_frame < min_note_frames:
            ev.end_frame = min(ev.start_frame + min_note_frames, nf)

    return events


# ═══════════════════════════════════════════════════
# ANA FONKSİYON: KONUŞMA → ŞARKI V9 (WORLD Vocoder)
# ═══════════════════════════════════════════════════


def _apply_note_scoop(f0, note_events, fr, scoop_cents=40, scoop_ratio=0.12):
    """
    V22: Note approach scoop — gerçek şarkıcılar notaya aşağıdan yaklaşır.
    Her notanın başında perde ~scoop_cents aşağıdan yukarı süzülür.
    Vurgulu heceler: daha derin scoop (×1.3), vurgusuz: daha sığ (×0.6).
    Legato notalar küçük scoop, sessizlik sonrası büyük scoop alır.
    """
    if not note_events:
        return f0
    result = f0.copy()
    n = len(result)

    for idx, ev in enumerate(note_events):
        s = ev.start_frame
        e = min(ev.end_frame, n)
        length = e - s
        if length < 6:
            continue

        # Scoop duration: max ~60ms or scoop_ratio of note
        max_scoop_frames = max(4, int(0.06 * fr))
        scoop_frames = min(int(scoop_ratio * length), max_scoop_frames)
        if scoop_frames < 3:
            continue

        # Stress modulation: stressed syllables scoop deeper
        stress_scale = 0.6 + ev.stress * 0.7  # 0.6-1.3x

        # If previous note is legato (no gap), use smaller scoop
        if idx > 0 and note_events[idx - 1].articulation == 'legato':
            note_scoop = scoop_cents * 0.4 * stress_scale  # 40% of normal scoop
        else:
            note_scoop = scoop_cents * stress_scale

        if note_scoop < 5:
            continue

        # Exponential rise from -note_scoop to 0 cents
        for i in range(scoop_frames):
            fi = s + i
            if fi >= n or result[fi] <= 0:
                continue
            progress = i / max(1, scoop_frames - 1)
            # Smooth curve: starts steep, flattens at target
            offset_cents = -note_scoop * (1.0 - progress ** 0.55)
            result[fi] *= 2.0 ** (offset_cents / 1200.0)

    return result


def _apply_f0_vibrato(f0, frame_rate, depth_cents=40, rate_hz=5.5, onset_ratio=0.45,
                      note_events=None):
    """
    V14: Per-syllable stress-aware vibrato.
    - Vurgulu heceler (stress>0.5): depth × 1.5, onset daha erken
    - Kısa/vurgusuz heceler: depth × 0.5, onset daha geç
    - Crescendo envelope korunur
    """
    result = f0.copy()
    n = len(result)
    t = np.arange(n, dtype=np.float64) / frame_rate

    # Build per-frame stress map from note_events
    frame_stress = np.full(n, 0.5)  # default stress
    frame_onset_ratio = np.full(n, onset_ratio)
    if note_events:
        for ev in note_events:
            s = ev.start_frame
            e = min(ev.end_frame, n)
            if e > s:
                frame_stress[s:e] = ev.stress
                # Stressed syllables: vibrato girer daha erken
                if ev.stress > 0.5:
                    frame_onset_ratio[s:e] = max(0.15, onset_ratio * 0.6)
                elif ev.stress < 0.2:
                    frame_onset_ratio[s:e] = min(0.7, onset_ratio * 1.5)

    # Voiced run'ları bul
    runs = []
    in_run = False
    start = 0
    for i in range(n + 1):
        v = i < n and result[i] > 0
        if v and not in_run:
            start = i
            in_run = True
        elif not v and in_run:
            if i - start >= 5:
                runs.append((start, i))
            in_run = False

    for rs, re in runs:
        length = re - rs
        # Use average onset ratio for this run
        run_onset = float(np.mean(frame_onset_ratio[rs:re]))
        onset_frame = int(run_onset * length)
        ramp = min(int(0.25 * frame_rate), length - onset_frame)
        if ramp <= 0:
            continue

        # Crescendo envelope
        envelope = np.zeros(length, dtype=np.float64)
        env_start = min(onset_frame, length - 1)
        env_end = min(onset_frame + ramp, length)
        if env_end > env_start:
            envelope[env_start:env_end] = np.linspace(0, 0.6, env_end - env_start)
            remaining = length - env_end
            if remaining > 0:
                envelope[env_end:] = np.linspace(0.6, 1.0, remaining)

        # Per-frame depth modulation by stress
        stress_scale = 0.5 + frame_stress[rs:re]  # 0.5-1.5x based on stress
        effective_depth = depth_cents * stress_scale

        phase_jitter = np.random.default_rng(rs).normal(0, 0.1, length)
        lfo = effective_depth * np.sin(2 * np.pi * rate_hz * t[rs:re] + phase_jitter) * envelope
        result[rs:re] = result[rs:re] * (2.0 ** (lfo / 1200.0))

    return result


def _apply_amplitude_vibrato(audio, sr, f0, frame_rate, depth=0.08, rate_hz=5.5, onset_ratio=0.45):
    """
    V9: Amplitude vibrato — pitch vibrato ile coupled.
    Gerçek şarkıcılar pitch + amplitude birlikte salınır.
    """
    n = len(audio)
    gain = np.ones(n, dtype=np.float64)

    nf = len(f0)
    hop_samples = int(sr / frame_rate)

    # Voiced run'ları bul
    runs = []
    in_run = False
    start = 0
    for i in range(nf + 1):
        v = i < nf and f0[i] > 0
        if v and not in_run:
            start = i
            in_run = True
        elif not v and in_run:
            if i - start >= 5:
                runs.append((start, i))
            in_run = False

    for rs, re in runs:
        length = re - rs
        onset_frame = int(onset_ratio * length)
        ramp_frames = min(int(0.25 * frame_rate), length - onset_frame)
        if ramp_frames <= 0:
            continue

        # Frame-level envelope
        envelope = np.zeros(length, dtype=np.float64)
        env_start = min(onset_frame, length - 1)
        env_end = min(onset_frame + ramp_frames, length)
        if env_end > env_start:
            envelope[env_start:env_end] = np.linspace(0, 0.5, env_end - env_start)
            remaining = length - env_end
            if remaining > 0:
                envelope[env_end:] = np.linspace(0.5, 1.0, remaining)

        # Apply to audio samples
        for fi in range(length):
            frame_idx = rs + fi
            sample_start = frame_idx * hop_samples
            sample_end = min((frame_idx + 1) * hop_samples, n)
            if sample_start >= n:
                break
            t_sec = sample_start / sr
            amp_mod = 1.0 + depth * np.sin(2 * np.pi * rate_hz * t_sec) * envelope[fi]
            gain[sample_start:sample_end] = amp_mod

    return (audio * gain[:n]).astype(np.float32)


def _stretch_vowel_only(f0, sp, ap, voiced, syllable_events, fr, sustain):
    """
    V9: Sadece ünlü çekirdeğini uzat, ünsüz kısa kalsın.
    Her NoteEvent'in vowel_ratio'suna göre differansiyel uzatma.
    Ünlü ağırlıklı hece → çok uzat, ünsüz ağırlıklı → az uzat.
    """
    nf = len(f0)
    new_f0, new_sp, new_ap = [], [], []

    if not syllable_events:
        # Fallback: eski davranış
        return _stretch_voiced_frames_legacy(f0, sp, ap, voiced, sustain)

    i = 0
    event_idx = 0
    while i < nf:
        if not voiced[i] or f0[i] <= 0:
            new_f0.append(f0[i])
            new_sp.append(sp[i])
            new_ap.append(ap[i])
            i += 1
            continue

        # Voiced run'ın sonunu bul
        run_start = i
        while i < nf and voiced[i] and f0[i] > 0:
            i += 1
        run_end = i
        run_len = run_end - run_start

        if run_len < 3:
            for j in range(run_start, run_end):
                new_f0.append(f0[j])
                new_sp.append(sp[j])
                new_ap.append(ap[j])
            continue

        # Bu voiced run hangi NoteEvent'e düşüyor?
        vr = 0.5  # default
        while event_idx < len(syllable_events):
            ev = syllable_events[event_idx]
            if ev.end_frame > run_start:
                vr = ev.vowel_ratio
                break
            event_idx += 1

        # V18: Vowel-weighted sustain — daha yumuşak (netlik korunur)
        # Eskiden vr*1.5 → 3.25x stretch mümkündü, kelimeler yutuluyordu
        # Şimdi: vr*0.8 → max ~1.6x, kelimeler net kalır
        effective_sustain = 1.0 + (sustain - 1.0) * max(0.15, vr * 0.8)
        effective_sustain = max(1.0, min(effective_sustain, 1.6))

        new_len = max(run_len, int(run_len * effective_sustain))
        indices = np.linspace(0, run_len - 1, new_len)

        for idx in indices:
            lo = int(idx)
            hi = min(lo + 1, run_len - 1)
            frac = idx - lo
            src_lo = run_start + lo
            src_hi = run_start + hi

            new_f0.append(f0[src_lo] * (1 - frac) + f0[src_hi] * frac)
            new_sp.append(sp[src_lo] * (1 - frac) + sp[src_hi] * frac)
            new_ap.append(ap[src_lo] * (1 - frac) + ap[src_hi] * frac)

    return (
        np.array(new_f0, dtype=np.float64),
        np.array(new_sp, dtype=np.float64),
        np.array(new_ap, dtype=np.float64),
    )


def _stretch_voiced_frames_legacy(f0, sp, ap, voiced, sustain):
    """Legacy V7 voiced frame stretching (fallback)."""
    nf = len(f0)
    new_f0, new_sp, new_ap = [], [], []

    i = 0
    while i < nf:
        if not voiced[i] or f0[i] <= 0:
            new_f0.append(f0[i])
            new_sp.append(sp[i])
            new_ap.append(ap[i])
            i += 1
            continue

        run_start = i
        while i < nf and voiced[i] and f0[i] > 0:
            i += 1
        run_end = i
        run_len = run_end - run_start

        if run_len < 3:
            for j in range(run_start, run_end):
                new_f0.append(f0[j])
                new_sp.append(sp[j])
                new_ap.append(ap[j])
            continue

        new_len = max(run_len, int(run_len * sustain))
        indices = np.linspace(0, run_len - 1, new_len)

        for idx in indices:
            lo = int(idx)
            hi = min(lo + 1, run_len - 1)
            frac = idx - lo
            src_lo = run_start + lo
            src_hi = run_start + hi

            new_f0.append(f0[src_lo] * (1 - frac) + f0[src_hi] * frac)
            new_sp.append(sp[src_lo] * (1 - frac) + sp[src_hi] * frac)
            new_ap.append(ap[src_lo] * (1 - frac) + ap[src_hi] * frac)

    return (
        np.array(new_f0, dtype=np.float64),
        np.array(new_sp, dtype=np.float64),
        np.array(new_ap, dtype=np.float64),
    )


# ═══════════════════════════════════════════════════
# V11: EXPRESSIVE COUPLED VOCAL SYNTHESIS
# ═══════════════════════════════════════════════════

# Türkçe ünsüz sınıfları (onset modeling için)
_TR_PLOSIVES = set('kKtTpPbBdDgGçÇcC')
_TR_FRICATIVES = set('sSşŞfFvVzZhHjJ')

# V11: Turkish vowel F1/F2/F3 targets (Hz) — akustik fonetik + F3 for richness
_VOWEL_FORMANTS = {
    'a': (750, 1200, 2600),  'e': (550, 1800, 2700),  'ı': (400, 1100, 2550),  'i': (300, 2200, 2900),
    'o': (500, 900, 2500),   'ö': (450, 1500, 2600),  'u': (350, 700, 2400),   'ü': (300, 1650, 2700),
    'A': (750, 1200, 2600),  'E': (550, 1800, 2700),  'I': (400, 1100, 2550),  'İ': (300, 2200, 2900),
    'O': (500, 900, 2500),   'Ö': (450, 1500, 2600),  'U': (350, 700, 2400),   'Ü': (300, 1650, 2700),
}

# V12: Vowel clustering — bright/dark groups for formant character
_VOWEL_BRIGHT = set('iİeEöÖüÜ')  # front vowels
_VOWEL_DARK = set('aAıIoOuU')     # back vowels

# V12: Turkish long vowels (for prosody rules)
_TR_LONG_VOWELS = set('âîûÂÎÛ')


def _detect_phrases(note_events, fr, max_gap_ms=200):
    """
    V12: Phrase detection — nota gruplarını frazlara ayır.
    Ardışık notalar arası >max_gap_ms boşluk varsa yeni fraz.
    Döndürür: [(start_event_idx, end_event_idx), ...]
    """
    if not note_events:
        return []
    phrases = []
    phrase_start = 0
    gap_frames = int(max_gap_ms / 1000.0 * fr)

    for i in range(1, len(note_events)):
        prev_end = note_events[i - 1].end_frame
        curr_start = note_events[i].start_frame
        if curr_start - prev_end > gap_frames:
            phrases.append((phrase_start, i))
            phrase_start = i
    phrases.append((phrase_start, len(note_events)))
    return phrases


def _phrase_timing_curve(frame_idx, phrase_start_frame, phrase_end_frame, fr):
    """
    V12: Phrase-based deterministic micro drift.
    Random değil — sinüsoidal, fraz uzunluğuna bağlı.
    ±5 cent drift — algılanamaz ama organik.
    """
    phrase_len_sec = max(0.1, (phrase_end_frame - phrase_start_frame) / fr)
    t = (frame_idx - phrase_start_frame) / fr
    # Slow sinusoid over phrase length — deterministic, not random
    drift_cents = 5.0 * np.sin(2.0 * np.pi * t / phrase_len_sec)
    return drift_cents


def _apply_phrase_expression(target_f0, note_events, phrases, fr, expr_params):
    """
    V14: Phrase-aware melodic arc — gerçek şarkı fraz yapısı.
    1) Fraz başı: -60 cent scoop (aşağıdan yaklaş)
    2) Fraz ortası (~%60): +20 cent peak
    3) Fraz sonu: -40 cent cadence (düşüş)
    4) Micro drift: organik sinüsoidal titreşim
    """
    result = target_f0.copy()
    nf = len(result)
    expression = expr_params.get('expression', 0.4)
    jitter_depth = expr_params.get('jitter_depth', 2.0)

    for p_start_idx, p_end_idx in phrases:
        if p_start_idx >= len(note_events) or p_end_idx > len(note_events):
            continue
        phrase_events = note_events[p_start_idx:p_end_idx]
        if not phrase_events:
            continue

        phrase_start_frame = phrase_events[0].start_frame
        phrase_end_frame = phrase_events[-1].end_frame
        phrase_total = max(1, phrase_end_frame - phrase_start_frame)

        # ── Phrase arc: makro melodic shape ──
        # Shape: scoop(-60) → rise → peak(+20) @ 60% → fall → cadence(-40)
        scoop_cents = -60.0 * expression    # max -36 cents
        peak_cents = 20.0 * expression      # max +12 cents
        cadence_cents = -40.0 * expression  # max -24 cents
        peak_pos = 0.60  # peak at 60% of phrase

        for ev_idx, ev in enumerate(phrase_events):
            start = ev.start_frame
            end = min(ev.end_frame, nf)
            if end <= start:
                continue

            for i in range(start, end):
                if result[i] <= 0:
                    continue
                # Position within phrase (0.0 → 1.0)
                pos = (i - phrase_start_frame) / max(1, phrase_total)
                pos = max(0.0, min(1.0, pos))

                # Phrase arc contour
                if pos < 0.12:
                    # Scoop region: rise from scoop to 0
                    t = pos / 0.12
                    arc_cents = scoop_cents * (1.0 - t ** 1.5)
                elif pos < peak_pos:
                    # Rising to peak
                    t = (pos - 0.12) / (peak_pos - 0.12)
                    arc_cents = peak_cents * t ** 0.8
                elif pos < 0.85:
                    # Post-peak plateau, slow descent
                    t = (pos - peak_pos) / (0.85 - peak_pos)
                    arc_cents = peak_cents * (1.0 - 0.5 * t)
                else:
                    # Cadence: fall
                    t = (pos - 0.85) / 0.15
                    arc_cents = peak_cents * 0.5 * (1.0 - t) + cadence_cents * t ** 1.5

                # Micro drift (organic sinusoid)
                drift = _phrase_timing_curve(i, phrase_start_frame, phrase_end_frame, fr)
                drift_scaled = drift * (jitter_depth / 5.0)

                total_cents = arc_cents + drift_scaled
                result[i] *= 2.0 ** (total_cents / 1200.0)

    return result


def _apply_shaped_breath(audio, sr, note_events, phrases, fr, intensity=0.5):
    """
    V12: Shaped breath model — lowpass filtered, envelope-shaped.
    Random noise DEĞİL → shaped breath: sadece fraz başında inhale, fraz sonunda exhale.
    Mix çok düşük (%3) — fog yapmaz ama insan hissi verir.
    """
    result = audio.copy().astype(np.float64)
    n = len(result)
    rng = np.random.default_rng(42)
    hop_samples = int(sr / fr)
    nyq = sr * 0.45

    for p_start_idx, p_end_idx in phrases:
        if p_start_idx >= len(note_events):
            continue
        phrase_events = note_events[p_start_idx:p_end_idx]
        if not phrase_events:
            continue

        first_ev = phrase_events[0]
        last_ev = phrase_events[-1]

        # ── Inhale: fraz başından önce ──
        inhale_dur = int(0.08 * sr * intensity)  # ~40-80ms
        inhale_start = max(0, first_ev.start_frame * hop_samples - inhale_dur)
        inhale_end = min(n, first_ev.start_frame * hop_samples)
        actual_len = inhale_end - inhale_start

        if actual_len > int(0.02 * sr):
            noise = rng.normal(0, 1, actual_len)
            # Lowpass at 2kHz — shaped, not raw noise
            cutoff = min(2000, nyq)
            if cutoff > 100:
                sos_lp = butter(3, cutoff, btype='low', fs=sr, output='sos')
                noise = sosfiltfilt(sos_lp, noise)
            # Crescendo envelope
            env = np.linspace(0, 1, actual_len) ** 2
            result[inhale_start:inhale_end] += 0.03 * intensity * noise * env

        # ── Exhale: fraz sonunda ──
        exhale_dur = int(0.06 * sr * intensity)  # ~30-60ms
        exhale_start = min(n - 1, last_ev.end_frame * hop_samples)
        exhale_end = min(n, exhale_start + exhale_dur)
        actual_len = exhale_end - exhale_start

        if actual_len > int(0.015 * sr):
            noise = rng.normal(0, 1, actual_len)
            cutoff = min(1500, nyq)
            if cutoff > 100:
                sos_lp = butter(3, cutoff, btype='low', fs=sr, output='sos')
                noise = sosfiltfilt(sos_lp, noise)
            # Decrescendo envelope
            env = np.linspace(1, 0, actual_len) ** 1.5
            result[exhale_start:exhale_end] += 0.02 * intensity * noise * env

    # ── V15: Continuous spectral breath during voiced regions ──
    # Hafif lowpass filtered nefes: doğal vokal sıcaklığı
    if note_events and intensity > 0.15:
        breath_noise = rng.normal(0, 1, n)
        cutoff_cont = min(1800, nyq)
        if cutoff_cont > 100:
            sos_cont = butter(3, cutoff_cont, btype='low', fs=sr, output='sos')
            breath_noise = sosfiltfilt(sos_cont, breath_noise)
        # Only apply during voiced frames
        voiced_mask = np.zeros(n, dtype=np.float64)
        for ev in note_events:
            vs = ev.start_frame * hop_samples
            ve = min(ev.end_frame * hop_samples, n)
            if ve > vs:
                voiced_mask[vs:ve] = 1.0
        # Smooth mask to avoid clicks
        smooth_len = min(int(0.005 * sr), 128)
        if smooth_len > 2:
            kernel = np.ones(smooth_len) / smooth_len
            voiced_mask = np.convolve(voiced_mask, kernel, mode='same')
        # Mix at 2% — subtle warmth, not fog
        cont_mix = 0.02 * intensity
        result += cont_mix * breath_noise * voiced_mask

    peak = np.abs(result).max()
    if peak > 0.98:
        result = result / peak * 0.95
    return result.astype(np.float32)


def _apply_turkish_prosody(target_f0, note_events, fr, text=None):
    """
    V14: Türkçe Melodik Contour Motoru.
    Gerçek şarkı gibi ses üretir — metin okuma gibi DEĞİL.

    Katmanlar:
    1) Kelime vurgusu: son hece → pitch peak (+3%), attack ramp
    2) Hece-içi contour: attack → peak → sustain → release eğrisi
    3) Legato: aynı kelimenin heceleri arasında yumuşak pitch geçişi
    4) İlk hece: hafif yükselen giriş (approach from below)
    """
    result = target_f0.copy()
    nf = len(result)
    if not note_events or len(note_events) < 2:
        return result

    for idx, ev in enumerate(note_events):
        start = ev.start_frame
        end = min(ev.end_frame, nf)
        if end <= start or ev.vowel_ratio < 0.1:
            continue
        length = end - start

        # ── 1) Kelime vurgusu: son hece pitch peak ──
        if ev.word_pos in ('last', 'only') and ev.stress > 0.5:
            # Son hece: +3% pitch ramp-up + hold + gentle release
            boost_cents = 50.0 * ev.stress  # max +50 cents (~3%)
            attack_len = min(int(0.06 * fr), length // 3)  # 60ms attack
            hold_len = max(1, length - attack_len - int(0.04 * fr))
            release_len = length - attack_len - hold_len

            for i in range(length):
                fi = start + i
                if fi >= nf or result[fi] <= 0:
                    continue
                if i < attack_len:
                    # Ramp up to peak
                    t = i / max(1, attack_len)
                    cents = boost_cents * (t ** 0.7)  # concave ramp
                elif i < attack_len + hold_len:
                    cents = boost_cents
                else:
                    # Gentle release
                    t = (i - attack_len - hold_len) / max(1, release_len)
                    cents = boost_cents * (1.0 - t * 0.4)  # release to 60% of peak
                result[fi] *= 2.0 ** (cents / 1200.0)

        # ── 2) İlk hece: approach from below ──
        elif ev.word_pos == 'first' and ev.stress < 0.5:
            # Hafif scoop: aşağıdan yaklaş
            scoop_cents = -30.0  # start 30 cents below
            scoop_len = min(int(0.08 * fr), length // 2)  # 80ms scoop
            if scoop_len > 3:
                for i in range(scoop_len):
                    fi = start + i
                    if fi >= nf or result[fi] <= 0:
                        continue
                    t = i / max(1, scoop_len)
                    cents = scoop_cents * (1.0 - t ** 1.5)  # exponential rise
                    result[fi] *= 2.0 ** (cents / 1200.0)

        # ── 3) Orta heceler: hafif dynamism ──
        elif ev.word_pos == 'mid':
            # Micro contour: slight rise at start, steady
            rise_len = min(int(0.04 * fr), length // 3)
            if rise_len > 2:
                for i in range(rise_len):
                    fi = start + i
                    if fi >= nf or result[fi] <= 0:
                        continue
                    t = i / max(1, rise_len)
                    cents = -8.0 * (1.0 - t)  # -8 cents → 0
                    result[fi] *= 2.0 ** (cents / 1200.0)

    # ── 4) Legato: aynı kelime içi heceler arası yumuşak geçiş ──
    for idx in range(1, len(note_events)):
        ev = note_events[idx]
        prev = note_events[idx - 1]
        # Eğer prev staccato ise (kelime sonu) → legato yapma
        if prev.articulation != 'legato':
            continue
        # Geçiş bölgesi: prev'in son %15'i + ev'in ilk %10'u
        prev_len = prev.end_frame - prev.start_frame
        curr_len = ev.end_frame - ev.start_frame
        blend_before = max(2, int(0.15 * prev_len))
        blend_after = max(2, int(0.10 * curr_len))
        blend_start = max(prev.start_frame, prev.end_frame - blend_before)
        blend_end = min(ev.start_frame + blend_after, nf)

        if blend_end <= blend_start:
            continue

        # Smooth pitch interpolation between notes
        for i in range(blend_start, blend_end):
            if i >= nf or result[i] <= 0:
                continue
            progress = (i - blend_start) / max(1, blend_end - blend_start - 1)
            # Cosine interpolation for smooth legato
            t = 0.5 * (1.0 - np.cos(np.pi * progress))
            # Blend 20% toward the other note's pitch
            if i < prev.end_frame and result[i] > 0:
                target = ev.freq_hz
                current = result[i]
                result[i] = current * (1.0 - 0.20 * t) + target * (0.20 * t)
            elif i >= ev.start_frame and result[i] > 0:
                source = prev.freq_hz
                current = result[i]
                result[i] = current * (1.0 - 0.15 * (1.0 - t)) + source * (0.15 * (1.0 - t))

    return result


def _sigmoid_glide(progress, interval_semitones):
    """Sigmoid nota geçiş eğrisi — interval büyüklüğüne göre farklı steep."""
    abs_iv = abs(interval_semitones)
    if abs_iv <= 2:
        k = 8.0
    elif abs_iv <= 5:
        k = 5.0
    else:
        k = 3.0
    x = (progress - 0.5) * k * 2
    return 1.0 / (1.0 + np.exp(-x))


def _apply_consonant_onset(sp, ap, note_events, nf, strength=0.5):
    """
    V14: Türkçe ünsüz onset + transient — stress-aware.
    Vurgulu heceler: daha güçlü transient (şarkıcı vurgusu).
    Patlayıcı (k,t,p,b,d,g,ç,c): noise burst + transient.
    Sürtünmeli (s,ş,f,v): hafif noise onset.
    Glide/approximant (l,r,m,n,y): yumuşak geçiş.
    """
    result_sp = sp.copy()
    result_ap = ap.copy()

    for ev in note_events:
        start = ev.start_frame
        if start >= nf:
            continue
        syl = ev.syllable
        if not syl:
            continue
        first_char = syl[0]

        # V18: Stress modulation — azaltıldı, ses dalgalanması önlendi
        # Eskiden 1.7x → şimdi max 1.25x (netlik korunur, volume spike yok)
        if ev.stress > 0.7 and getattr(ev, 'word_pos', '') == 'last':
            stress_mult = 1.0 + 0.25 * ev.stress  # max 1.25x (eskiden 1.7x)
        else:
            stress_mult = 0.8 + 0.3 * ev.stress  # 0.8-1.1x (eskiden 0.7-1.5x)

        if first_char in _TR_PLOSIVES:
            attack_frames = min(4, nf - start)
            ap_boost = 0.25 * strength * stress_mult
            sp_boost = 1.0 + 0.3 * strength * stress_mult
            transient_frames = min(int(0.025 * (1000.0 / 5.0)), nf - start)
            transient_boost = 0.08 * strength * stress_mult
        elif first_char in _TR_FRICATIVES:
            attack_frames = min(5, nf - start)
            ap_boost = 0.15 * strength * stress_mult
            sp_boost = 1.0 + 0.20 * strength * stress_mult
            transient_frames = min(int(0.020 * (1000.0 / 5.0)), nf - start)
            transient_boost = 0.05 * strength * stress_mult
        elif first_char.lower() in 'lrmnny':
            # Glide/approximant — yumuşak onset, legato-friendly
            attack_frames = min(3, nf - start)
            ap_boost = 0.03 * strength
            sp_boost = 1.0 + 0.03 * strength
            transient_frames = 0
            transient_boost = 0.0
        else:
            attack_frames = min(2, nf - start)
            ap_boost = 0.05 * strength
            sp_boost = 1.0 + 0.05 * strength
            transient_frames = 0
            transient_boost = 0.0

        for j in range(attack_frames):
            fi = start + j
            if fi >= nf:
                break
            decay = np.exp(-j * 2.5 / max(1, attack_frames))
            result_ap[fi] = np.minimum(1.0, result_ap[fi] + ap_boost * decay)
            result_sp[fi] *= (1.0 + (sp_boost - 1.0) * decay)

        if transient_frames > 0 and transient_boost > 0.01:
            for j in range(transient_frames):
                fi = start + j
                if fi >= nf:
                    break
                t_decay = 1.0 - (j / max(1, transient_frames))
                result_sp[fi] *= (1.0 + transient_boost * t_decay)

    return result_sp, result_ap


def _apply_formant_shift_simple(sp, target_f0, med_f0, note_events=None, intensity=0.2):
    """
    V12: Pitch-linked formant shift + vowel clustering.
    Global spectral kaydırma + bright/dark vowel clustering ile karakter.
    Per-bin complexity YOK — TTS sinyalini bozmaz.
    Bright vowels (i,e,ö,ü): shift * 1.1 → parlaklık
    Dark vowels (a,ı,o,u): shift * 0.9 → sıcaklık
    """
    result_sp = sp.copy()
    nf = min(len(target_f0), len(sp))
    n_fft = sp.shape[1]
    freq_indices = np.arange(n_fft, dtype=np.float64)

    # Build per-frame vowel cluster map from note_events
    frame_vowel_mult = np.ones(nf, dtype=np.float64)
    if note_events:
        for ev in note_events:
            start = ev.start_frame
            end = min(ev.end_frame, nf)
            if end <= start or not ev.syllable:
                continue
            # Find vowel in syllable
            vowel_char = None
            for ch in ev.syllable:
                if ch in _VOWEL_BRIGHT or ch in _VOWEL_DARK:
                    vowel_char = ch
                    break
            if vowel_char:
                if vowel_char in _VOWEL_BRIGHT:
                    frame_vowel_mult[start:end] = 1.1  # bright → more shift
                else:
                    frame_vowel_mult[start:end] = 0.9  # dark → less shift

    for i in range(nf):
        if target_f0[i] <= 0:
            continue
        ratio = target_f0[i] / max(med_f0, 80.0)
        if abs(ratio - 1.0) < 0.03:
            continue
        # Pitch shift modulated by vowel cluster
        base_shift = (ratio - 1.0) * 0.20 * intensity
        shift_ratio = 1.0 + base_shift * frame_vowel_mult[i]
        if shift_ratio <= 0.6 or shift_ratio >= 1.6:
            continue
        new_idx = np.clip(freq_indices / shift_ratio, 0, n_fft - 1)
        lo = new_idx.astype(int)
        hi = np.minimum(lo + 1, n_fft - 1)
        frac = new_idx - lo
        result_sp[i] = sp[i, lo] * (1.0 - frac) + sp[i, hi] * frac

    return result_sp


def _apply_vowel_formant_model(sp, note_events, target_f0, med_f0, sr, nf, intensity=0.3):
    """
    V11: Vowel-specific formant model — her ünlü için F1/F2 hedemesi.
    Global spectral shift yerine, hecedeki ünlünün formant yapısına göre
    spectral envelope'u yeniden şekillendirir.
    pitch-linked: yüksek notalarda formant da yukarı kayar.
    """
    result_sp = sp.copy()
    n_fft = sp.shape[1]
    freq_per_bin = (sr / 2.0) / max(1, n_fft - 1)  # Hz per FFT bin
    freq_indices = np.arange(n_fft, dtype=np.float64)

    for ev in note_events:
        start = ev.start_frame
        end = min(ev.end_frame, nf)
        if end <= start:
            continue
        syl = ev.syllable
        if not syl:
            continue

        # Hecedeki ünlüyü bul
        vowel_char = None
        for ch in syl:
            if ch in _VOWEL_FORMANTS:
                vowel_char = ch
                break
        if vowel_char is None:
            # Ünlü yoksa sadece pitch-linked global shift (V10 davranışı)
            for i in range(start, end):
                if i >= nf or target_f0[i] <= 0:
                    continue
                ratio = target_f0[i] / max(med_f0, 80.0)
                if abs(ratio - 1.0) < 0.02:
                    continue
                shift_ratio = 1.0 + (ratio - 1.0) * 0.3 * intensity
                if shift_ratio <= 0.5 or shift_ratio >= 2.0:
                    continue
                new_idx = np.clip(freq_indices / shift_ratio, 0, n_fft - 1)
                lo = new_idx.astype(int)
                hi_idx = np.minimum(lo + 1, n_fft - 1)
                frac = new_idx - lo
                result_sp[i] = sp[i, lo] * (1.0 - frac) + sp[i, hi_idx] * frac
            continue

        # Vowel-specific formant application
        f1_target, f2_target = _VOWEL_FORMANTS[vowel_char]

        for i in range(start, end):
            if i >= nf or target_f0[i] <= 0:
                continue
            # Pitch-linked formant shift
            pitch_ratio = target_f0[i] / max(med_f0, 80.0)
            f1_shifted = f1_target * (1.0 + (pitch_ratio - 1.0) * 0.25 * intensity)
            f2_shifted = f2_target * (1.0 + (pitch_ratio - 1.0) * 0.15 * intensity)

            # F1 bölgesini güçlendir (±bandwidth)
            f1_bin = int(f1_shifted / max(freq_per_bin, 1))
            f1_bw = max(2, int(100 / max(freq_per_bin, 1)))
            f1_lo = max(0, f1_bin - f1_bw)
            f1_hi = min(n_fft, f1_bin + f1_bw)
            boost_f1 = 1.0 + 0.15 * intensity
            for b in range(f1_lo, f1_hi):
                dist = abs(b - f1_bin) / max(1, f1_bw)
                result_sp[i, b] *= (1.0 + (boost_f1 - 1.0) * (1.0 - dist))

            # F2 bölgesini güçlendir
            f2_bin = int(f2_shifted / max(freq_per_bin, 1))
            f2_bw = max(2, int(120 / max(freq_per_bin, 1)))
            f2_lo = max(0, f2_bin - f2_bw)
            f2_hi = min(n_fft, f2_bin + f2_bw)
            boost_f2 = 1.0 + 0.10 * intensity
            for b in range(f2_lo, f2_hi):
                dist = abs(b - f2_bin) / max(1, f2_bw)
                result_sp[i, b] *= (1.0 + (boost_f2 - 1.0) * (1.0 - dist))

    return result_sp


def _apply_micro_timing(note_events, nf, fr, max_drift_ms=20):
    """
    V11: Micro-timing humanization — onset timing drift + syllable overlap.
    Her notanın başlangıcına ±drift_ms kadar jitter ekler.
    Ardışık notalar arasında 2-4 frame overlap oluşturur.
    """
    if not note_events or len(note_events) < 2:
        return note_events

    max_drift_frames = int(max_drift_ms / 1000.0 * fr)

    for idx, ev in enumerate(note_events):
        rng = np.random.default_rng(idx * 251 + 13)
        # Onset drift: ±max_drift_frames (ilk nota hariç)
        if idx > 0:
            drift = rng.integers(-max_drift_frames, max_drift_frames + 1)
            new_start = max(0, min(ev.start_frame + drift, nf - 1))
            # Overlap ile önceki nota bitişi çakışabilir → kasıtlı 2-4 frame overlap
            prev_end = note_events[idx - 1].end_frame
            overlap_frames = rng.integers(2, 5)
            min_start = max(0, prev_end - overlap_frames)
            ev.start_frame = max(min_start, new_start)
        # End frame sabit kalır (veya bir sonraki nota start'ına göre)

    return note_events


def _apply_expression_bus(target_f0, note_events, fr, expr_params):
    """
    V11: Expression Bus — temiz micro-pitch variation.
    Sadece çok hafif doğal pitch titreşimi + isteğe bağlı scoop.
    Noise injection YOK — TTS sinyalini bulandırmaz.
    """
    result = target_f0.copy()
    nf = len(result)
    jitter_depth = expr_params.get('jitter_depth', 2.0)  # max 4 cent
    expression = expr_params.get('expression', 0.4)

    for idx, ev in enumerate(note_events):
        rng = np.random.default_rng(idx * 137 + 7)
        start = ev.start_frame
        end = min(ev.end_frame, nf)
        if end <= start:
            continue
        length = end - start

        # 1) Çok hafif micro-pitch jitter (1-4 cent — algılanamaz ama doğal)
        jitter_rate = 7.0 + rng.uniform(-1, 2)
        t = np.arange(length, dtype=np.float64) / fr
        jitter = jitter_depth * np.sin(2 * np.pi * jitter_rate * t + rng.uniform(0, 6.28))
        for i in range(start, end):
            if result[i] > 0:
                result[i] *= 2.0 ** (jitter[i - start] / 1200.0)

        # 2) Hafif intonation scoop: sadece yüksek expression'da, düşük olasılıkla
        if length > 15 and ev.vowel_ratio > 0.3 and expression > 0.4 and rng.random() < 0.3:
            scoop_len = min(int(0.06 * fr), length // 4)
            scoop_depth = rng.uniform(8, 20) * expression
            scoop = -scoop_depth * np.exp(-np.linspace(0, 4, max(1, scoop_len)))
            for i in range(min(scoop_len, length)):
                fi = start + i
                if fi < nf and result[fi] > 0:
                    result[fi] *= 2.0 ** (scoop[i] / 1200.0)

    return result


def _apply_source_excitation(audio, sr, breathiness=0.1, noise_grit=0.0):
    """
    V11: Source excitation enhancement — WORLD çıkışına air/breath/grit texture.
    WORLD tek başına "temiz synth" verir; bu fonksiyon kayıt-benzeri texture ekler.
    breathiness: nefesli hava ses katmanı (whisper için yüksek)
    noise_grit:  vokal grit/distortion katmanı (belting için yüksek)
    """
    n = len(audio)
    result = audio.copy().astype(np.float64)
    rng = np.random.default_rng(42)

    if breathiness > 0.02:
        # Breath noise: band-limited (200-4000Hz) pink-ish noise, modulated by audio envelope
        noise = rng.normal(0, 1, n).astype(np.float64)
        # Bandpass 200-4000Hz
        nyq = sr * 0.45
        hi_freq = min(4000, nyq)
        if hi_freq > 200:
            sos_bp = butter(2, [200, hi_freq], btype='band', fs=sr, output='sos')
            noise = sosfiltfilt(sos_bp, noise)
        # Envelope-following: noise sadece ses varken duyulur
        frame_len = max(256, int(0.01 * sr))
        hop = frame_len // 2
        rms = librosa.feature.rms(y=audio.astype(np.float32), frame_length=frame_len, hop_length=hop)[0]
        env = np.interp(np.arange(n), np.arange(len(rms)) * hop, rms)
        env = np.clip(env / (np.max(env) + 1e-10), 0, 1)
        result += breathiness * noise * env * 0.3

    if noise_grit > 0.02:
        # Grit: soft clipping + harmonic distortion, subtle
        # Tanh saturation modulated by grit amount
        drive = 1.0 + noise_grit * 4.0  # 1-5x drive
        clipped = np.tanh(result * drive) / drive
        result = result * (1.0 - noise_grit * 0.5) + clipped * (noise_grit * 0.5)

    peak = np.abs(result).max()
    if peak > 0.98:
        result = result / peak * 0.95
    return result.astype(np.float32)


def _apply_breath_model(audio, sr, note_events, fr, intensity=0.5):
    """
    V11: Breath model — nota öncesi inhale noise + uzun sustain sonrası exhale.
    İnsan şarkıcılar her fraza öncesinde nefes alır, uzun notalardan sonra nefes verir.
    """
    result = audio.copy().astype(np.float64)
    n = len(result)
    rng = np.random.default_rng(77)
    hop_samples = int(sr / fr)

    for idx, ev in enumerate(note_events):
        # ── Inhale: nota öncesi (ilk nota veya >200ms boşluk sonrası) ──
        if idx == 0 or (ev.start_frame - note_events[idx - 1].end_frame) > int(0.2 * fr):
            inhale_dur_ms = rng.uniform(60, 120) * intensity
            inhale_samples = int(inhale_dur_ms / 1000.0 * sr)
            inhale_start = max(0, ev.start_frame * hop_samples - inhale_samples)
            inhale_end = min(n, ev.start_frame * hop_samples)
            actual_len = inhale_end - inhale_start
            if actual_len > int(0.02 * sr):
                noise = rng.normal(0, 1, actual_len)
                # Bandpass 150-3000Hz for inhale
                nyq = sr * 0.45
                hi_freq = min(3000, nyq)
                if hi_freq > 150:
                    sos_bp = butter(2, [150, hi_freq], btype='band', fs=sr, output='sos')
                    noise = sosfiltfilt(sos_bp, noise)
                # Crescendo envelope (silence → noise)
                env = np.linspace(0, 1, actual_len) ** 2
                gain = 0.04 * intensity
                result[inhale_start:inhale_end] += gain * noise * env

        # ── Exhale: uzun nota sonrası (duration > 400ms) ──
        note_dur_frames = ev.end_frame - ev.start_frame
        note_dur_ms = note_dur_frames * (1000.0 / fr)
        if note_dur_ms > 400 and idx < len(note_events) - 1:
            exhale_dur_ms = rng.uniform(40, 80) * intensity
            exhale_samples = int(exhale_dur_ms / 1000.0 * sr)
            exhale_start = min(n - 1, ev.end_frame * hop_samples)
            exhale_end = min(n, exhale_start + exhale_samples)
            actual_len = exhale_end - exhale_start
            if actual_len > int(0.015 * sr):
                noise = rng.normal(0, 1, actual_len)
                nyq = sr * 0.45
                hi_freq = min(2500, nyq)
                if hi_freq > 100:
                    sos_bp = butter(2, [100, hi_freq], btype='band', fs=sr, output='sos')
                    noise = sosfiltfilt(sos_bp, noise)
                # Decrescendo envelope (noise → silence)
                env = np.linspace(1, 0, actual_len) ** 1.5
                gain = 0.025 * intensity
                result[exhale_start:exhale_end] += gain * noise * env

    peak = np.abs(result).max()
    if peak > 0.98:
        result = result / peak * 0.95
    return result.astype(np.float32)


# ═══════════════════════════════════════════════════
# NEURAL VOCODER POST-PROCESSING
# ═══════════════════════════════════════════════════

def _neural_formant_brighten(audio, sr, shift_semitones=0.5):
    """
    Formant brightening for neural vocoder output.
    WORLD vocoder ile spectral envelope'u hafifçe yukarı kaydırır,
    böylece boğukluk kalkar ve ses "parlak" olur.
    Pitch değişmez — sadece vokal karakteri (formantlar) incelir.

    shift_semitones: 0.5 → çok hafif parlaklık, 1.0 → belirgin
    """
    import pyworld as pw
    from scipy.signal import firwin, lfilter

    audio_f64 = audio.astype(np.float64)
    fp = 5.0

    # WORLD analysis
    f0, t = pw.dio(audio_f64, sr, f0_floor=65.0, f0_ceil=600.0, frame_period=fp)
    f0 = pw.stonemask(audio_f64, f0, t, sr)
    sp = pw.cheaptrick(audio_f64, f0, t, sr)
    ap = pw.d4c(audio_f64, f0, t, sr)

    # Formant shift: spectral envelope'u frekans ekseninde kaydır
    # shift_ratio > 1.0 → formantlar yukarı (daha ince/parlak)
    shift_ratio = 2 ** (shift_semitones / 12.0)
    n_freq = sp.shape[1]
    orig_axis = np.arange(n_freq)
    new_axis = orig_axis / shift_ratio  # sıkıştır → yukarı kaydır

    sp_shifted = np.zeros_like(sp)
    for i in range(sp.shape[0]):
        sp_shifted[i] = np.interp(orig_axis, new_axis, sp[i], right=sp[i, -1])

    # Synthesize with original f0 but shifted formants
    result = pw.synthesize(f0, sp_shifted, ap, sr, frame_period=fp)

    # Match length
    if len(result) > len(audio):
        result = result[:len(audio)]
    elif len(result) < len(audio):
        result = np.pad(result, (0, len(audio) - len(result)))

    return result.astype(np.float32)


def speech_to_singing(audio, sr, section_type='verse', intensity=0.7,
                      key='C', bpm=120, genre='pop', perf_tag=None, text=None,
                      vocoder_type='world'):
    """
    V16: Neural Vocoder + Türkçe Melodik Contour + Phrase-Aware Şarkı Sentezi.

    vocoder_type:
      'world'  → Klasik WORLD pw.synthesize (eski davranış)
      'neural' → WORLD sentez + Vocos neural re-synthesis (gür, net ses)
      'auto'   → Neural varsa neural, yoksa WORLD fallback

    Pipeline:
    1)  WORLD Analysis (f0, sp, ap)
    2)  Scale + NoteEvent grid (kelime vurgusuyla)
    3)  Phrase detection
    4)  Sigmoid nota geçişleri (coarticulation)
    5)  Phrase-aware melodic arc (scoop → peak → cadence)
    6)  Türkçe melodik contour (kelime vurgusu, hece-içi eğri, legato)
    7)  Energy envelope coupling
    8)  Tonality (aperiodicity azaltma)
    9)  Consonant onset + stress-aware transients
    10) Vowel-clustered formant shift
    11) Vowel-only stretch
    12) Per-syllable stress-aware vibrato
    13) WORLD Synthesis
    13n) Neural Re-synthesis (Vocos) — opsiyonel
    14) Shaped breath
    15) Dinamik kontrol
    """
    g = get_genre(genre)
    perf = get_performance_override(perf_tag)
    audio_f64 = audio.astype(np.float64)
    fp = 5.0  # frame period (ms)

    # ── Expression bus: temiz parametreler ──
    if perf:
        expr_val = perf.get('expr_base', 0.5)
        expr_params = _expr_to_params(expr_val)
    else:
        expr_params = _expr_to_params(0.5)

    # ── 1) WORLD Analysis ──
    f0_raw, t = pw.dio(audio_f64, sr, f0_floor=65.0, f0_ceil=600.0,
                       frame_period=fp)
    f0_raw = pw.stonemask(audio_f64, f0_raw, t, sr)
    sp = pw.cheaptrick(audio_f64, f0_raw, t, sr)
    ap = pw.d4c(audio_f64, f0_raw, t, sr)

    nf = len(f0_raw)
    voiced = f0_raw > 0

    if not np.any(voiced):
        return audio

    # ── 2) Scale + NoteEvent grid ──
    med_f0 = float(np.median(f0_raw[voiced]))
    base_oct = 3 if med_f0 < 180 else 4
    scale = build_scale(key, base_oct, g['scale_type'])
    root_idx = int(np.argmin([abs(freq - med_f0) for freq in scale]))
    fr = 1000.0 / fp  # 200 fps

    if perf:
        snap = perf['snap']
    else:
        # V21: Daha yüksek snap = nota kilidi = şarkı hissi (konuşma değil)
        snap = min(1.0, g['pitch_snap'] + 0.05 * intensity)

    target_f0 = np.zeros(nf, dtype=np.float64)
    note_events = None
    phrases = []

    # NoteEvent tabanlı nota ataması — V17: BPM-sync + kelime vurgusu
    if text and text.strip():
        syllables, is_word_last = syllabify_turkish_ex(text)
        if len(syllables) >= 2:
            note_events = build_note_events(
                syllables, key, g['scale_type'], section_type,
                genre, bpm, med_f0, scale, root_idx,
                is_word_last=is_word_last
            )
            onset_segments = detect_syllable_onsets(audio, sr, len(syllables))

            # V17: Onset'leri BPM grid'ine snap et
            onset_segments = _quantize_onsets_to_grid(onset_segments, bpm, fr, nf)

            note_events = _align_notes_to_audio(note_events, onset_segments, nf, fr, bpm)

            # Per-note f0 ataması
            for ev in note_events:
                for i in range(ev.start_frame, min(ev.end_frame, nf)):
                    if voiced[i]:
                        target_f0[i] = f0_raw[i] * (1.0 - snap) + ev.freq_hz * snap
        else:
            target_note = scale[root_idx] if scale else med_f0
            for i in range(nf):
                if voiced[i]:
                    target_f0[i] = f0_raw[i] * (1.0 - snap) + target_note * snap
    else:
        # Fallback: beat-grid melodi
        melody = g['chorus_melody'] if section_type == 'chorus' else g['verse_melody']
        beat_dur = 60.0 / max(bpm, 60)
        for i in range(nf):
            if not voiced[i]:
                continue
            t_sec = i / fr
            beat_idx = int(t_sec / beat_dur) % len(melody)
            degree = melody[beat_idx]
            nidx = max(0, min(root_idx + degree, len(scale) - 1))
            target_note = scale[nidx]
            target_f0[i] = f0_raw[i] * (1.0 - snap) + target_note * snap

    # ── 3) Phrase detection ──
    if note_events:
        phrases = _detect_phrases(note_events, fr)

    # ── 4) Sigmoid Note Transitions (coarticulation) ──
    if note_events:
        for idx in range(1, len(note_events)):
            ev = note_events[idx]
    # ── 4) V17: Improved Sigmoid Note Transitions ──
    # Wider glide windows + consonant-aware pitch hold
    if note_events:
        for idx in range(1, len(note_events)):
            ev = note_events[idx]
            prev_ev = note_events[idx - 1]
            if prev_ev.articulation == 'legato':
                interval_st = 12.0 * np.log2(max(ev.freq_hz, 1) / max(prev_ev.freq_hz, 1))
                prev_len = prev_ev.end_frame - prev_ev.start_frame
                curr_len = ev.end_frame - ev.start_frame

                # V21: Wide legato glide windows for smooth singing transitions
                # Before: 50%/35% → Now: 65%/45%
                glide_before = max(4, int(0.65 * prev_len))
                glide_after = max(3, int(0.45 * curr_len))
                glide_start = max(prev_ev.start_frame, prev_ev.end_frame - glide_before)
                glide_end = min(ev.start_frame + glide_after, nf)
                actual_frames = glide_end - glide_start
                if actual_frames < 3:
                    continue

                # V17: Consonant-aware — unvoiced frames hold previous pitch
                for i in range(glide_start, glide_end):
                    if target_f0[i] > 0:
                        progress = (i - glide_start) / max(1, actual_frames - 1)
                        # If frame is unvoiced (consonant), don't transition yet
                        if not voiced[i]:
                            continue
                        s = _sigmoid_glide(progress, interval_st)
                        target_f0[i] = prev_ev.freq_hz * (1 - s) * snap + \
                                        ev.freq_hz * s * snap + \
                                        f0_raw[i] * (1.0 - snap)
    else:
        # Fallback portamento
        port = max(3, int(0.035 * fr))
        raw_f0 = target_f0.copy()
        for i in range(nf):
            if raw_f0[i] <= 0:
                continue
            lo = max(0, i - port)
            hi = min(nf, i + port + 1)
            window = raw_f0[lo:hi]
            voiced_vals = window[window > 0]
            if len(voiced_vals) > 0:
                target_f0[i] = np.mean(voiced_vals)

    # ── 5) Phrase-aware melodic arc (scoop → peak → cadence) ──
    if note_events and phrases:
        expression_val = expr_params.get('expression', 0.4)
        if expression_val > 0.15:
            target_f0 = _apply_phrase_expression(
                target_f0, note_events, phrases, fr, expr_params)
    elif note_events:
        expression_val = expr_params.get('expression', 0.4)
        if expression_val > 0.15:
            target_f0 = _apply_expression_bus(target_f0, note_events, fr, expr_params)

    # ── 6) Türkçe melodik contour (kelime vurgusu + hece contour + legato) ──
    if note_events:
        target_f0 = _apply_turkish_prosody(target_f0, note_events, fr, text)

    # ── 7) Energy envelope coupling: expression → amplitude gain ──
    expression = expr_params.get('expression', 0.4)
    energy_gain = 1.0 + 0.15 * expression  # max +9% amplitude at full expression

    # ── 8) Tonality (aperiodicity azaltma) + Breathiness (performance tag) ──
    singing_ap = ap.copy()
    singing_sp = sp.copy()
    tonality = expr_params.get('tonality', 0.25 + 0.45 * intensity)
    # V6: Per-tag breathiness — whisper/soft için aperiodicity boost
    ap_breathiness = perf.get('ap_breathiness', 0.0) if perf else 0.0
    for i in range(nf):
        if target_f0[i] > 0:
            singing_ap[i] *= (1.0 - tonality)
            # Breathiness: aperiodicity'yi yukarı çek (nefesli karakter)
            if ap_breathiness > 0:
                singing_ap[i] = singing_ap[i] + (1.0 - singing_ap[i]) * ap_breathiness

    # ── 9) Consonant onset + transients ──
    if note_events:
        onset_str = min(0.4, expr_params.get('onset_attack', 0.3))
        if onset_str > 0.1:
            singing_sp, singing_ap = _apply_consonant_onset(
                singing_sp, singing_ap, note_events, nf, onset_str)

    # ── 10) Vowel-clustered formant shift ──
    if note_events:
        fs_amt = min(0.35, expr_params.get('formant_shift', 0.2))
        if fs_amt > 0.05:
            singing_sp = _apply_formant_shift_simple(
                singing_sp, target_f0, med_f0, note_events, fs_amt)

    # ── 10b) V22: Note scoop — notaya aşağıdan yaklaşma (şarkı hissi) ──
    # Sustain öncesi uygulanır çünkü stretch frame indekslerini değiştirir
    if note_events:
        scoop_depth = 40 if not perf else max(15, int(40 * perf.get('vibrato_mult', 1.0) * 0.7))
        target_f0 = _apply_note_scoop(target_f0, note_events, fr,
                                       scoop_cents=scoop_depth, scoop_ratio=0.12)

    # ── 11) Vowel-only stretch — sesli uzatma (şarkı hissi) ──
    # V22: Daha derin sustain — Türkçe şarkıda uzun ünlüler kritik
    sustain_mult = perf['sustain_mult'] if perf else 1.0
    sustain = 1.0 + (g['sustain_ratio'] - 1.0) * intensity * 1.4 * sustain_mult
    sustain = max(1.0, min(sustain, 1.8))

    if sustain > 1.08:
        target_f0, singing_sp, singing_ap = _stretch_vowel_only(
            target_f0, singing_sp, singing_ap, voiced, note_events, fr, sustain
        )

    # ── 12) Per-syllable stress-aware vibrato ──
    vib_mult = expr_params.get('vibrato_mult', 1.0)
    vib_expression_scale = 0.7 + expression * 1.3
    vib_cents = g['vibrato_depth'] * 1200 * max(0.5, intensity) * vib_mult * vib_expression_scale
    if vib_cents > 5:
        target_f0 = _apply_f0_vibrato(
            target_f0, fr, depth_cents=vib_cents,
            rate_hz=g['vibrato_rate'], onset_ratio=g['vibrato_onset'],
            note_events=note_events
        )

    # ── 12b) V6: Per-tag F0 shift (semitone) — belting/falsetto yüksek, whisper düşük ──
    f0_shift_st = perf.get('f0_shift_st', 0) if perf else 0
    if f0_shift_st != 0:
        shift_ratio = 2.0 ** (f0_shift_st / 12.0)
        voiced_mask = target_f0 > 0
        target_f0[voiced_mask] *= shift_ratio
        print(f"[PERF-TAG] f0_shift: {f0_shift_st:+d} st (ratio={shift_ratio:.3f})")

    # ── 13) WORLD Synthesis ──
    result = pw.synthesize(
        target_f0.astype(np.float64),
        singing_sp.astype(np.float64),
        singing_ap.astype(np.float64),
        sr, frame_period=fp
    )

    # ── 13n) Neural Re-synthesis (Vocos) — WORLD çıkışını neural vocoder ile yeniden sentezle ──
    use_neural = False
    if vocoder_type in ('neural', 'auto'):
        try:
            from services.neural_vocoder import neural_resynthesize, is_available
            if is_available():
                neural_result = neural_resynthesize(result, sr)
                if neural_result is not None:
                    # Neural vocoder çıkışını WORLD çıkışı ile aynı uzunluğa getir
                    target_len = len(result)
                    if len(neural_result) > target_len:
                        neural_result = neural_result[:target_len]
                    elif len(neural_result) < target_len:
                        neural_result = np.pad(neural_result, (0, target_len - len(neural_result)))
                    result = neural_result
                    use_neural = True
        except Exception as e:
            print(f"[speech_to_singing] Neural vocoder hatası, WORLD fallback: {e}")

    # ── 13n-post) V21: Neural path — minimal waveform enhancement ──
    # Vocos sesi temiz, AMA amplitude vibrato + dynamics şarkı hissi için şart.
    # F0 vibrato zaten WORLD öncesinde uygulandı ve Vocos bunu koruyor.
    # Sadece amplitude vibrato (hafif) + dynamics uygula.
    if use_neural:
        # V21: Amplitude vibrato — neural path için de gerekli (şarkı hissi)
        if vib_cents > 5:
            amp_vib_depth = 0.025 * vib_mult * intensity * vib_expression_scale
            if amp_vib_depth > 0.015:
                result = _apply_amplitude_vibrato(
                    result.astype(np.float32), sr, target_f0, fr,
                    depth=min(amp_vib_depth, 0.05), rate_hz=g['vibrato_rate'],
                    onset_ratio=g['vibrato_onset']
                )
        # Dynamics
        dyn = g['dynamics_chorus'] if section_type == 'chorus' else g['dynamics_verse']
        dyn_mult = perf['dynamics'] if perf else 1.0
        result = result * ((1.0 + (dyn - 1.0) * intensity) * dyn_mult * energy_gain)
        peak = np.abs(result).max()
        if peak > 0.95:
            result = result / peak * 0.92
        return result.astype(np.float32)

    # ── Below: WORLD-only post-processing (skipped for neural) ──

    # ── 13a) V15: Harmonic Enrichment — gür, net ses (WORLD only) ──
    if note_events:
        harmonic_richness = min(0.30, 0.15 + 0.15 * intensity)
        result = _apply_harmonic_enrichment(
            result.astype(np.float32), sr, target_f0, fr,
            note_events=note_events, n_harmonics=6, richness=harmonic_richness
        )

    # ── 13a2) V15: Spectral Vibrato — shimmer ──
    if vib_cents > 5 and note_events:
        shimmer_depth = 0.03 * vib_mult * intensity
        if shimmer_depth > 0.01:
            result = _apply_spectral_vibrato(
                result.astype(np.float32), sr, target_f0, fr,
                note_events=note_events, depth=min(shimmer_depth, 0.08),
                rate_hz=g['vibrato_rate']
            )

    # ── 13b) V18: Amplitude vibrato — azaltıldı, ses dalgalanması önlendi ──
    if vib_cents > 5:
        amp_vib_depth = 0.03 * vib_mult * intensity * vib_expression_scale
        if amp_vib_depth > 0.02:
            result = _apply_amplitude_vibrato(
                result.astype(np.float32), sr, target_f0, fr,
                depth=min(amp_vib_depth, 0.06), rate_hz=g['vibrato_rate'],
                onset_ratio=g['vibrato_onset']
            )

    # ── 14) Shaped breath (lowpass, phrase-aware, %3 mix) ──
    if note_events and phrases:
        breath_intensity = min(0.5, expression * 0.7)
        if breath_intensity > 0.1:
            result = _apply_shaped_breath(
                result.astype(np.float32), sr, note_events, phrases, fr,
                intensity=breath_intensity)

    # ── 15) Dinamik kontrol + energy coupling ──
    dyn = g['dynamics_chorus'] if section_type == 'chorus' else g['dynamics_verse']
    dyn_mult = perf['dynamics'] if perf else 1.0
    result *= (1.0 + (dyn - 1.0) * intensity) * dyn_mult * energy_gain

    # V20: Crescendo/building — giderek artan dinamik
    if perf_tag and perf_tag.lower() in ('crescendo', 'yükseliş', 'yükselme', 'building', 'artarak'):
        n_samples = len(result)
        if n_samples > 0:
            # Başlangıç %50 ses → bitiş %110 ses (doğal crescendo eğrisi)
            cresc_env = np.linspace(0.50, 1.10, n_samples).astype(np.float32)
            result = result * cresc_env

    # ── 16) Peak güvenliği ──
    peak = np.abs(result).max()
    if peak > 0.95:
        result = result / peak * 0.92

    return result.astype(np.float32)


# ═══════════════════════════════════════════════════
# V15: MULTI-HARMONIC ENRICHMENT + SPECTRAL VIBRATO
# ═══════════════════════════════════════════════════

def _get_vowel_for_frame(frame_idx, note_events, nf):
    """Frame'in hangi ünlüye denk geldiğini bul."""
    if not note_events:
        return None
    for ev in note_events:
        if ev.start_frame <= frame_idx < min(ev.end_frame, nf):
            if ev.syllable:
                for ch in ev.syllable:
                    lch = ch.lower()
                    if lch in 'aeıioöuü':
                        return lch
            return None
    return None


def _formant_resonance(freq, vowel_char):
    """
    Formant-based resonance gain for a frequency.
    Vowel formants (F1, F2, F3) act as resonance peaks.
    Returns gain multiplier 0.1-1.0.
    """
    if not vowel_char or vowel_char.lower() not in _VOWEL_FORMANTS:
        return 0.5  # neutral
    formants = _VOWEL_FORMANTS.get(vowel_char.lower(), (500, 1200, 2600))
    f1, f2, f3 = formants[0], formants[1], formants[2]
    # Resonance = sum of gaussian peaks at each formant
    bw1, bw2, bw3 = 90.0, 120.0, 150.0  # bandwidth (Hz)
    g1 = np.exp(-0.5 * ((freq - f1) / bw1) ** 2)
    g2 = 0.7 * np.exp(-0.5 * ((freq - f2) / bw2) ** 2)
    g3 = 0.4 * np.exp(-0.5 * ((freq - f3) / bw3) ** 2)
    gain = 0.15 + 0.85 * min(1.0, g1 + g2 + g3)  # floor 0.15
    return gain


def _apply_harmonic_enrichment(audio, sr, target_f0, fr, note_events=None,
                               n_harmonics=6, richness=0.25):
    """
    V15: Multi-harmonic waveform enrichment.

    WORLD vocoder çıkışına harmonik overtone'lar ekler:
    - 6 harmonik partial (fundamental × 2..7)
    - Per-partial micro-detuning (0.2-0.5 cent)
    - Vowel-specific formant resonance filter
    - Stress-based amplitude modulation
    - Natural roll-off: higher partials quieter

    Sonuç: Gür, net, doğal vokal — flat sinüzoid DEĞİL.

    richness: 0.0-1.0 → harmonik mix seviyesi (0.25 = %25 harmonik ekleme)
    """
    if richness < 0.02:
        return audio

    result = audio.copy().astype(np.float64)
    n_samples = len(result)
    hop_samples = max(1, int(sr / fr))
    nf = len(target_f0)
    rng = np.random.default_rng(17)

    # Per-partial detuning: sabit ama küçük (0.2-0.5 cent)
    detune_cents = rng.uniform(-0.5, 0.5, n_harmonics)

    # Build per-frame stress map
    frame_stress = np.full(nf, 0.5)
    if note_events:
        for ev in note_events:
            s = ev.start_frame
            e = min(ev.end_frame, nf)
            if e > s:
                frame_stress[s:e] = ev.stress

    # Build harmonics signal
    harmonics_signal = np.zeros(n_samples, dtype=np.float64)

    # Phase accumulators for each harmonic (continuous phase)
    phases = np.zeros(n_harmonics, dtype=np.float64)

    for fi in range(nf):
        f0_val = target_f0[fi]
        if f0_val <= 0:
            continue

        sample_start = fi * hop_samples
        sample_end = min((fi + 1) * hop_samples, n_samples)
        if sample_start >= n_samples:
            break
        frame_len = sample_end - sample_start
        if frame_len <= 0:
            continue

        # Find vowel for this frame
        vowel = _get_vowel_for_frame(fi, note_events, nf)
        stress = frame_stress[fi]

        # Generate each harmonic partial
        for h in range(n_harmonics):
            partial_num = h + 2  # harmonics 2,3,4,5,6,7
            base_freq = f0_val * partial_num
            # Skip if above Nyquist
            if base_freq >= sr * 0.45:
                continue

            # Micro-detuning
            detuned_freq = base_freq * (2.0 ** (detune_cents[h] / 1200.0))

            # Natural roll-off: higher partials quieter
            # Typical voice: -6dB per octave above fundamental
            rolloff = 1.0 / (partial_num ** 0.8)  # gentler than 1/n

            # Formant resonance: vowel-specific gain
            formant_gain = _formant_resonance(detuned_freq, vowel)

            # Stress modulation: stressed syllables slightly brighter
            stress_gain = 0.8 + 0.4 * stress  # 0.8-1.2x

            # Combined amplitude
            amp = rolloff * formant_gain * stress_gain

            # Generate samples with continuous phase
            t_samples = np.arange(frame_len, dtype=np.float64) / sr
            partial_signal = amp * np.sin(2.0 * np.pi * detuned_freq * t_samples + phases[h])

            # Update phase for continuity
            phases[h] += 2.0 * np.pi * detuned_freq * frame_len / sr
            phases[h] %= (2.0 * np.pi)

            harmonics_signal[sample_start:sample_end] += partial_signal

    # Normalize harmonics to match original audio level
    orig_rms = np.sqrt(np.mean(result ** 2)) + 1e-10
    harm_rms = np.sqrt(np.mean(harmonics_signal ** 2)) + 1e-10
    harmonics_signal *= (orig_rms / harm_rms)

    # Mix: original + harmonics at richness level
    result = result + richness * harmonics_signal

    # Peak safety
    peak = np.abs(result).max()
    if peak > 0.95:
        result = result / peak * 0.92

    return result.astype(np.float32)


def _apply_spectral_vibrato(audio, sr, target_f0, fr, note_events=None,
                            depth=0.04, rate_hz=5.5):
    """
    V15: Per-harmonic spectral vibrato — amplitude + spectral modulation.

    Normal vibrato sadece F0 sallar. Spectral vibrato ayrıca:
    - Üst harmoniklerin amplitüdünü modüle eder (shimmer)
    - Formant bölgelerine yakın harmonikler daha çok salınır
    - Stress-coupled: vurgulu hecelerde daha belirgin

    İnsan sesinde F0 + amplitude + spectral birlikte salınır.
    depth: 0.0-0.15 → shimmer seviyesi
    """
    if depth < 0.01:
        return audio

    result = audio.copy().astype(np.float64)
    n_samples = len(result)
    hop_samples = max(1, int(sr / fr))
    nf = len(target_f0)

    # Build stress map
    frame_stress = np.full(nf, 0.5)
    if note_events:
        for ev in note_events:
            s = ev.start_frame
            e = min(ev.end_frame, nf)
            if e > s:
                frame_stress[s:e] = ev.stress

    # Build modulation signal: low-frequency spectral vibrato
    # Applied as amplitude envelope modulation
    for fi in range(nf):
        f0_val = target_f0[fi]
        if f0_val <= 0:
            continue

        sample_start = fi * hop_samples
        sample_end = min((fi + 1) * hop_samples, n_samples)
        if sample_start >= n_samples:
            break
        frame_len = sample_end - sample_start
        if frame_len <= 0:
            continue

        stress = frame_stress[fi]
        effective_depth = depth * (0.6 + 0.8 * stress)  # stress modulation

        t_samples = np.arange(frame_len, dtype=np.float64) / sr
        t_global = sample_start / sr

        # Spectral modulation: slight amplitude wobble synced with vibrato
        mod = 1.0 + effective_depth * np.sin(2.0 * np.pi * rate_hz * (t_global + t_samples))

        result[sample_start:sample_end] *= mod

    # Peak safety
    peak = np.abs(result).max()
    if peak > 0.95:
        result = result / peak * 0.92

    return result.astype(np.float32)


# ═══════════════════════════════════════════════════
# STÜDYO KALİTESİ MASTERİNG — V6
# ═══════════════════════════════════════════════════

def _generate_room_ir(sr, rt60=0.3, pre_delay_ms=5):
    """V12: Kısa, difüz oda impulse response — echo DEĞİL ambiyans."""
    pd = int(pre_delay_ms / 1000.0 * sr)
    ir_len = int(rt60 * sr)
    t = np.arange(ir_len, dtype=np.float64) / sr
    # Hızlı decay — echo oluşmadan biter
    decay = np.exp(-9.0 * t / max(rt60, 0.05))
    rng = np.random.default_rng(42)
    noise = rng.standard_normal(ir_len).astype(np.float32)
    ir = noise * decay.astype(np.float32)
    # Daha agresif lowpass — tiz yankıyı kes
    sos = butter(3, min(4000, sr * 0.35), btype='low', fs=sr, output='sos')
    ir = sosfiltfilt(sos, ir).astype(np.float32)
    ir = np.concatenate([np.zeros(pd, dtype=np.float32), ir])
    peak = np.abs(ir).max()
    if peak > 0:
        ir = ir / peak * 0.3
    return ir


def apply_studio_reverb(audio, sr, room_size=0.3, wet=0.04):
    """
    V12: Minimal ambiyans reverb — echo oluşturmaz, sadece hafif alan hissi.
    Room size 0.0-1.0 → RT60 0.1s-0.5s (çok kısa).
    Wet max %5 — vokal okunur, yankı duyulmaz.
    """
    from scipy.signal import fftconvolve
    rt60 = 0.1 + room_size * 0.4  # Max 0.5s — minimal ambiyans
    ir = _generate_room_ir(sr, rt60=rt60, pre_delay_ms=3)  # 3ms pre-delay — algılanamaz
    reverb_tail = fftconvolve(audio, ir, mode='full')[:len(audio)]
    result = (1.0 - wet) * audio + wet * reverb_tail.astype(np.float32)
    peak = np.abs(result).max()
    if peak > 0.98:
        result = result / peak * 0.95
    return result.astype(np.float32)


def apply_vocal_eq(audio, sr, profile='bright'):
    """
    Genre-spesifik vokal EQ.
    Profiller: warm, bright, airy, full, vintage
    """
    result = audio.copy().astype(np.float64)

    if profile == 'warm':
        # Low-mid boost (200-500Hz), gentle HF roll-off
        sos_lm = butter(2, [200, 500], btype='band', fs=sr, output='sos')
        result += 0.15 * sosfiltfilt(sos_lm, audio)
        sos_hf = butter(2, min(8000, sr * 0.4), btype='low', fs=sr, output='sos')
        result = sosfiltfilt(sos_hf, result)
    elif profile == 'bright':
        # Presence boost (3-6kHz), air boost (10kHz+)
        sos_pr = butter(2, [3000, min(6000, sr * 0.4)], btype='band', fs=sr, output='sos')
        result += 0.20 * sosfiltfilt(sos_pr, audio)
        if sr > 22000:
            sos_air = butter(2, min(10000, sr * 0.4), btype='high', fs=sr, output='sos')
            result += 0.10 * sosfiltfilt(sos_air, audio)
    elif profile == 'airy':
        # Wide high boost, gentle compression
        sos_air = butter(2, min(5000, sr * 0.4), btype='high', fs=sr, output='sos')
        result += 0.18 * sosfiltfilt(sos_air, audio)
    elif profile == 'full':
        # Balanced boost across spectrum
        sos_lo = butter(2, [100, 300], btype='band', fs=sr, output='sos')
        sos_mid = butter(2, [1000, min(4000, sr * 0.4)], btype='band', fs=sr, output='sos')
        sos_hi = butter(2, min(8000, sr * 0.4), btype='high', fs=sr, output='sos')
        result += 0.08 * sosfiltfilt(sos_lo, audio)
        result += 0.12 * sosfiltfilt(sos_mid, audio)
        result += 0.10 * sosfiltfilt(sos_hi, audio)
    elif profile == 'vintage':
        # Band-limited warmth (300Hz-5kHz emphasis)
        sos_bp = butter(2, [300, min(5000, sr * 0.4)], btype='band', fs=sr, output='sos')
        result = 0.7 * result + 0.3 * sosfiltfilt(sos_bp, audio)

    # Always: HP at 80Hz to remove rumble
    sos_hp = butter(3, 80, btype='high', fs=sr, output='sos')
    result = sosfiltfilt(sos_hp, result)

    return result.astype(np.float32)


def apply_soft_compression(audio, sr, threshold_db=-18, ratio=3.0,
                           attack_ms=15, release_ms=150):
    """Soft-knee dinamik kompresyon — broadcast kalitesi."""
    frame_len = max(256, int(0.01 * sr))
    hop = frame_len // 2
    rms = librosa.feature.rms(y=audio, frame_length=frame_len, hop_length=hop)[0]
    rms_db = 20 * np.log10(rms + 1e-10)

    knee_w = 6.0
    gain_db = np.zeros_like(rms_db)
    for i in range(len(rms_db)):
        x = rms_db[i]
        if x < threshold_db - knee_w / 2:
            gain_db[i] = 0.0
        elif x > threshold_db + knee_w / 2:
            gain_db[i] = (threshold_db + (x - threshold_db) / ratio) - x
        else:
            t = (x - threshold_db + knee_w / 2) / knee_w
            comp = threshold_db + (x - threshold_db) / (1 + (ratio - 1) * t)
            gain_db[i] = comp - x

    att_c = np.exp(-1.0 / max(1, attack_ms / 1000 * sr / hop))
    rel_c = np.exp(-1.0 / max(1, release_ms / 1000 * sr / hop))
    smoothed = np.zeros_like(gain_db)
    smoothed[0] = gain_db[0]
    for i in range(1, len(gain_db)):
        coef = att_c if gain_db[i] < smoothed[i - 1] else rel_c
        smoothed[i] = coef * smoothed[i - 1] + (1 - coef) * gain_db[i]

    gain_lin = 10 ** (smoothed / 20)
    times = np.arange(len(gain_lin)) * hop
    gain_interp = np.interp(np.arange(len(audio)), times, gain_lin)
    gain_interp = np.clip(gain_interp, 0.1, 3.0)
    return (audio * gain_interp).astype(np.float32)


def apply_deesser(audio, sr, frequency=5500, reduction_db=4.5):
    """Tiz ses arındırma (de-esser)."""
    nyq = sr * 0.45
    freq = min(frequency, nyq)
    sos_hp = butter(4, freq, btype='high', fs=sr, output='sos')
    sibilance = sosfiltfilt(sos_hp, audio).astype(np.float32)

    frame_len = max(128, int(0.005 * sr))
    hop = frame_len // 2
    rms_sib = librosa.feature.rms(y=sibilance, frame_length=frame_len, hop_length=hop)[0]
    rms_db = 20 * np.log10(rms_sib + 1e-10)
    thresh = float(np.percentile(rms_db, 75))

    gain_db = np.where(rms_db > thresh,
                       np.clip((rms_db - thresh) * (-reduction_db / 8), -reduction_db, 0),
                       0.0)
    times = np.arange(len(gain_db)) * hop
    gain_interp = np.interp(np.arange(len(audio)), times, 10 ** (gain_db / 20))
    reduced_sib = sibilance * gain_interp.astype(np.float32)
    return (audio - sibilance + reduced_sib).astype(np.float32)


def master_vocal(audio, sr, genre='pop', mood=None, neural_vocoder=False):
    """
    Tam stüdyo mastering zinciri.
    V5 Neural: Sadece LUFS normalizasyon + peak limiter.
    WORLD: Full chain (EQ, comp, de-esser, reverb, LUFS, limiter).
    """
    g = get_genre(genre)
    y = audio.astype(np.float32)

    # ── V5: Neural path — Vocos çıkışı zaten temiz, sadece normalize et ──
    if neural_vocoder:
        # LUFS normalize
        sos_k = butter(2, min(1500, sr * 0.4), btype='high', fs=sr, output='sos')
        weighted = sosfiltfilt(sos_k, y).astype(np.float32)
        rms = np.sqrt(np.mean(weighted ** 2)) + 1e-10
        current_lufs = 20 * np.log10(rms) - 0.691
        target_lufs = -14.0
        gain = 10 ** ((target_lufs - current_lufs) / 20)
        gain = min(gain, 6.0)
        y = (y * gain).astype(np.float32)

        # Hard Limiter — -0.1dB ceiling
        _final_ceiling = 10 ** (-0.1 / 20)
        peak = np.abs(y).max()
        if peak > _final_ceiling:
            y = y / peak * _final_ceiling

        return y.astype(np.float32)

    # ── Below: WORLD-only full mastering chain ──
    reverb_amount = g.get('reverb_amount', 0.22)
    eq_profile = g.get('eq_profile', 'bright')
    comp_amount = g.get('compression', 0.5)

    if mood and mood in MOOD_PRESETS:
        mp = MOOD_PRESETS[mood]
        reverb_amount = max(0.05, min(0.50, reverb_amount + mp.get('reverb_bias', 0)))

    # 1) EQ
    y = apply_vocal_eq(audio, sr, profile=eq_profile)

    # 2) Compression
    if comp_amount > 0.1:
        ratio = 2.0 + comp_amount * 3.0
        y = apply_soft_compression(y, sr, threshold_db=-20, ratio=ratio)

    # 3) De-esser
    y = apply_deesser(y, sr)

    # 4) Reverb — minimal ambiyans
    reverb_amount = min(reverb_amount, 0.05)  # WORLD: max %5 wet
    if reverb_amount > 0.01:
        room = min(0.35, reverb_amount * 5.0)
        y = apply_studio_reverb(y, sr, room_size=room, wet=reverb_amount)

    # 5) LUFS normalize
    sos_k = butter(2, min(1500, sr * 0.4), btype='high', fs=sr, output='sos')
    weighted = sosfiltfilt(sos_k, y).astype(np.float32)
    rms = np.sqrt(np.mean(weighted ** 2)) + 1e-10
    current_lufs = 20 * np.log10(rms) - 0.691
    target_lufs = -14.0
    gain = 10 ** ((target_lufs - current_lufs) / 20)
    gain = min(gain, 6.0)
    y = (y * gain).astype(np.float32)

    # 6) Hard Limiter — V3: -0.1dB ceiling
    _final_ceiling = 10 ** (-0.1 / 20)  # ~0.9885
    peak = np.abs(y).max()
    if peak > _final_ceiling:
        y = y / peak * _final_ceiling

    return y.astype(np.float32)


# ═══════════════════════════════════════════════════
# V22: VOKAL MARKUP PARSERİ — Fonetik + Uzatma + Duygu + Nefes
# ═══════════════════════════════════════════════════

import re as _re_mod

# Duygu/ton etiketleri → perf_tag + parametre etkisi
_MARKUP_TAG_MAP = {
    # Türkçe duygu etiketleri
    'yumuşak': 'soft', 'sert': 'powerful', 'fısıltı': 'whisper', 'nefesli': 'whisper',
    'tiz': None, 'kalın': None, 'titreşimli': None, 'vibrato': None,
    'kırık sesli': 'emotional', 'bağırarak': 'belting',
    'duygulu': 'emotional', 'hüzünlü': 'emotional', 'güçlü': 'powerful',
    'hafif': 'soft', 'yüksek': 'belting', 'alçak': 'soft',
    'hafif çatallı': 'emotional', 'dramatik': 'belting',
    # Doğrudan geçen performans etiketleri
    'soft': 'soft', 'belting': 'belting', 'whisper': 'whisper',
    'powerful': 'powerful', 'emotional': 'emotional', 'falsetto': 'falsetto',
    'crescendo': 'crescendo', 'rap': 'rap', 'spoken': 'spoken', 'adlib': 'adlib',
}

# Zamanlama etiketleri
_TIMING_MAP = {
    'kısa': 0.7, 'orta': 1.0, 'uzun': 1.4, 'çok uzun': 1.8,
    'short': 0.7, 'medium': 1.0, 'long': 1.4, 'very long': 1.8,
}

# Efekt etiketleri
_EFFECT_TAGS = {
    'nefes', 'nefes alır', 'nefes verir', 'breath',
    'hafif titreme', 'titreme', 'vibrato',
}


class VocalSegment:
    """V22: Parçalanmış vokal markup segmenti."""
    __slots__ = ('text', 'clean_text', 'perf_tag', 'elongation_map',
                 'timing_mult', 'is_breath', 'effects', 'pitch_hint')

    def __init__(self, text='', clean_text='', perf_tag=None,
                 elongation_map=None, timing_mult=1.0,
                 is_breath=False, effects=None, pitch_hint=None):
        self.text = text
        self.clean_text = clean_text
        self.perf_tag = perf_tag
        self.elongation_map = elongation_map or {}  # {syllable_idx: multiplier}
        self.timing_mult = timing_mult
        self.is_breath = is_breath
        self.effects = effects or []
        self.pitch_hint = pitch_hint  # 'tiz', 'kalın', 'yükselen' etc.


def _count_elongation(text):
    """
    Tekrarlanan ünlü harflerden uzatma çarpanı hesapla.
    'aaa' → 3x, 'ee' → 2x, 'aaaaa' → 5x (cap: 4.0)
    Döndürür: (temiz_metin, {hece_indexi: çarpan} dict)
    """
    tr_vowels = set('aeıioöuüAEIİOÖUÜ')
    result_chars = []
    elongation_positions = []  # (char_position_in_clean, multiplier)
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.lower() in tr_vowels:
            # Aynı ünlü kaç kez tekrarlanıyor?
            count = 1
            while i + count < len(text) and text[i + count].lower() == ch.lower():
                count += 1
            result_chars.append(ch)
            if count > 1:
                elongation_positions.append((len(result_chars) - 1, min(count, 4)))
            i += count
        else:
            result_chars.append(ch)
            i += 1

    clean = ''.join(result_chars)
    return clean, elongation_positions


def _parse_inline_tags(text):
    """
    Metin içindeki [...] etiketlerini parse et.
    Döndürür: [(is_tag, content), ...]
    """
    parts = []
    i = 0
    while i < len(text):
        if text[i] == '[':
            end = text.find(']', i)
            if end != -1:
                parts.append((True, text[i + 1:end].strip()))
                i = end + 1
            else:
                parts.append((False, text[i]))
                i += 1
        else:
            # Sonraki [ veya metin sonu
            next_bracket = text.find('[', i)
            if next_bracket == -1:
                parts.append((False, text[i:]))
                i = len(text)
            else:
                parts.append((False, text[i:next_bracket]))
                i = next_bracket
    return parts


def _parse_timing_hint(text):
    """
    Parantez içi zamanlama ipuçlarını parse et.
    'yaaaktıı (uzun)' → ('yaaaktıı', 1.4)
    """
    match = _re_mod.search(r'\(([^)]+)\)\s*$', text)
    if match:
        hint = match.group(1).strip().lower()
        timing = _TIMING_MAP.get(hint, None)
        if timing:
            clean = text[:match.start()].strip()
            return clean, timing
    return text, 1.0


def parse_vocal_markup(text):
    """
    V22: Gelişmiş vokal markup parser.

    Desteklenen format:
    ─────────────────────────────────────────
    [tempo: slow]
    [tone: duygulu, hafif hüzünlü]

    [yumuşak] aaşk be-ni yaaaktıı (uzun)
    [nefes]
    [belting] YAAAKTIII!
    [crescendo] git-ti-iii gööönlümden

    veya inline:
    aaşk... be-ni... yaaak-tıı
    aaşk | be-ni | yaaaak-tıı
    ─────────────────────────────────────────

    Döndürür: list[VocalSegment]
    """
    segments = []
    current_perf = None
    current_effects = []
    global_pitch_hint = None
    global_tempo = None

    # Satır bazlı parse
    lines = text.strip().split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Global meta etiketler: [tempo: slow], [tone: duygulu]
        meta_match = _re_mod.match(r'^\[(\w+)\s*:\s*(.+)\]\s*$', line)
        if meta_match:
            meta_key = meta_match.group(1).lower()
            meta_val = meta_match.group(2).strip().lower()
            if meta_key == 'tempo':
                global_tempo = meta_val  # slow, medium, fast
            elif meta_key in ('tone', 'ton', 'duygu'):
                # Virgülle ayrılmış duygu etiketleri
                for tag in meta_val.split(','):
                    tag = tag.strip()
                    mapped = _MARKUP_TAG_MAP.get(tag)
                    if mapped:
                        current_perf = mapped
                    if tag in ('tiz', 'kalın', 'yükselen', 'alçalan'):
                        global_pitch_hint = tag
            continue

        # | ile ayrılmış segmentler
        if '|' in line:
            sub_parts = line.split('|')
        else:
            sub_parts = [line]

        for sub in sub_parts:
            sub = sub.strip()
            if not sub:
                continue

            # Inline tag'leri parse et
            parsed = _parse_inline_tags(sub)
            text_parts = []
            seg_perf = current_perf
            seg_effects = list(current_effects)
            seg_pitch = global_pitch_hint

            for is_tag, content in parsed:
                if is_tag:
                    cl = content.lower().strip()
                    # Nefes efekti?
                    if cl in _EFFECT_TAGS:
                        if cl in ('nefes', 'nefes alır', 'nefes verir', 'breath'):
                            segments.append(VocalSegment(
                                text='[nefes]', clean_text='', is_breath=True))
                        else:
                            seg_effects.append(cl)
                        continue

                    # Virgülle ayrılmış duygu etiketleri
                    for tag in cl.split(','):
                        tag = tag.strip()
                        mapped = _MARKUP_TAG_MAP.get(tag)
                        if mapped:
                            seg_perf = mapped
                        if tag in ('tiz', 'kalın', 'yükselen', 'alçalan',
                                   'yükselen ton', 'alçalan ton', 'titreşimli'):
                            seg_pitch = tag
                        if tag in ('titreşimli', 'vibrato'):
                            seg_effects.append('vibrato')
                else:
                    text_parts.append(content)

            text_content = ''.join(text_parts).strip()
            if not text_content:
                continue

            # Zamanlama hint'i: "(uzun)", "(kısa)"
            text_content, timing_mult = _parse_timing_hint(text_content)

            # Uzatma analizi: tekrarlanan ünlüler
            clean_text, elong_positions = _count_elongation(text_content)

            # Tire ile bölünmüş heceler → clean_text'te tireleri koru (hece bilgisi)
            # Ama TTS için temizle
            tts_text = clean_text.replace('-', '').replace('...', ' ').replace('!', '').strip()
            tts_text = _re_mod.sub(r'\s+', ' ', tts_text)

            # Elongasyon pozisyonlarını hece indeksine çevir
            elongation_map = {}
            if elong_positions:
                # Heceleri çıkar
                syls = syllabify_turkish(tts_text)
                char_idx = 0
                for si, syl in enumerate(syls):
                    for ci in range(len(syl)):
                        for epos, emult in elong_positions:
                            if char_idx == epos:
                                elongation_map[si] = emult
                        char_idx += 1

            seg = VocalSegment(
                text=text_content,
                clean_text=tts_text,
                perf_tag=seg_perf,
                elongation_map=elongation_map,
                timing_mult=timing_mult,
                effects=seg_effects,
                pitch_hint=seg_pitch,
            )
            segments.append(seg)

    return segments, global_tempo


def apply_elongation_to_note_events(note_events, elongation_map, max_mult=3.5):
    """
    V22: Elongation map'e göre note_events'deki hecelerin süresini uzat.
    elongation_map: {syllable_index: multiplier}
    """
    if not elongation_map or not note_events:
        return note_events

    for syl_idx, mult in elongation_map.items():
        if 0 <= syl_idx < len(note_events):
            ev = note_events[syl_idx]
            orig_len = ev.end_frame - ev.start_frame
            extra = int(orig_len * (min(mult, max_mult) - 1.0))
            if extra > 0:
                ev.end_frame += extra
                # Sonraki note_events'leri kaydır
                for j in range(syl_idx + 1, len(note_events)):
                    note_events[j].start_frame += extra
                    note_events[j].end_frame += extra

    return note_events


def generate_breath_audio(sr=22050, duration=0.25):
    """V22: Kısa nefes sesi üret (gentle noise burst)."""
    n = int(sr * duration)
    rng = np.random.default_rng(42)
    noise = rng.normal(0, 0.03, n).astype(np.float32)
    # Fade envelope
    fade_in = np.linspace(0, 1, min(int(0.03 * sr), n))
    fade_out = np.linspace(1, 0, min(int(0.1 * sr), n))
    env = np.ones(n, dtype=np.float32)
    env[:len(fade_in)] *= fade_in
    env[-len(fade_out):] *= fade_out
    # Lowpass karakter (nefes sesi)
    from scipy.signal import butter, sosfiltfilt
    sos = butter(2, min(2500, sr * 0.4), btype='low', fs=sr, output='sos')
    breath = sosfiltfilt(sos, noise * env).astype(np.float32)
    return breath * 0.15  # Düşük seviye


# ═══════════════════════════════════════════════════
# METİN BÖLÜMLEME
# ═══════════════════════════════════════════════════

def parse_sections(text):
    """
    Metni bölümlere ayır.
    [kuple], [nakarat], [köprü] yapısal etiketleri + [soft], [belting], [whisper] performans etiketleri.
    Döndürür: [(section_type, text, perf_tag), ...]
    perf_tag None olabilir (performans etiketi yoksa).
    """
    import re

    # Yapısal etiketler → section type (case-insensitive)
    tag_map = {
        'verse': 'verse', 'kuple': 'verse', 'küple': 'verse', 'kuplé': 'verse',
        'mısra': 'verse', 'misra': 'verse', 'kıta': 'verse', 'dize': 'verse',
        'verse 1': 'verse', 'verse 2': 'verse', 'verse 3': 'verse',
        'kuple 1': 'verse', 'kuple 2': 'verse', 'kuple 3': 'verse',
        'chorus': 'chorus', 'nakarat': 'chorus', 'refren': 'chorus',
        'chorus 1': 'chorus', 'chorus 2': 'chorus',
        'bridge': 'bridge', 'köprü': 'bridge', 'kopru': 'bridge', 'ara': 'bridge',
        'intro': 'intro', 'giriş': 'intro', 'giris': 'intro',
        'outro': 'outro', 'çıkış': 'outro', 'cikis': 'outro', 'final': 'outro',
        'son': 'outro', 'kapanış': 'outro', 'kapanis': 'outro',
    }

    # Performans tag tanıma — büyük/küçük harf duyarsız
    all_perf_tags = set(PERFORMANCE_TAGS.keys()) | set(_PERF_TAG_ALIASES.keys())

    parts = re.split(r'\[([^\]]+)\]', text)
    sections = []

    if len(parts) > 1:
        current_type = 'verse'
        current_perf = None
        for part in parts:
            ps = part.strip()
            if not ps:
                continue
            pl = ps.lower().strip()
            if pl in tag_map:
                current_type = tag_map[pl]
            elif pl in all_perf_tags:
                current_perf = _PERF_TAG_ALIASES.get(pl, pl)
            else:
                # Metin bölümü: boş satırları temizle, section'a ekle
                clean_text = '\n'.join(l for l in ps.split('\n') if l.strip())
                if clean_text:
                    sections.append((current_type, clean_text, current_perf))
                    current_perf = None  # Perf tag kullanıldıktan sonra sıfırla
    else:
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        if len(paragraphs) <= 1:
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            if len(lines) <= 2:
                sections.append(('verse', text.strip(), None))
            else:
                mid = len(lines) // 2
                sections.append(('verse', '\n'.join(lines[:mid]), None))
                sections.append(('chorus', '\n'.join(lines[mid:]), None))
        else:
            for i, para in enumerate(paragraphs):
                sections.append(('verse' if i % 2 == 0 else 'chorus', para, None))

    if not sections:
        sections.append(('verse', text.strip(), None))
    return sections
