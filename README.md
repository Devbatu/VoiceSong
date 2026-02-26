# 🎵 VoiceSong

AI-Powered Voice & Music Studio - Complete platform for music generation, voice conversion, and audio separation.

## 🚀 Features

- **🎹 Music Generation** - Create music from text descriptions using AudioCraft MusicGen
- **🎤 Voice Conversion** - Transform voices with RVC (Retrieval-based Voice Conversion)
- **🎼 Audio Separation** - Extract stems (vocals, drums, bass, etc.) with Demucs
- **📤 Audio Upload** - Easy file upload and management
- **⚡ Fast & Modern** - Built with React + FastAPI for optimal performance

## 🏗️ Architecture

```
VoiceSong/
├── Vsonice-backend/     # Python FastAPI backend
│   ├── main.py          # API endpoints
│   ├── services/        # AI services (Demucs, RVC, AudioCraft)
│   └── requirements.txt # Python dependencies
│
└── Vsonice-frontend/    # React TypeScript frontend
    ├── src/
    │   ├── components/  # UI components
    │   └── services/    # API client
    └── package.json     # Node dependencies
```

## 🛠️ Tech Stack

### Backend
- **FastAPI** - High-performance async API framework
- **PyTorch** - Deep learning framework
- **AudioCraft** - Meta's music generation (MusicGen)
- **Demucs** - State-of-the-art audio source separation
- **RVC** - Advanced voice conversion

### Frontend
- **React 18** - Modern UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Next-generation build tool
- **CSS3** - Modern styling with glassmorphism

## 📦 Installation

### Prerequisites
- Python 3.9+
- Node.js 18+
- CUDA-capable GPU (recommended)
- 8GB+ RAM
- 10GB+ free disk space

### Backend Setup

1. Navigate to backend directory:
```bash
cd Vsonice-backend
```

2. Create virtual environment:
```bash
python -m venv venv
.\venv\Scripts\activate  # Windows
source venv/bin/activate # Linux/Mac
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Configure environment:
```bash
copy .env.example .env  # Windows
cp .env.example .env    # Linux/Mac
```

5. Start backend server:
```bash
python main.py
```

Backend will be available at: http://localhost:8000

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd Vsonice-frontend
```

2. Install dependencies (already done if using the template):
```bash
npm install
```

3. Start development server:
```bash
npm run dev
```

Frontend will be available at: http://localhost:5173

## 🎯 Usage

### Music Generation
1. Navigate to "Generate Music" tab
2. Describe the music you want (e.g., "upbeat electronic dance music")
3. Adjust duration and creativity settings
4. Click "Generate Music"

### Voice Conversion
1. Navigate to "Convert Voice" tab
2. Upload an audio file
3. Select target voice model
4. Click "Convert Voice"

### Audio Separation
1. Navigate to "Separate Audio" tab
2. Upload a music file
3. Select Demucs model (htdemucs recommended)
4. Click "Separate Audio"
5. Download individual stems (vocals, drums, bass, other)

## 📚 API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🔧 Configuration

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

## 🎨 Models

### Demucs Models
- **htdemucs** ⭐ (Recommended) - 4 stems, best quality
- **htdemucs_ft** - Fine-tuned version
- **htdemucs_6s** - 6 stems (includes piano & guitar)
- **mdx_extra** - Extra quality

### AudioCraft Models
- **musicgen-small** - Fast generation
- **musicgen-medium** - Balanced quality/speed
- **musicgen-large** - Highest quality

Models are downloaded automatically on first use.

## 🚀 Development

### Backend
```bash
# Run with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Run tests
pytest

# Format code
black .
```

### Frontend
```bash
# Development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

## 📝 Project Status

- ✅ Project structure setup
- ✅ Frontend UI components
- ✅ Backend API endpoints
- ⏳ AudioCraft integration (in progress)
- ⏳ RVC integration (in progress)
- ⏳ Demucs integration (in progress)

## 🤝 Contributing

This is a project template. Feel free to:
1. Implement the pending AI model integrations
2. Add more features
3. Improve UI/UX
4. Optimize performance

## 📄 License

MIT License - feel free to use this template for your projects!

## 🙏 Credits

- **AudioCraft** by Meta AI
- **Demucs** by Facebook Research
- **RVC** by RVC Project
- **FastAPI** by Sebastián Ramírez
- **React** by Meta
- **Vite** by Evan You

## 📞 Support

For issues or questions, please open an issue on GitHub.

---

Made with ❤️ for music and AI enthusiasts
