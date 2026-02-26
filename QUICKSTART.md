# 🎯 VoiceSong - Hızlı Başlangıç Kılavuzu

## 🚀 Projeyi Başlatma

### Seçenek 1: Hepsini Birden Başlat (Önerilen)
```bash
start-all.bat
```
Bu komut hem backend hem frontend'i otomatik başlatır.

### Seçenek 2: Ayrı Ayrı Başlat

**Backend Başlatma:**
```bash
start-backend.bat
```

**Frontend Başlatma:**
```bash
start-frontend.bat
```

## 📋 Proje Yapısı

```
VoiceSong/
│
├── 📄 README.md                    # Ana proje dokümantasyonu
├── 📄 QUICKSTART.md               # Bu dosya (hızlı başlangıç)
├── 🔧 start-all.bat               # Her iki servisi başlat
├── 🔧 start-backend.bat           # Sadece backend başlat
├── 🔧 start-frontend.bat          # Sadece frontend başlat
│
├── 📁 Vsonice-backend/            # Python FastAPI Backend
│   ├── main.py                    # Ana API dosyası
│   ├── requirements.txt           # Python bağımlılıkları
│   ├── .env.example              # Örnek çevre değişkenleri
│   ├── README.md                 # Backend dokümantasyonu
│   │
│   ├── services/                 # AI Servisleri
│   │   ├── __init__.py
│   │   └── demucs_service.py    # Demucs ayırma servisi
│   │
│   ├── uploads/                  # Yüklenen dosyalar
│   ├── output/                   # İşlenmiş çıktılar
│   └── temp/                     # Geçici dosyalar
│
└── 📁 Vsonice-frontend/          # React TypeScript Frontend
    ├── src/
    │   ├── App.tsx               # Ana uygulama
    │   ├── App.css               # Global stiller
    │   │
    │   ├── components/           # React bileşenleri
    │   │   ├── MusicGenerator.tsx      # 🎹 Müzik üretimi
    │   │   ├── VoiceConverter.tsx      # 🎤 Ses dönüştürme
    │   │   ├── AudioSeparator.tsx      # 🎼 Ses ayırma (Demucs)
    │   │   └── AudioUploader.tsx       # 📤 Dosya yükleme
    │   │
    │   └── services/             # API servisleri
    │       └── api.ts            # API istemci
    │
    ├── package.json              # Node bağımlılıkları
    ├── .env                      # Çevre değişkenleri
    └── README.md                 # Frontend dokümantasyonu
```

## 🎯 Özellikler

### ✅ Tamamlanan
- [x] Proje yapısı kurulumu
- [x] Backend API endpoint'leri
- [x] Frontend UI bileşenleri
- [x] Demucs entegrasyonu (template)
- [x] API client servisleri
- [x] Dosya yükleme sistemi
- [x] Modern UI/UX tasarımı

### ⏳ Geliştirme Aşamasında
- [ ] AudioCraft MusicGen implementasyonu
- [ ] RVC ses dönüştürme implementasyonu
- [ ] Demucs model yükleme ve işleme
- [ ] Çıktı dosyalarını indirme
- [ ] Gerçek zamanlı işleme durumu
- [ ] Kullanıcı oturum yönetimi

## 🛠️ Kurulum Gereksinimleri

### Minimum Sistem Gereksinimleri
- **İşlemci:** 4 çekirdek CPU
- **RAM:** 8GB
- **Disk:** 10GB boş alan
- **GPU:** CUDA destekli (önerilen)

### Yazılım Gereksinimleri
- Python 3.9 veya üzeri
- Node.js 18 veya üzeri
- pip (Python paket yöneticisi)
- npm (Node paket yöneticisi)

## 🎨 Kullanım

### 1. Müzik Üretimi (AudioCraft)
- "Generate Music" sekmesine gidin
- İstediğiniz müziği tanımlayın
- Süre ve yaratıcılık ayarlarını yapın
- "Generate Music" butonuna tıklayın

### 2. Ses Dönüştürme (RVC)
- "Convert Voice" sekmesine gidin
- Ses dosyası yükleyin
- Hedef ses modelini seçin
- "Convert Voice" butonuna tıklayın

### 3. Ses Ayırma (Demucs)
- "Separate Audio" sekmesine gidin
- Müzik dosyası yükleyin
- Demucs modelini seçin (htdemucs önerilir)
- "Separate Audio" butonuna tıklayın
- Ayrılan stem'leri indirin

### 4. Dosya Yükleme
- "Upload Audio" sekmesine gidin
- Dosyayı sürükle-bırak veya tıklayarak seçin
- "Upload File" butonuna tıklayın

## 🔧 Yapılandırma

### Backend (.env)
```env
HOST=0.0.0.0
PORT=8000
DEBUG=True
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
MAX_UPLOAD_SIZE=50000000
ALLOWED_AUDIO_FORMATS=mp3,wav,flac,ogg
```

### Frontend (.env)
```env
VITE_API_BASE_URL=http://localhost:8000
```

## 📚 API Dokümantasyonu

Backend başlatıldıktan sonra:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

## 🐛 Sorun Giderme

### Backend başlamıyor
```bash
cd Vsonice-backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### Frontend başlamıyor
```bash
cd Vsonice-frontend
npm install
npm run dev
```

### Port zaten kullanımda
- Backend: `.env` dosyasında `PORT` değerini değiştirin
- Frontend: `vite.config.ts` dosyasında port ayarlayın

### CUDA/GPU sorunları
Eğer GPU'nuz yoksa, modeller CPU üzerinde çalışacaktır (daha yavaş).

## 📞 Destek

- 📖 Dokümantasyon: README.md dosyalarını inceleyin
- 🐛 Hata bildirimi: GitHub Issues kullanın
- 💬 Sorular: Proje sahibiyle iletişime geçin

## 🎓 Sonraki Adımlar

1. **AI Modellerini Entegre Edin:**
   - `services/demucs_service.py` dosyasını tamamlayın
   - AudioCraft ve RVC servislerini ekleyin

2. **Veritabanı Ekleyin:**
   - SQLite veya PostgreSQL
   - Kullanıcı ve dosya yönetimi

3. **Kimlik Doğrulama:**
   - JWT token sistemi
   - Kullanıcı kayıt/giriş

4. **Üretim Dağıtımı:**
   - Docker containerization
   - AWS/GCP/Azure deployment
   - Nginx reverse proxy

## 🌟 İpuçları

- Geliştirme sırasında her iki terminal penceresini açık tutun
- Backend loglarını takip edin (hata ayıklama için)
- Browser DevTools'u kullanın (frontend debug)
- Küçük dosyalarla test edin (ilk denemeler için)

---

**🎵 Mutlu Kodlamalar! 🎵**
