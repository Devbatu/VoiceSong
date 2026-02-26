import { useState } from 'react'
import './App.css'
import Welcome from './components/Welcome'
import MusicGenerator from './components/MusicGenerator'
import VoiceConverter from './components/VoiceConverter'
import AudioUploader from './components/AudioUploader'
import AudioSeparator from './components/AudioSeparator'
import TextToSongGenerator from './components/TextToSongGenerator'
import StemMixer from './components/StemMixer'

type TabType = 'welcome' | 'generate' | 'convert' | 'upload' | 'separate' | 'textsong' | 'mixer'

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('welcome')

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🎵 VoiceSong Studio</h1>
        <p>AI-Powered Voice & Music Studio</p>
      </header>

      <nav className="app-nav">
        <button
          className={activeTab === 'welcome' ? 'active' : ''}
          onClick={() => setActiveTab('welcome')}
        >
          🏠 Ana Sayfa
        </button>
        <button
          className={activeTab === 'textsong' ? 'active' : ''}
          onClick={() => setActiveTab('textsong')}
        >
          📝 Metin ile Şarkı
        </button>
        <button
          className={activeTab === 'separate' ? 'active' : ''}
          onClick={() => setActiveTab('separate')}
        >
          🎼 Ses Ayırma
        </button>
        <button
          className={activeTab === 'mixer' ? 'active' : ''}
          onClick={() => setActiveTab('mixer')}
          data-tab="mixer"
        >
          🎛️ Stem Mixer
        </button>
        <button
          className={activeTab === 'generate' ? 'active' : ''}
          onClick={() => setActiveTab('generate')}
        >
          🎵 Müzik Üret
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'welcome' && <Welcome />}
        {activeTab === 'textsong' && <TextToSongGenerator />}
        {activeTab === 'mixer' && <StemMixer />}
        {activeTab === 'generate' && <MusicGenerator />}
        {activeTab === 'convert' && <VoiceConverter />}
        {activeTab === 'separate' && <AudioSeparator />}
        {activeTab === 'upload' && <AudioUploader />}
      </main>

      <footer className="app-footer">
        <p>Powered by Advanced HPSS & Spectral Gating</p>
      </footer>
    </div>
  )
}

export default App
