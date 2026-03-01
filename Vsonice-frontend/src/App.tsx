import { useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { Home, Mic, AudioLines, SlidersHorizontal, Sliders, Piano, FileText, Music, RefreshCw, Upload, Menu, X } from 'lucide-react'
import './App.css'
import Welcome from './components/Welcome'
import MusicGenerator from './components/MusicGenerator'
import VoiceConverter from './components/VoiceConverter'
import AudioUploader from './components/AudioUploader'
import AudioSeparator from './components/AudioSeparator'
import AudioStemEditor from './components/AudioStemEditor'
import TextToSongGenerator from './components/TextToSongGenerator'
import StemMixer from './components/StemMixer'
import VoiceCloneSongMaker from './components/VoiceCloneSongMaker'
import ProfessionalStudio from './components/ProfessionalStudio'
import DAWStudio from './components/daw/DAWStudio'

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // DAW Studio gets full-screen layout (no sidebar)
  if (location.pathname === '/studio') {
    return <DAWStudio />
  }

  const navGroups: { label: string; items: { to: string; icon: React.ReactNode; label: string; end?: boolean }[] }[] = [
    {
      label: 'Ana Menü',
      items: [
        { to: '/', icon: <Home size={18} />, label: 'Ana Sayfa', end: true },
      ]
    },
    {
      label: 'Ses İşleme',
      items: [
        { to: '/ses-klonla', icon: <Mic size={18} />, label: 'Ses Klonlama' },
        { to: '/stem-ayir', icon: <AudioLines size={18} />, label: 'Ses Ayırma (AI)' },
        { to: '/stem-mixer', icon: <SlidersHorizontal size={18} />, label: 'Stem Mixer' },
        { to: '/stem-editor', icon: <Sliders size={18} />, label: 'Stem Editör' },
      ]
    },
    {
      label: 'Üretici Araçlar',
      items: [
        { to: '/studio', icon: <Piano size={18} />, label: 'DAW Studio' },
        { to: '/metin-sarki', icon: <FileText size={18} />, label: 'Metin → Şarkı' },
        { to: '/muzik-uret', icon: <Music size={18} />, label: 'Müzik Üret' },
      ]
    },
    {
      label: 'Diğer',
      items: [
        { to: '/ses-donustur', icon: <RefreshCw size={18} />, label: 'Ses Dönüştür' },
        { to: '/yukle', icon: <Upload size={18} />, label: 'Dosya Yükle' },
      ]
    }
  ]

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Mobile Header */}
      <header className="mobile-header">
        <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <NavLink to="/" className="mobile-logo">
          <span className="logo-icon">VS</span>
          <span>VoiceSong</span>
        </NavLink>
      </header>

      {/* Sidebar Overlay for Mobile */}
      {mobileMenuOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <NavLink to="/" className="sidebar-logo" onClick={() => setMobileMenuOpen(false)}>
            <span className="logo-icon">🎵</span>
            {!sidebarCollapsed && <span className="logo-text">VoiceSong</span>}
          </NavLink>
          <button 
            className="sidebar-toggle" 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Genişlet' : 'Daralt'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="nav-group">
              {!sidebarCollapsed && <div className="nav-group-label">{group.label}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!sidebarCollapsed && (
            <div className="sidebar-badge">
              <span className="badge-dot" />
              <span>AI Aktif</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-wrapper">
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/metin-sarki" element={<TextToSongGenerator />} />
            <Route path="/stem-ayir" element={<AudioSeparator />} />
            <Route path="/stem-editor" element={<AudioStemEditor />} />
            <Route path="/stem-mixer" element={<StemMixer />} />
            <Route path="/ses-klonla" element={<VoiceCloneSongMaker />} />
            <Route path="/muzik-uret" element={<MusicGenerator />} />
            <Route path="/ses-donustur" element={<VoiceConverter />} />
            <Route path="/yukle" element={<AudioUploader />} />
            <Route path="/studio" element={<ProfessionalStudio />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App
