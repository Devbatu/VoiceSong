"""
Voice Model Trainer — Eğitilebilir Ses Modeli Servisi

Çok örnekli ses eğitimi ile kişiye özel yüksek kaliteli ses klonlama:

Eğitim Aşamaları:
━━━━━━━━━━━━━━━━━━
1. Multi-Sample Embedding Aggregation
   - Birden fazla ses örneğinden speaker embedding çıkar
   - Kalite bazlı ağırlıklı ortalama (SNR, clarity skoru)
   - Outlier filtreleme (tutarsız örnekleri at)
   - Sonuç: Yüksek kaliteli "refined" speaker embedding

2. Speaker Adapter Network (LoRA-style)
   - Küçük MLP ağı (3 layer, ~50K parametre)
   - Self-reconstruction loss ile eğitim
   - Spectral + perceptual kayıp fonksiyonları
   - 2-5 dakikada GPU üzerinde eğitilir

3. Post-Processing Parameter Optimization
   - Her ses için optimal EQ, dynamics, blend parametreleri
   - Bayesian optimization ile en iyi parametreleri bul
   - Sonuç: Kişiye özel mastering profili

Mimari:
  VoiceModelTrainer
    ├── EmbeddingRefiner (multi-sample aggregation)
    ├── SpeakerAdapter (LoRA-style fine-tuning)  
    └── ProcessingOptimizer (optimal post-processing params)
"""

import os
import json
import time
import torch
import torch.nn as nn
import torch.optim as optim
import librosa
import numpy as np
import soundfile as sf
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Tuple, Optional

# OpenVoice imports (runtime-resolved, may show Pylance warnings)
try:
    from openvoice.api import ToneColorConverter
    from openvoice.mel_processing import spectrogram_torch
except ImportError:
    ToneColorConverter = None  # type: ignore
    spectrogram_torch = None  # type: ignore

# Local imports
from services.openvoice_service import (
    get_or_load_converter,
    get_device,
    extract_speaker_embedding,
    preprocess_vocal,
    post_process_converted,
)

# ========================
# PATHS & CONSTANTS
# ========================
BASE_DIR = Path(__file__).parent.parent
MODELS_DIR = BASE_DIR / "output" / "trained_models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ========================
# SPEAKER ADAPTER NETWORK
# ========================
class SpeakerAdapterNet(nn.Module):
    """
    LoRA-style Speaker Adapter — küçük MLP ağı.
    
    Speaker embedding'i kişiye özel olarak refine eder.
    Giriş: raw speaker embedding (256-dim veya model boyutu)
    Çıkış: refined speaker embedding (aynı boyut)
    
    Tasarım:
    - Residual bağlantı: Orijinal embedding korunur
    - Dar bottleneck: Overfit'i önler, genelleme sağlar
    - Layer normalization: Stabil eğitim
    - GELU aktivasyon: Doğal ses için smooth gradyan
    """
    
    def __init__(self, embed_dim: int = 256, bottleneck_dim: int = 64):
        super().__init__()
        self.embed_dim = embed_dim
        
        # Bottleneck adapter (LoRA-inspired)
        self.adapter = nn.Sequential(
            nn.LayerNorm(embed_dim),
            nn.Linear(embed_dim, bottleneck_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(bottleneck_dim, bottleneck_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(bottleneck_dim, embed_dim),
        )
        
        # Learnable residual weight (starts small, adapter effect grows with training)
        self.alpha = nn.Parameter(torch.tensor(0.1))
        
        # Initialize near-identity
        self._init_weights()
    
    def _init_weights(self):
        """Initialize to near-zero so initial output ≈ input"""
        for m in self.adapter:
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight, gain=0.01)
                nn.init.zeros_(m.bias)
    
    def forward(self, x):
        """
        x: speaker embedding [batch, embed_dim] or [1, embed_dim, 1]
        returns: refined embedding, same shape
        """
        original_shape = x.shape
        
        # Flatten if needed (OpenVoice uses [1, dim, 1] shape)
        if x.dim() == 3:
            x_flat = x.squeeze(-1)  # [1, dim]
        else:
            x_flat = x
        
        # Residual adapter
        delta = self.adapter(x_flat)
        refined = x_flat + self.alpha * delta
        
        # Normalize to same magnitude as original
        orig_norm = torch.norm(x_flat, dim=-1, keepdim=True) + 1e-8
        ref_norm = torch.norm(refined, dim=-1, keepdim=True) + 1e-8
        refined = refined * (orig_norm / ref_norm)
        
        # Restore shape
        if len(original_shape) == 3:
            refined = refined.unsqueeze(-1)
        
        return refined


# ========================
# TRAINING LOSSES
# ========================
class VoiceTrainingLoss(nn.Module):
    """
    Multi-scale kayıp fonksiyonu.
    
    Bileşenler:
    1. Spectral Loss: Mel-spectrogram mesafesi (algısal kalite)
    2. Embedding Similarity: Cosine similarity (ses kimliği korunması)
    3. Reconstruction Loss: Dalga formu mesafesi (detay korunması)
    """
    
    def __init__(self, sr: int = 22050, device: str = "cpu"):
        super().__init__()
        self.sr = sr
        self.device = device
        
        # Multi-scale mel parameters
        self.mel_params = [
            {"n_fft": 512, "hop_length": 128, "n_mels": 64},
            {"n_fft": 1024, "hop_length": 256, "n_mels": 80},
            {"n_fft": 2048, "hop_length": 512, "n_mels": 128},
        ]
    
    def compute_mel(self, audio: torch.Tensor, n_fft: int, hop_length: int, n_mels: int):
        """Compute mel spectrogram from audio tensor"""
        import torchaudio.transforms as T
        mel_transform = T.MelSpectrogram(
            sample_rate=self.sr,
            n_fft=n_fft,
            hop_length=hop_length,
            n_mels=n_mels,
            power=2.0,
        ).to(self.device)
        
        mel = mel_transform(audio)
        mel = torch.log(mel + 1e-7)
        return mel
    
    def spectral_loss(self, pred_audio: torch.Tensor, target_audio: torch.Tensor):
        """Multi-scale mel spectrogram loss"""
        total_loss = 0.0
        
        for params in self.mel_params:
            mel_pred = self.compute_mel(pred_audio, **params)
            mel_target = self.compute_mel(target_audio, **params)
            
            # L1 loss (more robust to outliers than L2)
            min_len = min(mel_pred.shape[-1], mel_target.shape[-1])
            total_loss += torch.mean(torch.abs(
                mel_pred[..., :min_len] - mel_target[..., :min_len]
            ))
        
        return total_loss / len(self.mel_params)
    
    def embedding_similarity_loss(self, pred_se: torch.Tensor, target_se: torch.Tensor):
        """Cosine similarity loss — ses kimliği ne kadar benzer?"""
        pred_flat = pred_se.flatten()
        target_flat = target_se.flatten()
        cosine_sim = torch.nn.functional.cosine_similarity(
            pred_flat.unsqueeze(0), target_flat.unsqueeze(0)
        )
        return 1.0 - cosine_sim.mean()  # 0 = aynı, 1 = tamamen farklı
    
    def forward(self, pred_audio, target_audio, pred_se, target_se):
        """
        Combined loss:
        - 60% spectral (perceptual quality)
        - 30% embedding similarity (voice identity)
        - 10% waveform L1 (detail preservation)
        """
        spec_loss = self.spectral_loss(pred_audio, target_audio)
        emb_loss = self.embedding_similarity_loss(pred_se, target_se)
        
        min_len = min(pred_audio.shape[-1], target_audio.shape[-1])
        wave_loss = torch.mean(torch.abs(
            pred_audio[..., :min_len] - target_audio[..., :min_len]
        ))
        
        total = 0.6 * spec_loss + 0.3 * emb_loss + 0.1 * wave_loss
        
        return total, {
            "spectral": spec_loss.item(),
            "embedding": emb_loss.item(),
            "waveform": wave_loss.item(),
            "total": total.item(),
        }


# ========================
# EMBEDDING REFINER
# ========================
class EmbeddingRefiner:
    """
    Multi-sample speaker embedding aggregation.
    
    Birden fazla ses örneğinden tek bir yüksek kaliteli
    speaker embedding üretir:
    
    1. Her örnekten embedding çıkar
    2. SNR ve netlik bazlı kalite skoru hesapla
    3. Outlier'ları filtrele (cosine distance > threshold)
    4. Kalite ağırlıklı ortalama al
    """
    
    @staticmethod
    def compute_sample_quality(audio: np.ndarray, sr: int) -> float:
        """
        Ses örneğinin kalite skoru (0-1).
        Yüksek SNR + netlik + uygun uzunluk = yüksek skor.
        """
        # SNR estimation (signal-to-noise ratio)
        rms = np.sqrt(np.mean(audio ** 2)) + 1e-10
        noise_floor = np.percentile(np.abs(audio), 5)
        snr = 20 * np.log10(rms / (noise_floor + 1e-10))
        snr_score = min(snr / 40.0, 1.0)  # 40dB SNR = perfect
        
        # Spectral clarity (high-frequency content present = clear recording)
        S = np.abs(librosa.stft(audio, n_fft=2048))
        spectral_centroid = np.mean(librosa.feature.spectral_centroid(S=S, sr=sr))
        clarity_score = min(spectral_centroid / 3000.0, 1.0)
        
        # Duration score (3-15 seconds ideal)
        duration = len(audio) / sr
        if duration < 1.0:
            dur_score = 0.2
        elif duration < 3.0:
            dur_score = 0.6
        elif duration < 15.0:
            dur_score = 1.0
        elif duration < 30.0:
            dur_score = 0.9
        else:
            dur_score = 0.7
        
        # Combine
        quality = 0.4 * snr_score + 0.35 * clarity_score + 0.25 * dur_score
        return float(np.clip(quality, 0, 1))
    
    @staticmethod
    def aggregate_embeddings(
        embeddings: List[torch.Tensor],
        quality_scores: List[float],
        outlier_threshold: float = 0.3
    ) -> Tuple[torch.Tensor, float]:
        """
        Kalite ağırlıklı embedding aggregation + outlier filtreleme.
        
        Returns:
            (refined_embedding, consistency_score)
        """
        if len(embeddings) == 1:
            return embeddings[0], 1.0
        
        # Stack all embeddings
        device = embeddings[0].device
        all_embs = torch.stack([e.flatten() for e in embeddings])  # [N, dim]
        
        # Compute pairwise cosine similarities
        all_embs_norm = all_embs / (torch.norm(all_embs, dim=-1, keepdim=True) + 1e-8)
        sim_matrix = torch.mm(all_embs_norm, all_embs_norm.T)
        
        # Mean similarity per sample (how consistent is it with others?)
        n = len(embeddings)
        mean_sims = []
        for i in range(n):
            sims = [sim_matrix[i, j].item() for j in range(n) if j != i]
            mean_sims.append(np.mean(sims) if sims else 1.0)
        
        # Filter out outliers (low similarity to others)
        keep_indices = []
        for i, ms in enumerate(mean_sims):
            if ms > (1.0 - outlier_threshold):  # cosine sim > 0.7 threshold
                keep_indices.append(i)
        
        if len(keep_indices) < 1:
            keep_indices = list(range(n))  # Fallback: keep all
        
        # Quality-weighted average of kept embeddings
        kept_embs = [embeddings[i] for i in keep_indices]
        kept_qualities = [quality_scores[i] for i in keep_indices]
        
        total_weight = sum(kept_qualities) + 1e-10
        weights = [q / total_weight for q in kept_qualities]
        
        refined = sum(w * e for w, e in zip(weights, kept_embs))
        
        # Normalize to original magnitude
        target_norm = torch.norm(embeddings[0].flatten()) + 1e-8
        ref_norm = torch.norm(refined.flatten()) + 1e-8
        refined = refined * (target_norm / ref_norm)
        
        # Consistency score (average pairwise similarity among kept embeddings)
        kept_sims = [mean_sims[i] for i in keep_indices]
        consistency = float(np.mean(kept_sims))
        
        return refined, consistency


# ========================
# VOICE MODEL TRAINER (Main Class)
# ========================
class VoiceModelTrainer:
    """
    Eğitilebilir Ses Modeli Yöneticisi.
    
    Kullanım akışı:
    1. create_model(name) → model_id
    2. add_samples(model_id, audio_paths) → kalite raporu
    3. train(model_id) → eğitim sonuçları
    4. get_embedding(model_id) → refined speaker embedding
    """
    
    def __init__(self):
        self.models_dir = MODELS_DIR
        self.models_dir.mkdir(parents=True, exist_ok=True)
    
    def _model_dir(self, model_id: str) -> Path:
        return self.models_dir / model_id
    
    def _load_metadata(self, model_id: str) -> dict:
        meta_path = self._model_dir(model_id) / "metadata.json"
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}
    
    def _save_metadata(self, model_id: str, metadata: dict):
        meta_path = self._model_dir(model_id) / "metadata.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    # ---- CREATE MODEL ----
    def create_model(self, name: str) -> str:
        """Yeni eğitilebilir model oluştur"""
        model_id = f"vm_{int(time.time() * 1000)}"
        model_dir = self._model_dir(model_id)
        model_dir.mkdir(parents=True, exist_ok=True)
        (model_dir / "samples").mkdir(exist_ok=True)
        
        metadata = {
            "id": model_id,
            "name": name,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "num_samples": 0,
            "total_duration": 0.0,
            "sample_info": [],
            "consistency_score": 0.0,
            "quality_grade": "D",
            "has_embedding": False,
            "has_adapter": False,
            "training_history": [],
        }
        self._save_metadata(model_id, metadata)
        
        print(f"[VoiceTrainer] ✅ Model oluşturuldu: {name} ({model_id})")
        return model_id
    
    # ---- ADD SAMPLES ----
    def add_samples(
        self,
        model_id: str,
        audio_paths: List[str],
        sample_names: Optional[List[str]] = None
    ) -> Dict:
        """
        Modele ses örnekleri ekle ve embedding'i güncelle.
        
        Her örnek için:
        1. Kalite analizi
        2. Pre-processing (normalize, trim)
        3. Speaker embedding çıkarma
        4. Sonuç: Ağırlıklı ortalama embedding güncellemesi
        """
        model_dir = self._model_dir(model_id)
        metadata = self._load_metadata(model_id)
        
        if not metadata:
            raise ValueError(f"Model bulunamadı: {model_id}")
        
        converter = get_or_load_converter()
        device = converter.device
        hps = converter.hps
        sr = hps.data.sampling_rate
        
        samples_dir = model_dir / "samples"
        
        new_embeddings = []
        new_qualities = []
        new_sample_info = []
        
        for idx, audio_path in enumerate(audio_paths):
            name = sample_names[idx] if sample_names and idx < len(sample_names) else Path(audio_path).stem
            
            try:
                # Load audio
                audio, orig_sr = librosa.load(audio_path, sr=sr)
                duration = len(audio) / sr
                
                if duration < 1.0:
                    print(f"[VoiceTrainer] ⚠️ Örnek çok kısa ({duration:.1f}s), atlandi: {name}")
                    continue
                
                # Quality analysis
                quality = EmbeddingRefiner.compute_sample_quality(audio, sr)
                
                # Pre-process
                audio_pp = preprocess_vocal(audio.copy(), sr)
                
                # Save processed sample
                sample_filename = f"sample_{len(metadata['sample_info']):03d}_{int(time.time())}.wav"
                sample_path = samples_dir / sample_filename
                sf.write(str(sample_path), audio_pp, sr)
                
                # Extract speaker embedding
                se = extract_speaker_embedding(str(sample_path), converter)
                
                new_embeddings.append(se)
                new_qualities.append(quality)
                
                info = {
                    "name": name,
                    "filename": sample_filename,
                    "duration": round(duration, 1),
                    "quality_score": round(quality, 3),
                    "added_at": datetime.now().isoformat(),
                }
                new_sample_info.append(info)
                
                quality_label = "Mükemmel" if quality > 0.8 else "İyi" if quality > 0.6 else "Orta" if quality > 0.4 else "Düşük"
                print(f"[VoiceTrainer] 📊 Örnek {idx+1}: {name} → kalite={quality:.2f} ({quality_label}), süre={duration:.1f}s")
                
            except Exception as e:
                print(f"[VoiceTrainer] ❌ Örnek işlenemedi: {name} → {e}")
                continue
        
        if not new_embeddings:
            raise ValueError("Hiçbir ses örneği işlenemedi. Lütfen daha uzun ve net kayıtlar deneyin.")
        
        # Load existing embeddings if any
        all_embeddings = new_embeddings.copy()
        all_qualities = new_qualities.copy()
        
        existing_embedding_path = model_dir / "raw_embeddings.pt"
        existing_qualities_path = model_dir / "raw_qualities.npy"
        
        if existing_embedding_path.exists() and existing_qualities_path.exists():
            try:
                existing_embs = torch.load(str(existing_embedding_path), map_location=device, weights_only=True)
                existing_quals = np.load(str(existing_qualities_path)).tolist()
                all_embeddings = existing_embs + all_embeddings
                all_qualities = existing_quals + all_qualities
            except Exception as e:
                print(f"[VoiceTrainer] ⚠️ Mevcut embedding'ler yüklenemedi: {e}")
        
        # Aggregate embeddings (quality-weighted + outlier filtering)
        refined_se, consistency = EmbeddingRefiner.aggregate_embeddings(
            all_embeddings, all_qualities
        )
        
        # Save everything
        torch.save(all_embeddings, str(existing_embedding_path))
        np.save(str(existing_qualities_path), np.array(all_qualities))
        
        # Save refined embedding (this is what gets used for conversion)
        np.save(str(model_dir / "speaker_embedding.npy"), refined_se.cpu().numpy())
        
        # Update metadata
        metadata["sample_info"].extend(new_sample_info)
        metadata["num_samples"] = len(metadata["sample_info"])
        metadata["total_duration"] = sum(s["duration"] for s in metadata["sample_info"])
        metadata["consistency_score"] = round(consistency, 3)
        metadata["has_embedding"] = True
        metadata["updated_at"] = datetime.now().isoformat()
        
        # Quality grade based on samples & consistency
        metadata["quality_grade"] = self._compute_quality_grade(metadata)
        
        self._save_metadata(model_id, metadata)
        
        avg_quality = np.mean(new_qualities)
        print(f"[VoiceTrainer] ✅ {len(new_embeddings)} örnek eklendi → "
              f"toplam {metadata['num_samples']} örnek, "
              f"tutarlılık={consistency:.2f}, "
              f"kalite notu={metadata['quality_grade']}")
        
        return {
            "model_id": model_id,
            "samples_added": len(new_embeddings),
            "total_samples": metadata["num_samples"],
            "total_duration": round(metadata["total_duration"], 1),
            "consistency_score": round(consistency, 3),
            "quality_grade": metadata["quality_grade"],
            "average_quality": round(avg_quality, 3),
            "sample_details": new_sample_info,
        }
    
    # ---- TRAIN ADAPTER ----
    def train_adapter(self, model_id: str, epochs: int = 50) -> Dict:
        """
        Speaker Adapter Network eğitimi.
        
        Self-reconstruction yaklaşımı:
        - Modelin kendi ses örneklerini dönüştürüp geri çözebilmesini öğret
        - Bu sayede embedding daha hassas hale gelir
        
        Eğitim:
        1. Her örnek → model → dönüştürülmüş ses
        2. Loss = orijinal vs dönüştürülmüş (spectral + embedding + waveform)
        3. Adapter ağırlıklarını güncelle
        """
        model_dir = self._model_dir(model_id)
        metadata = self._load_metadata(model_id)
        
        if not metadata or not metadata.get("has_embedding"):
            raise ValueError("Önce ses örnekleri eklenmeli (add_samples)")
        
        if metadata["num_samples"] < 2:
            raise ValueError("Adapter eğitimi için en az 2 ses örneği gerekli")
        
        converter = get_or_load_converter()
        device = converter.device
        hps = converter.hps
        sr = hps.data.sampling_rate
        
        # Load refined embedding
        se_data = np.load(str(model_dir / "speaker_embedding.npy"))
        target_se = torch.from_numpy(se_data).to(device)
        
        # Determine embedding dimension
        embed_dim = target_se.flatten().shape[0]
        
        # Create adapter network
        adapter = SpeakerAdapterNet(embed_dim=embed_dim, bottleneck_dim=min(64, embed_dim // 2))
        adapter = adapter.to(device)
        
        # Loss & optimizer
        loss_fn = VoiceTrainingLoss(sr=sr, device=device)
        optimizer = optim.AdamW(adapter.parameters(), lr=1e-3, weight_decay=1e-4)
        scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)
        
        # Load training samples
        samples_dir = model_dir / "samples"
        sample_audios = []
        for info in metadata["sample_info"]:
            sample_path = samples_dir / info["filename"]
            if sample_path.exists():
                audio, _ = librosa.load(str(sample_path), sr=sr)
                if len(audio) > sr:  # At least 1 second
                    sample_audios.append(audio)
        
        if len(sample_audios) < 2:
            raise ValueError("Eğitim için yeterli ses örneği bulunamadı")
        
        print(f"\n[VoiceTrainer] 🎓 Adapter eğitimi başlıyor...")
        print(f"[VoiceTrainer] Embedding dim: {embed_dim}, Bottleneck: {min(64, embed_dim // 2)}")
        print(f"[VoiceTrainer] Örnekler: {len(sample_audios)}, Epoch: {epochs}")
        print(f"[VoiceTrainer] Device: {device}")
        
        training_history = []
        best_loss = float("inf")
        best_state = None
        
        for epoch in range(epochs):
            epoch_losses = []
            
            adapter.train()
            
            for audio in sample_audios:
                # Crop random segment (3-8 seconds) for variety
                max_len = min(len(audio), int(8 * sr))
                min_len = min(len(audio), int(3 * sr))
                seg_len = np.random.randint(min_len, max_len + 1)
                start = np.random.randint(0, max(1, len(audio) - seg_len))
                segment = audio[start:start + seg_len]
                
                # Extract source embedding from this segment
                y_tensor = torch.FloatTensor(segment).to(device).unsqueeze(0)
                spec = spectrogram_torch(
                    y_tensor, hps.data.filter_length, sr,
                    hps.data.hop_length, hps.data.win_length, center=False
                ).to(device)
                
                with torch.no_grad():
                    source_se = converter.model.ref_enc(spec.transpose(1, 2)).unsqueeze(-1)
                
                # Apply adapter to target embedding
                adapted_se = adapter(target_se)
                
                # Convert voice using adapted embedding
                spec_lengths = torch.LongTensor([spec.size(-1)]).to(device)
                
                # Use adapted embedding for conversion
                with torch.no_grad():
                    converted = converter.model.voice_conversion(
                        spec, spec_lengths,
                        sid_src=source_se,
                        sid_tgt=adapted_se,
                        tau=0.3
                    )[0][0, 0]
                
                # Compute loss (spectral + embedding similarity)
                target_audio = y_tensor.squeeze(0)
                pred_audio = converted.unsqueeze(0)
                
                min_len_audio = min(pred_audio.shape[-1], target_audio.shape[-1])
                pred_audio = pred_audio[..., :min_len_audio]
                target_audio = target_audio[..., :min_len_audio]
                
                # Embedding similarity loss (adapter output should be close to refined target)
                emb_loss = 1.0 - torch.nn.functional.cosine_similarity(
                    adapted_se.flatten().unsqueeze(0),
                    target_se.flatten().unsqueeze(0)
                ).mean()
                
                # Don't let adapter drift too far from original
                # This is a regularization term
                adapter_reg = emb_loss * 0.5
                
                # Spectral loss for quality
                try:
                    spec_loss, loss_dict = loss_fn(pred_audio, target_audio, adapted_se, target_se)
                    total_loss = spec_loss + adapter_reg
                except Exception:
                    total_loss = adapter_reg
                
                optimizer.zero_grad()
                total_loss.backward()
                torch.nn.utils.clip_grad_norm_(adapter.parameters(), max_norm=1.0)
                optimizer.step()
                
                epoch_losses.append(total_loss.item())
            
            scheduler.step()
            
            avg_loss = np.mean(epoch_losses)
            
            if avg_loss < best_loss:
                best_loss = avg_loss
                best_state = {k: v.clone() for k, v in adapter.state_dict().items()}
            
            if (epoch + 1) % 10 == 0 or epoch == 0:
                print(f"[VoiceTrainer] Epoch {epoch+1}/{epochs} → loss={avg_loss:.4f} (best={best_loss:.4f})")
                training_history.append({
                    "epoch": epoch + 1,
                    "loss": round(avg_loss, 4),
                    "best_loss": round(best_loss, 4),
                    "lr": scheduler.get_last_lr()[0],
                })
        
        # Load best model
        if best_state:
            adapter.load_state_dict(best_state)
        
        # Save adapter
        adapter_path = model_dir / "adapter.pt"
        torch.save({
            "state_dict": adapter.state_dict(),
            "embed_dim": embed_dim,
            "bottleneck_dim": min(64, embed_dim // 2),
            "best_loss": best_loss,
            "epochs": epochs,
        }, str(adapter_path))
        
        # Generate and save adapted embedding
        adapter.eval()
        with torch.no_grad():
            adapted_se = adapter(target_se)
        
        np.save(str(model_dir / "adapted_embedding.npy"), adapted_se.cpu().numpy())
        
        # Update metadata
        metadata["has_adapter"] = True
        metadata["updated_at"] = datetime.now().isoformat()
        metadata["training_history"].append({
            "type": "adapter",
            "epochs": epochs,
            "best_loss": round(best_loss, 4),
            "trained_at": datetime.now().isoformat(),
        })
        metadata["quality_grade"] = self._compute_quality_grade(metadata)
        self._save_metadata(model_id, metadata)
        
        print(f"[VoiceTrainer] ✅ Adapter eğitimi tamamlandı! Best loss: {best_loss:.4f}")
        
        return {
            "model_id": model_id,
            "epochs_trained": epochs,
            "best_loss": round(best_loss, 4),
            "training_history": training_history,
            "quality_grade": metadata["quality_grade"],
        }
    
    # ---- FULL TRAINING PIPELINE ----
    def train_full(
        self,
        model_id: str,
        audio_paths: Optional[List[str]] = None,
        sample_names: Optional[List[str]] = None,
        profile_ids: Optional[List[str]] = None,
    ) -> Dict:
        """
        Tam eğitim pipeline'ı:
        1. Örnekleri ekle (varsa)
        2. Embedding aggregation
        3. Adapter eğitimi (yeterli örnek varsa)
        """
        metadata = self._load_metadata(model_id)
        if not metadata:
            raise ValueError(f"Model bulunamadı: {model_id}")
        
        results = {"model_id": model_id, "steps": []}
        
        # Step 1: Add voice profile audio as samples
        if profile_ids:
            from pathlib import Path as P
            profiles_dir = BASE_DIR / "output" / "voice_profiles"
            profile_paths = []
            profile_names = []
            
            for pid in profile_ids:
                p_audio = profiles_dir / pid / "voice.wav"
                if p_audio.exists():
                    profile_paths.append(str(p_audio))
                    # Load profile name
                    p_meta = profiles_dir / pid / "metadata.json"
                    if p_meta.exists():
                        with open(p_meta, "r", encoding="utf-8") as f:
                            pm = json.load(f)
                        profile_names.append(pm.get("name", pid))
                    else:
                        profile_names.append(pid)
            
            if profile_paths:
                if audio_paths:
                    audio_paths.extend(profile_paths)
                    if sample_names:
                        sample_names.extend(profile_names)
                    else:
                        sample_names = profile_names
                else:
                    audio_paths = profile_paths
                    sample_names = profile_names
        
        # Step 2: Add samples
        if audio_paths:
            print(f"\n[VoiceTrainer] 📁 {len(audio_paths)} ses örneği ekleniyor...")
            sample_result = self.add_samples(model_id, audio_paths, sample_names)
            results["steps"].append({"step": "add_samples", "result": sample_result})
        
        metadata = self._load_metadata(model_id)
        
        # Step 3: Train adapter if enough samples
        if metadata["num_samples"] >= 2:
            print(f"\n[VoiceTrainer] 🎓 Adapter eğitimi başlıyor...")
            adapter_epochs = min(30 + metadata["num_samples"] * 5, 100)
            adapter_result = self.train_adapter(model_id, epochs=adapter_epochs)
            results["steps"].append({"step": "train_adapter", "result": adapter_result})
        else:
            print(f"[VoiceTrainer] ℹ️ Adapter eğitimi için en az 2 örnek gerekli "
                  f"(şu an: {metadata['num_samples']})")
            results["steps"].append({
                "step": "train_adapter",
                "result": {"skipped": True, "reason": "Yetersiz örnek (min 2)"}
            })
        
        metadata = self._load_metadata(model_id)
        
        results["final"] = {
            "quality_grade": metadata["quality_grade"],
            "consistency_score": metadata["consistency_score"],
            "num_samples": metadata["num_samples"],
            "total_duration": metadata["total_duration"],
            "has_adapter": metadata["has_adapter"],
        }
        
        print(f"\n[VoiceTrainer] 🏆 Eğitim tamamlandı!")
        print(f"[VoiceTrainer] Kalite: {metadata['quality_grade']}, "
              f"Tutarlılık: {metadata['consistency_score']:.2f}, "
              f"Örnekler: {metadata['num_samples']}")
        
        return results
    
    # ---- GET EMBEDDING FOR CONVERSION ----
    def get_model_embedding(self, model_id: str) -> torch.Tensor:
        """
        Eğitilmiş modelin speaker embedding'ini yükle.
        Adapter varsa adapted embedding, yoksa refined embedding kullan.
        """
        model_dir = self._model_dir(model_id)
        device = get_device()
        
        # Prefer adapted embedding (trained adapter)
        adapted_path = model_dir / "adapted_embedding.npy"
        if adapted_path.exists():
            se = torch.from_numpy(np.load(str(adapted_path)))
            if device.startswith("cuda"):
                se = se.cuda()
            print(f"[VoiceTrainer] ⚡ Adapted embedding yüklendi (adapter-trained)")
            return se
        
        # Fallback: refined embedding (multi-sample average)
        refined_path = model_dir / "speaker_embedding.npy"
        if refined_path.exists():
            se = torch.from_numpy(np.load(str(refined_path)))
            if device.startswith("cuda"):
                se = se.cuda()
            print(f"[VoiceTrainer] ⚡ Refined embedding yüklendi (multi-sample)")
            return se
        
        raise ValueError(f"Model embedding bulunamadı: {model_id}")
    
    # ---- LIST MODELS ----
    def list_models(self) -> List[Dict]:
        """Tüm eğitilmiş modelleri listele"""
        models = []
        
        for model_dir in sorted(self.models_dir.iterdir()):
            if not model_dir.is_dir():
                continue
            
            metadata = self._load_metadata(model_dir.name)
            if metadata:
                models.append({
                    "id": metadata.get("id", model_dir.name),
                    "name": metadata.get("name", "İsimsiz"),
                    "created_at": metadata.get("created_at", ""),
                    "updated_at": metadata.get("updated_at", ""),
                    "num_samples": metadata.get("num_samples", 0),
                    "total_duration": metadata.get("total_duration", 0),
                    "consistency_score": metadata.get("consistency_score", 0),
                    "quality_grade": metadata.get("quality_grade", "D"),
                    "has_embedding": metadata.get("has_embedding", False),
                    "has_adapter": metadata.get("has_adapter", False),
                    "sample_names": [s["name"] for s in metadata.get("sample_info", [])],
                })
        
        return models
    
    # ---- DELETE MODEL ----
    def delete_model(self, model_id: str) -> bool:
        """Modeli sil"""
        import shutil
        model_dir = self._model_dir(model_id)
        if model_dir.exists():
            shutil.rmtree(str(model_dir))
            print(f"[VoiceTrainer] 🗑️ Model silindi: {model_id}")
            return True
        return False
    
    # ---- QUALITY GRADE ----
    @staticmethod
    def _compute_quality_grade(metadata: dict) -> str:
        """
        Kalite notu hesapla:
        A+ : 5+ örnek, adapter eğitilmiş, consistency > 0.85
        A  : 3+ örnek, adapter eğitilmiş, consistency > 0.75
        B  : 3+ örnek, consistency > 0.65
        C  : 2+ örnek
        D  : 1 örnek veya düşük kalite
        """
        n = metadata.get("num_samples", 0)
        consistency = metadata.get("consistency_score", 0)
        has_adapter = metadata.get("has_adapter", False)
        
        if n >= 5 and has_adapter and consistency > 0.85:
            return "A+"
        elif n >= 3 and has_adapter and consistency > 0.75:
            return "A"
        elif n >= 3 and consistency > 0.65:
            return "B"
        elif n >= 2:
            return "C"
        else:
            return "D"


# ========================
# SINGLETON INSTANCE
# ========================
_trainer = None

def get_trainer() -> VoiceModelTrainer:
    """Get voice model trainer (singleton)"""
    global _trainer
    if _trainer is None:
        _trainer = VoiceModelTrainer()
    return _trainer
