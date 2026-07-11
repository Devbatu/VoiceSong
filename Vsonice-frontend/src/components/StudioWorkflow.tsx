import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const API = 'http://localhost:8000'

/* ─── Types ─── */
interface VoiceProfile { id: string; name: string; has_embedding?: boolean }
interface TrainedModel { id: string; name: string }
interface StemResult { name: string; download_url: string }
const STEPS = [
  { num: 1, icon: '📥', title: 'Kaynak Ses', desc: 'YouTube URL veya dosya yükleme' },
  { num: 2, icon: '🎧', title: 'Vokal Ayırma', desc: 'Demucs AI ile stem separation' },
  { num: 3, icon: '🎤', title: 'AI Ses Dönüştürme', desc: 'OpenVoice V2 ile ses kimliği değiştirme' },
  { num: 4, icon: '🎸', title: 'Enstrümantal', desc: 'Ayrılmış müziği kullan veya yeni üret' },
  { num: 5, icon: '🎚', title: 'Mix & Master', desc: 'Profesyonel mastering' },
  { num: 6, icon: '📤', title: 'Dışa Aktar', desc: 'Final dosyayı indir' },
]

const GENRES = [
  { id: 'pop', label: 'Pop' }, { id: 'rock', label: 'Rock' },
  { id: 'anatolian_rock', label: 'Anatolian Rock' }, { id: 'arabesk', label: 'Arabesk' },
  { id: 'electronic', label: 'Elektronik' }, { id: 'rnb', label: 'R&B' },
  { id: 'hiphop', label: 'Hip-Hop' }, { id: 'ballad', label: 'Balad' },
]

const MASTER_PRESETS = [
  { id: 'balanced', label: '⚖️ Dengeli', desc: 'Vokal ve enstrümantal dengede' },
  { id: 'vocal_forward', label: '🎤 Vokal Ön Planda', desc: 'Vokal daha belirgin' },
  { id: 'instrumental_forward', label: '🎸 Müzik Ön Planda', desc: 'Enstrümantal daha güçlü' },
  { id: 'radio', label: '📻 Radyo', desc: 'Yüksek ses, net ve kompakt' },
  { id: 'cinematic', label: '🎬 Sinematik', desc: 'Geniş, mekansal master' },
  { id: 'raw', label: '🔈 Ham', desc: 'Efektsiz, salt mix' },
]

export default function StudioWorkflow() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Source
  const [sourceType, setSourceType] = useState<'file' | 'youtube'>('file')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceAudioUrl, setSourceAudioUrl] = useState<string | null>(null)
  const [sourceFilename, setSourceFilename] = useState('')
  // Step 2: Separation
  const [demucsModel, setDemucsModel] = useState('htdemucs_ft')
  const [stems, setStems] = useState<StemResult[]>([])
  const [vocalUrl, setVocalUrl] = useState<string | null>(null)
  const [instrumentalUrl, setInstrumentalUrl] = useState<string | null>(null)

  // Step 3: Voice Conversion
  const [voiceSource, setVoiceSource] = useState<'profile' | 'model' | 'file'>('profile')
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [convertedVocalUrl, setConvertedVocalUrl] = useState<string | null>(null)

  // Step 4: Instrumental
  const [instrumentalSource, setInstrumentalSource] = useState<'separated' | 'generate' | 'upload'>('separated')
  const [genGenre, setGenGenre] = useState('anatolian_rock')
  const [genBpm, setGenBpm] = useState(120)
  const [genKey, setGenKey] = useState('A')
  const [genDuration, setGenDuration] = useState(30)
  const [customInstFile, setCustomInstFile] = useState<File | null>(null)
  const [finalInstrumentalUrl, setFinalInstrumentalUrl] = useState<string | null>(null)

  // Step 5: Mix & Master
  const [masterPreset, setMasterPreset] = useState('balanced')
  const [vocalVol, setVocalVol] = useState(0.85)
  const [instVol, setInstVol] = useState(0.75)
  const [masteredUrl, setMasteredUrl] = useState<string | null>(null)

  // Step 6: Export
  const [exportFilename, setExportFilename] = useState('')

  // Step completion tracking
  const stepDone = (n: number): boolean => {
    switch (n) {
      case 1: return !!sourceAudioUrl
      case 2: return !!vocalUrl && !!instrumentalUrl
      case 3: return !!convertedVocalUrl
      case 4: return !!finalInstrumentalUrl
      case 5: return !!masteredUrl
      case 6: return false
      default: return false
    }
  }

  // Load voice profiles & trained models on mount
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

  /* ═══ Helper: fetch blob from download URL ═══ */
  async function fetchBlob(downloadUrl: string): Promise<Blob> {
    const res = await fetch(`${API}${downloadUrl}`)
    if (!res.ok) throw new Error('Dosya indirilemedi')
    return await res.blob()
  }

  /* ═══ STEP 1: Source Audio ═══ */
  async function handleStep1() {
    setLoading(true); setError(null)
    try {
      if (sourceType === 'youtube') {
        if (!youtubeUrl.trim()) throw new Error('YouTube URL girin')
        const formData = new FormData()
        formData.append('url', youtubeUrl.trim())
        const res = await fetch(`${API}/api/youtube/extract-audio`, { method: 'POST', body: formData })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || 'YouTube indirme başarısız')
        }
        const blob = await res.blob()
        const title = res.headers.get('X-Audio-Title') || 'youtube_audio'
        const url = URL.createObjectURL(blob)
        setSourceAudioUrl(url)
        setSourceFilename(decodeURIComponent(title))
        // Save blob as File for later steps
        setSourceFile(new File([blob], `${title}.wav`, { type: 'audio/wav' }))
      } else {
        if (!sourceFile) throw new Error('Bir ses dosyası seçin')
        const url = URL.createObjectURL(sourceFile)
        setSourceAudioUrl(url)
        setSourceFilename(sourceFile.name)
      }
      setCurrentStep(2)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ═══ STEP 2: Vocal Separation ═══ */
  async function handleStep2() {
    if (!sourceFile) { setError('Kaynak ses bulunamadı'); return }
    setLoading(true); setError(null)
    try {
      const formData = new FormData()
      formData.append('audio_file', sourceFile)
      formData.append('model', demucsModel)
      const res = await fetch(`${API}/api/separate`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Ayırma başarısız')
      }
      const data = await res.json()
      const stemList: StemResult[] = data.stems || []
      setStems(stemList)

      // Find vocals and instrumental/music stems
      const vocal = stemList.find(s => s.name === 'vocals')
      const inst = stemList.find(s => s.name === 'music') || stemList.find(s => s.name === 'other')
      if (vocal) setVocalUrl(vocal.download_url)
      if (inst) setInstrumentalUrl(inst.download_url)
      setFinalInstrumentalUrl(inst?.download_url || null)
      setCurrentStep(3)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ═══ STEP 3: Voice Conversion ═══ */
  async function handleStep3() {
    if (!vocalUrl) { setError('Vokal bulunamadı'); return }
    setLoading(true); setError(null)
    try {
      // Download vocal stem as blob
      const vocalBlob = await fetchBlob(vocalUrl)
      const vocalFile = new File([vocalBlob], 'vocals.wav', { type: 'audio/wav' })

      const formData = new FormData()
      formData.append('audio_file', vocalFile)

      if (voiceSource === 'profile' && selectedProfileId) {
        formData.append('voice_profile_id', selectedProfileId)
      } else if (voiceSource === 'model' && selectedModelId) {
        formData.append('voice_model_id', selectedModelId)
      } else if (voiceSource === 'file' && voiceFile) {
        formData.append('voice_file', voiceFile)
      } else {
        throw new Error('Bir ses kaynağı seçin')
      }

      const res = await fetch(`${API}/api/convert/voice`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Ses dönüştürme başarısız')
      }
      const data = await res.json()
      setConvertedVocalUrl(data.download_url)
      setCurrentStep(4)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ═══ STEP 4: Instrumental ═══ */
  async function handleStep4() {
    setLoading(true); setError(null)
    try {
      if (instrumentalSource === 'separated') {
        setFinalInstrumentalUrl(instrumentalUrl)
      } else if (instrumentalSource === 'generate') {
        const res = await fetch(`${API}/api/generate/music`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genre: genGenre, bpm: genBpm, key: genKey, duration: genDuration }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || 'Müzik üretimi başarısız')
        }
        const data = await res.json()
        setFinalInstrumentalUrl(data.download_url)
      } else if (instrumentalSource === 'upload') {
        if (!customInstFile) throw new Error('Enstrümantal dosya seçin')
        // Upload the file and get a path
        const fd = new FormData()
        fd.append('file', customInstFile)
        const upRes = await fetch(`${API}/api/upload`, { method: 'POST', body: fd })
        if (!upRes.ok) throw new Error('Dosya yükleme başarısız')
        const upData = await upRes.json()
        setFinalInstrumentalUrl(`/api/download/${upData.filename}/other`)
      }
      setCurrentStep(5)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ═══ STEP 5: Mix & Master ═══ */
  async function handleStep5() {
    if (!convertedVocalUrl || !finalInstrumentalUrl) {
      setError('Vokal veya enstrümantal bulunamadı')
      return
    }
    setLoading(true); setError(null)
    try {
      const vocalBlob = await fetchBlob(convertedVocalUrl)
      const instBlob = await fetchBlob(finalInstrumentalUrl)

      const formData = new FormData()
      formData.append('vocal_file', new File([vocalBlob], 'vocal.wav', { type: 'audio/wav' }))
      formData.append('instrumental_file', new File([instBlob], 'instrumental.wav', { type: 'audio/wav' }))
      formData.append('vocal_volume', vocalVol.toString())
      formData.append('instrumental_volume', instVol.toString())
      formData.append('preset', masterPreset)

      const res = await fetch(`${API}/api/workflow/mix-master`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Mastering başarısız')
      }
      const data = await res.json()
      setMasteredUrl(data.download_url)
      setExportFilename(data.filename)
      setCurrentStep(6)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ═══ STEP 6: Export ═══ */
  function handleExport() {
    if (!masteredUrl) return
    const link = document.createElement('a')
    link.href = `${API}${masteredUrl}`
    link.download = exportFilename || 'mastered_output.wav'
    link.click()
  }

  /* ═══ Audio preview helper ═══ */
  function PreviewPlayer({ url, label }: { url: string | null; label: string }) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)
    if (!url) return null
    const fullUrl = url.startsWith('blob:') ? url : `${API}${url}`
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: '#1a1a2e', borderRadius: '6px', fontSize: '0.8rem' }}>
        <audio ref={audioRef} src={fullUrl} preload="none"
          onEnded={() => setPlaying(false)} />
        <button className="btn" onClick={() => {
          if (playing) { audioRef.current?.pause(); setPlaying(false) }
          else { audioRef.current?.play(); setPlaying(true) }
        }} style={{ background: 'none', border: 'none', padding: '0.2rem', fontSize: '1rem', cursor: 'pointer' }}>
          {playing ? '⏸' : '▶️'}
        </button>
        <span style={{ color: '#aaa' }}>{label}</span>
      </div>
    )
  }

  /* ═══ RENDER ═══ */
  return (
    <div className="component-container" style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{
          fontSize: '1.8rem', fontWeight: 800, margin: '0 0 0.5rem',
          background: 'linear-gradient(135deg, #6366f1, #ec4899)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          🎵 Profesyonel Workflow
        </h2>
        <p style={{ color: '#888', fontSize: '0.95rem' }}>
          Piyasa standardı AI müzik prodüksiyon hattı — adım adım
        </p>
      </div>

      {/* Step Timeline */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '0.15rem', marginBottom: '1.5rem', flexWrap: 'wrap',
        padding: '0.75rem', background: '#0d0d1a', borderRadius: '12px', border: '1px solid #1e1e36',
      }}>
        {STEPS.map((s, i) => {
          const done = stepDone(s.num)
          const active = currentStep === s.num
          const locked = s.num > 1 && !stepDone(s.num - 1) && !active
          return (
            <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => { if (!locked) setCurrentStep(s.num) }}
                disabled={locked}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.5rem 0.8rem', borderRadius: '8px', border: 'none',
                  cursor: locked ? 'not-allowed' : 'pointer',
                  background: active ? '#6366f120' : done ? '#10b98115' : '#1a1a2e',
                  opacity: locked ? 0.4 : 1,
                  transition: 'all 0.2s',
                  color: active ? '#fff' : done ? '#10b981' : '#888',
                  fontSize: '0.8rem', fontWeight: active ? 700 : 500,
                }}>
                <span style={{ fontSize: '1.1rem' }}>{done ? '✅' : s.icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>{s.title}</span>
                </span>
              </button>
              {i < STEPS.length - 1 && <span style={{ color: '#333', margin: '0 0.1rem', fontSize: '0.8rem' }}>→</span>}
            </div>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="status-message error-message" style={{ marginBottom: '1rem' }}>
          <p>❌ {error}</p>
          <button className="btn" onClick={() => setError(null)} style={{ marginTop: '0.5rem', background: '#555', fontSize: '0.8rem' }}>Kapat</button>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div style={{
          textAlign: 'center', padding: '2rem',
          background: '#12122a', borderRadius: '12px', border: '1px solid #2a2a3e',
          marginBottom: '1rem',
        }}>
          <div style={{
            width: 40, height: 40, border: '3px solid #6366f1', borderTop: '3px solid transparent',
            borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem',
          }} />
          <p style={{ color: '#aaa', fontSize: '1rem' }}>
            {currentStep === 1 && 'Ses indiriliyor...'}
            {currentStep === 2 && '🧠 Demucs AI vokal ayırıyor... (1-5 dk)'}
            {currentStep === 3 && '🎤 OpenVoice V2 ses dönüştürüyor...'}
            {currentStep === 4 && '🎸 Enstrümantal üretiliyor...'}
            {currentStep === 5 && '🎚 Mix & Master yapılıyor...'}
          </p>
        </div>
      )}

      {/* ═══ STEP CONTENT ═══ */}
      {!loading && (
        <div style={{
          background: '#12122a', borderRadius: '12px', padding: '1.5rem',
          border: '1px solid #2a2a3e', minHeight: '300px',
        }}>

          {/* ─── STEP 1: Source ─── */}
          {currentStep === 1 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>📥 Adım 1: Kaynak Ses</h3>
              <p style={{ color: '#888', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                Şarkıyı YouTube'dan indirin veya bilgisayarınızdan yükleyin
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                {(['file', 'youtube'] as const).map(t => (
                  <button key={t} className="btn" onClick={() => setSourceType(t)}
                    style={{
                      background: sourceType === t ? '#6366f120' : '#1a1a2e',
                      border: sourceType === t ? '1.5px solid #6366f1' : '1px solid #333',
                      padding: '0.5rem 1rem', fontSize: '0.9rem',
                    }}>
                    {t === 'file' ? '📂 Dosya Yükle' : '🔗 YouTube URL'}
                  </button>
                ))}
              </div>

              {sourceType === 'youtube' ? (
                <div>
                  <input type="text" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    style={{
                      width: '100%', padding: '0.75rem', background: '#0d0d1a', border: '1px solid #333',
                      borderRadius: '8px', color: '#fff', fontSize: '0.95rem',
                    }} />
                  <p style={{ color: '#555', fontSize: '0.75rem', marginTop: '0.3rem' }}>Maksimum 15 dakika</p>
                </div>
              ) : (
                <div>
                  <input type="file" accept="audio/*" id="wf-source"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setSourceFile(f); setSourceFilename(f.name) } }}
                    style={{ display: 'none' }} />
                  <label htmlFor="wf-source" className="btn"
                    style={{ background: '#1a1a2e', border: '1px solid #333', cursor: 'pointer', display: 'inline-block', padding: '0.75rem 1.5rem' }}>
                    📂 Dosya Seç
                  </label>
                  {sourceFile && <span style={{ color: '#aaa', marginLeft: '0.75rem', fontSize: '0.9rem' }}>{sourceFile.name}</span>}
                </div>
              )}

              {sourceAudioUrl && <PreviewPlayer url={sourceAudioUrl} label={sourceFilename} />}

              <button className="btn" onClick={handleStep1} disabled={loading}
                style={{
                  marginTop: '1.25rem', width: '100%', padding: '0.85rem',
                  background: '#6366f1', fontSize: '1rem', fontWeight: 600,
                }}>
                {sourceType === 'youtube' ? '⬇️ YouTube\'dan İndir' : '📂 Dosyayı Yükle'} → Sonraki Adım
              </button>
            </div>
          )}

          {/* ─── STEP 2: Vocal Separation ─── */}
          {currentStep === 2 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>🎧 Adım 2: Vokal Ayırma (Demucs AI)</h3>
              <p style={{ color: '#888', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                AI ile şarkıyı vokal ve enstrümantal parçalara ayırın
              </p>

              <PreviewPlayer url={sourceAudioUrl} label={`Kaynak: ${sourceFilename}`} />

              <div style={{ margin: '1rem 0' }}>
                <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Demucs AI Modeli</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {[
                    { id: 'htdemucs', label: 'HTDemucs', desc: 'Hızlı' },
                    { id: 'htdemucs_ft', label: 'HTDemucs FT', desc: 'En iyi kalite' },
                    { id: 'htdemucs_6s', label: 'HTDemucs 6S', desc: '6 stem' },
                  ].map(m => (
                    <button key={m.id} className="btn" onClick={() => setDemucsModel(m.id)}
                      style={{
                        background: demucsModel === m.id ? '#8b5cf620' : '#1a1a2e',
                        border: demucsModel === m.id ? '1.5px solid #8b5cf6' : '1px solid #333',
                        padding: '0.4rem 0.8rem', fontSize: '0.85rem',
                      }}>
                      {m.label} <span style={{ color: '#666', fontSize: '0.75rem' }}>({m.desc})</span>
                    </button>
                  ))}
                </div>
              </div>

              {stems.length > 0 && (
                <div style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {stems.map(s => (
                    <PreviewPlayer key={s.name} url={s.download_url} label={s.name} />
                  ))}
                </div>
              )}

              <button className="btn" onClick={handleStep2} disabled={loading || !sourceFile}
                style={{
                  marginTop: '1rem', width: '100%', padding: '0.85rem',
                  background: stepDone(2) ? '#10b981' : '#8b5cf6', fontSize: '1rem', fontWeight: 600,
                }}>
                {stepDone(2) ? '✅ Ayrılmış — Tekrar Ayır' : '🧠 Demucs AI ile Ayır'} → Sonraki Adım
              </button>
            </div>
          )}

          {/* ─── STEP 3: Voice Conversion ─── */}
          {currentStep === 3 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>🎤 Adım 3: AI Ses Dönüştürme</h3>
              <p style={{ color: '#888', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                Vokalı hedef sanatçının ses kimliğine dönüştürün (OpenVoice V2 Neural Voice Conversion)
              </p>

              {vocalUrl && <PreviewPlayer url={vocalUrl} label="Orijinal Vokal" />}

              <div style={{ margin: '1rem 0' }}>
                <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>Hedef Ses Kaynağı</label>
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
                    <input type="file" accept="audio/*" id="wf-voice"
                      onChange={e => { const f = e.target.files?.[0]; if (f) setVoiceFile(f) }}
                      style={{ display: 'none' }} />
                    <label htmlFor="wf-voice" className="btn"
                      style={{ background: '#1a1a2e', border: '1px solid #333', cursor: 'pointer', padding: '0.5rem 1rem' }}>
                      📂 Hedef Ses Dosyası Seç
                    </label>
                    {voiceFile && <span style={{ color: '#aaa', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{voiceFile.name}</span>}
                  </div>
                )}
              </div>

              {convertedVocalUrl && <PreviewPlayer url={convertedVocalUrl} label="Dönüştürülmüş Vokal" />}

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button className="btn" onClick={handleStep3} disabled={loading}
                  style={{
                    flex: 1, padding: '0.85rem',
                    background: '#ec4899', fontSize: '1rem', fontWeight: 600,
                  }}>
                  🎤 Ses Dönüştür → Sonraki Adım
                </button>
                <button className="btn" onClick={() => { setConvertedVocalUrl(vocalUrl); setCurrentStep(4) }}
                  style={{ padding: '0.85rem 1rem', background: '#333', fontSize: '0.85rem' }}
                  title="Orijinal vokali olduğu gibi kullan">
                  ⏭ Atla
                </button>
              </div>
            </div>
          )}

          {/* ─── STEP 4: Instrumental ─── */}
          {currentStep === 4 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>🎸 Adım 4: Enstrümantal / Altyapı</h3>
              <p style={{ color: '#888', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                Ayrılmış müziği kullanın, yeni bir altyapı üretin veya kendi dosyanızı yükleyin
              </p>

              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {([
                  { id: 'separated' as const, label: '🎧 Ayrılmış Enstrümantal', enabled: !!instrumentalUrl },
                  { id: 'generate' as const, label: '🎵 Yeni Üret', enabled: true },
                  { id: 'upload' as const, label: '📂 Kendi Dosyam', enabled: true },
                ]).map(s => (
                  <button key={s.id} className="btn"
                    onClick={() => { if (s.enabled) setInstrumentalSource(s.id) }}
                    disabled={!s.enabled}
                    style={{
                      background: instrumentalSource === s.id ? '#f59e0b20' : '#1a1a2e',
                      border: instrumentalSource === s.id ? '1.5px solid #f59e0b' : '1px solid #333',
                      padding: '0.4rem 0.8rem', fontSize: '0.85rem',
                      opacity: s.enabled ? 1 : 0.4,
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>

              {instrumentalSource === 'separated' && instrumentalUrl && (
                <PreviewPlayer url={instrumentalUrl} label="Ayrılmış Enstrümantal" />
              )}

              {instrumentalSource === 'generate' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.8rem', display: 'block', marginBottom: '0.3rem' }}>Tür</label>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {GENRES.map(g => (
                        <button key={g.id} className="btn" onClick={() => setGenGenre(g.id)}
                          style={{
                            padding: '0.3rem 0.6rem', fontSize: '0.75rem',
                            background: genGenre === g.id ? '#f59e0b25' : '#1a1a2e',
                            border: genGenre === g.id ? '1px solid #f59e0b' : '1px solid #333',
                          }}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.8rem' }}>BPM: {genBpm}</label>
                    <input type="range" min={60} max={180} value={genBpm} onChange={e => setGenBpm(+e.target.value)}
                      style={{ width: '100%', accentColor: '#f59e0b' }} />
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.8rem' }}>Anahtar</label>
                    <select value={genKey} onChange={e => setGenKey(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', background: '#0d0d1a', border: '1px solid #333', borderRadius: '6px', color: '#fff' }}>
                      {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k =>
                        <option key={k} value={k}>{k}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={{ color: '#aaa', fontSize: '0.8rem' }}>Süre: {genDuration}s</label>
                    <input type="range" min={10} max={120} value={genDuration} onChange={e => setGenDuration(+e.target.value)}
                      style={{ width: '100%', accentColor: '#f59e0b' }} />
                  </div>
                </div>
              )}

              {instrumentalSource === 'upload' && (
                <div>
                  <input type="file" accept="audio/*" id="wf-inst"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setCustomInstFile(f) }}
                    style={{ display: 'none' }} />
                  <label htmlFor="wf-inst" className="btn"
                    style={{ background: '#1a1a2e', border: '1px solid #333', cursor: 'pointer', padding: '0.5rem 1rem' }}>
                    📂 Enstrümantal Dosya Seç
                  </label>
                  {customInstFile && <span style={{ color: '#aaa', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{customInstFile.name}</span>}
                </div>
              )}

              {finalInstrumentalUrl && stepDone(4) && (
                <PreviewPlayer url={finalInstrumentalUrl} label="Final Enstrümantal" />
              )}

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button className="btn" onClick={handleStep4} disabled={loading}
                  style={{
                    flex: 1, padding: '0.85rem',
                    background: '#f59e0b', fontSize: '1rem', fontWeight: 600, color: '#000',
                  }}>
                  🎸 {instrumentalSource === 'generate' ? 'Üret' : 'Onayla'} → Sonraki Adım
                </button>
                {instrumentalSource !== 'separated' && (
                  <button className="btn" onClick={() => navigate('/studio')}
                    style={{ padding: '0.85rem 1rem', background: '#333', fontSize: '0.85rem' }}>
                    🎹 DAW Studio
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ─── STEP 5: Mix & Master ─── */}
          {currentStep === 5 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>🎚 Adım 5: Mix & Master</h3>
              <p style={{ color: '#888', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                Vokal ve enstrümantalı profesyonel şekilde birleştirin ve master edin
              </p>

              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {convertedVocalUrl && <PreviewPlayer url={convertedVocalUrl} label="Vokal" />}
                {finalInstrumentalUrl && <PreviewPlayer url={finalInstrumentalUrl} label="Enstrümantal" />}
              </div>

              {/* Volume sliders */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ color: '#aaa', fontSize: '0.8rem' }}>🎤 Vokal: {Math.round(vocalVol * 100)}%</label>
                  <input type="range" min={0} max={1.5} step={0.05} value={vocalVol}
                    onChange={e => setVocalVol(+e.target.value)}
                    style={{ width: '100%', accentColor: '#ec4899' }} />
                </div>
                <div>
                  <label style={{ color: '#aaa', fontSize: '0.8rem' }}>🎸 Enstrümantal: {Math.round(instVol * 100)}%</label>
                  <input type="range" min={0} max={1.5} step={0.05} value={instVol}
                    onChange={e => setInstVol(+e.target.value)}
                    style={{ width: '100%', accentColor: '#f59e0b' }} />
                </div>
              </div>

              {/* Master presets */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ color: '#aaa', fontSize: '0.85rem', display: 'block', marginBottom: '0.4rem' }}>Master Preset</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.4rem' }}>
                  {MASTER_PRESETS.map(p => (
                    <button key={p.id} className="btn" onClick={() => setMasterPreset(p.id)}
                      style={{
                        padding: '0.5rem 0.6rem', fontSize: '0.8rem', textAlign: 'left',
                        background: masterPreset === p.id ? '#6366f120' : '#1a1a2e',
                        border: masterPreset === p.id ? '1.5px solid #6366f1' : '1px solid #333',
                      }}>
                      <div>{p.label}</div>
                      <div style={{ color: '#666', fontSize: '0.7rem' }}>{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {masteredUrl && <PreviewPlayer url={masteredUrl} label="🎧 Mastered Output" />}

              <button className="btn" onClick={handleStep5} disabled={loading}
                style={{
                  width: '100%', padding: '0.85rem', marginTop: '0.5rem',
                  background: '#6366f1', fontSize: '1rem', fontWeight: 600,
                }}>
                🎚 Master & Finalize → Sonraki Adım
              </button>
            </div>
          )}

          {/* ─── STEP 6: Export ─── */}
          {currentStep === 6 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>📤 Adım 6: Dışa Aktar</h3>
              <p style={{ color: '#888', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                Final şarkınız hazır! İndirin veya editörlerde daha fazla düzenleyin.
              </p>

              {masteredUrl && (
                <div style={{ margin: '1.5rem 0', textAlign: 'center' }}>
                  <div style={{
                    display: 'inline-block', padding: '2rem 3rem',
                    background: 'linear-gradient(135deg, #10b98115, #6366f115)',
                    borderRadius: '16px', border: '1px solid #10b98140',
                  }}>
                    <span style={{ fontSize: '3rem' }}>🎵</span>
                    <p style={{ color: '#10b981', fontWeight: 700, fontSize: '1.1rem', margin: '0.5rem 0 0.25rem' }}>
                      Şarkı Hazır!
                    </p>
                    <p style={{ color: '#888', fontSize: '0.85rem' }}>{exportFilename}</p>
                  </div>
                </div>
              )}

              {masteredUrl && <PreviewPlayer url={masteredUrl} label="Final Master" />}

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn" onClick={handleExport}
                  style={{ padding: '0.85rem 2rem', background: '#10b981', fontSize: '1rem', fontWeight: 700 }}>
                  📥 WAV İndir
                </button>
                {masteredUrl && (
                  <button className="btn"
                    onClick={() => navigate('/vokal-editor', { state: { audioUrl: masteredUrl, filename: exportFilename } })}
                    style={{ padding: '0.85rem 1.5rem', background: '#6366f1', fontSize: '0.9rem' }}>
                    🎛️ Vokal Editörde Aç
                  </button>
                )}
                <button className="btn" onClick={() => {
                  setCurrentStep(1); setSourceAudioUrl(null); setStems([])
                  setVocalUrl(null); setInstrumentalUrl(null); setConvertedVocalUrl(null)
                  setFinalInstrumentalUrl(null); setMasteredUrl(null)
                }}
                  style={{ padding: '0.85rem 1.5rem', background: '#333', fontSize: '0.9rem' }}>
                  🔄 Yeni Proje Başlat
                </button>
              </div>

              {/* Summary */}
              <div style={{
                marginTop: '2rem', padding: '1.25rem', background: '#0d0d1a', borderRadius: '10px',
                border: '1px solid #1e1e36',
              }}>
                <h4 style={{ color: '#aaa', marginBottom: '0.75rem', fontSize: '0.9rem' }}>📋 İşlem Özeti</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div style={{ color: '#666' }}>📥 Kaynak: <span style={{ color: '#aaa' }}>{sourceFilename}</span></div>
                  <div style={{ color: '#666' }}>🎧 Model: <span style={{ color: '#aaa' }}>{demucsModel}</span></div>
                  <div style={{ color: '#666' }}>🎤 Ses: <span style={{ color: '#aaa' }}>{
                    voiceSource === 'profile' ? profiles.find(p => p.id === selectedProfileId)?.name || selectedProfileId :
                    voiceSource === 'model' ? trainedModels.find(m => m.id === selectedModelId)?.name || selectedModelId :
                    voiceFile?.name || 'Orijinal'
                  }</span></div>
                  <div style={{ color: '#666' }}>🎸 Altyapı: <span style={{ color: '#aaa' }}>{
                    instrumentalSource === 'separated' ? 'Ayrılmış' :
                    instrumentalSource === 'generate' ? `Üretilmiş (${genGenre}, ${genBpm}BPM)` :
                    customInstFile?.name || 'Özel'
                  }</span></div>
                  <div style={{ color: '#666' }}>🎚 Master: <span style={{ color: '#aaa' }}>{MASTER_PRESETS.find(p => p.id === masterPreset)?.label}</span></div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
