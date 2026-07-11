"""
Seed-VC sürücüsü — RMVPE f0 çıktısına temizlik uygular.

Sorun: RMVPE, haykırmalı/yüksek (belted) notalarda oktav atlaması yapar;
model bu hatalı perdeyi aynen söyler -> "aşırı tizleşme / detone" hissi.

Çözüm: f0 eğrisinde oktav sıçramalarını komşu medyana göre düzelt,
ardından hafif medyan filtre ile tekil ölçüm hatalarını yumuşat.

Kullanım: worker venv python'u ile, cwd = seed-vc dizini:
    python /app/seedvc_infer.py --source ... --target ... (inference.py ile aynı CLI)
"""

import os
import sys
import argparse

# seed-vc modülleri cwd'den import edilir (script başka dizinde durur)
sys.path.insert(0, os.getcwd())

import numpy as np


def clean_f0(f0: np.ndarray) -> np.ndarray:
    """
    Segment tabanlı f0 temizliği (RMVPE hop ~10ms):

    1) Kısa unvoiced boşlukları doldur (<=15 frame ~150ms): pes/nefesli
       hecelerde perde kesintisi 'parça parça' söyleyişe yol açıyor.
    2) Oktav hatası düzeltme — SEGMENT bazında: perde eğrisi sıçrama
       noktalarından segmentlere bölünür; yalnızca KISA (<=25 frame ~250ms)
       ve her iki komşusundan da ~1 oktav sapan segmentler geri çekilir.
       Böylece şarkıdaki GERÇEK oktav atlayışları (uzun süreli) korunur.
    3) Tekil aykırı noktalara hafif medyan yumuşatma (vibrato korunur).
    """
    f0 = np.asarray(f0, dtype=np.float64).copy()
    voiced = f0 > 1.0
    if voiced.sum() < 10:
        return f0

    n_gapfill = 0
    n_segfix = 0

    # ── 1) Kısa unvoiced boşlukları log-lineer interpolasyonla doldur ──
    idx_v = np.where(voiced)[0]
    gaps = np.where(np.diff(idx_v) > 1)[0]
    for g in gaps:
        a, b = idx_v[g], idx_v[g + 1]
        gap_len = b - a - 1
        if 0 < gap_len <= 12:
            la, lb = np.log2(f0[a]), np.log2(f0[b])
            # Boşluğun iki ucu arasında büyük atlama varsa doldurma (gerçek es olabilir)
            if abs(lb - la) < 0.35:
                t = np.arange(1, gap_len + 1) / (gap_len + 1)
                f0[a + 1:b] = 2.0 ** (la + t * (lb - la))
                n_gapfill += gap_len

    voiced = f0 > 1.0
    idx = np.where(voiced)[0]
    vals = np.log2(f0[idx])

    # ── 2) Segment bazlı oktav düzeltme ──
    # Segment sınırları: ardışık voiced frame'ler arasında >0.45 oktav sıçrama
    # veya zaman içinde kopukluk (>10 frame)
    boundaries = [0]
    for i in range(1, len(vals)):
        if abs(vals[i] - vals[i - 1]) > 0.45 or (idx[i] - idx[i - 1]) > 10:
            boundaries.append(i)
    boundaries.append(len(vals))

    segs = [(boundaries[i], boundaries[i + 1]) for i in range(len(boundaries) - 1)]
    seg_med = [float(np.median(vals[s:e])) for s, e in segs]

    for k, (s, e) in enumerate(segs):
        seg_len = e - s
        if seg_len > 25:  # uzun segment = gerçek melodi, dokunma
            continue
        prev_med = seg_med[k - 1] if k > 0 else None
        next_med = seg_med[k + 1] if k < len(segs) - 1 else None
        neighbors = [m for m in (prev_med, next_med) if m is not None]
        if not neighbors:
            continue
        nb = float(np.mean(neighbors))
        diff = seg_med[k] - nb
        # Her iki komşudan da aynı yönde ~1 oktav sapıyorsa RMVPE hatasıdır
        if abs(diff) > 0.7 and all(abs(seg_med[k] - m) > 0.55 for m in neighbors):
            shift = float(np.round(diff))
            if shift != 0.0:
                vals[s:e] -= shift
                seg_med[k] -= shift
                n_segfix += seg_len

    # ── 3) Tekil aykırılar için hafif medyan filtre ──
    sm = np.empty_like(vals)
    for i in range(len(vals)):
        lo, hi = max(0, i - 2), min(len(vals), i + 3)
        sm[i] = np.median(vals[lo:hi])
    outlier = np.abs(vals - sm) > 0.12
    vals[outlier] = sm[outlier]

    f0[idx] = 2.0 ** vals
    if n_gapfill or n_segfix or outlier.any():
        print(f"[F0-CLEAN] boşluk doldurma: {n_gapfill} frame, "
              f"oktav düzeltme: {n_segfix} frame, aykırı: {int(outlier.sum())}")
    return f0


def _patch_rmvpe():
    from modules import rmvpe

    orig = rmvpe.RMVPE.infer_from_audio

    def infer_clean(self, audio, thred=0.03):
        return clean_f0(orig(self, audio, thred=thred))

    rmvpe.RMVPE.infer_from_audio = infer_clean


def main():
    _patch_rmvpe()
    import inference
    from modules.commons import str2bool

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=str, required=True)
    parser.add_argument("--target", type=str, required=True)
    parser.add_argument("--output", type=str, default="./reconstructed")
    parser.add_argument("--diffusion-steps", type=int, default=30)
    parser.add_argument("--length-adjust", type=float, default=1.0)
    parser.add_argument("--inference-cfg-rate", type=float, default=0.7)
    parser.add_argument("--f0-condition", type=str2bool, default=False)
    parser.add_argument("--auto-f0-adjust", type=str2bool, default=False)
    parser.add_argument("--semi-tone-shift", type=int, default=0)
    parser.add_argument("--checkpoint", type=str, default=None)
    parser.add_argument("--config", type=str, default=None)
    parser.add_argument("--fp16", type=str2bool, default=True)
    args = parser.parse_args()
    inference.main(args)


if __name__ == "__main__":
    main()
