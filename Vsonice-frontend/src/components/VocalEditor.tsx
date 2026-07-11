import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const API_BASE = 'http://localhost:8000'
const REGION_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']

/* ========== HIZLI PRESET'LER ========== */
const PRESETS: { id: string; label: string; desc: string; fx: Partial<ReturnType<typeof mkDefaults>> }[] = [
  { id: 'clean', label: '🎤 Temiz', desc: 'Gürültü + de-esser + kompresör', fx: { noiseReduction: 0.4, deEsser: 0.3, compEnabled: true, compThreshold: -18, compRatio: 3 } },
  { id: 'warm', label: '🌡️ Sıcak', desc: 'Sıcaklık + bas + reverb', fx: { warmth: 0.4, eqBass: 2, reverbMix: 0.08, reverbDecay: 1.2 } },
  { id: 'radio', label: '📻 Radyo', desc: 'Presence + kompresyon', fx: { compEnabled: true, compThreshold: -14, compRatio: 5, eqTreble: 3, eqMid: 1, deEsser: 0.35 } },
  { id: 'wide', label: '🏛️ Geniş', desc: 'Reverb + mekan', fx: { reverbMix: 0.3, reverbDecay: 2.5, eqTreble: 1.5 } },
  { id: 'power', label: '💪 Güçlü', desc: 'Yüksek + bas + kompresör', fx: { volume: 5, compEnabled: true, compThreshold: -12, compRatio: 6, eqBass: 3 } },
  { id: 'bright', label: '✨ Parlak', desc: 'Tiz + netlik', fx: { eqTreble: 4, eqMid: -1, deEsser: 0.3, compEnabled: true, compThreshold: -18, compRatio: 3 } },
]

interface Region {
  id: string
  startTime: number
  endTime: number
  name: string
  color: string
}

const mkDefaults = () => ({
  volume: 0, fadeIn: 0, fadeOut: 0,
  eqBass: 0, eqMid: 0, eqTreble: 0,
  reverbMix: 0, reverbDecay: 1.5,
  compEnabled: false, compThreshold: -18, compRatio: 4,
  pitchShift: 0, deEsser: 0, warmth: 0, noiseReduction: 0,
})
type FxValues = ReturnType<typeof mkDefaults>

function fmt(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`
}

/* ---------- Slider sub-component ---------- */
function Slider({ label, value, min, max, step, unit, onChange, color }: {
  label: string; value: number; min: number; max: number; step: number; unit: string
  onChange: (v: number) => void; color?: string
}) {
  const isNonZero = value !== 0 && value !== min
  return (
    <div style={{ marginBottom: '0.55rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#aaa', marginBottom: '0.15rem' }}>
        <span>{label}</span>
        <span style={{ color: isNonZero ? (color || '#a29bfe') : '#555', fontFamily: 'monospace', fontWeight: isNonZero ? 600 : 400 }}>
          {value > 0 && min < 0 ? '+' : ''}{typeof value === 'number' ? (Number.isInteger(step) ? value : value.toFixed(step < 0.1 ? 2 : 1)) : value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color || '#6c5ce7' }} />
    </div>
  )
}

export default function VocalEditor() {
  const location = useLocation()
  const navigate = useNavigate()
  const { audioUrl: navUrl, filename: navFilename } = (location.state || {}) as { audioUrl?: string; filename?: string }

  // Session
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [historySize, setHistorySize] = useState(0)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState(navFilename || '')

  // Audio playback
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playTime, setPlayTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef(0)

  // Waveform
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [zoom, setZoom] = useState(1)
  const [scrollX, setScrollX] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Regions
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [regionCounter, setRegionCounter] = useState(1)

  // Drag state for region creation / resize
  const [dragSel, setDragSel] = useState<{ start: number; end: number } | null>(null)
  const dragRef = useRef<{
    mode: 'none' | 'create' | 'resize-left' | 'resize-right'
    regionId: string
    startTime: number
  }>({ mode: 'none', regionId: '', startTime: 0 })

  // Effects
  const [fx, setFx] = useState<FxValues>(mkDefaults())

  // Loop & Auto-Apply
  const [loopMode, setLoopMode] = useState(false)
  const [autoApply, setAutoApply] = useState(true)
  const applyingRef = useRef(false)
  const skipAutoRef = useRef(false)

  const selectedRegion = regions.find(r => r.id === selectedId) || null

  const hasChanges = () => {
    const d = mkDefaults()
    return (
      fx.volume !== d.volume || fx.fadeIn !== d.fadeIn || fx.fadeOut !== d.fadeOut ||
      fx.eqBass !== d.eqBass || fx.eqMid !== d.eqMid || fx.eqTreble !== d.eqTreble ||
      fx.reverbMix !== d.reverbMix || fx.compEnabled ||
      fx.pitchShift !== d.pitchShift || fx.deEsser !== d.deEsser ||
      fx.warmth !== d.warmth || fx.noiseReduction !== d.noiseReduction
    )
  }

  /* ========== INIT SESSION ========== */
  useEffect(() => {
    if (navUrl) initSession(navUrl)
  }, []) // eslint-disable-line

  async function initSession(downloadUrl: string) {
    setLoading(true)
    setError(null)
    try {
      const audioPath = downloadUrl.replace('/api/download/', '')
      const res = await fetch(`${API_BASE}/api/vocal-editor/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_path: audioPath }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Oturum başlatılamadı')
      }
      const data = await res.json()
      setSessionId(data.session_id)
      setDuration(data.duration)
      setHistorySize(0)
      await fetchAudio(data.session_id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ========== FETCH & DECODE AUDIO ========== */
  async function fetchAudio(sid: string) {
    const res = await fetch(`${API_BASE}/api/vocal-editor/audio/${encodeURIComponent(sid)}`)
    if (!res.ok) throw new Error('Audio yüklenemedi')
    const arrayBuf = await res.arrayBuffer()

    // Blob URL for <audio>
    const blob = new Blob([arrayBuf.slice(0)], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })

    // Decode for peaks
    const ctx = new AudioContext()
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0))
    const ch = decoded.getChannelData(0)
    const numPeaks = Math.min(4000, ch.length)
    const step = Math.max(1, Math.floor(ch.length / numPeaks))
    const p = new Float32Array(numPeaks)
    for (let i = 0; i < numPeaks; i++) {
      let mx = 0
      const end = Math.min((i + 1) * step, ch.length)
      for (let j = i * step; j < end; j++) {
        const a = Math.abs(ch[j])
        if (a > mx) mx = a
      }
      p[i] = mx
    }
    setPeaks(p)
    ctx.close()
  }

  /* ========== FILE UPLOAD (standalone) ========== */
  async function handleFileUpload(file: File) {
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/api/vocal-editor/upload`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Yükleme başarısız')
      }
      const data = await res.json()
      setSessionId(data.session_id)
      setDuration(data.duration)
      setHistorySize(0)
      setFilename(file.name)
      await fetchAudio(data.session_id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ========== PLAYBACK ========== */
  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) { audio.pause(); setIsPlaying(false) }
    else { audio.play(); setIsPlaying(true) }
  }
  const stopPlay = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setIsPlaying(false)
    setPlayTime(0)
  }

  // RAF for playhead during playback (with loop support)
  useEffect(() => {
    if (!isPlaying) return
    const tick = () => {
      const audio = audioRef.current
      if (audio) {
        // Loop mode: loop within selected region
        if (loopMode && selectedRegion && audio.currentTime >= selectedRegion.endTime) {
          audio.currentTime = selectedRegion.startTime
        }
        setPlayTime(audio.currentTime)
        if (audio.ended) {
          if (loopMode && selectedRegion) {
            audio.currentTime = selectedRegion.startTime
            audio.play()
          } else {
            setIsPlaying(false)
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, loopMode, selectedRegion])

  /* ========== CANVAS DRAWING ========== */
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const W = rect.width, H = rect.height, midY = H / 2
    const visDur = duration / zoom
    const startT = scrollX, endT = startT + visDur

    // Background
    ctx.fillStyle = '#0a0a16'
    ctx.fillRect(0, 0, W, H)

    // Center line
    ctx.strokeStyle = '#1e1e36'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke()

    // 25% / 75% dB lines
    ctx.strokeStyle = '#141428'
    ctx.setLineDash([4, 4])
    for (const y of [midY * 0.5, midY * 1.5]) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    ctx.setLineDash([])

    // Time grid
    const interval = visDur > 60 ? 10 : visDur > 20 ? 5 : visDur > 10 ? 2 : visDur > 5 ? 1 : 0.5
    ctx.fillStyle = '#444'
    ctx.font = '10px monospace'
    ctx.textAlign = 'left'
    for (let t = Math.ceil(startT / interval) * interval; t < endT; t += interval) {
      const x = ((t - startT) / visDur) * W
      ctx.strokeStyle = '#1a1a30'
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, H); ctx.stroke()
      ctx.fillText(fmt(t), x + 3, 12)
    }

    // Waveform
    const pc = peaks.length
    const si = Math.max(0, Math.floor((startT / duration) * pc))
    const ei = Math.min(pc, Math.ceil((endT / duration) * pc))
    const vis = peaks.subarray(si, ei)
    if (vis.length > 0) {
      const barW = W / vis.length
      const maxA = H * 0.42
      const grad = ctx.createLinearGradient(0, midY - maxA, 0, midY + maxA)
      grad.addColorStop(0, '#a29bfe')
      grad.addColorStop(0.35, '#6c5ce7')
      grad.addColorStop(0.65, '#6c5ce7')
      grad.addColorStop(1, '#a29bfe')
      ctx.fillStyle = grad
      for (let i = 0; i < vis.length; i++) {
        const h = vis[i] * maxA
        if (h < 0.5) continue
        ctx.fillRect(i * barW, midY - h, Math.max(1, barW - (barW > 3 ? 1 : 0)), h * 2)
      }
    }

    // Regions
    for (const r of regions) {
      if (r.endTime < startT || r.startTime > endT) continue
      const x1 = Math.max(0, ((r.startTime - startT) / visDur) * W)
      const x2 = Math.min(W, ((r.endTime - startT) / visDur) * W)
      const sel = r.id === selectedId
      ctx.fillStyle = sel ? `${r.color}30` : `${r.color}15`
      ctx.fillRect(x1, 16, x2 - x1, H - 16)
      ctx.strokeStyle = sel ? r.color : `${r.color}50`
      ctx.lineWidth = sel ? 2 : 1
      ctx.strokeRect(x1, 16, x2 - x1, H - 16)
      if (x2 - x1 > 50) {
        ctx.fillStyle = sel ? '#fff' : '#bbb'
        ctx.font = `${sel ? 'bold ' : ''}11px sans-serif`
        ctx.fillText(r.name, x1 + 5, 30)
        ctx.fillStyle = '#777'
        ctx.font = '9px monospace'
        ctx.fillText(`${fmt(r.startTime)} — ${fmt(r.endTime)}`, x1 + 5, 42)
      }
      if (sel) {
        ctx.fillStyle = r.color
        ctx.fillRect(x1 - 2, 16, 4, H - 16)
        ctx.fillRect(x2 - 2, 16, 4, H - 16)
      }
    }

    // Drag selection (new region being created)
    if (dragSel) {
      const dx1 = ((Math.min(dragSel.start, dragSel.end) - startT) / visDur) * W
      const dx2 = ((Math.max(dragSel.start, dragSel.end) - startT) / visDur) * W
      ctx.fillStyle = 'rgba(108, 92, 231, 0.15)'
      ctx.strokeStyle = 'rgba(108, 92, 231, 0.5)'
      ctx.lineWidth = 1
      ctx.fillRect(dx1, 16, dx2 - dx1, H - 16)
      ctx.strokeRect(dx1, 16, dx2 - dx1, H - 16)
    }

    // Playhead
    if (playTime >= startT && playTime <= endT) {
      const px = ((playTime - startT) / visDur) * W
      ctx.strokeStyle = '#00d2ff'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
      ctx.fillStyle = '#00d2ff'
      ctx.beginPath()
      ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8)
      ctx.fill()
    }
  }, [peaks, zoom, scrollX, duration, regions, selectedId, playTime, dragSel])

  useEffect(() => { drawCanvas() }, [drawCanvas])

  /* ========== MOUSE INTERACTIONS ========== */
  const timeFromX = (clientX: number): number => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    const visDur = duration / zoom
    return Math.max(0, Math.min(duration, scrollX + ((clientX - rect.left) / rect.width) * visDur))
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const t = timeFromX(e.clientX)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const visDur = duration / zoom

    // Check resize handles of selected region
    if (selectedId) {
      const sel = regions.find(r => r.id === selectedId)
      if (sel) {
        const lx = ((sel.startTime - scrollX) / visDur) * rect.width
        const rx = ((sel.endTime - scrollX) / visDur) * rect.width
        if (Math.abs(x - lx) < 8) {
          dragRef.current = { mode: 'resize-left', regionId: sel.id, startTime: sel.startTime }
          return
        }
        if (Math.abs(x - rx) < 8) {
          dragRef.current = { mode: 'resize-right', regionId: sel.id, startTime: sel.endTime }
          return
        }
      }
    }

    // Click on existing region → select
    const clicked = [...regions].reverse().find(r => t >= r.startTime && t <= r.endTime)
    if (clicked) {
      setSelectedId(clicked.id)
      setFx(mkDefaults())
      return
    }

    // Start creating new region
    setSelectedId(null)
    dragRef.current = { mode: 'create', regionId: '', startTime: t }
    setDragSel({ start: t, end: t })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (drag.mode === 'none') return
    const t = timeFromX(e.clientX)

    if (drag.mode === 'create') {
      setDragSel({ start: drag.startTime, end: t })
    } else if (drag.mode === 'resize-left') {
      setRegions(prev => prev.map(r =>
        r.id === drag.regionId ? { ...r, startTime: Math.max(0, Math.min(t, r.endTime - 0.05)) } : r
      ))
    } else if (drag.mode === 'resize-right') {
      setRegions(prev => prev.map(r =>
        r.id === drag.regionId ? { ...r, endTime: Math.min(duration, Math.max(t, r.startTime + 0.05)) } : r
      ))
    }
  }

  const handleMouseUp = () => {
    const drag = dragRef.current
    if (drag.mode === 'create' && dragSel) {
      const t1 = Math.min(dragSel.start, dragSel.end)
      const t2 = Math.max(dragSel.start, dragSel.end)
      if (t2 - t1 >= 0.1) {
        const color = REGION_COLORS[(regionCounter - 1) % REGION_COLORS.length]
        const nr: Region = { id: `r_${Date.now()}`, startTime: t1, endTime: t2, name: `Bölge ${regionCounter}`, color }
        setRegions(prev => [...prev, nr])
        setSelectedId(nr.id)
        setRegionCounter(c => c + 1)
        setFx(mkDefaults())
      } else {
        // Click → set playhead
        if (audioRef.current) {
          audioRef.current.currentTime = drag.startTime
          setPlayTime(drag.startTime)
        }
      }
      setDragSel(null)
    }
    dragRef.current = { mode: 'none', regionId: '', startTime: 0 }
  }

  // Wheel: Ctrl+wheel = zoom, wheel = scroll
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        setZoom(z => Math.max(1, Math.min(50, z * (e.deltaY > 0 ? 0.9 : 1.1))))
      } else {
        setScrollX(s => {
          const visDur = duration / zoom
          return Math.max(0, Math.min(Math.max(0, duration - visDur), s + (e.deltaY > 0 ? 1 : -1) * visDur * 0.1))
        })
      }
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [duration, zoom])

  const deleteRegion = (id: string) => {
    setRegions(prev => prev.filter(r => r.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  /* ========== APPLY EFFECTS ========== */
  const applyEffects = async () => {
    if (!sessionId) return
    let startTime = 0, endTime = -1
    if (selectedRegion) { startTime = selectedRegion.startTime; endTime = selectedRegion.endTime }

    const effects: Array<{ type: string; params: Record<string, number> }> = []
    if (fx.volume !== 0) effects.push({ type: 'volume', params: { gain_db: fx.volume } })
    if (fx.fadeIn > 0) effects.push({ type: 'fade_in', params: { duration: fx.fadeIn } })
    if (fx.fadeOut > 0) effects.push({ type: 'fade_out', params: { duration: fx.fadeOut } })
    if (fx.eqBass !== 0 || fx.eqMid !== 0 || fx.eqTreble !== 0) {
      effects.push({ type: 'eq', params: { bass: fx.eqBass, mid: fx.eqMid, treble: fx.eqTreble } })
    }
    if (fx.reverbMix > 0) effects.push({ type: 'reverb', params: { mix: fx.reverbMix, decay: fx.reverbDecay } })
    if (fx.compEnabled) effects.push({ type: 'compressor', params: { threshold: fx.compThreshold, ratio: fx.compRatio } })
    if (fx.pitchShift !== 0) effects.push({ type: 'pitch_shift', params: { semitones: fx.pitchShift } })
    if (fx.deEsser > 0) effects.push({ type: 'de_esser', params: { amount: fx.deEsser } })
    if (fx.warmth > 0) effects.push({ type: 'warmth', params: { amount: fx.warmth } })
    if (fx.noiseReduction > 0) effects.push({ type: 'noise_reduction', params: { strength: fx.noiseReduction } })

    if (effects.length === 0) return

    setApplying(true)
    applyingRef.current = true
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/vocal-editor/apply-effect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, start_time: startTime, end_time: endTime, effects, crossfade_ms: 30 }),
      })
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Efekt uygulanamadı') }
      const data = await res.json()
      setDuration(data.duration)
      setHistorySize(data.history_size)
      await fetchAudio(sessionId)
      skipAutoRef.current = true
      setFx(mkDefaults())
    } catch (e: any) { setError(e.message) }
    finally { setApplying(false); applyingRef.current = false }
  }

  /* ========== UNDO ========== */
  const handleUndo = async () => {
    if (!sessionId || historySize === 0) return
    setApplying(true)
    try {
      const res = await fetch(`${API_BASE}/api/vocal-editor/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!res.ok) throw new Error('Geri alınamadı')
      const data = await res.json()
      setDuration(data.duration)
      setHistorySize(data.history_size)
      await fetchAudio(sessionId)
    } catch (e: any) { setError(e.message) }
    finally { setApplying(false) }
  }

  /* ========== EXPORT ========== */
  const handleExport = async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/vocal-editor/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!res.ok) throw new Error('Dışa aktarılamadı')
      const data = await res.json()
      const link = document.createElement('a')
      link.href = `${API_BASE}${data.download_url}`
      link.download = data.filename
      link.click()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  /* ========== AUTO-APPLY DEBOUNCE ========== */
  useEffect(() => {
    if (!autoApply || !sessionId || applyingRef.current || skipAutoRef.current) {
      skipAutoRef.current = false
      return
    }
    const d = mkDefaults()
    const changed = fx.volume !== d.volume || fx.fadeIn !== d.fadeIn || fx.fadeOut !== d.fadeOut ||
      fx.eqBass !== d.eqBass || fx.eqMid !== d.eqMid || fx.eqTreble !== d.eqTreble ||
      fx.reverbMix !== d.reverbMix || fx.compEnabled ||
      fx.pitchShift !== d.pitchShift || fx.deEsser !== d.deEsser ||
      fx.warmth !== d.warmth || fx.noiseReduction !== d.noiseReduction
    if (!changed) return
    const timer = setTimeout(() => {
      if (!applyingRef.current) applyEffects()
    }, 800)
    return () => clearTimeout(timer)
  }, [fx, autoApply, sessionId]) // eslint-disable-line

  /* ========== PRESET UYGULA ========== */
  const applyPreset = (preset: typeof PRESETS[0]) => {
    const base = mkDefaults()
    setFx({ ...base, ...preset.fx })
  }

  /* ========== KEYBOARD SHORTCUTS ========== */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); handleUndo() }
      if (e.code === 'Delete' && selectedId) deleteRegion(selectedId)
      if (e.code === 'KeyL') setLoopMode(l => !l)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }) // intentionally no deps — always latest closures

  /* ========== RENDER ========== */
  return (
    <div className="component-container" style={{ maxWidth: '100%' }}>
      {/* Hidden audio element */}
      {blobUrl && <audio ref={audioRef} src={blobUrl} preload="auto" />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>🎛️ Vokal Editör</h2>
          {filename && <p style={{ color: '#888', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>{filename} · {fmt(duration)}</p>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {historySize > 0 && (
            <button className="btn" onClick={handleUndo} disabled={applying}
              style={{ background: '#555', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>
              ↩ Geri Al ({historySize})
            </button>
          )}
          {sessionId && (
            <button className="btn" onClick={handleExport} disabled={loading}
              style={{ background: '#10b981', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>
              📥 Dışa Aktar
            </button>
          )}
          <button className="btn" onClick={() => navigate(-1)}
            style={{ background: '#333', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>
            🔙 Geri
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="status-message error-message" style={{ marginBottom: '1rem' }}>
          <p>❌ {error}</p>
          <button className="btn" onClick={() => setError(null)} style={{ marginTop: '0.5rem', background: '#555', fontSize: '0.8rem' }}>Kapat</button>
        </div>
      )}

      {/* Loading */}
      {loading && !sessionId && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #6c5ce7', borderTop: '3px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
          <p style={{ color: '#888', marginTop: '1rem' }}>Ses yükleniyor...</p>
        </div>
      )}

      {/* No audio — upload or navigate */}
      {!loading && !sessionId && !navUrl && (
        <div
          style={{ textAlign: 'center', padding: '3rem', border: '2px dashed #333', borderRadius: '12px', cursor: 'pointer' }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f) }}
        >
          <p style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎵</p>
          <p style={{ fontSize: '1.1rem', marginBottom: '1rem', color: '#ccc' }}>Düzenlemek için ses dosyası sürükleyin veya seçin</p>
          <input type="file" accept="audio/*" id="ve-upload" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="ve-upload" className="btn" style={{ background: '#6c5ce7', cursor: 'pointer' }}>📂 Dosya Seç</label>
            <button className="btn" onClick={() => navigate('/metin-sarki')} style={{ background: '#333' }}>🎤 Metin → Şarkı ile Oluştur</button>
          </div>
        </div>
      )}

      {/* ========== EDITOR UI ========== */}
      {sessionId && peaks && (
        <>
          {/* Zoom controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#888', fontSize: '0.8rem' }}>🔍</span>
            <button className="btn" onClick={() => setZoom(z => Math.max(1, z / 1.3))}
              style={{ background: '#2a2a3e', padding: '0.2rem 0.5rem', fontSize: '0.8rem', border: '1px solid #444' }}>−</button>
            <input type="range" min="1" max="50" step="0.5" value={zoom}
              onChange={e => setZoom(parseFloat(e.target.value))}
              style={{ width: '160px', accentColor: '#6c5ce7' }} />
            <button className="btn" onClick={() => setZoom(z => Math.min(50, z * 1.3))}
              style={{ background: '#2a2a3e', padding: '0.2rem 0.5rem', fontSize: '0.8rem', border: '1px solid #444' }}>+</button>
            <span style={{ color: '#555', fontSize: '0.75rem', fontFamily: 'monospace' }}>{zoom.toFixed(1)}x</span>
            <div style={{ flex: 1 }} />
            <span style={{ color: '#555', fontSize: '0.75rem' }}>
              Sürükle: bölge oluştur · Ctrl+Scroll: yakınlaştır · Space: oynat
            </span>
          </div>

          {/* Waveform Canvas */}
          <div style={{
            position: 'relative', background: '#0a0a16',
            borderRadius: '8px', border: '1px solid #2a2a3e', overflow: 'hidden', marginBottom: '0.75rem',
          }}>
            <canvas ref={canvasRef}
              style={{ width: '100%', height: '200px', cursor: 'crosshair', display: 'block' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            {applying && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.6)', borderRadius: '8px',
              }}>
                <div style={{ color: '#a29bfe', fontWeight: 600 }}>⏳ İşleniyor...</div>
              </div>
            )}
          </div>

          {/* Scrollbar when zoomed */}
          {zoom > 1 && (
            <input type="range" min={0} max={Math.max(0, duration - duration / zoom)} step={0.01} value={scrollX}
              onChange={e => setScrollX(parseFloat(e.target.value))}
              style={{ width: '100%', marginBottom: '0.75rem', accentColor: '#444' }} />
          )}

          {/* Transport Controls */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            marginBottom: '1rem', padding: '0.6rem 0.75rem',
            background: '#12122a', borderRadius: '8px', border: '1px solid #2a2a3e', flexWrap: 'wrap',
          }}>
            <button className="btn" onClick={togglePlay}
              style={{ background: isPlaying ? '#ef4444' : '#10b981', padding: '0.45rem 1rem', fontSize: '0.9rem' }}>
              {isPlaying ? '⏸ Durdur' : '▶ Oynat'}
            </button>
            <button className="btn" onClick={stopPlay}
              style={{ background: '#2a2a3e', padding: '0.45rem 0.8rem', fontSize: '0.9rem', border: '1px solid #444' }}>
              ⏹
            </button>
            {/* Loop toggle */}
            <button className="btn" onClick={() => setLoopMode(l => !l)}
              title={loopMode ? 'Döngü Kapalı (L)' : 'Döngü Aç (L)'}
              style={{
                background: loopMode ? '#6c5ce720' : '#2a2a3e',
                border: loopMode ? '1.5px solid #6c5ce7' : '1px solid #444',
                padding: '0.45rem 0.8rem', fontSize: '0.9rem',
                color: loopMode ? '#a29bfe' : '#888',
              }}>
              🔁 {loopMode ? 'Döngü' : 'Döngü'}
            </button>
            <span style={{
              fontFamily: 'monospace', fontSize: '1rem', color: '#00d2ff',
              minWidth: '110px', textAlign: 'center',
            }}>
              {fmt(playTime)} / {fmt(duration)}
            </span>

            {/* Play selected region (with auto-loop) */}
            {selectedRegion && (
              <button className="btn" onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = selectedRegion.startTime
                  audioRef.current.play()
                  setIsPlaying(true)
                  setPlayTime(selectedRegion.startTime)
                  setLoopMode(true)
                }
              }}
                style={{ background: selectedRegion.color + '40', border: `1px solid ${selectedRegion.color}`, padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}>
                🔁 {selectedRegion.name}
              </button>
            )}

            <div style={{ flex: 1 }} />
            {selectedRegion && (
              <span style={{ color: selectedRegion.color, fontSize: '0.8rem', fontWeight: 600 }}>
                📍 {selectedRegion.name}: {fmt(selectedRegion.startTime)} – {fmt(selectedRegion.endTime)}
              </span>
            )}
          </div>

          {/* Regions list */}
          {regions.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#aaa' }}>📌 Bölgeler</span>
                <span style={{ color: '#555', fontSize: '0.75rem' }}>({regions.length})</span>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {regions.map(r => (
                  <button key={r.id} className="btn" onClick={() => { setSelectedId(r.id); setFx(mkDefaults()) }}
                    style={{
                      background: r.id === selectedId ? `${r.color}30` : '#1e1e36',
                      border: `1.5px solid ${r.id === selectedId ? r.color : '#333'}`,
                      padding: '0.35rem 0.7rem', fontSize: '0.8rem', color: r.id === selectedId ? '#fff' : '#aaa',
                    }}>
                    <span style={{ color: r.color, marginRight: '0.3rem' }}>●</span>
                    {r.name}
                    <span style={{ color: '#666', marginLeft: '0.4rem', fontSize: '0.75rem' }}>{fmt(r.startTime)}–{fmt(r.endTime)}</span>
                    <span onClick={(e) => { e.stopPropagation(); deleteRegion(r.id) }}
                      style={{ marginLeft: '0.5rem', cursor: 'pointer', color: '#666', fontSize: '0.9rem' }}
                      title="Bölgeyi sil">✕</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ========== EFFECTS PANEL ========== */}
          <div style={{
            background: '#12122a', borderRadius: '10px', padding: '1.25rem',
            border: '1px solid #2a2a3e',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                🎛️ Efektler {selectedRegion ? <span style={{ color: selectedRegion.color }}>— {selectedRegion.name}</span> : <span style={{ color: '#666' }}>— Tüm Ses</span>}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {/* Auto-apply toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.8rem', color: autoApply ? '#10b981' : '#666' }}>
                  <input type="checkbox" checked={autoApply} onChange={e => setAutoApply(e.target.checked)}
                    style={{ accentColor: '#10b981' }} />
                  Otomatik Uygula
                </label>
                <button className="btn" onClick={() => setFx(mkDefaults())}
                  style={{ background: '#2a2a3e', fontSize: '0.75rem', padding: '0.25rem 0.5rem', border: '1px solid #444' }}>
                  🔄 Sıfırla
                </button>
              </div>
            </div>

            {/* Quick Presets */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#777', marginBottom: '0.4rem' }}>⚡ Hızlı Preset</div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {PRESETS.map(p => (
                  <button key={p.id} className="btn" onClick={() => applyPreset(p)}
                    title={p.desc}
                    style={{
                      background: '#1e1e36', border: '1px solid #333',
                      padding: '0.35rem 0.7rem', fontSize: '0.8rem', color: '#ccc',
                      transition: 'all 0.15s',
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
              {/* Seviye */}
              <div>
                <h4 style={{ color: '#a29bfe', marginBottom: '0.5rem', fontSize: '0.85rem', borderBottom: '1px solid #2a2a3e', paddingBottom: '0.3rem' }}>🎚️ Seviye</h4>
                <Slider label="Ses Seviyesi" value={fx.volume} min={-24} max={24} step={0.5} unit=" dB"
                  onChange={v => setFx(p => ({ ...p, volume: v }))} />
                <Slider label="Fade In" value={fx.fadeIn} min={0} max={2} step={0.05} unit=" s"
                  onChange={v => setFx(p => ({ ...p, fadeIn: v }))} color="#10b981" />
                <Slider label="Fade Out" value={fx.fadeOut} min={0} max={2} step={0.05} unit=" s"
                  onChange={v => setFx(p => ({ ...p, fadeOut: v }))} color="#ef4444" />
              </div>

              {/* EQ */}
              <div>
                <h4 style={{ color: '#3b82f6', marginBottom: '0.5rem', fontSize: '0.85rem', borderBottom: '1px solid #2a2a3e', paddingBottom: '0.3rem' }}>📊 Ekolayzer</h4>
                <Slider label="Bas (250 Hz)" value={fx.eqBass} min={-12} max={12} step={0.5} unit=" dB"
                  onChange={v => setFx(p => ({ ...p, eqBass: v }))} color="#3b82f6" />
                <Slider label="Orta (1 kHz)" value={fx.eqMid} min={-12} max={12} step={0.5} unit=" dB"
                  onChange={v => setFx(p => ({ ...p, eqMid: v }))} color="#3b82f6" />
                <Slider label="Tiz (4 kHz)" value={fx.eqTreble} min={-12} max={12} step={0.5} unit=" dB"
                  onChange={v => setFx(p => ({ ...p, eqTreble: v }))} color="#3b82f6" />
              </div>

              {/* Mekan */}
              <div>
                <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem', fontSize: '0.85rem', borderBottom: '1px solid #2a2a3e', paddingBottom: '0.3rem' }}>🏛️ Mekan</h4>
                <Slider label="Reverb Mix" value={fx.reverbMix} min={0} max={1} step={0.01} unit=""
                  onChange={v => setFx(p => ({ ...p, reverbMix: v }))} color="#f59e0b" />
                <Slider label="Reverb Decay" value={fx.reverbDecay} min={0.3} max={4} step={0.1} unit=" s"
                  onChange={v => setFx(p => ({ ...p, reverbDecay: v }))} color="#f59e0b" />
              </div>

              {/* Dinamik */}
              <div>
                <h4 style={{ color: '#ef4444', marginBottom: '0.5rem', fontSize: '0.85rem', borderBottom: '1px solid #2a2a3e', paddingBottom: '0.3rem' }}>🔧 Dinamik</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <label style={{ fontSize: '0.8rem', color: '#aaa' }}>Kompresör</label>
                  <input type="checkbox" checked={fx.compEnabled}
                    onChange={e => setFx(p => ({ ...p, compEnabled: e.target.checked }))}
                    style={{ accentColor: '#ef4444' }} />
                  <span style={{ fontSize: '0.75rem', color: fx.compEnabled ? '#ef4444' : '#555' }}>
                    {fx.compEnabled ? 'Açık' : 'Kapalı'}
                  </span>
                </div>
                {fx.compEnabled && (
                  <>
                    <Slider label="Eşik" value={fx.compThreshold} min={-60} max={0} step={1} unit=" dB"
                      onChange={v => setFx(p => ({ ...p, compThreshold: v }))} color="#ef4444" />
                    <Slider label="Oran" value={fx.compRatio} min={1} max={20} step={0.5} unit=":1"
                      onChange={v => setFx(p => ({ ...p, compRatio: v }))} color="#ef4444" />
                  </>
                )}
              </div>

              {/* Pitch */}
              <div>
                <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem', fontSize: '0.85rem', borderBottom: '1px solid #2a2a3e', paddingBottom: '0.3rem' }}>🎵 Perde</h4>
                <Slider label="Perde Kaydırma" value={fx.pitchShift} min={-12} max={12} step={1} unit=" yarım ton"
                  onChange={v => setFx(p => ({ ...p, pitchShift: v }))} color="#8b5cf6" />
              </div>

              {/* İyileştirme */}
              <div>
                <h4 style={{ color: '#10b981', marginBottom: '0.5rem', fontSize: '0.85rem', borderBottom: '1px solid #2a2a3e', paddingBottom: '0.3rem' }}>✨ İyileştirme</h4>
                <Slider label="De-esser (Tıslama Azalt)" value={fx.deEsser} min={0} max={1} step={0.01} unit=""
                  onChange={v => setFx(p => ({ ...p, deEsser: v }))} color="#10b981" />
                <Slider label="Sıcaklık" value={fx.warmth} min={0} max={1} step={0.01} unit=""
                  onChange={v => setFx(p => ({ ...p, warmth: v }))} color="#10b981" />
                <Slider label="Gürültü Azaltma" value={fx.noiseReduction} min={0} max={1} step={0.01} unit=""
                  onChange={v => setFx(p => ({ ...p, noiseReduction: v }))} color="#10b981" />
              </div>
            </div>

            {/* Apply button (or auto-apply indicator) */}
            {autoApply ? (
              <div style={{
                width: '100%', marginTop: '1.25rem', padding: '0.6rem',
                textAlign: 'center', borderRadius: '8px',
                background: hasChanges() ? '#1e3a1e' : '#1a1a2e',
                border: hasChanges() ? '1px solid #10b98140' : '1px solid #2a2a3e',
                fontSize: '0.85rem', color: hasChanges() ? '#10b981' : '#555',
                transition: 'all 0.3s',
              }}>
                {applying ? (
                  <span>
                    <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #10b981', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 8, verticalAlign: 'middle' }} />
                    Uygulanıyor...
                  </span>
                ) : hasChanges() ? (
                  '🟢 Değişiklik algılandı — 0.8s sonra otomatik uygulanacak'
                ) : (
                  '✓ Otomatik uygulama aktif — slider\'ları değiştirin'
                )}
              </div>
            ) : (
              <button className="btn" onClick={applyEffects}
                disabled={applying || !hasChanges()}
                style={{
                  width: '100%', marginTop: '1.25rem', padding: '0.8rem',
                  background: hasChanges() ? '#6c5ce7' : '#2a2a3e',
                  fontSize: '1rem', fontWeight: 600,
                  border: hasChanges() ? '2px solid #a29bfe' : '2px solid #333',
                  transition: 'all 0.2s',
                }}>
                {applying ? (
                  <span>
                    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 8, verticalAlign: 'middle' }} />
                    Efektler Uygulanıyor...
                  </span>
                ) : (
                  `🎯 Efektleri Uygula${selectedRegion ? ` — ${selectedRegion.name}` : ' — Tüm Ses'}`
                )}
              </button>
            )}
          </div>

          {/* Keyboard shortcuts help */}
          <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              ['Space', 'Oynat/Durdur'],
              ['L', 'Döngü Aç/Kapat'],
              ['Ctrl+Z', 'Geri Al'],
              ['Delete', 'Bölge Sil'],
              ['Ctrl+Scroll', 'Yakınlaştır'],
              ['Scroll', 'Kaydır'],
            ].map(([key, desc]) => (
              <span key={key} style={{ fontSize: '0.7rem', color: '#444' }}>
                <kbd style={{ background: '#1e1e36', padding: '0.1rem 0.3rem', borderRadius: '3px', border: '1px solid #333', marginRight: '0.3rem', fontFamily: 'monospace' }}>{key}</kbd>
                {desc}
              </span>
            ))}
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
