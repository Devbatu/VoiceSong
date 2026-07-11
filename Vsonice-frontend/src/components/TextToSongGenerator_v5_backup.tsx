import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiService } from '../services/api'

const API_BASE = 'http://localhost:8000'

interface VoiceProfile {
  id: string
  name: string
  duration: number
  has_embedding: boolean
}

interface TrainedModel {
  id: string
  name: string
  quality_grade: string
  num_samples: number
  has_embedding: boolean
}

interface SongSection {
  id: number
  type: 'verse' | 'chorus' | 'bridge' | 'intro' | 'outro'
  text: string
}

interface GenerationResult {
  message: string
  status: string
  filename: string
  download_url: string
  duration: number
  size_mb: number
  voice_name: string
  text_length: number
  sections?: Array<{ type: string; text: string }>
  melody_intensity?: number
  key?: string
}

const SECTION_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  verse:  { label: 'Kuple', emoji: '🎵', color: '#3b82f6' },
  chorus: { label: 'Nakarat', emoji: '🔥', color: '#ef4444' },
  bridge: { label: 'Köprü', emoji: '🌉', color: '#f59e0b' },
  intro:  { label: 'Giriş', emoji: '🎬', color: '#8b5cf6' },
  outro:  { label: 'Çıkış', emoji: '🏁', color: '#6b7280' },
}

export default function TextToSongGenerator() {
  const [mode, setMode] = useState<'simple' | 'sections'>('simple')
  const [simpleText, setSimpleText] = useState('')
  const [sections, setSections] = useState<SongSection[]>([
    { id: 1, type: 'verse', text: '' },
    { id: 2, type: 'chorus', text: '' },
  ])
  const [nextSectionId, setNextSectionId] = useState(3)

  const [voiceSource, setVoiceSource] = useState<'profile' | 'model'>('profile')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [speed, setSpeed] = useState('medium')
  const [language, setLanguage] = useState('tr')
  const [melodyIntensity, setMelodyIntensity] = useState(0.5)
  const [musicalKey, setMusicalKey] = useState('C')
  const [bpm, setBpm] = useState(120)
  const [genre, setGenre] = useState('pop')

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [models, setModels] = useState<TrainedModel[]>([])
  const [loadingVoices, setLoadingVoices] = useState(true)

  const audioRef = useRef<HTMLAudioElement>(null)
  const navigate = useNavigate()

  useEffect(() => { loadVoices() }, [])

  async function loadVoices() {
    setLoadingVoices(true)
    try {
      const [profileRes, modelRes] = await Promise.all([
        apiService.listVoiceProfiles(),
        apiService.listTrainedModels(),
      ])
      const loadedProfiles = (profileRes.profiles || []).filter((p: VoiceProfile) => p.has_embedding)
      const loadedModels = (modelRes.models || []).filter((m: TrainedModel) => m.has_embedding)
      setProfiles(loadedProfiles)
      setModels(loadedModels)

      if (loadedModels.length > 0) {
        setVoiceSource('model')
        setSelectedModelId(loadedModels[0].id)
      } else if (loadedProfiles.length > 0) {
        setVoiceSource('profile')
        setSelectedProfileId(loadedProfiles[0].id)
      }
    } catch (err) {
      console.error('Ses kaynakları yüklenemedi:', err)
    } finally {
      setLoadingVoices(false)
    }
  }

  const addSection = (type: SongSection['type'] = 'verse') => {
    setSections([...sections, { id: nextSectionId, type, text: '' }])
    setNextSectionId(nextSectionId + 1)
  }

  const removeSection = (id: number) => {
    if (sections.length <= 1) return
    setSections(sections.filter(s => s.id !== id))
  }

  const updateSection = (id: number, field: keyof SongSection, value: any) => {
    setSections(sections.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  const moveSection = (id: number, dir: -1 | 1) => {
    const idx = sections.findIndex(s => s.id === id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= sections.length) return
    const updated = [...sections]
    ;[updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]]
    setSections(updated)
  }

  const totalText = mode === 'simple'
    ? simpleText.trim()
    : sections.map(s => s.text.trim()).filter(Boolean).join('\n\n')

  const hasVoice = (voiceSource === 'profile' && selectedProfileId) ||
    (voiceSource === 'model' && selectedModelId)
  const canGenerate = totalText.length >= 2

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canGenerate) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const params: any = {
        text: totalText,
        speed,
        language,
        melodyIntensity,
        key: musicalKey,
        bpm,
        genre,
      }
      if (hasVoice) {
        if (voiceSource === 'profile') params.voiceProfileId = selectedProfileId
        else params.voiceModelId = selectedModelId
      }

      if (mode === 'sections') {
        params.sections = sections
          .filter(s => s.text.trim())
          .map(s => ({ type: s.type, text: s.text.trim() }))
      }

      const response = await apiService.generateTextToSong(params)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vokal oluşturma başarısız')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!result?.download_url) return
    const link = document.createElement('a')
    link.href = `${API_BASE}${result.download_url}`
    link.download = result.filename
    link.click()
  }

  const noVoices = profiles.length === 0 && models.length === 0

  const intensityLabel = melodyIntensity < 0.2 ? 'Düz konuşma'
    : melodyIntensity < 0.4 ? 'Hafif melodi'
    : melodyIntensity < 0.6 ? 'Orta melodi'
    : melodyIntensity < 0.8 ? 'Belirgin şarkı'
    : 'Tam şarkı'

  const bpmLabel = bpm < 80 ? 'Ağır / Balad'
    : bpm < 110 ? 'Yavaş'
    : bpm < 130 ? 'Orta'
    : bpm < 160 ? 'Hızlı'
    : 'Enerjik'

  return (
    <div className="component-container">
      <h2>🎤 Metin → Şarkı Vokal Oluşturucu</h2>
      <p style={{ marginBottom: '1.5rem', color: '#888' }}>
        Metninizi gerçek şarkı vokali olarak seslendir — notalara oturtma, vibrato, melodi desenleri
      </p>

      {noVoices && !loadingVoices && (
        <div className="status-message" style={{ marginBottom: '1.5rem', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '1rem' }}>
          <p><strong>💡 Ses profili olmadan da çalışır!</strong></p>
          <p style={{ marginTop: '0.5rem', color: '#aaa' }}>
            TTS orijinal sesiyle melodi oluşturulur. Daha iyi sonuç için "Ses Klonlama" sayfasından bir ses profili ekleyin.
          </p>
        </div>
      )}

      <form onSubmit={handleGenerate}>
        {/* Mod Seçimi */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <button
            type="button" className="btn"
            style={{
              flex: 1,
              background: mode === 'simple' ? '#6c5ce7' : '#333',
              border: mode === 'simple' ? '2px solid #a29bfe' : '2px solid #444',
            }}
            onClick={() => setMode('simple')}
          >
            📝 Basit Mod
          </button>
          <button
            type="button" className="btn"
            style={{
              flex: 1,
              background: mode === 'sections' ? '#6c5ce7' : '#333',
              border: mode === 'sections' ? '2px solid #a29bfe' : '2px solid #444',
            }}
            onClick={() => setMode('sections')}
          >
            🎼 Bölümlü Mod (Kuple/Nakarat/Köprü)
          </button>
        </div>

        {/* === BASİT MOD === */}
        {mode === 'simple' && (
          <div className="form-group">
            <label>Metin / Şarkı Sözleri</label>
            <textarea
              value={simpleText}
              onChange={(e) => setSimpleText(e.target.value)}
              placeholder={"Şarkı sözlerinizi yazın...\n\nKuple ve nakarat otomatik algılanır.\nYa da [nakarat] [kuple] [köprü] etiketleri kullanın.\n\nÖrnek:\n[kuple]\nGözlerinde kayboldum bu gece\nYıldızlar parlar seninle\n\n[nakarat]\nSeni seviyorum, deli gibi\nYüreğim seninle çarpar"}
              style={{ minHeight: '200px', resize: 'vertical' }}
            />
            <small style={{ color: '#888' }}>
              {simpleText.length} karakter • Otomatik bölümleme veya [kuple] [nakarat] [köprü] etiketleri kullanın
            </small>
          </div>
        )}

        {/* === BÖLÜMLÜ MOD === */}
        {mode === 'sections' && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 600 }}>Şarkı Bölümleri</label>
            
            {sections.map((sec, idx) => {
              const info = SECTION_LABELS[sec.type]
              return (
                <div key={sec.id} style={{
                  border: `2px solid ${info.color}40`,
                  borderRadius: '8px',
                  padding: '1rem',
                  marginBottom: '0.75rem',
                  background: `${info.color}08`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', color: '#888' }}>#{idx + 1}</span>
                    <select
                      value={sec.type}
                      onChange={(e) => updateSection(sec.id, 'type', e.target.value)}
                      style={{
                        background: info.color,
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                      }}
                    >
                      {Object.entries(SECTION_LABELS).map(([key, val]) => (
                        <option key={key} value={key}>{val.emoji} {val.label}</option>
                      ))}
                    </select>
                    <div style={{ flex: 1 }} />
                    <button type="button" onClick={() => moveSection(sec.id, -1)} disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: idx === 0 ? 0.3 : 1, color: '#ccc' }}>▲</button>
                    <button type="button" onClick={() => moveSection(sec.id, 1)} disabled={idx === sections.length - 1}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: idx === sections.length - 1 ? 0.3 : 1, color: '#ccc' }}>▼</button>
                    <button type="button" onClick={() => removeSection(sec.id)} disabled={sections.length <= 1}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#ef4444', opacity: sections.length <= 1 ? 0.3 : 1 }}>✕</button>
                  </div>
                  <textarea
                    value={sec.text}
                    onChange={(e) => updateSection(sec.id, 'text', e.target.value)}
                    placeholder={sec.type === 'chorus' ? 'Nakarat sözlerini yaz (güçlü, yüksek melodi)...' :
                      sec.type === 'bridge' ? 'Köprü sözlerini yaz (farklı ton)...' :
                      'Kuple sözlerini yaz (sakin, hikaye anlatım)...'}
                    style={{ minHeight: '80px', resize: 'vertical', width: '100%' }}
                  />
                </div>
              )
            })}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {Object.entries(SECTION_LABELS).map(([key, val]) => (
                <button key={key} type="button" className="btn"
                  onClick={() => addSection(key as SongSection['type'])}
                  style={{ background: val.color, fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                >
                  {val.emoji} + {val.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ses Kaynağı */}
        <div className="form-group">
          <label>Ses Kaynağı</label>
          {loadingVoices ? (
            <p style={{ color: '#888' }}>Ses modelleri yükleniyor...</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                {models.length > 0 && (
                  <button type="button" className="btn"
                    style={{ flex: 1, background: voiceSource === 'model' ? '#6c5ce7' : '#333', border: voiceSource === 'model' ? '2px solid #a29bfe' : '2px solid #444' }}
                    onClick={() => setVoiceSource('model')}
                  >🎓 Eğitilmiş Model</button>
                )}
                {profiles.length > 0 && (
                  <button type="button" className="btn"
                    style={{ flex: 1, background: voiceSource === 'profile' ? '#6c5ce7' : '#333', border: voiceSource === 'profile' ? '2px solid #a29bfe' : '2px solid #444' }}
                    onClick={() => setVoiceSource('profile')}
                  >🎤 Ses Profili</button>
                )}
              </div>
              {voiceSource === 'model' && models.length > 0 && (
                <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
                  <option value="">Model seçin...</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} (Kalite: {m.quality_grade}, {m.num_samples} örnek)</option>
                  ))}
                </select>
              )}
              {voiceSource === 'profile' && profiles.length > 0 && (
                <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                  <option value="">Profil seçin...</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.duration.toFixed(1)}s)</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>

        {/* Melodi Ayarları */}
        <div style={{
          background: '#1a1a2e',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          border: '1px solid #333',
        }}>
          <label style={{ fontWeight: 600, marginBottom: '0.75rem', display: 'block' }}>🎵 Melodi Ayarları</label>

          {/* Tür Seçici */}
          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>Şarkı Türü</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
              {[
                { id: 'pop', label: '🎤 Pop', color: '#6c5ce7' },
                { id: 'ballad', label: '💔 Balad', color: '#e17055' },
                { id: 'arabesk', label: '🎻 Arabesk', color: '#d63031' },
                { id: 'rock', label: '🎸 Rock', color: '#2d3436' },
                { id: 'turk_halk', label: '🪕 Türk Halk', color: '#00b894' },
                { id: 'rnb', label: '🎷 R&B / Soul', color: '#a29bfe' },
              ].map(g => (
                <button key={g.id} type="button"
                  onClick={() => setGenre(g.id)}
                  style={{
                    background: genre === g.id ? g.color : '#2a2a3e',
                    color: '#fff',
                    border: genre === g.id ? `2px solid ${g.color}` : '2px solid #444',
                    borderRadius: '6px',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                    fontWeight: genre === g.id ? 700 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >{g.label}</button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.9rem' }}>
              Melodi Yoğunluğu: <strong style={{ color: '#a29bfe' }}>{Math.round(melodyIntensity * 100)}% — {intensityLabel}</strong>
            </label>
            <input
              type="range" min="0" max="1" step="0.05"
              value={melodyIntensity}
              onChange={(e) => setMelodyIntensity(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#666' }}>
              <span>Konuşma</span>
              <span>Hafif</span>
              <span>Orta</span>
              <span>Belirgin</span>
              <span>Tam Şarkı</span>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.9rem' }}>
              Tempo (BPM): <strong style={{ color: '#a29bfe' }}>{bpm} BPM — {bpmLabel}</strong>
            </label>
            <input
              type="range" min="60" max="180" step="5"
              value={bpm}
              onChange={(e) => setBpm(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#666' }}>
              <span>60 (Balad)</span>
              <span>100</span>
              <span>120 (Pop)</span>
              <span>140</span>
              <span>180 (Dans)</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label style={{ fontSize: '0.9rem' }}>Anahtar</label>
              <select value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)}>
                {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label style={{ fontSize: '0.9rem' }}>Hız</label>
              <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
                <option value="slow">🐢 Yavaş</option>
                <option value="medium">⚡ Normal</option>
                <option value="fast">🚀 Hızlı</option>
              </select>
            </div>
            <div className="form-group">
              <label style={{ fontSize: '0.9rem' }}>Dil</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="tr">🇹🇷 Türkçe</option>
                <option value="tr-female">🇹🇷 Türkçe (Kadın)</option>
                <option value="en">🇺🇸 İngilizce</option>
                <option value="en-female">🇺🇸 İngilizce (Kadın)</option>
              </select>
            </div>
          </div>
        </div>

        <button type="submit" className="btn"
          disabled={loading || !canGenerate}
          style={{ width: '100%', marginTop: '0.5rem', padding: '0.9rem', fontSize: '1rem' }}
        >
          {loading ? (
            <>
              <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #fff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 8, verticalAlign: 'middle' }} />
              Oluşturuluyor... (melodi + ses dönüşümü yapılıyor)
            </>
          ) : (
            '🎤 Şarkı Vokali Oluştur'
          )}
        </button>
      </form>

      {/* Sonuç */}
      {result && (
        <div className="status-message success-message" style={{ marginTop: '2rem', padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>✅ {result.message}</h3>

          <div style={{ marginBottom: '1rem' }}>
            <p><strong>Ses:</strong> {result.voice_name}</p>
            <p><strong>Süre:</strong> {result.duration}s</p>
            <p><strong>Boyut:</strong> {result.size_mb} MB</p>
            {result.sections && (
              <p><strong>Bölümler:</strong> {result.sections.map(s => {
                const info = SECTION_LABELS[s.type]
                return info ? `${info.emoji} ${info.label}` : s.type
              }).join(' → ')}</p>
            )}
            {result.melody_intensity !== undefined && (
              <p><strong>Melodi:</strong> {Math.round(result.melody_intensity * 100)}%</p>
            )}
          </div>

          <audio ref={audioRef} controls src={`${API_BASE}${result.download_url}`} style={{ width: '100%', marginBottom: '1rem' }} />

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn" onClick={handleDownload} style={{ flex: 1 }}>📥 İndir</button>
            <button className="btn" onClick={() => navigate('/vokal-editor', { state: { audioUrl: result.download_url, filename: result.filename } })} style={{ flex: 1, background: '#6c5ce7' }}>🎛️ Editörde Aç</button>
            <button className="btn" onClick={() => { setResult(null) }} style={{ flex: 1, background: '#333' }}>🔄 Yeni Oluştur</button>
          </div>
        </div>
      )}

      {/* Hata */}
      {error && (
        <div className="status-message error-message" style={{ marginTop: '2rem' }}>
          <h3>❌ Hata</h3>
          <p style={{ marginTop: '0.5rem' }}>{error}</p>
          <button className="btn" onClick={() => setError(null)} style={{ marginTop: '0.75rem', background: '#555' }}>Tekrar Dene</button>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
