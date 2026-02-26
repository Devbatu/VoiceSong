# 🎵 VoiceSong Hızlı Başlangıç

## ✅ Sistem Çalışıyor!

**Backend:** http://localhost:8000
**Frontend:** http://localhost:5174

## 🚀 Özellikler

### 1️⃣ Voice Clone Song Maker
Kendi sesinle veya AI ses modelleri ile şarkı oluştur

### 2️⃣ Text to Song
Metinden AI ile şarkı üret (tempo, tarz, key kontrolü)

### 3️⃣ Professional Studio 🆕
- 🎛️ 5 Track Mixer (Lead Vocal, Music, Drums, Bass, Backing)
- 🎚️ Volume Faders & Pan Controls
- 📊 VU Meters
- 🎼 8 Efekt Tipi (Reverb, Delay, EQ, Compressor, Autotune, Distortion, Chorus, Phaser)
- 🤖 AI Mixing Assistant
- ⏯️ Transport Controls (Play/Pause/Record)
- ⏱️ Timeline & BPM/Key Controls

### 4️⃣ Audio Separator (Demucs)
Müziği farklı stem'lere ayır (vokal, drums, bass, other)

### 5️⃣ Music Generator (AudioCraft)
AI ile instrumental müzik üret

### 6️⃣ Voice Converter (RVC)
Ses dönüştürme ve klonlama

### 7️⃣ Audio Uploader
Drag & drop ses dosyası yükleme

## 📦 Paket Durumu

### ✅ Yüklü Paketler
- FastAPI 0.104.1 (Backend framework)
- Uvicorn 0.24.0 (ASGI server)
- Pydantic 2.5.0 (Veri validasyonu)
- NumPy 1.24.3 (Matematiksel işlemler)
- SoundFile 0.12.1 (Ses dosyası okuma/yazma)

### ⏳ AI Paketleri (Opsiyonel)
AI özelliklerini kullanmak için şu paketleri yükleyebilirsiniz:

```powershell
cd Vsonice-backend
.\install-ai-packages.ps1
```

Bu yüklenecek:
- PyTorch 2.1.0 (CPU version - ~200MB)
- TorchAudio 2.1.0
- Librosa 0.10.1 (Ses analizi)
- Scipy 1.11.3

**Not:** AudioCraft ve Demucs çok büyük paketlerdir (>2GB). Sadece ihtiyaç duyarsanız yükleyin.

## 🎨 Modern UI Özellikleri

- ✨ Glassmorphism tasarım
- 🌈 Gradient animasyonlar
- 🎨 Professional color palette
- 📱 Responsive (mobil uyumlu)
- ⚡ Smooth transitions & hover effects
- 🎛️ DAW-style mixer interface

## 🛠️ Geliştirme

### Backend'i Başlat
```powershell
cd Vsonice-backend
.\venv\Scripts\Activate.ps1
python main.py
```

### Frontend'i Başlat
```powershell
cd Vsonice-frontend
npm run dev
```

### Her İkisini Birden Başlat
```powershell
.\start-all.bat
```

## 📝 API Endpoints

- `GET /` - Health check
- `POST /api/generate/music` - Müzik üretimi
- `POST /api/convert/voice` - Ses dönüştürme
- `POST /api/separate` - Ses ayrıştırma (Demucs)
- `POST /api/generate/text-to-song` - Metinden şarkı
- `POST /api/clone-voice-sing` - Ses klonlama
- `GET /api/voice-library` - Ses kütüphanesi
- `POST /api/upload` - Dosya yükleme

## 🔧 Sorun Giderme

### Timeout Hataları
Büyük paketler yüklenirken timeout olursa:
```powershell
python -m pip install -r requirements-ai.txt --timeout 600
```

### Port Çakışması
- Backend varsayılan: 8000
- Frontend varsayılan: 5173 (çakışırsa 5174 kullanır)

### Virtual Environment
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

## 📚 Teknolojiler

**Backend:**
- Python 3.11
- FastAPI (modern async API framework)
- Uvicorn (ASGI server)
- PyTorch (AI models)

**Frontend:**
- React 18 + TypeScript
- Vite 7.2.5 (with Rolldown)
- Modern CSS3 (gradients, animations, glassmorphism)

## 🎯 Sonraki Adımlar

1. ✅ Backend ve Frontend çalışıyor
2. ⏳ AI paketlerini yükle (opsiyonel)
3. 🎨 Professional Studio'yu dene
4. 🎵 Ses dosyaları yükle ve işle
5. 🤖 AI özelliklerini test et

## 💡 İpuçları

- Professional Studio'da track'lere tıklayarak seç
- Effects Panel'de 8 farklı efekt ekleyebilirsin
- AI Mixing Assistant otomatik öneriler sunar
- VU Meters gerçek zamanlı ses seviyelerini gösterir
- Timeline'da playhead pozisyonu görülür

---

**Geliştirici:** VoiceSong Team
**Versiyon:** 1.0.0
**Tarih:** 25 Aralık 2024
