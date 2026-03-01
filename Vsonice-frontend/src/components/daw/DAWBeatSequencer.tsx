/* ============================================================
   DAWBeatSequencer — Step sequencer / drum machine grid
   16/32 step grid with instrument rows, pattern management
   ============================================================ */
import React, { useState, useCallback, useRef, memo, useEffect } from 'react'

interface BeatStep {
  active: boolean
  velocity: number  // 0-127
  accent: boolean
}

interface InstrumentRow {
  id: string
  name: string
  color: string
  steps: BeatStep[]
  volume: number
  muted: boolean
  // Web Audio
  buffer: AudioBuffer | null
}

// Pattern interface reserved for future multi-pattern support

interface Props {
  bpm: number
  onPatternExport?: (buffer: AudioBuffer) => void
}

const DEFAULT_INSTRUMENTS = [
  { name: 'Kick', color: '#ef4444', freq: 60, type: 'kick' },
  { name: 'Snare', color: '#f59e0b', freq: 200, type: 'snare' },
  { name: 'Hi-Hat', color: '#10b981', freq: 800, type: 'hihat' },
  { name: 'Open HH', color: '#06b6d4', freq: 600, type: 'openhat' },
  { name: 'Clap', color: '#8b5cf6', freq: 1200, type: 'clap' },
  { name: 'Tom', color: '#ec4899', freq: 120, type: 'tom' },
  { name: 'Rim', color: '#84cc16', freq: 400, type: 'rim' },
  { name: 'Perc', color: '#f97316', freq: 300, type: 'perc' },
]

const STEP_COUNTS = [8, 16, 32]

function createEmptySteps(count: number): BeatStep[] {
  return Array.from({ length: count }, () => ({ active: false, velocity: 100, accent: false }))
}

function synthesizeDrum(ctx: AudioContext, type: string): AudioBuffer {
  const sr = ctx.sampleRate
  const dur = type === 'openhat' ? 0.3 : type === 'kick' ? 0.3 : 0.15
  const length = Math.ceil(sr * dur)
  const buffer = ctx.createBuffer(1, length, sr)
  const data = buffer.getChannelData(0)

  switch (type) {
    case 'kick': {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        const freq = 150 * Math.exp(-t * 30)
        data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 8) * 0.8
      }
      break
    }
    case 'snare': {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        const body = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 20) * 0.5
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 15) * 0.5
        data[i] = body + noise
      }
      break
    }
    case 'hihat': {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.3
      }
      break
    }
    case 'openhat': {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 8) * 0.25
      }
      break
    }
    case 'clap': {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        const env = (t < 0.01 ? t / 0.01 : 1) * Math.exp(-t * 25)
        data[i] = (Math.random() * 2 - 1) * env * 0.4
      }
      break
    }
    case 'tom': {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        const freq = 120 * Math.exp(-t * 15)
        data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 10) * 0.6
      }
      break
    }
    case 'rim': {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        data[i] = Math.sin(2 * Math.PI * 400 * t) * Math.exp(-t * 50) * 0.4 + (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.3
      }
      break
    }
    default: {
      for (let i = 0; i < length; i++) {
        const t = i / sr
        data[i] = Math.sin(2 * Math.PI * 300 * t) * Math.exp(-t * 20) * 0.4
      }
    }
  }
  return buffer
}

const DAWBeatSequencer: React.FC<Props> = memo(({ bpm, onPatternExport }) => {
  const ctxRef = useRef<AudioContext | null>(null)
  const [stepCount, setStepCount] = useState(16)
  const [currentStep, setCurrentStep] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [swing, setSwing] = useState(0) // 0-100
  const timerRef = useRef<number>(0)
  const stepRef = useRef(-1)

  const [rows, setRows] = useState<InstrumentRow[]>(() =>
    DEFAULT_INSTRUMENTS.map((inst, i) => ({
      id: `drum-${i}`,
      name: inst.name,
      color: inst.color,
      steps: createEmptySteps(16),
      volume: 0.8,
      muted: false,
      buffer: null,
    }))
  )

  const rowsRef = useRef(rows)
  rowsRef.current = rows

  // Init audio context + drum buffers
  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext()
      // Synthesize drum sounds
      setRows(prev => prev.map((row, i) => ({
        ...row,
        buffer: synthesizeDrum(ctxRef.current!, DEFAULT_INSTRUMENTS[i]?.type || 'perc')
      })))
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])

  // Toggle step
  const toggleStep = useCallback((rowId: string, stepIdx: number) => {
    setRows(prev => prev.map(r =>
      r.id !== rowId ? r : {
        ...r,
        steps: r.steps.map((s, i) => i !== stepIdx ? s : { ...s, active: !s.active })
      }
    ))
  }, [])

  // Right-click for accent
  const toggleAccent = useCallback((e: React.MouseEvent, rowId: string, stepIdx: number) => {
    e.preventDefault()
    setRows(prev => prev.map(r =>
      r.id !== rowId ? r : {
        ...r,
        steps: r.steps.map((s, i) => i !== stepIdx ? s : { ...s, accent: !s.accent, active: true })
      }
    ))
  }, [])

  // Play single drum sound
  const playSound = useCallback((buffer: AudioBuffer | null, velocity: number) => {
    if (!buffer) return
    const ctx = getCtx()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = (velocity / 127) * 0.8
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start()
  }, [getCtx])

  // Sequencer loop
  const startSequencer = useCallback(() => {
    getCtx()
    setIsPlaying(true)
    stepRef.current = -1

    const stepDuration = (60 / bpm) / 4 // 16th note duration

    const tick = () => {
      stepRef.current = (stepRef.current + 1) % stepCount
      setCurrentStep(stepRef.current)

      rowsRef.current.forEach(row => {
        if (row.muted) return
        const step = row.steps[stepRef.current]
        if (step?.active) {
          const vel = step.accent ? 127 : step.velocity
          playSound(row.buffer, vel)
        }
      })

      // Apply swing to even steps
      const isEvenStep = stepRef.current % 2 === 1
      const swingDelay = isEvenStep ? (swing / 100) * stepDuration * 0.5 : 0

      timerRef.current = window.setTimeout(tick, (stepDuration + swingDelay) * 1000)
    }
    tick()
  }, [bpm, stepCount, swing, getCtx, playSound])

  const stopSequencer = useCallback(() => {
    setIsPlaying(false)
    setCurrentStep(-1)
    stepRef.current = -1
    clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    return () => clearTimeout(timerRef.current)
  }, [])

  // Update step count
  const handleStepCountChange = useCallback((count: number) => {
    setStepCount(count)
    setRows(prev => prev.map(r => ({
      ...r,
      steps: Array.from({ length: count }, (_, i) => r.steps[i] || { active: false, velocity: 100, accent: false })
    })))
  }, [])

  // Clear all
  const clearAll = useCallback(() => {
    setRows(prev => prev.map(r => ({
      ...r,
      steps: r.steps.map(() => ({ active: false, velocity: 100, accent: false }))
    })))
  }, [])

  // Random pattern
  const randomize = useCallback(() => {
    setRows(prev => prev.map(r => ({
      ...r,
      steps: r.steps.map(() => ({
        active: Math.random() > 0.65,
        velocity: 80 + Math.floor(Math.random() * 47),
        accent: Math.random() > 0.85,
      }))
    })))
  }, [])

  // Export pattern as audio buffer
  const exportPattern = useCallback(async () => {
    const ctx = getCtx()
    const stepDur = (60 / bpm) / 4
    const totalDur = stepCount * stepDur
    const sr = ctx.sampleRate
    const offline = new OfflineAudioContext(2, Math.ceil(totalDur * sr), sr)

    rows.forEach(row => {
      if (row.muted || !row.buffer) return
      row.steps.forEach((step, i) => {
        if (!step.active) return
        const src = offline.createBufferSource()
        src.buffer = row.buffer!
        const gain = offline.createGain()
        gain.gain.value = (step.accent ? 127 : step.velocity) / 127 * row.volume
        src.connect(gain)
        gain.connect(offline.destination)
        src.start(i * stepDur)
      })
    })

    const rendered = await offline.startRendering()
    onPatternExport?.(rendered)
    return rendered
  }, [bpm, stepCount, rows, getCtx, onPatternExport])

  return (
    <div className="daw-beat-seq">
      {/* Toolbar */}
      <div className="daw-beat-toolbar">
        <button
          className={`daw-btn ${isPlaying ? 'active' : ''}`}
          onClick={isPlaying ? stopSequencer : startSequencer}
        >
          {isPlaying ? '⏹ Durdur' : '▶ Oynat'}
        </button>

        <div className="daw-beat-steps-select">
          {STEP_COUNTS.map(c => (
            <button
              key={c}
              className={`daw-btn ${c === stepCount ? 'active' : ''}`}
              onClick={() => handleStepCountChange(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="daw-beat-swing">
          <label className="daw-label">Swing</label>
          <input type="range" className="daw-range" min={0} max={100} value={swing}
            onChange={e => setSwing(Number(e.target.value))} />
          <span className="daw-label">{swing}%</span>
        </div>

        <button className="daw-btn" onClick={clearAll}>Temizle</button>
        <button className="daw-btn" onClick={randomize}>Rastgele</button>
        <button className="daw-btn daw-btn-export" onClick={exportPattern}>Dışa Aktar</button>
      </div>

      {/* Grid */}
      <div className="daw-beat-grid">
        {rows.map(row => (
          <div key={row.id} className={`daw-beat-row ${row.muted ? 'muted' : ''}`}>
            {/* Instrument label */}
            <div className="daw-beat-inst">
              <div className="daw-beat-inst-color" style={{ background: row.color }} />
              <span className="daw-beat-inst-name">{row.name}</span>
              <button
                className={`daw-beat-mute ${row.muted ? 'active' : ''}`}
                onClick={() => setRows(prev => prev.map(r => r.id !== row.id ? r : { ...r, muted: !r.muted }))}
              >M</button>
              <input
                type="range"
                className="daw-beat-vol"
                min={0} max={1} step={0.01}
                value={row.volume}
                onChange={e => setRows(prev => prev.map(r => r.id !== row.id ? r : { ...r, volume: Number(e.target.value) }))}
              />
            </div>

            {/* Steps */}
            <div className="daw-beat-steps">
              {row.steps.map((step, i) => {
                const isBarStart = i % 4 === 0
                const isCurrent = i === currentStep
                return (
                  <button
                    key={i}
                    className={`daw-beat-step ${step.active ? 'active' : ''} ${step.accent ? 'accent' : ''} ${isCurrent ? 'current' : ''} ${isBarStart ? 'bar-start' : ''}`}
                    style={{
                      background: step.active ? row.color + (step.accent ? 'ff' : '99') : undefined,
                      borderColor: isCurrent ? '#fff' : undefined,
                    }}
                    onClick={() => toggleStep(row.id, i)}
                    onContextMenu={e => toggleAccent(e, row.id, i)}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="daw-beat-help">
        <span>Sol tık: Adım ekle/kaldır</span>
        <span>Sağ tık: Vurgu (accent)</span>
        <span>Renk yoğunluğu = velocity</span>
      </div>
    </div>
  )
})

DAWBeatSequencer.displayName = 'DAWBeatSequencer'
export default DAWBeatSequencer
