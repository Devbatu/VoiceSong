import { useState, useEffect, useRef } from 'react'

const API = 'http://localhost:8000'

interface VoiceProfile { id: string; name: string; has_embedding?: boolean }
interface TrainedModel { id: string; name: string }

export default function VoiceConverter() {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [voiceSource, setVoiceSource] = useState<'profile' | 'model' | 'file'>('profile')
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ download_url: string; filename: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    fetch(`${API}/api/voice-profiles`).then(r => r.json()).then(data => {
      setProfiles(data.profiles || [])
      if (data.profiles?.length > 0) setSelectedProfileId(data.profiles[0].id)
    }).catch(() => {})
    fetch(`${API}/api/voice-training/models`).then(r => r.json()).then(data => {
      setTrainedModels(data.models || [])
      if (data.models?.length > 0) setSelectedModelId(data.models[0].id)
    }).catch(() => {})
  }, [])

  const handleConvert = async () => {
    if (!audioFile) { setError('Bir ses dosyası seçin'); return }
    setLoading(true); setError(null); setResult(null)
    try {
      const formData = new FormData()
      formData.append('audio_file', audioFile)
      if (voiceSource === 'profile' && selectedProfileId) {
        formData.append('voice_profile_id', selectedProfileId)
      } else if (voiceSource === 'model' && selectedModelId) {
        formData.append('voice_model_id', selectedModelId)
      } else if (voiceSource === 'file' && voiceFile) {
        formData.append('voice_file', voiceFile)
      } else {
        throw new Error('Bir hedef ses kaynağı seçin')
      }
      const res = await fetch(`${API}/api/convert/voice`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Ses dönüştürme başarısız')
      }
      setResult(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="component-container">
      <h2 style={{
        background: 'linear-gradient(135deg, #ec4899, #6366f1)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        fontWeight: 800,
      }}>🎤 Ses Dönüştürücü</h2>
      <p style={{ marginBottom: '1.5rem', color: '#888' }}>
        OpenVoice V2 Neural Voice Conversion — herhangi bir sesi hedef kimliğe dönüştürün
      </p>

      {/* Audio File */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.4rem' }}>Kaynak Ses Dosyası</label>
        <input type="file" accept="audio/*" id="vc-audio"
          onChange={e => { const f = e.target.files?.[0]; if (f) { setAudioFile(f); setError(null) } }}
          style={{ display: 'none' }} />
        <label htmlFor="vc-audio" className="btn"
          style={{ background: '#1a1a2e', border: '1px solid #333', cursor: 'pointer', padding: '0.65rem 1.25rem' }}>
          📂 Ses Dosyası Seç
        </label>
        {audioFile && <span style={{ color: '#aaa', marginLeft: '0.75rem', fontSize: '0.85rem' }}>
          {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)} MB)
        </span>}
      </div>

      {/* Voice Source */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.4rem' }}>Hedef Ses Kaynağı</label>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {([
            { id: 'profile' as const, label: '👤 Ses Profili', enabled: profiles.length > 0 },
            { id: 'model' as const, label: '🧠 Eğitilmiş Model', enabled: trainedModels.length > 0 },
            { id: 'file' as const, label: '📂 Ses Dosyası', enabled: true },
          ]).map(s => (
            <button key={s.id} className="btn"
              onClick={() => { if (s.enabled) setVoiceSource(s.id) }}
              disabled={!s.enabled}
              style={{
                background: voiceSource === s.id ? '#ec489920' : '#1a1a2e',
                border: voiceSource === s.id ? '1.5px solid #ec4899' : '1px solid #333',
                padding: '0.4rem 0.8rem', fontSize: '0.85rem',
                opacity: s.enabled ? 1 : 0.4,
              }}>
              {s.label}
            </button>
          ))}
        </div>

        {voiceSource === 'profile' && (
          <select value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)}
            style={{ width: '100%', padding: '0.6rem', background: '#0d0d1a', border: '1px solid #333', borderRadius: '8px', color: '#fff' }}>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {voiceSource === 'model' && (
          <select value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)}
            style={{ width: '100%', padding: '0.6rem', background: '#0d0d1a', border: '1px solid #333', borderRadius: '8px', color: '#fff' }}>
            {trainedModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {voiceSource === 'file' && (
          <div>
            <input type="file" accept="audio/*" id="vc-target"
              onChange={e => { const f = e.target.files?.[0]; if (f) setVoiceFile(f) }}
              style={{ display: 'none' }} />
            <label htmlFor="vc-target" className="btn"
              style={{ background: '#1a1a2e', border: '1px solid #333', cursor: 'pointer', padding: '0.5rem 1rem' }}>
              📂 Hedef Ses Dosyası
            </label>
            {voiceFile && <span style={{ color: '#aaa', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{voiceFile.name}</span>}
          </div>
        )}
      </div>

      <button className="btn" onClick={handleConvert} disabled={loading || !audioFile}
        style={{ width: '100%', padding: '0.85rem', background: '#ec4899', fontSize: '1rem', fontWeight: 700 }}>
        {loading ? '⏳ Dönüştürülüyor...' : '🎤 Sesi Dönüştür'}
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
            <div style={{ fontWeight: 600 }}>Ses Dönüştürüldü!</div>
          </div>
          <audio ref={audioRef} src={`${API}${result.download_url}`} controls
            style={{ width: '100%', marginBottom: '0.75rem' }} />
          <a href={`${API}${result.download_url}`} download={result.filename} className="btn"
            style={{ display: 'inline-block', background: '#333', padding: '0.5rem 1rem', fontSize: '0.85rem', textDecoration: 'none' }}>
            📥 İndir
          </a>
        </div>
      )}
    </div>
  )
}
