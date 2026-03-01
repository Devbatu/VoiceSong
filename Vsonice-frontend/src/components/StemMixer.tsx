
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'

const API_BASE = 'http://localhost:8000'

// ---- Custom Audio Player Component ----
export interface StemPlayerHandle {
  play: () => void
  pause: () => void
  seekTo: (time: number) => void
  getAudio: () => HTMLAudioElement | null
}

const StemPlayer = forwardRef<StemPlayerHandle, {
  src: string
  volume: number
  onEnded?: () => void
}>(({ src, volume, onEnded }, ref) => {
  const audioRef = useRef<HTMLAudioElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [waveformBars, setWaveformBars] = useState<number[]>([])
  const animRef = useRef<number>(0)

  // Expose controls to parent
  useImperativeHandle(ref, () => ({
    play: () => { audioRef.current?.play(); setIsPlaying(true) },
    pause: () => { audioRef.current?.pause(); setIsPlaying(false) },
    seekTo: (time: number) => { if (audioRef.current) { audioRef.current.currentTime = time; setCurrentTime(time) } },
    getAudio: () => audioRef.current,
  }))

  // Generate pseudo-waveform bars on mount
  useEffect(() => {
    const bars: number[] = []
    for (let i = 0; i < 80; i++) {
      bars.push(0.15 + Math.random() * 0.85)
    }
    // Smooth the bars
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < bars.length - 1; i++) {
        bars[i] = bars[i] * 0.5 + (bars[i - 1] + bars[i + 1]) * 0.25
      }
    }
    setWaveformBars(bars)
  }, [src])

  // Sync volume prop
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  // Animation loop for smooth time updates
  const updateTime = useCallback(() => {
    if (audioRef.current && !isDragging) {
      setCurrentTime(audioRef.current.currentTime)
    }
    animRef.current = requestAnimationFrame(updateTime)
  }, [isDragging])

  useEffect(() => {
    animRef.current = requestAnimationFrame(updateTime)
    return () => cancelAnimationFrame(animRef.current)
  }, [updateTime])

  const formatTime = (t: number) => {
    if (!isFinite(t) || t < 0) return '0:00'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !progressRef.current || !duration) return
    const rect = progressRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const pct = x / rect.width
    audioRef.current.currentTime = pct * duration
    setCurrentTime(pct * duration)
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true)
    seekTo(e)
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: MouseEvent) => {
      if (!audioRef.current || !progressRef.current || !duration) return
      const rect = progressRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
      const pct = x / rect.width
      audioRef.current.currentTime = pct * duration
      setCurrentTime(pct * duration)
    }
    const handleUp = () => setIsDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, duration])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div style={{ marginBottom: '1rem' }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration)
        }}
        onEnded={() => { setIsPlaying(false); onEnded?.() }}
      />

      {/* Player controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <button
          onClick={togglePlay}
          style={{
            width: '36px', height: '36px', borderRadius: '50%',
            border: 'none', cursor: 'pointer', fontSize: '1rem',
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '36px', textAlign: 'center', fontFamily: 'monospace' }}>
          {formatTime(currentTime)}
        </span>

        {/* Waveform seek bar */}
        <div
          ref={progressRef}
          onMouseDown={handleMouseDown}
          style={{
            flex: 1, height: '40px', position: 'relative', cursor: 'pointer',
            borderRadius: '6px', overflow: 'hidden',
            background: 'rgba(99, 102, 241, 0.06)',
            userSelect: 'none',
          }}
        >
          {/* Waveform bars */}
          <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', gap: '1px', padding: '4px 2px' }}>
            {waveformBars.map((h, i) => {
              const barPct = (i / waveformBars.length) * 100
              const isPlayed = barPct <= progress
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: `${h * 100}%`,
                    minWidth: '2px',
                    borderRadius: '1px',
                    background: isPlayed
                      ? 'linear-gradient(180deg, #a855f7, #6366f1)'
                      : 'rgba(148, 163, 184, 0.25)',
                    transition: 'background 0.1s',
                  }}
                />
              )
            })}
          </div>

          {/* Playhead */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${progress}%`,
            width: '2px', background: '#fff',
            boxShadow: '0 0 6px rgba(168, 85, 247, 0.8)',
            transition: isDragging ? 'none' : 'left 0.1s linear',
            pointerEvents: 'none',
          }} />
        </div>

        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '36px', textAlign: 'center', fontFamily: 'monospace' }}>
          {formatTime(duration)}
        </span>
      </div>
    </div>
  )
})
// ---- End Custom Audio Player ----

interface Stem {
  name: string
  label: string
  url: string
  volume: number
  muted: boolean
  solo: boolean
}

// Stem icon mapping
const STEM_ICONS: Record<string, string> = {
  vocals: '',
  drums: '',
  bass: '',
  other: '',
  music: '',
  piano: '',
  guitar: '',
}

// AI Effect types
type AIEffectType = 'autotune' | 'reverb' | 'pitch_shift' | 'tempo_change' | 'noise_reduction' | 'eq_preset' | 'harmonizer' | 'vocal_enhance'

interface AIEffect {
  type: AIEffectType
  label: string
  icon: string
  description: string
  params: Record<string, any>
}

const AI_EFFECTS: AIEffect[] = [
  { type: 'autotune', label: 'AutoTune', icon: '', description: 'Vokal pitch düzeltme - profesyonel ses ayarı', params: { key: 'C', speed: 5 } },
  { type: 'pitch_shift', label: 'Pitch Shift', icon: '', description: 'Ses tonunu yarım ton yukarı/aşağı kaydır', params: { semitones: 0 } },
  { type: 'tempo_change', label: 'Tempo Değiştir', icon: '', description: 'Hızlandır veya yavaşlat (kalite korunarak)', params: { factor: 1.0 } },
  { type: 'reverb', label: 'AI Reverb', icon: '', description: 'Yapay alan hissi (oda, salon, kilise)', params: { room_size: 0.5, damping: 0.5, wet: 0.3 } },
  { type: 'noise_reduction', label: 'Gürültü Temizle', icon: '', description: 'AI ile arka plan gürültüsünü kaldır', params: { strength: 0.7 } },
  { type: 'eq_preset', label: 'EQ Preset', icon: '', description: 'Hazır EQ profilleri (Pop, Rock, Jazz, R&B)', params: { preset: 'pop' } },
  { type: 'harmonizer', label: 'Harmonizer', icon: '', description: 'Otomatik harmoni sesi ekle', params: { interval: 3, mix: 0.4 } },
  { type: 'vocal_enhance', label: 'Vokal Boost', icon: '', description: 'Vokal netliği ve sıcaklığını artır', params: { warmth: 0.5, presence: 0.5, air: 0.3 } },
]

const AUTOTUNE_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const EQ_PRESETS = [
  { value: 'pop', label: 'Pop' },
  { value: 'rock', label: 'Rock' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'rnb', label: 'R&B' },
  { value: 'electronic', label: 'Electronic' },
  { value: 'vocal_clarity', label: 'Vokal Netlik' },
  { value: 'bass_boost', label: 'Bass Boost' },
  { value: 'warm', label: 'Sıcak Ton' },
]

export default function StemMixer() {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [stems, setStems] = useState<Stem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [selectedStems, setSelectedStems] = useState<string[]>([])
  const [showGuide, setShowGuide] = useState(false)
  const [activeEffect, setActiveEffect] = useState<AIEffectType | null>(null)
  const [effectTarget, setEffectTarget] = useState<string | null>(null)
  const [effectProcessing, setEffectProcessing] = useState(false)
  const [effectParams, setEffectParams] = useState<Record<string, any>>({})
  const audioRefs = useRef<{ [key: string]: StemPlayerHandle | null }>({})
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup progress timer
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [])

  // Handle file upload and trigger backend separation
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setAudioFile(file)
      setLoading(true)
      setError(null)
      setSuccess(null)
      setStems([])
      setSelectedStems([])

      // Animated progress
      setLoadingProgress(0)
      setLoadingMessage('Dosya yükleniyor...')
      const progressStages = [
        { at: 5, msg: 'Dosya yükleniyor...' },
        { at: 15, msg: 'Demucs AI modeli hazırlanıyor...' },
        { at: 25, msg: 'Müzik analiz ediliyor...' },
        { at: 40, msg: 'Frekans spektrumu ayrıştırılıyor...' },
        { at: 55, msg: 'Vokal izolasyonu yapılıyor...' },
        { at: 70, msg: 'Davul & bas ayrıştırılıyor...' },
        { at: 85, msg: 'Enstrümanlar tespit ediliyor...' },
        { at: 92, msg: 'Stems dosyaları oluşturuluyor...' },
      ]
      let stageIdx = 0
      progressTimerRef.current = setInterval(() => {
        setLoadingProgress(prev => {
          const next = prev + 0.5
          if (stageIdx < progressStages.length && next >= progressStages[stageIdx].at) {
            setLoadingMessage(progressStages[stageIdx].msg)
            stageIdx++
          }
          return Math.min(next, 95)
        })
      }, 2000)

      try {
        const formData = new FormData()
        formData.append('file', file)

        // 30 minute timeout for Demucs AI (shifts=3 on CPU can take 15+ min for long songs)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 1800000)

        const response = await fetch(`${API_BASE}/api/separate_multi`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          const errData = await response.json().catch(() => null)
          throw new Error(errData?.detail || 'Ayrıştırma başarısız oldu')
        }
        const data = await response.json()

        // Fix stem URLs - prepend API_BASE
        const fixedStems = data.stems.map((s: any) => ({
          ...s,
          url: s.url.startsWith('http') ? s.url : `${API_BASE}${s.url}`,
          volume: 1,
          muted: false,
          solo: false,
        }))

        setStems(fixedStems)
        setSelectedStems(data.stems.map((s: any) => s.name))
        setLoadingProgress(100)
        setLoadingMessage('Tamamlandı!')
        setSuccess(`${data.stems.length} stem başarıyla ayrıştırıldı!`)
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setError('İşlem zaman aşımına uğradı (30 dakika). Daha kısa bir şarkı deneyin.')
        } else {
          setError(err.message || 'Ayrıştırma sırasında hata oluştu')
        }
      }
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      setLoading(false)
    }
  }

  // Solo/mute/volume logic
  const toggleMute = (name: string) => {
    setStems(stems => stems.map(s => s.name === name ? { ...s, muted: !s.muted } : s))
  }
  const toggleSolo = (name: string) => {
    setStems(stems => stems.map(s => s.name === name ? { ...s, solo: !s.solo } : { ...s, solo: false }))
  }
  const updateVolume = (name: string, volume: number) => {
    setStems(stems => stems.map(s => s.name === name ? { ...s, volume } : s))
    // Apply volume to audio element via handle
    const handle = audioRefs.current[name]
    if (handle) {
      const audio = handle.getAudio()
      if (audio) audio.volume = volume
    }
  }

  // Select stems for export
  const toggleSelectStem = (name: string) => {
    setSelectedStems(sel => sel.includes(name) ? sel.filter(n => n !== name) : [...sel, name])
  }

  // Export selected stems as a new mix
  const exportMix = async () => {
    if (selectedStems.length === 0) return
    setLoading(true)
    setLoadingMessage('Mix dosyası oluşturuluyor...')
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/export_mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stems: selectedStems })
      })
      if (!response.ok) throw new Error('Mix dışa aktarma başarısız')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mix_${selectedStems.join('_')}.wav`
      a.click()
      window.URL.revokeObjectURL(url)
      setSuccess('Mix başarıyla indirildi!')
    } catch (err: any) {
      setError(err.message || 'Export hatası')
    }
    setLoading(false)
    setLoadingMessage('')
  }

  // Play/pause all stems (synchronously)
  const handlePlay = () => {
    if (playing) {
      Object.values(audioRefs.current).forEach(handle => handle?.pause())
      setPlaying(false)
    } else {
      const hasSolo = stems.some(s => s.solo)
      Object.entries(audioRefs.current).forEach(([name, handle]) => {
        if (handle) {
          const stem = stems.find(s => s.name === name)
          const audio = handle.getAudio()
          if (stem && audio) {
            audio.volume = stem.muted ? 0 : (hasSolo && !stem.solo ? 0 : stem.volume)
          }
          handle.seekTo(0)
          handle.play()
        }
      })
      setPlaying(true)
    }
  }

  // Apply AI effect to a stem
  const applyEffect = async (stemName: string, effectType: AIEffectType, params: Record<string, any>) => {
    setEffectProcessing(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`${API_BASE}/api/audio_effect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stem_name: stemName,
          effect_type: effectType,
          params: params
        })
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(errData?.detail || 'Efekt uygulanamadı')
      }
      const data = await response.json()

      // Update stem URL with processed version
      setStems(prev => prev.map(s =>
        s.name === stemName
          ? { ...s, url: `${API_BASE}${data.url}?t=${Date.now()}` }
          : s
      ))
      setSuccess(`${AI_EFFECTS.find(e => e.type === effectType)?.label} başarıyla uygulandı!`)
      setActiveEffect(null)
      setEffectTarget(null)
    } catch (err: any) {
      setError(err.message || 'Efekt hatası')
    }
    setEffectProcessing(false)
  }

  // Open effect panel for a stem
  const openEffectPanel = (stemName: string, effect: AIEffectType) => {
    setEffectTarget(stemName)
    setActiveEffect(effect)
    const defaultParams = AI_EFFECTS.find(e => e.type === effect)?.params || {}
    setEffectParams({ ...defaultParams })
  }

  return (
    <div className="component-container">
      <h2>Stem Mixer - AI Müzik Ayrıştırma & Efektler</h2>
      <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
        Müzik dosyasını yükleyin → AI ile stem'lere ayırın → AutoTune, Reverb, Pitch Shift gibi AI efektleri uygulayın → İndirin
      </p>

      {/* Quick Guide Toggle */}
      <button
        className="btn btn-secondary"
        style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}
        onClick={() => setShowGuide(!showGuide)}
      >
        {showGuide ? 'Kapat' : 'Nasıl Kullanılır?'}
      </button>

      {/* Guide Section */}
      {showGuide && (
        <div className="card" style={{ padding: '2rem', marginBottom: '2rem', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.08))', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1.3rem' }}>Nasıl Kullanılır? - Adım Adım Rehber</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem', marginBottom: '1.5rem' }}>
            <div style={{ padding: '1.2rem', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>1</div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>1. Dosya Yükle</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                MP3, WAV, FLAC veya diğer ses formatlarından birini yükleyin. Demucs AI modeli dosyanızı analiz edecek.
              </p>
            </div>
            <div style={{ padding: '1.2rem', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>2</div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>2. AI Ayrıştırma</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                AI, şarkıyı vokal, davul, bas ve enstrümantallere ayırır. Bu işlem 2-5 dakika sürebilir.
              </p>
            </div>
            <div style={{ padding: '1.2rem', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>3</div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>3. Dinle & Düzenle</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                Her stem'i ayrı ayrı dinleyin. Solo/Mute ile kontrol edin. Volume ayarlayın.
              </p>
            </div>
            <div style={{ padding: '1.2rem', borderRadius: '12px', background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>4</div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>4. AI Efektler</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                AutoTune, Reverb, Pitch Shift, Tempo Değiştir gibi AI efektleri uygulayın.
              </p>
            </div>
            <div style={{ padding: '1.2rem', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>5</div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary)' }}>5. İndir</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                İstediğiniz stem'leri seçin ve yeni bir mix olarak WAV formatında indirin.
              </p>
            </div>
          </div>

          <div style={{ padding: '1rem', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.06)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <strong>İpuçları:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.2rem', lineHeight: '1.8' }}>
              <li>Yüksek kaliteli dosyalar (WAV, FLAC) daha iyi sonuç verir</li>
              <li>İlk ayrıştırma daha uzun sürer (model yükleniyor), sonrakiler daha hızlıdır</li>
              <li>AutoTune en iyi vokal stem'inde çalışır</li>
              <li>Tempo değişikliği tüm stem'lere ayrı ayrı uygulanmalıdır</li>
              <li>Reverb eklemeden önce gürültü temizlemeyi deneyin</li>
              <li>Daha detaylı düzenleme için <strong>Studio</strong> sekmesini kullanın</li>
            </ul>
          </div>
        </div>
      )}

      {/* File Upload */}
      <div
        className="card"
        style={{ padding: '2rem', marginBottom: '2rem', textAlign: 'center', border: '2px dashed rgba(99, 102, 241, 0.3)', borderRadius: '16px', cursor: loading ? 'not-allowed' : 'pointer' }}
        onClick={() => {
          if (!loading) {
            const input = document.getElementById('stem-file-input') as HTMLInputElement
            input?.click()
          }
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>+</div>
        <input
          type="file"
          accept="audio/*"
          onChange={handleFileUpload}
          disabled={loading}
          id="stem-file-input"
          style={{ display: 'none' }}
        />
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          {audioFile ? `${audioFile.name}` : 'Müzik dosyası yüklemek için tıklayın'}
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          MP3, WAV, FLAC, OGG, M4A desteklenir
        </div>
      </div>

      {/* Loading Progress */}
      {loading && (
        <div className="card" style={{ padding: '2rem', marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>{loadingMessage}</div>
          <div style={{ background: 'rgba(99, 102, 241, 0.1)', borderRadius: '10px', height: '12px', overflow: 'hidden', marginBottom: '0.5rem' }}>
            <div style={{
              width: `${loadingProgress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #6366f1, #a855f7)',
              borderRadius: '10px',
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>%{Math.round(loadingProgress)} tamamlandı</div>
        </div>
      )}

      {/* Error / Success Messages */}
      {error && (
        <div style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}>
          {error}
        </div>
      )}
      {success && !loading && (
        <div style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', borderRadius: '10px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#22c55e' }}>
          {success}
        </div>
      )}

      {/* Stems List */}
      {stems.length > 0 && (
        <div>
          {/* Controls Bar */}
          <div className="card" style={{ padding: '1.2rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={handlePlay} style={{ fontSize: '1rem' }}>
              {playing ? 'Duraklat' : 'Tümünü Çal'}
            </button>
            <button className="btn btn-secondary" onClick={exportMix} disabled={loading || selectedStems.length === 0}>
              Seçili Stemleri İndir ({selectedStems.length})
            </button>
            <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {stems.length} stem ayrıştırıldı
            </span>
          </div>

          {/* AI Effects Toolbar */}
          <div className="card" style={{ padding: '1.2rem 1.5rem', marginBottom: '1.5rem', background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(99, 102, 241, 0.05))' }}>
            <h4 style={{ marginBottom: '1rem', fontSize: '1rem' }}>AI Efektler - Stem'e uygula</h4>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {AI_EFFECTS.map(effect => (
                <button
                  key={effect.type}
                  className={`btn ${activeEffect === effect.type ? '' : 'btn-secondary'}`}
                  style={{ fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}
                  title={effect.description}
                  onClick={() => {
                    if (activeEffect === effect.type) {
                      setActiveEffect(null)
                      setEffectTarget(null)
                    } else {
                      setActiveEffect(effect.type)
                      setEffectTarget(null)
                      setEffectParams({ ...effect.params })
                    }
                  }}
                >
                  {effect.icon} {effect.label}
                </button>
              ))}
            </div>
            {activeEffect && !effectTarget && (
              <div style={{ marginTop: '1rem', padding: '0.8rem', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.08)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Efekti uygulamak istediğiniz stem'deki <strong>"Efekt Uygula"</strong> butonuna tıklayın
              </div>
            )}
          </div>

          {/* Stem Cards */}
          <div className="grid grid-2" style={{ gap: '1rem' }}>
            {stems.map(stem => (
              <div key={stem.name} className="card" style={{ padding: '1.5rem', position: 'relative', border: effectTarget === stem.name ? '2px solid #a855f7' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.2rem' }}>
                    {STEM_ICONS[stem.name] || ''} {stem.label}
                  </h3>
                  <label style={{ fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <input type="checkbox" checked={selectedStems.includes(stem.name)} onChange={() => toggleSelectStem(stem.name)} />
                    <span>Seç</span>
                  </label>
                </div>

                <StemPlayer
                  ref={el => { audioRefs.current[stem.name] = el }}
                  src={stem.url}
                  volume={stem.volume}
                  onEnded={() => setPlaying(false)}
                />

                <div style={{ marginBottom: '1rem' }}>
                  <label className="input-label" style={{ fontSize: '0.85rem' }}>
                    Volume: {Math.round(stem.volume * 100)}%
                  </label>
                  <input
                    type="range" min="0" max="1" step="0.01"
                    value={stem.volume}
                    onChange={e => updateVolume(stem.name, parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                  <button
                    className={`btn ${stem.muted ? '' : 'btn-secondary'}`}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.7rem' }}
                    onClick={() => toggleMute(stem.name)}
                  >
                    {stem.muted ? 'Muted' : 'Active'}
                  </button>
                  <button
                    className={`btn ${stem.solo ? '' : 'btn-secondary'}`}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.7rem' }}
                    onClick={() => toggleSolo(stem.name)}
                  >
                    {stem.solo ? 'Solo' : 'Solo'}
                  </button>
                  {activeEffect && (
                    <button
                      className="btn"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.7rem', background: 'linear-gradient(135deg, #a855f7, #6366f1)' }}
                      onClick={() => openEffectPanel(stem.name, activeEffect)}
                    >
                      Efekt Uygula
                    </button>
                  )}
                </div>

                {/* Effect parameter panel - shown when this stem is targeted */}
                {effectTarget === stem.name && activeEffect && (
                  <div style={{ padding: '1rem', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.2)', marginTop: '0.5rem' }}>
                    <h4 style={{ marginBottom: '0.8rem', fontSize: '0.95rem' }}>
                      {AI_EFFECTS.find(e => e.type === activeEffect)?.icon} {AI_EFFECTS.find(e => e.type === activeEffect)?.label} Ayarları
                    </h4>

                    {/* AutoTune params */}
                    {activeEffect === 'autotune' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Anahtar (Key):</label>
                          <select
                            value={effectParams.key || 'C'}
                            onChange={e => setEffectParams(p => ({ ...p, key: e.target.value }))}
                            style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.1)' }}
                          >
                            {AUTOTUNE_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Düzeltme Hızı: {effectParams.speed || 5}</label>
                          <input type="range" min="1" max="10" step="1" value={effectParams.speed || 5} onChange={e => setEffectParams(p => ({ ...p, speed: parseInt(e.target.value) }))} style={{ width: '100%' }} />
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            <span>Yavaş (Doğal)</span>
                            <span>Hızlı (T-Pain efekti)</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Pitch Shift params */}
                    {activeEffect === 'pitch_shift' && (
                      <div>
                        <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Yarım Ton: {effectParams.semitones > 0 ? '+' : ''}{effectParams.semitones || 0}</label>
                        <input type="range" min="-12" max="12" step="1" value={effectParams.semitones || 0} onChange={e => setEffectParams(p => ({ ...p, semitones: parseInt(e.target.value) }))} style={{ width: '100%' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span>-12 (1 oktav aşağı)</span>
                          <span>0</span>
                          <span>+12 (1 oktav yukarı)</span>
                        </div>
                      </div>
                    )}

                    {/* Tempo Change params */}
                    {activeEffect === 'tempo_change' && (
                      <div>
                        <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Tempo: {Math.round((effectParams.factor || 1.0) * 100)}%</label>
                        <input type="range" min="0.5" max="2.0" step="0.05" value={effectParams.factor || 1.0} onChange={e => setEffectParams(p => ({ ...p, factor: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span>0.5x (Yavaş)</span>
                          <span>1x (Normal)</span>
                          <span>2x (Hızlı)</span>
                        </div>
                      </div>
                    )}

                    {/* Reverb params */}
                    {activeEffect === 'reverb' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Oda Boyutu: {Math.round((effectParams.room_size || 0.5) * 100)}%</label>
                          <input type="range" min="0.1" max="1.0" step="0.05" value={effectParams.room_size || 0.5} onChange={e => setEffectParams(p => ({ ...p, room_size: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Wet/Dry Mix: {Math.round((effectParams.wet || 0.3) * 100)}%</label>
                          <input type="range" min="0" max="1.0" step="0.05" value={effectParams.wet || 0.3} onChange={e => setEffectParams(p => ({ ...p, wet: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                        </div>
                      </div>
                    )}

                    {/* Noise Reduction params */}
                    {activeEffect === 'noise_reduction' && (
                      <div>
                        <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Gürültü Azaltma Gücü: {Math.round((effectParams.strength || 0.7) * 100)}%</label>
                        <input type="range" min="0.1" max="1.0" step="0.05" value={effectParams.strength || 0.7} onChange={e => setEffectParams(p => ({ ...p, strength: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                      </div>
                    )}

                    {/* EQ Preset params */}
                    {activeEffect === 'eq_preset' && (
                      <div>
                        <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>EQ Profili:</label>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {EQ_PRESETS.map(p => (
                            <button
                              key={p.value}
                              className={`btn ${effectParams.preset === p.value ? '' : 'btn-secondary'}`}
                              style={{ fontSize: '0.8rem', padding: '0.4rem 0.7rem' }}
                              onClick={() => setEffectParams(prev => ({ ...prev, preset: p.value }))}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Harmonizer params */}
                    {activeEffect === 'harmonizer' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Harmoni Aralığı: {effectParams.interval || 3} yarım ton</label>
                          <input type="range" min="1" max="12" step="1" value={effectParams.interval || 3} onChange={e => setEffectParams(p => ({ ...p, interval: parseInt(e.target.value) }))} style={{ width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Mix: {Math.round((effectParams.mix || 0.4) * 100)}%</label>
                          <input type="range" min="0.1" max="0.8" step="0.05" value={effectParams.mix || 0.4} onChange={e => setEffectParams(p => ({ ...p, mix: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                        </div>
                      </div>
                    )}

                    {/* Vocal Enhance params */}
                    {activeEffect === 'vocal_enhance' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Sıcaklık: {Math.round((effectParams.warmth || 0.5) * 100)}%</label>
                          <input type="range" min="0" max="1" step="0.05" value={effectParams.warmth || 0.5} onChange={e => setEffectParams(p => ({ ...p, warmth: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Presence: {Math.round((effectParams.presence || 0.5) * 100)}%</label>
                          <input type="range" min="0" max="1" step="0.05" value={effectParams.presence || 0.5} onChange={e => setEffectParams(p => ({ ...p, presence: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Air: {Math.round((effectParams.air || 0.3) * 100)}%</label>
                          <input type="range" min="0" max="1" step="0.05" value={effectParams.air || 0.3} onChange={e => setEffectParams(p => ({ ...p, air: parseFloat(e.target.value) }))} style={{ width: '100%' }} />
                        </div>
                      </div>
                    )}

                    {/* Apply / Cancel buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                      <button
                        className="btn"
                        disabled={effectProcessing}
                        style={{ flex: 1 }}
                        onClick={() => applyEffect(stem.name, activeEffect, effectParams)}
                      >
                        {effectProcessing ? 'İşleniyor...' : 'Uygula'}
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => { setEffectTarget(null); setActiveEffect(null) }}
                        style={{ flex: 1 }}
                      >
                        İptal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && stems.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>&bull;</div>
          <p style={{ fontSize: '1.1rem' }}>Müzik dosyası yükleyerek başlayın</p>
          <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>AI, şarkınızı vokal, davul, bas ve enstrümantallere ayıracak</p>
        </div>
      )}
    </div>
  )
}
