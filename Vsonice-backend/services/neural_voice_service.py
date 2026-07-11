"""
Neural Voice Service — Seed-VC (zero-shot singing voice conversion) wrapper.

Seed-VC, ayrı bir Python 3.11 venv'inde (.venv-neural) subprocess olarak çalışır;
ana backend Python 3.14'te kalır. GPU (CUDA) worker venv'inde kullanılır.

Kullanım:
    from services.neural_voice_service import neural_convert_singing, is_neural_available
    if is_neural_available():
        ok = neural_convert_singing(src.wav, ref.wav, out.wav)
"""

import os
import subprocess
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
SEEDVC_DIR = BACKEND_DIR / "vendor" / "seed-vc"


def _find_worker_python() -> Path:
    """Worker venv python'unu bul: env var > Windows venv > Linux venv (Docker)."""
    env = os.environ.get("NEURAL_PYTHON")
    if env:
        return Path(env)
    win = BACKEND_DIR / ".venv-neural" / "Scripts" / "python.exe"
    if win.exists():
        return win
    return Path("/opt/venv-neural/bin/python")


WORKER_PYTHON = _find_worker_python()

# İlk çalıştırmada HuggingFace'ten model iner (~1.5GB) — ek pay
MODEL_DOWNLOAD_EXTRA = 1200


def _conversion_timeout(source_path: str) -> int:
    """Dönüşüm süresi kaynak uzunluğuyla ölçeklenir (6GB GPU'da RTF ~3-4x).
    Kaynak süresinin 8 katı + 5 dk pay; en az 15 dk."""
    try:
        import soundfile as _sf
        dur = _sf.info(source_path).duration
    except Exception:
        dur = 300.0
    return max(900, int(dur * 8 + 300))


def is_neural_available() -> bool:
    """Worker venv ve Seed-VC reposu mevcut mu?"""
    return WORKER_PYTHON.exists() and (SEEDVC_DIR / "inference.py").exists()


def _models_downloaded() -> bool:
    cache = SEEDVC_DIR / "checkpoints" / "hf_cache"
    return cache.exists() and any(cache.rglob("*.pth")) or (
        cache.exists() and any(cache.rglob("*.safetensors"))
    )


def neural_convert_singing(
    source_path: str,
    reference_path: str,
    output_path: str,
    # 50 adım / 0.55 CFG: belgelenmiş tatlı nokta — daha fazlası ünlü
    # stabilitesini bozup artefakt üretiyor (ör. sürekli notalarda dalgalanma)
    diffusion_steps: int = 50,
    pitch_shift: int = 0,
    singing: bool = True,
    auto_f0: bool = False,
    cfg_rate: float = 0.55,
) -> bool:
    """
    Seed-VC ile ses dönüşümü. singing=True ise f0-conditioned 44.1kHz şarkı modeli,
    False ise 22kHz konuşma modeli kullanılır.

    Returns True on success (output_path yazılmış olur), False on failure.
    """
    if not is_neural_available():
        print("[NEURAL-VC] Worker venv bulunamadı, atlanıyor")
        return False

    source_path = str(Path(source_path).resolve())
    reference_path = str(Path(prepare_reference(reference_path)).resolve())

    # Şarkı, hedef sesin aralığının dışındaysa tam-oktav uyarla
    # (tizleşme/zorlanma önlenir; tonalite ve melodi bozulmaz)
    if singing and pitch_shift == 0:
        pitch_shift = auto_octave_shift(source_path, reference_path)
    out_dir = SEEDVC_DIR / "worker_out" / f"job_{int(time.time() * 1000)}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # seedvc_infer.py: inference.py + RMVPE f0 temizliği (oktav sıçraması düzeltme)
    driver = BACKEND_DIR / "seedvc_infer.py"
    cmd = [
        str(WORKER_PYTHON), str(driver) if driver.exists() else "inference.py",
        "--source", source_path,
        "--target", reference_path,
        "--output", str(out_dir),
        "--diffusion-steps", str(diffusion_steps),
        # 0.7 -> 0.5: yüksek CFG diffusion artefaktı (cızırtı) üretebiliyor
        "--inference-cfg-rate", str(cfg_rate),
        # auto-f0-adjust şarkıyı referans sesin (konuşma) perdesine kaydırır ->
        # detone/gıcırtı yaratır; melodinin orijinal perdesi korunmalı
        "--f0-condition", "True" if singing else "False",
        "--auto-f0-adjust", "True" if auto_f0 else "False",
        "--semi-tone-shift", str(pitch_shift),
        "--fp16", "True",
    ]

    timeout = _conversion_timeout(source_path)
    if not _models_downloaded():
        timeout += MODEL_DOWNLOAD_EXTRA
    print(f"[NEURAL-VC] Seed-VC başlatılıyor (steps={diffusion_steps}, singing={singing}, timeout={timeout}s)...")
    t0 = time.time()

    try:
        result = subprocess.run(
            cmd,
            cwd=str(SEEDVC_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        print(f"[NEURAL-VC] HATA Timeout ({timeout}s)")
        return False
    except Exception as e:
        print(f"[NEURAL-VC] HATA Subprocess hatası: {e}")
        return False

    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "")[-2000:]
        print(f"[NEURAL-VC] HATA Worker hata kodu {result.returncode}:\n{tail}")
        return False

    wavs = sorted(out_dir.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not wavs:
        print("[NEURAL-VC] HATA Çıktı dosyası üretilmedi")
        return False

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    # shutil.move: volume/bind-mount sınırları arasında rename çalışmaz (EXDEV)
    import shutil
    shutil.move(str(wavs[0]), str(out))

    # temizle
    try:
        for f in out_dir.glob("*"):
            f.unlink()
        out_dir.rmdir()
    except Exception:
        pass

    print(f"[NEURAL-VC] OK Tamamlandı ({time.time() - t0:.1f}s) -> {out.name}")
    return True


def _median_pitch(audio_path: str, max_seconds: float = 60.0) -> float | None:
    """Ses dosyasının medyan f0'ını (Hz) hesapla. Başarısızsa None."""
    try:
        import numpy as np
        import librosa

        sr = 22050
        y, _ = librosa.load(audio_path, sr=sr, mono=True, duration=max_seconds,
                            offset=0.0)
        if len(y) < sr:
            return None
        f0 = librosa.yin(y, fmin=65, fmax=1000, sr=sr,
                         frame_length=2048, hop_length=512)
        # Enerjisi düşük frame'leri ele (sessizlik/gürültü yin'i yanıltır)
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
        n = min(len(f0), len(rms))
        f0, rms = f0[:n], rms[:n]
        mask = (rms > np.percentile(rms, 40)) & (f0 > 65) & (f0 < 1000)
        if mask.sum() < 20:
            return None
        return float(np.median(f0[mask]))
    except Exception as e:
        print(f"[NEURAL-VC] Medyan perde hesaplanamadı ({Path(audio_path).name}): {e}")
        return None


def auto_octave_shift(source_path: str, reference_path: str) -> int:
    """
    Kaynak vokal ile referans ses arasındaki perde farkına göre tam-oktav
    transpozisyon öner (semiton cinsinden: -24/-12/0/+12/+24).

    Tam oktav = tonalite/enstrümantal uyumu bozulmaz, melodi aynı kalır;
    ama vokal, hedef sesin doğal aralığında söyler (tizleşme/zorlanma önlenir).
    """
    import math

    src = _median_pitch(source_path)
    ref = _median_pitch(reference_path)
    if not src or not ref:
        return 0
    diff_oct = math.log2(ref / src)
    # Yalnızca NET fark varsa kaydır (>0.7 oktav) — sınırda kalan durumlarda
    # kaydırmamak, yanlış oktava kaydırmaktan her zaman daha güvenli
    if abs(diff_oct + 0.25) < 0.7:
        return 0
    shift_oct = int(round(diff_oct + 0.25))
    shift_oct = max(-1, min(1, shift_oct))
    if shift_oct:
        print(f"[NEURAL-VC] Oktav uyarlama: kaynak {src:.0f}Hz, referans {ref:.0f}Hz "
              f"-> {shift_oct * 12:+d} semiton")
    return shift_oct * 12


def prepare_reference(reference_path: str, max_seconds: float = 22.0) -> str:
    """
    Referans sesi Seed-VC için optimize et:
    - mono 44.1kHz'e çevir
    - sessizlikleri kırp
    - en yüksek enerjili bitişik bölümü seç (Seed-VC ilk ~25s'i kullanır)
    - loudness normalize et

    İşlenmiş geçici wav yolunu döner; hata olursa orijinal yolu döner.
    """
    try:
        import numpy as np
        import librosa
        import soundfile as sf

        sr = 44100
        y, _ = librosa.load(reference_path, sr=sr, mono=True)
        if len(y) < sr:  # 1 saniyeden kısa — dokunma
            return reference_path

        # ÖNEMLİ: parça yapıştırma YOK — süreksiz ses, Seed-VC'nin stil aldığı
        # mel-prompt'u bozuyor (tını dalgalanması). Sadece baş/son sessizliği
        # kırpılır ve orijinalden TEK bitişik pencere seçilir.
        intervals = librosa.effects.split(y, top_db=40)
        if len(intervals) > 0:
            y = y[intervals[0][0]:intervals[-1][1]]

        # En yüksek RMS enerjili bitişik pencereyi seç (doğal duraklar korunur)
        max_len = int(max_seconds * sr)
        if len(y) > max_len:
            hop = sr  # 1 saniyelik adımlarla tara
            best_start, best_rms = 0, -1.0
            for start in range(0, len(y) - max_len + 1, hop):
                seg = y[start:start + max_len]
                rms = float(np.sqrt(np.mean(seg ** 2)))
                if rms > best_rms:
                    best_rms, best_start = rms, start
            y = y[best_start:best_start + max_len]

        # Loudness normalize (~-15 dB RMS: enerjik stil işareti) + peak limit
        rms = float(np.sqrt(np.mean(y ** 2)))
        if rms > 1e-5:
            y = y * (0.18 / rms)
        peak = float(np.abs(y).max())
        if peak > 0.95:
            y = y / peak * 0.95

        out_path = Path(reference_path).parent / f"refprep_{Path(reference_path).stem}.wav"
        sf.write(str(out_path), y.astype(np.float32), sr)
        print(f"[NEURAL-VC] Referans hazırlandı: {len(y)/sr:.1f}s (kaynak: {Path(reference_path).name})")
        return str(out_path)
    except Exception as e:
        print(f"[NEURAL-VC] Referans ön işleme atlandı: {e}")
        return reference_path


def transfer_dynamics(source, converted, sr: int):
    """
    Orijinal vokalin enerji zarfını (dinamiklerini) dönüştürülmüş vokale aktar.

    Seed-VC tınıyı doğru aktarır ama vurgu/enerji eğrisini referans (sakin
    konuşma) tarafına çeker -> 'mırıldanıyor' hissi. Bu fonksiyon frame bazında
    kaynak/çıktı RMS oranını hesaplayıp çıktıya uygular: haykırma, vurgu,
    crescendo birebir orijinal performanstan gelir.
    """
    import numpy as np
    import librosa
    from scipy.ndimage import uniform_filter1d

    n = min(len(source), len(converted))
    if n < sr:  # 1 saniyeden kısa — dokunma
        return converted

    src = np.asarray(source[:n], dtype=np.float32)
    dst = np.asarray(converted[:n], dtype=np.float32)

    frame, hop = 2048, 512
    env_s = librosa.feature.rms(y=src, frame_length=frame, hop_length=hop)[0]
    env_d = librosa.feature.rms(y=dst, frame_length=frame, hop_length=hop)[0]
    m = min(len(env_s), len(env_d))
    env_s, env_d = env_s[:m], env_d[:m]

    # ── Zaman hizalama: dönüşüm çıktısı kaynağa göre kaymış olabilir;
    #    kayıksa zarf yanlış hecelere biner -> kekeleme hissi. Zarflar arası
    #    çapraz korelasyonla global gecikmeyi bul (±1s) ve düzelt.
    max_lag = int(sr / hop)  # ~86 frame = 1s
    es = env_s - env_s.mean()
    ed = env_d - env_d.mean()
    best_lag, best_corr = 0, -1e18
    for lag in range(-max_lag, max_lag + 1, 2):
        if lag >= 0:
            a, b = es[lag:], ed[:m - lag]
        else:
            a, b = es[:m + lag], ed[-lag:]
        if len(a) > 100:
            c = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
            if c > best_corr:
                best_corr, best_lag = c, lag
    if best_lag != 0:
        env_s = np.roll(env_s, -best_lag)
        print(f"[NEURAL-VC] Zarf hizalama: {best_lag * hop / sr * 1000:+.0f}ms kayma düzeltildi")

    # ── KABA zarf (~400ms): makro dinamikler (kıta/nakarat, haykırma) aktarılır;
    #    hece seviyesine inilmez -> mikro hizalama hatası kekeleme üretemez.
    smooth = 35  # ~400ms
    env_s = uniform_filter1d(env_s, size=smooth)
    env_d = uniform_filter1d(env_d, size=smooth)

    gain = env_s / (env_d + 1e-6)
    gain = np.clip(gain, 0.5, 2.5)
    gain = uniform_filter1d(gain, size=smooth)

    gain_full = np.repeat(gain, hop)[:n]
    if len(gain_full) < n:
        gain_full = np.pad(gain_full, (0, n - len(gain_full)),
                           constant_values=gain_full[-1])

    out = dst * gain_full
    peak = float(np.abs(out).max())
    if peak > 0.98:
        out = out / peak * 0.98

    tail = np.asarray(converted[n:], dtype=np.float32)
    if len(tail):
        out = np.concatenate([out, tail])
    print(f"[NEURAL-VC] Dinamik aktarımı uygulandı (makro zarf, hizalanmış)")
    return out


def enhance_vocal(audio, sr: int):
    """
    Dönüştürülmüş vokal için stüdyo zenginleştirme:
    - presence bandı (2-5 kHz): netlik/önde durma
    - air bandı (8-14 kHz): parlaklık, 'frekans dolgunluğu'
    - hafif tanh doygunluğu: harmonik zenginlik (analog sıcaklık)
    """
    import numpy as np
    from scipy.signal import butter, sosfiltfilt

    y = np.asarray(audio, dtype=np.float64)
    nyq = sr / 2.0

    try:
        # Dozlar düşük tutulur: aşırı air bandı nefesliliği (fısıltı hissini)
        # yükseltir, aşırı doygunluk hırıltı ekler
        sos = butter(2, [2000 / nyq, 5000 / nyq], btype='bandpass', output='sos')
        y = y + sosfiltfilt(sos, y) * 0.18  # presence
        hi = min(12000, nyq - 200)
        sos = butter(2, [8000 / nyq, hi / nyq], btype='bandpass', output='sos')
        y = y + sosfiltfilt(sos, y) * 0.12  # air
        y = np.tanh(y * 1.03) / np.tanh(1.03)  # çok hafif doygunluk
    except Exception as e:
        print(f"[NEURAL-VC] Vokal zenginleştirme atlandı: {e}")
        return audio

    peak = float(np.abs(y).max())
    if peak > 0.98:
        y = y / peak * 0.98
    print("[NEURAL-VC] Vokal zenginleştirme uygulandı (presence + air + doygunluk)")
    return y.astype(np.float32)


def best_model_reference(model_dir: Path) -> Path | None:
    """
    Eğitilmiş model klasöründen Seed-VC için en iyi referans örneğini seç:
    - metadata'daki kalite skoru × süre (22s'ye kadar) puanıyla sırala
    - varsa tam çözünürlüklü (ref_*.wav, 44.1kHz) kopyayı tercih et
    """
    import json

    samples_dir = model_dir / "samples"
    meta_path = model_dir / "metadata.json"
    if not samples_dir.exists():
        return None

    ranked = []
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            for info in meta.get("sample_info", []):
                fn = info.get("filename")
                if not fn:
                    continue
                score = float(info.get("quality_score", 0.5)) * min(float(info.get("duration", 0)), 22.0)
                ranked.append((score, fn))
        except Exception:
            pass
    ranked.sort(reverse=True)

    for _, fn in ranked:
        hq = samples_dir / f"ref_{fn}"
        if hq.exists():
            return hq
        p = samples_dir / fn
        if p.exists():
            return p

    # metadata yoksa: HQ kopyalar > en büyük sample
    hqs = list(samples_dir.glob("ref_*.wav"))
    if hqs:
        return max(hqs, key=lambda p: p.stat().st_size)
    samples = list(samples_dir.glob("sample_*.wav"))
    if samples:
        return max(samples, key=lambda p: p.stat().st_size)
    return None


def find_reference_audio(profile_dir: Path) -> Path | None:
    """Ses profili klasöründen referans ses dosyasını bul."""
    for name in ("voice.wav", "audio.wav", "audio.mp3", "audio.webm", "audio.ogg", "reference.wav"):
        p = profile_dir / name
        if p.exists():
            return p
    # herhangi bir ses dosyası
    for ext in ("*.wav", "*.mp3", "*.webm", "*.ogg", "*.m4a"):
        hits = list(profile_dir.glob(ext))
        if hits:
            return hits[0]
    return None

