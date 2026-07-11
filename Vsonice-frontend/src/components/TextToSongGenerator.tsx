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

interface GenerationResult {
  message: string
  status: string
  filename: string
  download_url: string
  duration: number
  size_mb: number
  voice_name: string
  text_length: number
  sections?: Array<{ type: string; text: string; perf_tag?: string }>
  melody_intensity?: number
  key?: string
  bpm?: number
}

const SECTION_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  verse:  { label: 'Kuple', emoji: '🎵', color: '#3b82f6' },
  chorus: { label: 'Nakarat', emoji: '🔥', color: '#ef4444' },
  bridge: { label: 'Köprü', emoji: '🌉', color: '#f59e0b' },
  intro:  { label: 'Giriş', emoji: '🎬', color: '#8b5cf6' },
  outro:  { label: 'Çıkış', emoji: '🏁', color: '#6b7280' },
}

const PROGRESS_STAGES = [
  { at: 0, label: 'Sözler işleniyor...', progress: 5 },
  { at: 2000, label: 'Ses sentezleniyor...', progress: 20 },
  { at: 6000, label: 'Melodi uygulanıyor...', progress: 40 },
  { at: 15000, label: 'Ses dönüşümü yapılıyor...', progress: 60 },
  { at: 30000, label: 'Stüdyo mastering...', progress: 80 },
  { at: 50000, label: 'Tamamlanıyor...', progress: 92 },
]

export default function TextToSongGenerator() {
  const [lyrics, setLyrics] = useState('')

  const [voiceSource, setVoiceSource] = useState<'profile' | 'model'>('profile')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [speed, setSpeed] = useState('medium')
  const [language, setLanguage] = useState('tr')
  const [melodyIntensity, setMelodyIntensity] = useState(0.7)
  const [musicalKey, setMusicalKey] = useState('C')
  const [bpm, setBpm] = useState(120)

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')

  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [models, setModels] = useState<TrainedModel[]>([])
  const [loadingVoices, setLoadingVoices] = useState(true)

  const audioRef = useRef<HTMLAudioElement>(null)
  const navigate = useNavigate()

  useEffect(() => { loadVoices() }, [])

  useEffect(() => {
    if (!loading) {
      if (result) { setProgress(100); setStage('Tamamlandı!') }
      return
    }
    const timers = PROGRESS_STAGES.map(s =>
      setTimeout(() => { setStage(s.label); setProgress(s.progress) }, s.at)
    )
    return () => timers.forEach(clearTimeout)
  }, [loading])

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

  const hasVoice = (voiceSource === 'profile' && selectedProfileId) ||
    (voiceSource === 'model' && selectedModelId)
  const canGenerate = lyrics.trim().length >= 2

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canGenerate) return
    setLoading(true)
    setError(null)
    setResult(null)
    setProgress(0)
    setStage('')

    try {
      const params: Record<string, unknown> = {
        text: lyrics.trim(),
        speed, language, melodyIntensity,
        key: musicalKey, bpm,
      }
      if (hasVoice) {
        if (voiceSource === 'profile') params.voiceProfileId = selectedProfileId
        else params.voiceModelId = selectedModelId
      }
      const response = await apiService.generateTextToSong(params as Parameters<typeof apiService.generateTextToSong>[0])
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
      {/* === HEADER === */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>
          🎤 Metin → Şarkı AI
        </h2>
        <p style={{ color: '#888', fontSize: '0.95rem' }}>
          Sözlerinizi yazın, [etiketler] ile söyleme tarzını belirleyin — AI vokalinizi oluştursun
        </p>
      </div>

      <form onSubmit={handleGenerate}>
        {/* === LYRICS === */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: '12px', padding: '1.25rem',
          marginBottom: '1.25rem', border: '1px solid #2a2a4a',
        }}>
          <label style={{ fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.1rem' }}>📝</span> Şarkı Sözleri
          </label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder={"Şarkı sözlerinizi yazın...\n\nBölüm & performans etiketleri:\n\n[Kuple] [Soft]\nGözlerinde kayboldum bu gece\nYıldızlar parlar seninle\n\n[Nakarat] [Belting]\nSeni seviyorum deli gibi\nYüreğim seninle çarpar\n\n[Köprü] [Whisper]\nBu gece farklı bir şey var..."}
            style={{
              minHeight: '180px', resize: 'vertical', width: '100%',
              background: '#0d0d1a', border: '1px solid #333',
              borderRadius: '8px', padding: '1rem', fontSize: '0.95rem',
              lineHeight: '1.6', color: '#e0e0e0',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.8rem', color: '#666', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {['[Kuple]', '[Nakarat]', '[Köprü]', '[Giriş]', '[Çıkış]'].map(tag => (
                  <button key={tag} type="button"
                    onClick={() => setLyrics(prev => prev + (prev ? '\n\n' : '') + tag + '\n')}
                    style={{
                      background: 'transparent', border: '1px solid #444',
                      color: '#888', borderRadius: '4px',
                      padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem',
                    }}
                  >{tag}</button>
                ))}
              </span>
              <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {[
                  { tag: '[Soft]', color: '#74b9ff', tip: 'Yumuşak' },
                  { tag: '[Belting]', color: '#e17055', tip: 'Güçlü' },
                  { tag: '[Whisper]', color: '#81ecec', tip: 'Fısıltı' },
                  { tag: '[Rap]', color: '#fdcb6e', tip: 'Rap' },
                  { tag: '[Falsetto]', color: '#a29bfe', tip: 'İnce ses' },
                  { tag: '[Spoken]', color: '#636e72', tip: 'Konuşma' },
                  { tag: '[Emotional]', color: '#fd79a8', tip: 'Duygusal' },
                  { tag: '[Powerful]', color: '#d63031', tip: 'Kuvvetli' },
                  { tag: '[Crescendo]', color: '#ffeaa7', tip: 'Yükseliş' },
                ].map(({ tag, color, tip }) => (
                  <button key={tag} type="button" title={tip}
                    onClick={() => setLyrics(prev => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + tag + '\n')}
                    style={{
                      background: 'transparent', border: `1px solid ${color}40`,
                      color, borderRadius: '4px',
                      padding: '2px 8px', cursor: 'pointer', fontSize: '0.73rem',
                      fontStyle: 'italic',
                    }}
                  >{tag}</button>
                ))}
              </span>
            </div>
            <span>{lyrics.length} karakter</span>
          </div>
        </div>


        {/* === VOICE SELECTOR === */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: '12px', padding: '1.25rem',
          marginBottom: '1.25rem', border: '1px solid #2a2a4a',
        }}>
          <label style={{ fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.1rem' }}>🎙️</span> Ses Kaynağı
            <span style={{ fontSize: '0.75rem', color: '#666', fontWeight: 400 }}>(opsiyonel)</span>
          </label>

          {loadingVoices ? (
            <p style={{ color: '#888', fontSize: '0.9rem' }}>Ses modelleri yükleniyor...</p>
          ) : profiles.length === 0 && models.length === 0 ? (
            <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>
              💡 Ses profili olmadan TTS orijinal sesi kullanılır. Daha iyi sonuç için &quot;Ses Klonlama&quot; sayfasından profil ekleyin.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {models.length > 0 && (
                <>
                  <button type="button"
                    onClick={() => setVoiceSource('model')}
                    style={{
                      background: voiceSource === 'model' ? '#6c5ce7' : 'rgba(255,255,255,0.05)',
                      color: voiceSource === 'model' ? '#fff' : '#aaa',
                      border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem',
                      fontSize: '0.85rem', cursor: 'pointer',
                    }}
                  >🎓 Model</button>
                  {voiceSource === 'model' && (
                    <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}
                      style={{ flex: 1, minWidth: '150px' }}>
                      <option value="">Seçin...</option>
                      {models.map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.quality_grade}, {m.num_samples} örnek)</option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {profiles.length > 0 && (
                <>
                  <button type="button"
                    onClick={() => setVoiceSource('profile')}
                    style={{
                      background: voiceSource === 'profile' ? '#6c5ce7' : 'rgba(255,255,255,0.05)',
                      color: voiceSource === 'profile' ? '#fff' : '#aaa',
                      border: 'none', borderRadius: '6px', padding: '0.4rem 0.8rem',
                      fontSize: '0.85rem', cursor: 'pointer',
                    }}
                  >🎤 Profil</button>
                  {voiceSource === 'profile' && (
                    <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}
                      style={{ flex: 1, minWidth: '150px' }}>
                      <option value="">Seçin...</option>
                      {profiles.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.duration.toFixed(1)}s)</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* === ADVANCED SETTINGS (collapsible) === */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: '12px',
          marginBottom: '1.25rem', border: '1px solid #2a2a4a',
          overflow: 'hidden',
        }}>
          <button type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              color: '#999', padding: '1rem 1.25rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: '0.9rem',
            }}
          >
            <span>🎛️ İleri Ayarlar</span>
            <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
          </button>

          {showAdvanced && (
            <div style={{ padding: '0 1.25rem 1.25rem' }}>
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.9rem' }}>
                  Melodi Yoğunluğu: <strong style={{ color: '#a29bfe' }}>{Math.round(melodyIntensity * 100)}% — {intensityLabel}</strong>
                </label>
                <input type="range" min="0" max="1" step="0.05"
                  value={melodyIntensity} onChange={(e) => setMelodyIntensity(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#555' }}>
                  <span>Konuşma</span><span>Hafif</span><span>Orta</span><span>Belirgin</span><span>Tam Şarkı</span>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.9rem' }}>
                  Tempo: <strong style={{ color: '#a29bfe' }}>{bpm} BPM — {bpmLabel}</strong>
                </label>
                <input type="range" min="60" max="180" step="5"
                  value={bpm} onChange={(e) => setBpm(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label style={{ fontSize: '0.85rem' }}>Anahtar</label>
                  <select value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)}>
                    {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '0.85rem' }}>Hız</label>
                  <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
                    <option value="slow">🐢 Yavaş</option>
                    <option value="medium">⚡ Normal</option>
                    <option value="fast">🚀 Hızlı</option>
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '0.85rem' }}>Dil</label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                    <option value="tr">🇹🇷 Türkçe</option>
                    <option value="tr-female">🇹🇷 Türkçe (K)</option>
                    <option value="en">🇺🇸 İngilizce</option>
                    <option value="en-female">🇺🇸 İngilizce (K)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* === GENERATE BUTTON === */}
        <button type="submit" className="btn"
          disabled={loading || !canGenerate}
          style={{
            width: '100%', padding: '1rem', fontSize: '1.05rem',
            background: loading ? '#2a2a3e' : 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)',
            border: 'none', borderRadius: '12px', position: 'relative',
            overflow: 'hidden', fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? (
            <div>
              <div style={{
                position: 'absolute', left: 0, top: 0, height: '100%',
                width: `${progress}%`, background: 'rgba(108,92,231,0.3)',
                transition: 'width 1s ease',
              }} />
              <span style={{ position: 'relative', zIndex: 1 }}>
                <span style={{
                  display: 'inline-block', width: 14, height: 14,
                  border: '2px solid #fff', borderTop: '2px solid transparent',
                  borderRadius: '50%', animation: 'spin 1s linear infinite',
                  marginRight: 8, verticalAlign: 'middle',
                }} />
                {stage || 'Hazırlanıyor...'} ({progress}%)
              </span>
            </div>
          ) : (
            '🎤 Şarkı Oluştur'
          )}
        </button>
      </form>

      {/* === RESULT === */}
      {result && (
        <div style={{
          marginTop: '2rem', padding: '1.5rem',
          background: 'linear-gradient(135deg, #0a3d0a 0%, #1a2e1a 100%)',
          borderRadius: '12px', border: '1px solid rgba(76,175,80,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '1.5rem' }}>✅</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Şarkınız Hazır!</h3>
              <p style={{ margin: 0, color: '#888', fontSize: '0.85rem' }}>
                {result.voice_name} • {result.duration}s • {result.size_mb} MB
              </p>
            </div>
          </div>

          <audio ref={audioRef} controls
            src={`${API_BASE}${result.download_url}`}
            style={{ width: '100%', marginBottom: '1rem', borderRadius: '8px' }}
          />

          {/* Tags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
            {result.key && (
              <span style={{ background: 'rgba(255,255,255,0.05)', color: '#888', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                🎵 {result.key}
              </span>
            )}
            {result.bpm && (
              <span style={{ background: 'rgba(255,255,255,0.05)', color: '#888', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                ♫ {result.bpm} BPM
              </span>
            )}
            {result.melody_intensity !== undefined && (
              <span style={{ background: 'rgba(255,255,255,0.05)', color: '#888', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                🎶 Melodi {Math.round(result.melody_intensity * 100)}%
              </span>
            )}
            {result.sections && result.sections.map((sec, i) => {
              const info = SECTION_LABELS[sec.type]
              return (
                <span key={i} style={{ background: info ? `${info.color}20` : 'rgba(255,255,255,0.05)', color: info?.color || '#888', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                  {info ? `${info.emoji} ${info.label}` : sec.type}{sec.perf_tag ? ` [${sec.perf_tag}]` : ''}
                </span>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn" onClick={handleDownload}
              style={{ flex: 1, background: '#2d7d32', borderRadius: '8px' }}>
              📥 İndir WAV
            </button>
            <button className="btn"
              onClick={() => navigate('/vokal-editor', { state: { audioUrl: result.download_url, filename: result.filename } })}
              style={{ flex: 1, background: '#6c5ce7', borderRadius: '8px' }}>
              🎛️ Editörde Aç
            </button>
            <button className="btn" onClick={() => { setResult(null); setProgress(0); setStage('') }}
              style={{ flex: 1, background: '#333', borderRadius: '8px' }}>
              🔄 Yeni Oluştur
            </button>
          </div>
        </div>
      )}

      {/* === ERROR === */}
      {error && (
        <div style={{
          marginTop: '2rem', padding: '1.25rem',
          background: 'rgba(239,68,68,0.1)', borderRadius: '12px',
          border: '1px solid rgba(239,68,68,0.3)',
        }}>
          <h3 style={{ margin: '0 0 0.5rem', color: '#ef4444' }}>❌ Hata</h3>
          <p style={{ color: '#ccc', margin: '0 0 0.75rem' }}>{error}</p>
          <button className="btn" onClick={() => setError(null)}
            style={{ background: '#555', borderRadius: '8px' }}>Kapat</button>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
