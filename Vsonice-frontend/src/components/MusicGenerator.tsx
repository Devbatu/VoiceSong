import { useState, useRef } from 'react'

const API = 'http://localhost:8000'

const GENRES = [
  { id: 'pop', label: '🎵 Pop' },
  { id: 'rock', label: '🎸 Rock' },
  { id: 'anatolian_rock', label: '🪕 Anatolian Rock' },
  { id: 'arabesk', label: '🎻 Arabesk' },
  { id: 'electronic', label: '🎹 Elektronik' },
  { id: 'rnb', label: '🎷 R&B' },
  { id: 'hiphop', label: '🎤 Hip-Hop' },
  { id: 'ballad', label: '🎶 Balad' },
]

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export default function MusicGenerator() {
  const [genre, setGenre] = useState('anatolian_rock')
  const [bpm, setBpm] = useState(120)
  const [key, setKey] = useState('A')
  const [duration, setDuration] = useState(30)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ download_url: string; filename: string; genre: string; bpm: number; key: string; duration: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${API}/api/generate/music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, bpm, key, duration }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Müzik üretimi başarısız')
      }
      const data = await res.json()
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="component-container">
      <h2 style={{
        background: 'linear-gradient(135deg, #f59e0b, #ec4899)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        fontWeight: 800,
      }}>🎵 Müzik Üreteci</h2>
      <p style={{ marginBottom: '1.5rem', color: '#888' }}>
        Programatik enstrümantal üretici — genre preset'leriyle drum, bas ve akor track'leri
      </p>

      {/* Genre Selection */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.4rem' }}>Tür Seçin</label>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {GENRES.map(g => (
            <button key={g.id} className="btn" onClick={() => setGenre(g.id)}
              style={{
                padding: '0.4rem 0.8rem', fontSize: '0.85rem',
                background: genre === g.id ? '#f59e0b20' : '#1a1a2e',
                border: genre === g.id ? '1.5px solid #f59e0b' : '1px solid #333',
              }}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Controls Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <label style={{ color: '#aaa', fontSize: '0.85rem' }}>BPM: <strong>{bpm}</strong></label>
          <input type="range" min={60} max={180} value={bpm} onChange={e => setBpm(+e.target.value)}
            style={{ width: '100%', accentColor: '#f59e0b' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#555' }}>
            <span>60</span><span>120</span><span>180</span>
          </div>
        </div>
        <div>
          <label style={{ color: '#aaa', fontSize: '0.85rem' }}>Anahtar</label>
          <select value={key} onChange={e => setKey(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', background: '#0d0d1a', border: '1px solid #333', borderRadius: '6px', color: '#fff', marginTop: '0.25rem' }}>
            {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label style={{ color: '#aaa', fontSize: '0.85rem' }}>Süre: <strong>{duration}s</strong></label>
          <input type="range" min={10} max={120} value={duration} onChange={e => setDuration(+e.target.value)}
            style={{ width: '100%', accentColor: '#f59e0b' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#555' }}>
            <span>10s</span><span>60s</span><span>120s</span>
          </div>
        </div>
      </div>

      <button className="btn" onClick={handleGenerate} disabled={loading}
        style={{ width: '100%', padding: '0.85rem', background: '#f59e0b', fontSize: '1rem', fontWeight: 700, color: '#000' }}>
        {loading ? '⏳ Üretiliyor...' : '🎵 Müzik Üret'}
      </button>

      {error && (
        <div className="status-message error-message" style={{ marginTop: '1rem' }}>
          <p>❌ {error}</p>
        </div>
      )}

      {result && (
        <div style={{ marginTop: '1.25rem', padding: '1.25rem', background: '#0d0d1a', borderRadius: '10px', border: '1px solid #1e1e36' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>✅</span>
            <div>
              <div style={{ fontWeight: 600 }}>Müzik Üretildi!</div>
              <div style={{ color: '#888', fontSize: '0.8rem' }}>
                {GENRES.find(g => g.id === result.genre)?.label} • {result.bpm} BPM • {result.key} • {result.duration}s
              </div>
            </div>
          </div>
          <audio ref={audioRef} src={`${API}${result.download_url}`} controls
            style={{ width: '100%', marginBottom: '0.75rem' }} />
          <a href={`${API}${result.download_url}`} download={result.filename} className="btn"
            style={{ display: 'inline-block', background: '#333', padding: '0.5rem 1rem', fontSize: '0.85rem', textDecoration: 'none' }}>
            📥 İndir ({result.filename})
          </a>
        </div>
      )}
    </div>
  )
}
