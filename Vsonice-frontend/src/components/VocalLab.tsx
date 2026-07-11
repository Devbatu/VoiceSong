import { useState, useRef, useCallback } from 'react'

const API_BASE = 'http://localhost:8000'

interface StepInfo {
  order: number
  label: string
  desc: string
  url: string
  param?: string
  value?: number | string
}

interface LabResult {
  lab_id: string
  text: string
  perf_tag: string | null
  params: Record<string, number | string>
  steps: Record<string, StepInfo>
  performance_tags: string[]
}

interface RefAnalysis {
  ref_id: string
  duration: number
  analysis: {
    pitch: { median_hz: number; range_st: number; estimated_key: string }
    vibrato: { detected: boolean; avg_rate_hz: number; avg_depth_cents: number }
    tempo: { estimated_bpm: number }
    energy: { avg_level: number; dynamic_range: number }
  }
  suggested_params: {
    key: string; bpm: number; intensity: number; snap: number;
    vibrato_depth: number; vibrato_rate: number | null
  }
  url: string
}

const EQ_PROFILES = ['bright', 'warm', 'airy', 'full', 'vintage']

const PERF_TAGS = [
  { id: 'soft', label: 'Soft — Yumuşak', color: '#74b9ff' },
  { id: 'belting', label: 'Belting — Güçlü', color: '#e17055' },
  { id: 'whisper', label: 'Whisper — Fısıltı', color: '#81ecec' },
  { id: 'rap', label: 'Rap', color: '#fdcb6e' },
  { id: 'falsetto', label: 'Falsetto — İnce Ses', color: '#a29bfe' },
  { id: 'spoken', label: 'Spoken — Konuşma', color: '#636e72' },
  { id: 'powerful', label: 'Powerful — Kuvvetli', color: '#d63031' },
  { id: 'emotional', label: 'Emotional — Duygusal', color: '#fd79a8' },
  { id: 'crescendo', label: 'Crescendo — Yükseliş', color: '#ffeaa7' },
  { id: 'adlib', label: 'Ad-lib — Doğaçlama', color: '#00cec9' },
]

const MARKUP_TAGS = [
  { tag: '[yumuşak]', label: 'Yumuşak', color: '#74b9ff' },
  { tag: '[duygulu]', label: 'Duygulu', color: '#fd79a8' },
  { tag: '[belting]', label: 'Belting', color: '#e17055' },
  { tag: '[fısıltı]', label: 'Fısıltı', color: '#81ecec' },
  { tag: '[nefes]', label: 'Nefes', color: '#95afc0' },
  { tag: '[güçlü]', label: 'Güçlü', color: '#d63031' },
  { tag: '[titreme]', label: 'Vibrato', color: '#ffeaa7' },
  { tag: '(uzun)', label: 'Uzun', color: '#a29bfe' },
  { tag: '(kısa)', label: 'Kısa', color: '#636e72' },
  { tag: '|', label: '| Ayraç', color: '#555' },
]

const STEP_COLORS: Record<string, string> = {
  raw_tts: '#636e72',
  bpm_aligned: '#e84393',
  pitch_snap: '#6c5ce7',
  tonality: '#00b894',
  sustain: '#e17055',
  vibrato: '#fdcb6e',
  world_singing: '#0984e3',
  neural_vocoder: '#00b4d8',
  eq: '#00cec9',
  compression: '#d63031',
  exciter: '#ff9f43',
  deesser: '#a29bfe',
  reverb: '#fd79a8',
  final_master: '#2ecc71',
}

export default function VocalLab() {
  const [text, setText] = useState('Gözlerinde kayboldum bu gece')
  const [key, setKey] = useState('C')
  const [bpm, setBpm] = useState(120)
  const [language, setLanguage] = useState('tr')
  const [intensity, setIntensity] = useState(0.7)
  const [perfTag, setPerfTag] = useState<string | null>(null)

  // Individual overrides (null = use default)
  const [snap, setSnap] = useState<number | null>(null)
  const [tonality, setTonality] = useState<number | null>(null)
  const [vibratoDepth, setVibratoDepth] = useState<number | null>(null)
  const [vibratoRate, setVibratoRate] = useState<number | null>(null)
  const [sustain, setSustain] = useState<number | null>(null)
  const [reverbAmount, setReverbAmount] = useState<number | null>(null)
  const [eqProfile, setEqProfile] = useState<string | null>(null)
  const [compression, setCompression] = useState<number | null>(null)
  const [vocoderType, setVocoderType] = useState<string>('auto')

  // V22: Reference audio & markup
  const [refAnalysis, setRefAnalysis] = useState<RefAnalysis | null>(null)
  const [refUploading, setRefUploading] = useState(false)
  const [showMarkupHelp, setShowMarkupHelp] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<LabResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playingStep, setPlayingStep] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareA, setCompareA] = useState<string | null>(null)
  const [compareB, setCompareB] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)

  // V22: Reference audio upload
  const handleRefUpload = useCallback(async (file: File) => {
    setRefUploading(true)
    try {
      const form = new FormData()
      form.append('audio_file', file)
      const resp = await fetch(`${API_BASE}/api/vocal-lab/analyze-reference`, {
        method: 'POST', body: form,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Referans analiz hatası')
      }
      const data: RefAnalysis = await resp.json()
      setRefAnalysis(data)
      // Auto-apply suggested params
      if (data.suggested_params) {
        setKey(data.suggested_params.key)
        setBpm(data.suggested_params.bpm)
        setIntensity(data.suggested_params.intensity)
        setSnap(data.suggested_params.snap)
        if (data.suggested_params.vibrato_depth)
          setVibratoDepth(data.suggested_params.vibrato_depth)
        if (data.suggested_params.vibrato_rate)
          setVibratoRate(data.suggested_params.vibrato_rate)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Referans yükleme hatası')
    } finally {
      setRefUploading(false)
    }
  }, [])

  // V22: Insert markup tag at cursor position
  const insertMarkupTag = useCallback((tag: string) => {
    const ta = textareaRef.current
    if (!ta) { setText(prev => prev + ' ' + tag + ' '); return }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const before = text.substring(0, start)
    const after = text.substring(end)
    // Başta boşluk yoksa ekle (bitişik yazılmasını engelle)
    const prefix = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : ''
    const newText = before + prefix + tag + ' ' + after
    setText(newText)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + prefix.length + tag.length + 1
      ta.setSelectionRange(pos, pos)
    })
  }, [text])

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const body: Record<string, unknown> = {
        text: text.trim(), key, bpm, language, intensity,
      }
      if (perfTag) body.perf_tag = perfTag
      if (snap !== null) body.snap = snap
      if (tonality !== null) body.tonality = tonality
      if (vibratoDepth !== null) body.vibrato_depth = vibratoDepth
      if (vibratoRate !== null) body.vibrato_rate = vibratoRate
      if (sustain !== null) body.sustain = sustain
      if (reverbAmount !== null) body.reverb_amount = reverbAmount
      if (eqProfile !== null) body.eq_profile = eqProfile
      if (compression !== null) body.compression = compression
      body.vocoder_type = vocoderType
      if (refAnalysis) body.ref_id = refAnalysis.ref_id

      const resp = await fetch(`${API_BASE}/api/vocal-lab/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'İstek başarısız')
      }
      const data: LabResult = await resp.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata')
    } finally {
      setLoading(false)
    }
  }, [text, key, bpm, language, intensity, perfTag, snap, tonality, vibratoDepth, vibratoRate, sustain, reverbAmount, eqProfile, compression, vocoderType, refAnalysis])

  const playStep = (stepKey: string, url: string) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = `${API_BASE}${url}`
      audioRef.current.play()
      setPlayingStep(stepKey)
    }
  }

  const sortedSteps = result
    ? Object.entries(result.steps).sort(([, a], [, b]) => a.order - b.order)
    : []

  const resetOverrides = () => {
    setSnap(null); setTonality(null); setVibratoDepth(null); setVibratoRate(null)
    setSustain(null); setReverbAmount(null); setEqProfile(null); setCompression(null)
  }

  const sliderRow = (
    label: string, value: number | null, setter: (v: number | null) => void,
    min: number, max: number, step: number, unit: string = '', defaultHint: string = ''
  ) => (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
        <label style={{ fontSize: '0.85rem', color: '#ccc' }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.8rem', color: value !== null ? '#a29bfe' : '#666', fontWeight: value !== null ? 600 : 400 }}>
            {value !== null ? `${value}${unit}` : `auto (${defaultHint})`}
          </span>
          {value !== null && (
            <button onClick={() => setter(null)}
              style={{ background: 'none', border: 'none', color: '#e17055', cursor: 'pointer', fontSize: '0.7rem', padding: '0 4px' }}
            >✕</button>
          )}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step}
        value={value ?? (min + max) / 2}
        onChange={(e) => setter(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: value !== null ? '#6c5ce7' : '#444' }}
      />
    </div>
  )

  return (
    <div className="component-container" style={{ maxWidth: 1100 }}>
      {/* HEADER */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.6rem', marginBottom: '0.3rem' }}>🔬 Vocal Lab — Ses İşleme Test Tezgahı</h2>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>
          Her pipeline adımını ayrı ayrı dinleyin. Parametreleri ayarlayın. Suno AI kalitesini yakalayın.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.25rem', alignItems: 'start' }}>
        {/* LEFT PANEL — Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Test Phrase + Markup Editor */}
          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <h3 style={panelTitle}>📝 Vokal Markup Editörü</h3>
              <button onClick={() => setShowMarkupHelp(!showMarkupHelp)}
                style={{ background: 'none', border: '1px solid #444', color: '#999', borderRadius: 6,
                  padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}>
                {showMarkupHelp ? '✕ Kapat' : '❓ Markup Yardım'}
              </button>
            </div>

            {/* Markup Help Panel */}
            {showMarkupHelp && (
              <div style={{
                background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)',
                borderRadius: 8, padding: '0.65rem', marginBottom: '0.5rem', fontSize: '0.78rem', color: '#ccc',
              }}>
                <p style={{ fontWeight: 600, color: '#a29bfe', marginBottom: '0.3rem' }}>Vokal Markup Sistemi</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.15rem 0.8rem' }}>
                  <span><code style={{ color: '#ffeaa7' }}>[yumuşak]</code> Yumuşak ton</span>
                  <span><code style={{ color: '#ffeaa7' }}>[duygulu]</code> Duygusal</span>
                  <span><code style={{ color: '#ffeaa7' }}>[belting]</code> Güçlü ses</span>
                  <span><code style={{ color: '#ffeaa7' }}>[fısıltı]</code> Fısıltı</span>
                  <span><code style={{ color: '#ffeaa7' }}>[nefes]</code> Nefes sesi</span>
                  <span><code style={{ color: '#ffeaa7' }}>[titreme]</code> Vibrato</span>
                  <span><code style={{ color: '#ffeaa7' }}>aaa</code> Uzatma (3x)</span>
                  <span><code style={{ color: '#ffeaa7' }}>(uzun)</code> Yavaş timing</span>
                  <span><code style={{ color: '#ffeaa7' }}>|</code> Segment ayracı</span>
                  <span><code style={{ color: '#ffeaa7' }}>(kısa)</code> Hızlı timing</span>
                </div>
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: '#888' }}>
                  Örnek: <code style={{ color: '#81ecec' }}>[yumuşak] aaşk be-ni yaaaktıı (uzun) | [nefes] | [belting] YANDI!</code>
                </p>
              </div>
            )}

            {/* Quick Insert Tags */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '0.4rem' }}>
              {MARKUP_TAGS.map(m => (
                <button key={m.tag} onClick={() => insertMarkupTag(m.tag)}
                  style={{
                    background: `${m.color}15`, color: m.color, border: `1px solid ${m.color}30`,
                    borderRadius: 10, padding: '1px 7px', fontSize: '0.7rem', cursor: 'pointer',
                  }}>{m.label}</button>
              ))}
            </div>

            <textarea ref={textareaRef} value={text} onChange={e => setText(e.target.value)}
              placeholder="[yumuşak] Gözlerinde kayboldum bu gece (uzun)&#10;[nefes]&#10;[belting] Seni seviyorum!"
              style={{
                width: '100%', minHeight: 80, resize: 'vertical',
                background: '#0d0d1a', border: '1px solid #333', borderRadius: 6,
                padding: '0.6rem', color: '#e0e0e0', fontSize: '0.9rem',
                fontFamily: 'monospace',
              }}
            />
            {/* Markup indicator */}
            {(text.includes('[') || text.includes('|') || /([aeıioöuü])\1{2}/i.test(text)) && (
              <div style={{ fontSize: '0.72rem', color: '#a29bfe', marginTop: '0.2rem' }}>
                ✨ Markup algılandı — Segment bazlı işlenecek
              </div>
            )}
          </div>

          {/* Reference Audio Upload */}
          <div style={panelStyle}>
            <h3 style={panelTitle}>🎧 Referans Ses (Stil Eşleme)</h3>
            <p style={{ fontSize: '0.73rem', color: '#666', marginBottom: '0.5rem' }}>
              Bir örnek şarkı/vokal yükleyin — AI pitch, vibrato ve tempo stilini analiz eder ve otomatik uygular.
            </p>
            <div
              onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
              onDrop={e => {
                e.preventDefault(); e.stopPropagation()
                const file = e.dataTransfer.files[0]
                if (file) handleRefUpload(file)
              }}
              style={{
                border: '2px dashed #333', borderRadius: 8, padding: '0.8rem', textAlign: 'center',
                cursor: 'pointer', transition: 'border-color 0.2s',
                background: refAnalysis ? 'rgba(46,204,113,0.05)' : 'transparent',
                borderColor: refAnalysis ? '#2ecc71' : '#333',
              }}
              onClick={() => {
                if (refUploading) return
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'audio/*'
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (file) handleRefUpload(file)
                }
                input.click()
              }}
            >
              {refUploading ? (
                <span style={{ color: '#a29bfe' }}>⏳ Analiz ediliyor...</span>
              ) : refAnalysis ? (
                <div style={{ fontSize: '0.8rem' }}>
                  <span style={{ color: '#2ecc71', fontWeight: 600 }}>✓ Referans yüklendi</span>
                  <span style={{ color: '#888', marginLeft: '0.5rem' }}>({refAnalysis.duration}s)</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem', justifyContent: 'center' }}>
                    <span style={refBadge}>Key: {refAnalysis.analysis.pitch.estimated_key}</span>
                    <span style={refBadge}>BPM: {refAnalysis.analysis.tempo.estimated_bpm}</span>
                    <span style={refBadge}>Pitch: {refAnalysis.analysis.pitch.median_hz}Hz</span>
                    {refAnalysis.analysis.vibrato.detected && (
                      <span style={refBadge}>Vibrato: {refAnalysis.analysis.vibrato.avg_depth_cents}cent@{refAnalysis.analysis.vibrato.avg_rate_hz}Hz</span>
                    )}
                    <span style={refBadge}>Range: {refAnalysis.analysis.pitch.range_st}st</span>
                  </div>
                  <button onClick={(e) => {
                    e.stopPropagation()
                    setRefAnalysis(null)
                    // Ref'ten gelen override'ları da sıfırla
                    setSnap(null); setVibratoDepth(null); setVibratoRate(null)
                  }}
                    style={{ background: 'none', border: 'none', color: '#e17055', fontSize: '0.72rem', cursor: 'pointer', marginTop: '0.3rem' }}>
                    ✕ Referansı Kaldır
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>📂 Ses dosyası sürükleyin veya tıklayın</p>
                  <p style={{ color: '#555', fontSize: '0.7rem', margin: '0.2rem 0 0' }}>MP3, WAV, OGG — max 60 saniye</p>
                </div>
              )}
            </div>
          </div>

          {/* Key + BPM */}
          <div style={panelStyle}>
            <h3 style={panelTitle}>🎵 Müzik Ayarları</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#888' }}>Key</label>
                <select value={key} onChange={e => setKey(e.target.value)} style={{ width: '100%' }}>
                  {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#888' }}>BPM</label>
                <input type="number" min={60} max={200} value={bpm} onChange={e => setBpm(+e.target.value)}
                  style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#888' }}>Dil</label>
                <select value={language} onChange={e => setLanguage(e.target.value)} style={{ width: '100%' }}>
                  <option value="tr">TR</option>
                  <option value="tr-female">TR(K)</option>
                  <option value="en">EN</option>
                  <option value="en-female">EN(K)</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#ccc' }}>
                Intensity: <strong style={{ color: '#a29bfe' }}>{Math.round(intensity * 100)}%</strong>
              </label>
              <input type="range" min={0} max={1} step={0.05} value={intensity}
                onChange={e => setIntensity(parseFloat(e.target.value))} style={{ width: '100%' }} />
            </div>
          </div>

          {/* Performance Tags */}
          <div style={panelStyle}>
            <h3 style={panelTitle}>🎤 Performans Etiketi (Suno-style)</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              <button onClick={() => setPerfTag(null)}
                style={{
                  background: !perfTag ? '#6c5ce7' : 'rgba(255,255,255,0.05)',
                  color: !perfTag ? '#fff' : '#999', border: 'none', borderRadius: 14,
                  padding: '3px 10px', fontSize: '0.78rem', cursor: 'pointer',
                }}>Yok (Default)</button>
              {PERF_TAGS.map(t => (
                <button key={t.id} onClick={() => setPerfTag(perfTag === t.id ? null : t.id)}
                  style={{
                    background: perfTag === t.id ? t.color + '40' : 'rgba(255,255,255,0.05)',
                    color: perfTag === t.id ? t.color : '#999',
                    border: perfTag === t.id ? `1px solid ${t.color}` : '1px solid transparent',
                    borderRadius: 14, padding: '3px 10px', fontSize: '0.78rem', cursor: 'pointer',
                  }}
                >{t.label}</button>
              ))}
            </div>
          </div>

          {/* Parameter Overrides */}
          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={panelTitle}>🎛️ Parametre Override</h3>
              <button onClick={resetOverrides}
                style={{ background: 'none', border: 'none', color: '#e17055', fontSize: '0.75rem', cursor: 'pointer' }}>
                Sıfırla
              </button>
            </div>
            <p style={{ fontSize: '0.73rem', color: '#666', marginBottom: '0.5rem' }}>
              null = default kullanılır. Değer ayarla = override.
            </p>
            {sliderRow('Snap (Pitch → Nota)', snap, setSnap, 0, 1, 0.05, '', 'default')}
            {sliderRow('Tonality (Tonal/Nefesli)', tonality, setTonality, 0, 1, 0.05, '', 'default')}
            {sliderRow('Vibrato Depth (×çarpan)', vibratoDepth, setVibratoDepth, 0, 3, 0.1, '×', '1.0×')}
            {sliderRow('Vibrato Rate', vibratoRate, setVibratoRate, 3, 8, 0.1, 'Hz', 'default')}
            {sliderRow('Sustain (×çarpan)', sustain, setSustain, 0.5, 2.5, 0.1, '×', '1.0×')}
            {sliderRow('Reverb Amount', reverbAmount, setReverbAmount, 0, 0.25, 0.01, '', 'default')}
            {sliderRow('Compression', compression, setCompression, 0, 1, 0.05, '', 'default')}
            <div style={{ marginBottom: '0.6rem' }}>
              <label style={{ fontSize: '0.85rem', color: '#ccc', marginBottom: '0.2rem', display: 'block' }}>EQ Profile</label>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button onClick={() => setEqProfile(null)}
                  style={{
                    background: eqProfile === null ? '#6c5ce7' : 'rgba(255,255,255,0.05)',
                    color: eqProfile === null ? '#fff' : '#999',
                    border: 'none', borderRadius: 10, padding: '2px 8px', fontSize: '0.75rem', cursor: 'pointer',
                  }}>auto</button>
                {EQ_PROFILES.map(p => (
                  <button key={p} onClick={() => setEqProfile(p)}
                    style={{
                      background: eqProfile === p ? '#6c5ce7' : 'rgba(255,255,255,0.05)',
                      color: eqProfile === p ? '#fff' : '#999',
                      border: 'none', borderRadius: 10, padding: '2px 8px', fontSize: '0.75rem', cursor: 'pointer',
                    }}>{p}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Vocoder Selection */}
          <div style={panelStyle}>
            <h3 style={panelTitle}>🧠 Vocoder (Sentezleyici)</h3>
            <p style={{ fontSize: '0.73rem', color: '#666', marginBottom: '0.5rem' }}>
              Neural vocoder WORLD çıkışını Vocos AI ile yeniden sentezler. Daha gür ve net ses.
            </p>
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              {[
                { id: 'auto', label: 'Auto', desc: 'Neural varsa kullan' },
                { id: 'neural', label: 'Neural (Vocos)', desc: 'AI vocoder' },
                { id: 'world', label: 'WORLD', desc: 'Klasik vocoder' },
              ].map(v => (
                <button key={v.id} onClick={() => setVocoderType(v.id)}
                  style={{
                    background: vocoderType === v.id
                      ? (v.id === 'neural' ? 'linear-gradient(135deg, #00b4d8 0%, #0077b6 100%)' : '#6c5ce7')
                      : 'rgba(255,255,255,0.05)',
                    color: vocoderType === v.id ? '#fff' : '#999',
                    border: vocoderType === v.id ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent',
                    borderRadius: 10, padding: '4px 12px', fontSize: '0.78rem', cursor: 'pointer',
                    fontWeight: vocoderType === v.id ? 600 : 400,
                  }}
                >{v.label}</button>
              ))}
            </div>
          </div>

          {/* Generate */}
          <button onClick={handleGenerate} disabled={loading || text.trim().length < 2}
            style={{
              width: '100%', padding: '0.9rem', fontWeight: 600, fontSize: '1rem',
              background: loading ? '#2a2a3e' : 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)',
              border: 'none', borderRadius: 10, color: '#fff', cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? '⏳ İşleniyor...' : '🔬 Test Et — Tüm Adımları Üret'}
          </button>
        </div>

        {/* RIGHT PANEL — Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && (
            <div style={{ background: 'rgba(231,76,60,0.15)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 8, padding: '0.75rem', color: '#e74c3c' }}>
              {error}
            </div>
          )}

          {!result && !loading && (
            <div style={{ ...panelStyle, textAlign: 'center', padding: '3rem', color: '#555' }}>
              <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔬</p>
              <p style={{ fontSize: '1rem' }}>Bir test cümlesi girin ve &quot;Test Et&quot; butonuna basın</p>
              <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                Her pipeline adımı ayrı ses dosyası olarak üretilecek.<br />
                Adımları tek tek dinleyerek hangi parametrenin ne yaptığını anlayabilirsiniz.
              </p>
            </div>
          )}

          {loading && (
            <div style={{ ...panelStyle, textAlign: 'center', padding: '3rem' }}>
              <div style={{
                width: 40, height: 40, border: '3px solid #333', borderTop: '3px solid #6c5ce7',
                borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem',
              }} />
              <p style={{ color: '#aaa' }}>TTS → WORLD Analysis → Singing → Mastering...</p>
              <p style={{ color: '#666', fontSize: '0.8rem' }}>11 ara çıktı üretiliyor</p>
            </div>
          )}

          {result && (
            <>
              {/* Summary */}
              <div style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={panelTitle}>📊 Kullanılan Parametreler</h3>
                  <button onClick={() => setCompareMode(!compareMode)}
                    style={{
                      background: compareMode ? '#6c5ce7' : 'rgba(255,255,255,0.05)',
                      color: compareMode ? '#fff' : '#999',
                      border: 'none', borderRadius: 8, padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer',
                    }}
                  >{compareMode ? '✕ Karşılaştırma Kapat' : '🔀 A/B Karşılaştır'}</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {Object.entries(result.params).map(([k, v]) => (
                    <span key={k} style={{
                      background: 'rgba(108,92,231,0.1)', border: '1px solid rgba(108,92,231,0.2)',
                      borderRadius: 8, padding: '2px 8px', fontSize: '0.75rem', color: '#a29bfe',
                    }}>
                      {k}: <strong>{typeof v === 'number' ? (v as number).toFixed(2) : v}</strong>
                    </span>
                  ))}
                  {result.perf_tag && (
                    <span style={{
                      background: 'rgba(253,121,168,0.15)', border: '1px solid rgba(253,121,168,0.3)',
                      borderRadius: 8, padding: '2px 8px', fontSize: '0.75rem', color: '#fd79a8',
                    }}>
                      perf: <strong>[{result.perf_tag}]</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Compare Panel */}
              {compareMode && (
                <div style={{ ...panelStyle, background: 'linear-gradient(135deg, #1a1a2e 0%, #1e2a40 100%)' }}>
                  <h3 style={panelTitle}>🔀 A/B Karşılaştırma</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#74b9ff', marginBottom: '0.3rem', display: 'block' }}>A Adımı</label>
                      <select value={compareA || ''} onChange={e => setCompareA(e.target.value || null)}
                        style={{ width: '100%' }}>
                        <option value="">Seçin...</option>
                        {sortedSteps.map(([k, s]) => (
                          <option key={k} value={k}>{s.order}. {s.label}</option>
                        ))}
                      </select>
                      {compareA && result.steps[compareA] && (
                        <button onClick={() => playStep(compareA!, result.steps[compareA].url)}
                          style={{ ...playBtn, background: '#0984e3', marginTop: '0.4rem', width: '100%' }}>
                          ▶ A Dinle
                        </button>
                      )}
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#e17055', marginBottom: '0.3rem', display: 'block' }}>B Adımı</label>
                      <select value={compareB || ''} onChange={e => setCompareB(e.target.value || null)}
                        style={{ width: '100%' }}>
                        <option value="">Seçin...</option>
                        {sortedSteps.map(([k, s]) => (
                          <option key={k} value={k}>{s.order}. {s.label}</option>
                        ))}
                      </select>
                      {compareB && result.steps[compareB] && (
                        <button onClick={() => playStep(compareB!, result.steps[compareB].url)}
                          style={{ ...playBtn, background: '#e17055', marginTop: '0.4rem', width: '100%' }}>
                          ▶ B Dinle
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Pipeline Steps */}
              <div style={panelStyle}>
                <h3 style={panelTitle}>🎚️ Pipeline Adımları — Her Birini Dinleyin</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {sortedSteps.map(([stepKey, step]) => {
                    const isPlaying = playingStep === stepKey
                    const color = STEP_COLORS[stepKey] || '#999'
                    return (
                      <div key={stepKey}
                        style={{
                          background: isPlaying ? `${color}15` : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isPlaying ? color : '#2a2a3a'}`,
                          borderRadius: 8, padding: '0.65rem 0.85rem',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <button onClick={() => playStep(stepKey, step.url)}
                            style={{
                              background: color, color: '#fff', border: 'none', borderRadius: '50%',
                              width: 32, height: 32, fontSize: '0.85rem', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >{isPlaying ? '⏸' : '▶'}</button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{
                                background: `${color}30`, color, borderRadius: 4,
                                padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600,
                              }}>{step.order}</span>
                              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#e0e0e0' }}>{step.label}</span>
                            </div>
                            <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: '#888', lineHeight: 1.3 }}>
                              {step.desc}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Audio element */}
              <audio ref={audioRef} controls
                onEnded={() => setPlayingStep(null)}
                style={{ width: '100%', borderRadius: 8 }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  borderRadius: 12, padding: '1rem',
  border: '1px solid #2a2a4a',
}

const panelTitle: React.CSSProperties = {
  fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.6rem 0',
}

const playBtn: React.CSSProperties = {
  color: '#fff', border: 'none', borderRadius: 6,
  padding: '0.4rem 0', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600,
}

const refBadge: React.CSSProperties = {
  background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.2)',
  borderRadius: 6, padding: '1px 6px', fontSize: '0.7rem', color: '#2ecc71',
}
