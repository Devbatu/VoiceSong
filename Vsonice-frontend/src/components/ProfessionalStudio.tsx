import { useState, useRef, useEffect, useCallback } from 'react'
import '../styles/studio.css'

// ============================================
// TYPES
// ============================================

interface EffectParams {
  // EQ
  lowGain?: number
  midGain?: number
  highGain?: number
  lowFreq?: number
  midFreq?: number
  highFreq?: number
  // Compressor
  threshold?: number
  ratio?: number
  attack?: number
  release?: number
  knee?: number
  // Reverb
  reverbMix?: number
  reverbDecay?: number
  // Delay
  delayTime?: number
  delayFeedback?: number
  delayMix?: number
  // Chorus
  chorusRate?: number
  chorusDepth?: number
  chorusMix?: number
  // Distortion
  distortionAmount?: number
  distortionMix?: number
  // Noise Gate
  gateThreshold?: number
  // De-Esser
  deEsserFreq?: number
  deEsserThreshold?: number
  // Autotune
  autotuneKey?: string
  autotuneSpeed?: number
  // Phaser
  phaserRate?: number
  phaserDepth?: number
  phaserMix?: number
  // Flanger
  flangerRate?: number
  flangerDepth?: number
  flangerMix?: number
  // Stereo Widener
  stereoWidth?: number
}

const DEFAULT_PARAMS: Record<string, EffectParams> = {
  eq: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 200, midFreq: 1000, highFreq: 5000 },
  compressor: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 30 },
  reverb: { reverbMix: 0.3, reverbDecay: 2.0 },
  delay: { delayTime: 0.3, delayFeedback: 0.4, delayMix: 0.25 },
  chorus: { chorusRate: 1.5, chorusDepth: 0.005, chorusMix: 0.3 },
  distortion: { distortionAmount: 20, distortionMix: 0.3 },
  noiseGate: { gateThreshold: -40 },
  deEsser: { deEsserFreq: 6500, deEsserThreshold: -20 },
  autotune: { autotuneKey: 'C', autotuneSpeed: 5 },
  phaser: { phaserRate: 0.5, phaserDepth: 0.7, phaserMix: 0.3 },
  flanger: { flangerRate: 0.25, flangerDepth: 0.003, flangerMix: 0.3 },
  stereoWidener: { stereoWidth: 1.0 },
}

type EffectType = 'eq' | 'compressor' | 'reverb' | 'delay' | 'chorus' | 'distortion' | 'noiseGate' | 'deEsser' | 'autotune' | 'phaser' | 'flanger' | 'stereoWidener'

interface TrackEffect {
  id: string
  type: EffectType
  enabled: boolean
  params: EffectParams
}

interface StudioTrack {
  id: string
  name: string
  type: 'vocal' | 'instrumental' | 'drums' | 'bass' | 'fx' | 'other'
  color: string
  volume: number
  pan: number
  muted: boolean
  solo: boolean
  effects: TrackEffect[]
  audioFile: File | null
  audioBuffer: AudioBuffer | null
  sourceNode: AudioBufferSourceNode | null
  gainNode: GainNode | null
  panNode: StereoPannerNode | null
  analyserNode: AnalyserNode | null
  waveformData: number[]
  vuLevel: number
  isProcessing: boolean
}

const TRACK_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#a855f7'
]

const EFFECT_LABELS: Record<EffectType, { icon: string; label: string; description: string }> = {
  eq: { icon: '📊', label: 'Ekolayzır (EQ)', description: 'Low/Mid/High frekans kontrolü' },
  compressor: { icon: '🔧', label: 'Kompresör', description: 'Dinamik aralık sıkıştırma' },
  reverb: { icon: '🏛️', label: 'Reverb', description: 'Mekan yankısı efekti' },
  delay: { icon: '🔄', label: 'Delay', description: 'Yankı/gecikme efekti' },
  chorus: { icon: '🎶', label: 'Chorus', description: 'Ses kalınlaştırma efekti' },
  distortion: { icon: '⚡', label: 'Distortion', description: 'Bozulma/overdrive efekti' },
  noiseGate: { icon: '🚫', label: 'Noise Gate', description: 'Gürültü kapısı - sessiz kısımları temizler' },
  deEsser: { icon: '🐍', label: 'De-Esser', description: 'Tıslama seslerini azaltır (S, Ş, Z)' },
  autotune: { icon: '🎯', label: 'Autotune', description: 'Otomatik pitch düzeltme' },
  phaser: { icon: '🌀', label: 'Phaser', description: 'Faz kaydırma efekti' },
  flanger: { icon: '🌊', label: 'Flanger', description: 'Uçak sesi benzeri efekt' },
  stereoWidener: { icon: '↔️', label: 'Stereo Genişletici', description: 'Stereo görüntüyü genişletir' },
}

const MUSICAL_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const API_BASE = 'http://localhost:8000'

// ============================================
// COMPONENT
// ============================================

export default function ProfessionalStudio() {
  // --- Audio Context ---
  const audioCtxRef = useRef<AudioContext | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const masterAnalyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)

  // --- State ---
  const [tracks, setTracks] = useState<StudioTrack[]>([])
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [masterVolume, setMasterVolume] = useState(80)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [masterVU, setMasterVU] = useState(0)
  const [activeSection, setActiveSection] = useState<'mixer' | 'effects' | 'noise' | 'export'>('mixer')
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [noiseReductionStrength, setNoiseReductionStrength] = useState(0.5)
  const [isProcessingNoise, setIsProcessingNoise] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const startTimeRef = useRef(0)
  const pauseOffsetRef = useRef(0)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const waveformCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const masterCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // --- Init AudioContext ---
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
      masterGainRef.current = audioCtxRef.current.createGain()
      masterAnalyserRef.current = audioCtxRef.current.createAnalyser()
      masterAnalyserRef.current.fftSize = 2048
      masterGainRef.current.connect(masterAnalyserRef.current)
      masterAnalyserRef.current.connect(audioCtxRef.current.destination)
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [])

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      tracksRef.current.forEach(t => {
        try { t.sourceNode?.stop() } catch { /* ignore */ }
      })
      audioCtxRef.current?.close()
    }
  }, [])

  // --- Master volume update ---
  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = masterVolume / 100
    }
  }, [masterVolume])

  // --- VU Meter animation ---
  const startVUAnimation = useCallback(() => {
    const animate = () => {
      // Master VU
      if (masterAnalyserRef.current) {
        const data = new Uint8Array(masterAnalyserRef.current.frequencyBinCount)
        masterAnalyserRef.current.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setMasterVU(Math.min(100, (avg / 255) * 100 * 1.5))
      }
      // Track VUs
      const updates: Record<string, number> = {}
      tracksRef.current.forEach(t => {
        if (t.analyserNode) {
          const data = new Uint8Array(t.analyserNode.frequencyBinCount)
          t.analyserNode.getByteFrequencyData(data)
          const avg = data.reduce((a, b) => a + b, 0) / data.length
          updates[t.id] = Math.min(100, (avg / 255) * 100 * 1.5)
        }
      })
      if (Object.keys(updates).length > 0) {
        setTracks(prev => prev.map(t => updates[t.id] !== undefined ? { ...t, vuLevel: updates[t.id] } : t))
      }
      // Current time
      if (audioCtxRef.current && startTimeRef.current > 0) {
        const elapsed = audioCtxRef.current.currentTime - startTimeRef.current + pauseOffsetRef.current
        setCurrentTime(elapsed)
      }
      // Master spectrum canvas
      drawMasterSpectrum()
      animFrameRef.current = requestAnimationFrame(animate)
    }
    cancelAnimationFrame(animFrameRef.current)
    animFrameRef.current = requestAnimationFrame(animate)
  }, [])

  // --- Draw master spectrum ---
  const drawMasterSpectrum = () => {
    const canvas = masterCanvasRef.current
    const analyser = masterAnalyserRef.current
    if (!canvas || !analyser) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)
    ctx.clearRect(0, 0, w, h)
    const barWidth = (w / data.length) * 2.5
    let x = 0
    for (let i = 0; i < data.length; i++) {
      const barHeight = (data[i] / 255) * h
      const gradient = ctx.createLinearGradient(0, h, 0, h - barHeight)
      gradient.addColorStop(0, '#6366f1')
      gradient.addColorStop(0.5, '#8b5cf6')
      gradient.addColorStop(1, '#ec4899')
      ctx.fillStyle = gradient
      ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight)
      x += barWidth
      if (x > w) break
    }
  }

  // --- Load audio file into a track ---
  const loadAudioFile = async (trackId: string, file: File) => {
    const ctx = getAudioContext()
    try {
      const arrayBuffer = await file.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      // Generate waveform data
      const rawData = audioBuffer.getChannelData(0)
      const samples = 200
      const blockSize = Math.floor(rawData.length / samples)
      const waveform: number[] = []
      for (let i = 0; i < samples; i++) {
        let sum = 0
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[i * blockSize + j])
        }
        waveform.push((sum / blockSize) * 100)
      }
      setTracks(prev => {
        const updated = prev.map(t => t.id === trackId ? {
          ...t,
          audioFile: file,
          audioBuffer: audioBuffer,
          waveformData: waveform
        } : t)
        // Update duration to longest track
        const maxDur = Math.max(...updated.map(t => t.audioBuffer?.duration ?? 0))
        if (maxDur > 0) setDuration(maxDur)
        return updated
      })
      setStatusMessage({ type: 'success', text: `"${file.name}" başarıyla yüklendi!` })
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (err) {
      console.error('Audio decode error:', err)
      setStatusMessage({ type: 'error', text: `Dosya yüklenemedi: ${file.name}` })
    }
  }

  // --- Create audio graph for a track ---
  const createTrackAudioGraph = (track: StudioTrack, ctx: AudioContext): {
    source: AudioBufferSourceNode
    gain: GainNode
    pan: StereoPannerNode
    analyser: AnalyserNode
  } | null => {
    if (!track.audioBuffer) return null

    const source = ctx.createBufferSource()
    source.buffer = track.audioBuffer
    source.loop = isLooping

    const gain = ctx.createGain()
    gain.gain.value = track.muted ? 0 : track.volume / 100

    const pan = ctx.createStereoPanner()
    pan.pan.value = track.pan / 100

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024

    // Build effect chain
    let lastNode: AudioNode = source

    // EQ effects
    track.effects.filter(e => e.enabled && e.type === 'eq').forEach(fx => {
      const low = ctx.createBiquadFilter()
      low.type = 'lowshelf'
      low.frequency.value = fx.params.lowFreq ?? 200
      low.gain.value = fx.params.lowGain ?? 0
      lastNode.connect(low)
      lastNode = low

      const mid = ctx.createBiquadFilter()
      mid.type = 'peaking'
      mid.frequency.value = fx.params.midFreq ?? 1000
      mid.Q.value = 1.5
      mid.gain.value = fx.params.midGain ?? 0
      lastNode.connect(mid)
      lastNode = mid

      const high = ctx.createBiquadFilter()
      high.type = 'highshelf'
      high.frequency.value = fx.params.highFreq ?? 5000
      high.gain.value = fx.params.highGain ?? 0
      lastNode.connect(high)
      lastNode = high
    })

    // Compressor
    track.effects.filter(e => e.enabled && e.type === 'compressor').forEach(fx => {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = fx.params.threshold ?? -24
      comp.ratio.value = fx.params.ratio ?? 4
      comp.attack.value = fx.params.attack ?? 0.003
      comp.release.value = fx.params.release ?? 0.25
      comp.knee.value = fx.params.knee ?? 30
      lastNode.connect(comp)
      lastNode = comp
    })

    // De-Esser (narrow notch on high freqs)
    track.effects.filter(e => e.enabled && e.type === 'deEsser').forEach(fx => {
      const notch = ctx.createBiquadFilter()
      notch.type = 'peaking'
      notch.frequency.value = fx.params.deEsserFreq ?? 6500
      notch.Q.value = 5
      notch.gain.value = fx.params.deEsserThreshold ?? -20
      lastNode.connect(notch)
      lastNode = notch
    })

    // Distortion
    track.effects.filter(e => e.enabled && e.type === 'distortion').forEach(fx => {
      const amount = fx.params.distortionAmount ?? 20
      const mix = fx.params.distortionMix ?? 0.3
      const shaper = ctx.createWaveShaper()
      const k = amount
      const nSamples = 44100
      const curve = new Float32Array(nSamples)
      for (let i = 0; i < nSamples; i++) {
        const x = (i * 2) / nSamples - 1
        curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x))
      }
      shaper.curve = curve
      shaper.oversample = '4x'
      const dryGain = ctx.createGain()
      dryGain.gain.value = 1 - mix
      const wetGain = ctx.createGain()
      wetGain.gain.value = mix
      const merger = ctx.createGain()
      lastNode.connect(dryGain)
      dryGain.connect(merger)
      lastNode.connect(shaper)
      shaper.connect(wetGain)
      wetGain.connect(merger)
      lastNode = merger
    })

    // Delay
    track.effects.filter(e => e.enabled && e.type === 'delay').forEach(fx => {
      const delayNode = ctx.createDelay(5.0)
      delayNode.delayTime.value = fx.params.delayTime ?? 0.3
      const feedback = ctx.createGain()
      feedback.gain.value = fx.params.delayFeedback ?? 0.4
      const wetGain = ctx.createGain()
      wetGain.gain.value = fx.params.delayMix ?? 0.25
      const dryGain = ctx.createGain()
      dryGain.gain.value = 1
      const merger = ctx.createGain()
      lastNode.connect(dryGain)
      dryGain.connect(merger)
      lastNode.connect(delayNode)
      delayNode.connect(feedback)
      feedback.connect(delayNode)
      delayNode.connect(wetGain)
      wetGain.connect(merger)
      lastNode = merger
    })

    // Reverb (convolution)
    track.effects.filter(e => e.enabled && e.type === 'reverb').forEach(fx => {
      const decay = fx.params.reverbDecay ?? 2.0
      const mix = fx.params.reverbMix ?? 0.3
      const sampleRate = ctx.sampleRate
      const length = Math.floor(sampleRate * decay)
      const impulse = ctx.createBuffer(2, length, sampleRate)
      for (let ch = 0; ch < 2; ch++) {
        const channel = impulse.getChannelData(ch)
        for (let i = 0; i < length; i++) {
          channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2)
        }
      }
      const convolver = ctx.createConvolver()
      convolver.buffer = impulse
      const wetGain = ctx.createGain()
      wetGain.gain.value = mix
      const dryGain = ctx.createGain()
      dryGain.gain.value = 1 - mix * 0.5
      const merger = ctx.createGain()
      lastNode.connect(dryGain)
      dryGain.connect(merger)
      lastNode.connect(convolver)
      convolver.connect(wetGain)
      wetGain.connect(merger)
      lastNode = merger
    })

    // Chorus (modulated delay)
    track.effects.filter(e => e.enabled && e.type === 'chorus').forEach(fx => {
      const rate = fx.params.chorusRate ?? 1.5
      const depth = fx.params.chorusDepth ?? 0.005
      const mix = fx.params.chorusMix ?? 0.3
      const chorusDelay = ctx.createDelay(0.1)
      chorusDelay.delayTime.value = 0.03
      const lfo = ctx.createOscillator()
      lfo.frequency.value = rate
      lfo.type = 'sine'
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = depth
      lfo.connect(lfoGain)
      lfoGain.connect(chorusDelay.delayTime)
      lfo.start()
      const wetGain = ctx.createGain()
      wetGain.gain.value = mix
      const dryGain = ctx.createGain()
      dryGain.gain.value = 1
      const merger = ctx.createGain()
      lastNode.connect(dryGain)
      dryGain.connect(merger)
      lastNode.connect(chorusDelay)
      chorusDelay.connect(wetGain)
      wetGain.connect(merger)
      lastNode = merger
    })

    // Phaser
    track.effects.filter(e => e.enabled && e.type === 'phaser').forEach(fx => {
      const rate = fx.params.phaserRate ?? 0.5
      const depth = fx.params.phaserDepth ?? 0.7
      const mix = fx.params.phaserMix ?? 0.3
      const allpassFilters: BiquadFilterNode[] = []
      const freqs = [100, 300, 1000, 3000]
      let chainNode: AudioNode = lastNode
      freqs.forEach(freq => {
        const ap = ctx.createBiquadFilter()
        ap.type = 'allpass'
        ap.frequency.value = freq
        ap.Q.value = 10
        allpassFilters.push(ap)
        chainNode.connect(ap)
        chainNode = ap
      })
      const lfo = ctx.createOscillator()
      lfo.frequency.value = rate
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = depth * 500
      lfo.connect(lfoGain)
      allpassFilters.forEach(ap => lfoGain.connect(ap.frequency))
      lfo.start()
      const wetGain = ctx.createGain()
      wetGain.gain.value = mix
      const dryGain = ctx.createGain()
      dryGain.gain.value = 1
      const merger = ctx.createGain()
      lastNode.connect(dryGain)
      dryGain.connect(merger)
      chainNode.connect(wetGain)
      wetGain.connect(merger)
      lastNode = merger
    })

    // Flanger
    track.effects.filter(e => e.enabled && e.type === 'flanger').forEach(fx => {
      const rate = fx.params.flangerRate ?? 0.25
      const depth = fx.params.flangerDepth ?? 0.003
      const mix = fx.params.flangerMix ?? 0.3
      const flangerDelay = ctx.createDelay(0.02)
      flangerDelay.delayTime.value = 0.005
      const lfo = ctx.createOscillator()
      lfo.frequency.value = rate
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = depth
      lfo.connect(lfoGain)
      lfoGain.connect(flangerDelay.delayTime)
      lfo.start()
      const feedbackGain = ctx.createGain()
      feedbackGain.gain.value = 0.5
      flangerDelay.connect(feedbackGain)
      feedbackGain.connect(flangerDelay)
      const wetGain = ctx.createGain()
      wetGain.gain.value = mix
      const dryGain = ctx.createGain()
      dryGain.gain.value = 1
      const merger = ctx.createGain()
      lastNode.connect(dryGain)
      dryGain.connect(merger)
      lastNode.connect(flangerDelay)
      flangerDelay.connect(wetGain)
      wetGain.connect(merger)
      lastNode = merger
    })

    // Connect final chain: -> gain -> pan -> analyser -> master
    lastNode.connect(gain)
    gain.connect(pan)
    pan.connect(analyser)
    analyser.connect(masterGainRef.current!)

    return { source, gain, pan, analyser }
  }

  // --- Play all tracks ---
  const playAll = () => {
    const ctx = getAudioContext()
    // Stop existing sources
    tracks.forEach(t => {
      try { t.sourceNode?.stop() } catch { /* ignore */ }
    })

    const offset = pauseOffsetRef.current
    const newTracks = tracks.map(t => {
      if (!t.audioBuffer) return t
      const graph = createTrackAudioGraph(t, ctx)
      if (!graph) return t
      graph.source.start(0, offset)
      return {
        ...t,
        sourceNode: graph.source,
        gainNode: graph.gain,
        panNode: graph.pan,
        analyserNode: graph.analyser
      }
    })
    setTracks(newTracks)
    startTimeRef.current = ctx.currentTime
    setIsPlaying(true)
    startVUAnimation()
  }

  // --- Pause ---
  const pauseAll = () => {
    if (audioCtxRef.current) {
      pauseOffsetRef.current += audioCtxRef.current.currentTime - startTimeRef.current
    }
    tracks.forEach(t => {
      try { t.sourceNode?.stop() } catch { /* ignore */ }
    })
    setIsPlaying(false)
    cancelAnimationFrame(animFrameRef.current)
  }

  // --- Stop ---
  const stopAll = () => {
    tracks.forEach(t => {
      try { t.sourceNode?.stop() } catch { /* ignore */ }
    })
    pauseOffsetRef.current = 0
    startTimeRef.current = 0
    setCurrentTime(0)
    setIsPlaying(false)
    setMasterVU(0)
    setTracks(prev => prev.map(t => ({ ...t, vuLevel: 0 })))
    cancelAnimationFrame(animFrameRef.current)
  }

  // --- Toggle play/pause ---
  const togglePlayPause = () => {
    if (isPlaying) pauseAll()
    else playAll()
  }

  // --- Add track ---
  const addTrack = (type: StudioTrack['type'] = 'other', name?: string) => {
    const id = Date.now().toString()
    const color = TRACK_COLORS[tracks.length % TRACK_COLORS.length]
    const newTrack: StudioTrack = {
      id,
      name: name || `Track ${tracks.length + 1}`,
      type,
      color,
      volume: 75,
      pan: 0,
      muted: false,
      solo: false,
      effects: [],
      audioFile: null,
      audioBuffer: null,
      sourceNode: null,
      gainNode: null,
      panNode: null,
      analyserNode: null,
      waveformData: [],
      vuLevel: 0,
      isProcessing: false
    }
    setTracks(prev => [...prev, newTrack])
    setSelectedTrackId(id)
  }

  // --- Remove track ---
  const removeTrack = (trackId: string) => {
    const track = tracks.find(t => t.id === trackId)
    if (track) {
      try { track.sourceNode?.stop() } catch { /* ignore */ }
    }
    setTracks(prev => prev.filter(t => t.id !== trackId))
    if (selectedTrackId === trackId) {
      setSelectedTrackId(tracks.length > 1 ? tracks[0].id : null)
    }
  }

  // --- Update track property ---
  const updateTrack = (trackId: string, updates: Partial<StudioTrack>) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t
      const updated = { ...t, ...updates }
      // Real-time volume/pan/mute update
      if (updates.volume !== undefined && t.gainNode) {
        t.gainNode.gain.value = (updates.muted ?? t.muted) ? 0 : (updates.volume ?? t.volume) / 100
      }
      if (updates.muted !== undefined && t.gainNode) {
        t.gainNode.gain.value = updates.muted ? 0 : t.volume / 100
      }
      if (updates.pan !== undefined && t.panNode) {
        t.panNode.pan.value = (updates.pan ?? t.pan) / 100
      }
      return updated
    }))
  }

  // --- Add effect to track ---
  const addEffect = (trackId: string, type: EffectType) => {
    const defaultParams = { ...DEFAULT_PARAMS[type] }
    const effect: TrackEffect = {
      id: Date.now().toString(),
      type,
      enabled: true,
      params: defaultParams
    }
    setTracks(prev => prev.map(t =>
      t.id === trackId ? { ...t, effects: [...t.effects, effect] } : t
    ))
  }

  // --- Remove effect ---
  const removeEffect = (trackId: string, effectId: string) => {
    setTracks(prev => prev.map(t =>
      t.id === trackId ? { ...t, effects: t.effects.filter(e => e.id !== effectId) } : t
    ))
  }

  // --- Toggle effect ---
  const toggleEffect = (trackId: string, effectId: string) => {
    setTracks(prev => prev.map(t =>
      t.id === trackId ? {
        ...t,
        effects: t.effects.map(e => e.id === effectId ? { ...e, enabled: !e.enabled } : e)
      } : t
    ))
  }

  // --- Update effect params ---
  const updateEffectParams = (trackId: string, effectId: string, params: Partial<EffectParams>) => {
    setTracks(prev => prev.map(t =>
      t.id === trackId ? {
        ...t,
        effects: t.effects.map(e => e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e)
      } : t
    ))
  }

  // --- Draw waveform on canvas ---
  const drawWaveform = useCallback((canvas: HTMLCanvasElement, waveformData: number[], color: string, progress: number) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    if (waveformData.length === 0) return
    const barWidth = w / waveformData.length
    waveformData.forEach((val, i) => {
      const barHeight = (val / 100) * h * 0.8
      const x = i * barWidth
      const isPlayed = (i / waveformData.length) < progress
      ctx.fillStyle = isPlayed ? color : `${color}44`
      ctx.fillRect(x, (h - barHeight) / 2, barWidth - 1, barHeight)
    })
    // Playhead
    const playheadX = progress * w
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(playheadX, 0)
    ctx.lineTo(playheadX, h)
    ctx.stroke()
  }, [])

  // --- Draw waveforms when data or time changes ---
  useEffect(() => {
    const progress = duration > 0 ? currentTime / duration : 0
    tracks.forEach(t => {
      const canvas = waveformCanvasRefs.current[t.id]
      if (canvas && t.waveformData.length > 0) {
        drawWaveform(canvas, t.waveformData, t.color, progress)
      }
    })
  }, [tracks, currentTime, duration, drawWaveform])

  // --- Noise Reduction (backend) ---
  const applyNoiseReduction = async (trackId: string) => {
    const track = tracks.find(t => t.id === trackId)
    if (!track?.audioFile) return
    setIsProcessingNoise(true)
    updateTrack(trackId, { isProcessing: true })
    setStatusMessage({ type: 'info', text: 'Gürültü azaltma uygulanıyor...' })
    try {
      const formData = new FormData()
      formData.append('audio_file', track.audioFile)
      formData.append('strength', noiseReductionStrength.toString())
      const response = await fetch(`${API_BASE}/api/studio/noise-reduce`, {
        method: 'POST',
        body: formData
      })
      if (!response.ok) throw new Error('Noise reduction failed')
      const blob = await response.blob()
      const newFile = new File([blob], `nr_${track.audioFile.name}`, { type: 'audio/wav' })
      await loadAudioFile(trackId, newFile)
      setStatusMessage({ type: 'success', text: 'Gürültü azaltma tamamlandı!' })
    } catch (err) {
      console.error(err)
      setStatusMessage({ type: 'error', text: 'Gürültü azaltma başarısız oldu' })
    } finally {
      setIsProcessingNoise(false)
      updateTrack(trackId, { isProcessing: false })
      setTimeout(() => setStatusMessage(null), 4000)
    }
  }

  // --- Autotune (backend) ---
  const applyAutotune = async (trackId: string) => {
    const track = tracks.find(t => t.id === trackId)
    if (!track?.audioFile) return
    const atEffect = track.effects.find(e => e.type === 'autotune')
    updateTrack(trackId, { isProcessing: true })
    setStatusMessage({ type: 'info', text: 'Autotune uygulanıyor...' })
    try {
      const formData = new FormData()
      formData.append('audio_file', track.audioFile)
      formData.append('key', atEffect?.params.autotuneKey ?? 'C')
      formData.append('speed', (atEffect?.params.autotuneSpeed ?? 5).toString())
      const response = await fetch(`${API_BASE}/api/studio/autotune`, {
        method: 'POST',
        body: formData
      })
      if (!response.ok) throw new Error('Autotune failed')
      const blob = await response.blob()
      const newFile = new File([blob], `at_${track.audioFile.name}`, { type: 'audio/wav' })
      await loadAudioFile(trackId, newFile)
      setStatusMessage({ type: 'success', text: 'Autotune tamamlandı!' })
    } catch (err) {
      console.error(err)
      setStatusMessage({ type: 'error', text: 'Autotune başarısız oldu' })
    } finally {
      updateTrack(trackId, { isProcessing: false })
      setTimeout(() => setStatusMessage(null), 4000)
    }
  }

  // --- Export mix ---
  const exportMix = async () => {
    const tracksWithAudio = tracks.filter(t => t.audioFile)
    if (tracksWithAudio.length === 0) {
      setStatusMessage({ type: 'error', text: 'Dışa aktarmak için en az bir track yükleyin' })
      return
    }
    setIsExporting(true)
    setExportProgress('Track dosyaları yükleniyor...')
    try {
      const formData = new FormData()
      tracksWithAudio.forEach((t, i) => {
        formData.append(`track_${i}`, t.audioFile!)
        formData.append(`volume_${i}`, (t.muted ? 0 : t.volume / 100).toString())
        formData.append(`pan_${i}`, (t.pan / 100).toString())
      })
      formData.append('track_count', tracksWithAudio.length.toString())
      formData.append('master_volume', (masterVolume / 100).toString())

      setExportProgress('Sunucu tarafında mix işleniyor...')
      const response = await fetch(`${API_BASE}/api/studio/mix-export`, {
        method: 'POST',
        body: formData
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `VoiceSong_Mix_${Date.now()}.wav`
      a.click()
      URL.revokeObjectURL(url)
      setStatusMessage({ type: 'success', text: 'Mix başarıyla dışa aktarıldı!' })
    } catch (err) {
      console.error(err)
      setStatusMessage({ type: 'error', text: 'Dışa aktarma başarısız oldu' })
    } finally {
      setIsExporting(false)
      setExportProgress('')
      setTimeout(() => setStatusMessage(null), 4000)
    }
  }

  // --- Format time ---
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    const ms = Math.floor((s % 1) * 100)
    return `${m}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  const selectedTrack = tracks.find(t => t.id === selectedTrackId)

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="component-container studio-container">
      <div className="studio-title-bar">
        <h2>🎛️ Professional Audio Studio</h2>
        <p>FL Studio tarzı tam teşekküllü ses düzenleme, efekt uygulama ve miksaj ortamı</p>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className={`studio-status studio-status-${statusMessage.type}`}>
          <span>{statusMessage.type === 'success' ? '✅' : statusMessage.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Section Tabs */}
      <div className="studio-section-tabs">
        <button className={`studio-tab ${activeSection === 'mixer' ? 'active' : ''}`} onClick={() => setActiveSection('mixer')}>
          🎛️ Mixer & Track'ler
        </button>
        <button className={`studio-tab ${activeSection === 'effects' ? 'active' : ''}`} onClick={() => setActiveSection('effects')}>
          🎚️ Efektler & EQ
        </button>
        <button className={`studio-tab ${activeSection === 'noise' ? 'active' : ''}`} onClick={() => setActiveSection('noise')}>
          🚫 Gürültü Azaltma
        </button>
        <button className={`studio-tab ${activeSection === 'export' ? 'active' : ''}`} onClick={() => setActiveSection('export')}>
          📥 Mix & Dışa Aktar
        </button>
      </div>

      {/* ======== TRANSPORT CONTROLS ======== */}
      <div className="transport-panel">
        <div className="transport-controls">
          <div className="transport-buttons">
            <button className="transport-btn" onClick={stopAll} title="Stop">⏹️</button>
            <button className={`transport-btn play-btn ${isPlaying ? 'active' : ''}`} onClick={togglePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            <button className={`transport-btn ${isLooping ? 'active' : ''}`} onClick={() => setIsLooping(!isLooping)} title="Loop">🔁</button>
          </div>

          <div className="transport-info">
            <div className="transport-info-item">
              <label>BPM</label>
              <input type="number" value={bpm} onChange={e => setBpm(Number(e.target.value))} min={40} max={300} />
            </div>
          </div>

          <div className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="master-vol-control">
            <label>Master</label>
            <input type="range" min={0} max={100} value={masterVolume} onChange={e => setMasterVolume(Number(e.target.value))} />
            <span className="fader-value">{masterVolume}%</span>
          </div>
        </div>

        {/* Timeline */}
        <div className="timeline-container">
          <div className="timeline" onClick={e => {
            const rect = (e.target as HTMLElement).getBoundingClientRect()
            const ratio = (e.clientX - rect.left) / rect.width
            const newTime = ratio * duration
            pauseOffsetRef.current = newTime
            setCurrentTime(newTime)
            if (isPlaying) {
              pauseAll()
              setTimeout(() => playAll(), 50)
            }
          }}>
            <div className="timeline-progress" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
            <div className="playhead" style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Master Spectrum */}
        <canvas
          ref={masterCanvasRef}
          width={800}
          height={60}
          className="master-spectrum-canvas"
        />

        {/* Master VU */}
        <div className="master-vu-bar">
          <div className="master-vu-fill" style={{ width: `${masterVU}%` }} />
        </div>
      </div>

      {/* ======== MIXER & TRACKS ======== */}
      {activeSection === 'mixer' && (
        <div className="studio-section">
          <div className="section-header">
            <h3>🎛️ Mixer & Track Yönetimi</h3>
            <div className="add-track-buttons">
              <button onClick={() => addTrack('vocal', 'Vokal')} className="effect-add-btn">🎤 Vokal Ekle</button>
              <button onClick={() => addTrack('instrumental', 'Enstrümantal')} className="effect-add-btn">🎵 Müzik Ekle</button>
              <button onClick={() => addTrack('drums', 'Davul')} className="effect-add-btn">🥁 Davul Ekle</button>
              <button onClick={() => addTrack('bass', 'Bass')} className="effect-add-btn">🎸 Bass Ekle</button>
              <button onClick={() => addTrack('fx', 'FX')} className="effect-add-btn">✨ FX Ekle</button>
              <button onClick={() => addTrack('other')} className="effect-add-btn">➕ Boş Track</button>
            </div>
          </div>

          {tracks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <h4>Henüz track eklenmedi</h4>
              <p>Yukarıdaki butonlardan yeni bir track ekleyin ve ses dosyanızı yükleyin</p>
            </div>
          ) : (
            <div className="tracks-timeline-view">
              {tracks.map(track => (
                <div
                  key={track.id}
                  className={`track-row ${selectedTrackId === track.id ? 'selected' : ''} ${track.muted ? 'muted' : ''}`}
                  onClick={() => setSelectedTrackId(track.id)}
                >
                  {/* Track Info */}
                  <div className="track-info-col" style={{ borderLeftColor: track.color }}>
                    <div className="track-name-row">
                      <span className="track-color-dot" style={{ background: track.color }} />
                      <input
                        className="track-name-input"
                        value={track.name}
                        onChange={e => updateTrack(track.id, { name: e.target.value })}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                    <div className="track-type-badge">{track.type}</div>
                    <div className="track-mini-controls">
                      <button className={`mini-btn ${track.muted ? 'active-red' : ''}`} onClick={e => { e.stopPropagation(); updateTrack(track.id, { muted: !track.muted }) }}>M</button>
                      <button className={`mini-btn ${track.solo ? 'active-yellow' : ''}`} onClick={e => { e.stopPropagation(); updateTrack(track.id, { solo: !track.solo }) }}>S</button>
                      <button className="mini-btn danger" onClick={e => { e.stopPropagation(); removeTrack(track.id) }}>✕</button>
                    </div>
                  </div>

                  {/* Volume & Pan */}
                  <div className="track-controls-col">
                    <div className="track-slider-row">
                      <span className="slider-icon">🔊</span>
                      <input type="range" min={0} max={100} value={track.volume} onChange={e => { e.stopPropagation(); updateTrack(track.id, { volume: Number(e.target.value) }) }} className="track-slider" />
                      <span className="slider-val">{track.volume}</span>
                    </div>
                    <div className="track-slider-row">
                      <span className="slider-icon">↔️</span>
                      <input type="range" min={-100} max={100} value={track.pan} onChange={e => { e.stopPropagation(); updateTrack(track.id, { pan: Number(e.target.value) }) }} className="track-slider pan-slider" />
                      <span className="slider-val">{track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.abs(track.pan)}` : `R${track.pan}`}</span>
                    </div>
                    <div className="track-vu">
                      <div className="track-vu-fill" style={{ width: `${track.vuLevel}%`, background: track.color }} />
                    </div>
                  </div>

                  {/* Waveform or Upload */}
                  <div className="track-waveform-col">
                    {track.audioFile ? (
                      <div className="waveform-wrapper">
                        <canvas
                          ref={el => { waveformCanvasRefs.current[track.id] = el }}
                          width={600}
                          height={60}
                          className="waveform-canvas"
                        />
                        <div className="waveform-filename">{track.audioFile.name}</div>
                      </div>
                    ) : (
                      <div
                        className="track-upload-zone"
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          const file = e.dataTransfer.files[0]
                          if (file) loadAudioFile(track.id, file)
                        }}
                        onClick={e => {
                          e.stopPropagation()
                          const input = document.createElement('input')
                          input.type = 'file'
                          input.accept = 'audio/*'
                          input.onchange = (ev: any) => {
                            const file = ev.target.files[0]
                            if (file) loadAudioFile(track.id, file)
                          }
                          input.click()
                        }}
                      >
                        <span>📂 Ses dosyası yükle veya sürükle</span>
                      </div>
                    )}
                  </div>

                  {/* FX count */}
                  <div className="track-fx-col">
                    <span className="fx-count">{track.effects.length} FX</span>
                    {track.isProcessing && <span className="processing-dot" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ======== EFFECTS & EQ ======== */}
      {activeSection === 'effects' && (
        <div className="studio-section">
          {!selectedTrack ? (
            <div className="empty-state">
              <div className="empty-icon">🎚️</div>
              <h4>Track seçin</h4>
              <p>Efekt eklemek için önce Mixer sekmesinden bir track seçin</p>
            </div>
          ) : (
            <>
              <div className="section-header">
                <h3>🎚️ Efektler — <span style={{ color: selectedTrack.color }}>{selectedTrack.name}</span></h3>
              </div>

              {/* Add Effects Grid */}
              <div className="effects-add-grid">
                {(Object.keys(EFFECT_LABELS) as EffectType[]).map(type => (
                  <button
                    key={type}
                    className="effect-add-card"
                    onClick={() => addEffect(selectedTrack.id, type)}
                  >
                    <span className="effect-card-icon">{EFFECT_LABELS[type].icon}</span>
                    <span className="effect-card-name">{EFFECT_LABELS[type].label}</span>
                    <span className="effect-card-desc">{EFFECT_LABELS[type].description}</span>
                  </button>
                ))}
              </div>

              {/* Effects Chain */}
              <div className="effects-chain">
                <h4>🔗 Efekt Zinciri {selectedTrack.effects.length > 0 && `(${selectedTrack.effects.length})`}</h4>
                {selectedTrack.effects.length === 0 ? (
                  <div className="empty-chain">Henüz efekt eklenmedi. Yukarıdan bir efekt seçin.</div>
                ) : (
                  selectedTrack.effects.map(fx => (
                    <div key={fx.id} className={`effect-detail-card ${fx.enabled ? '' : 'disabled'}`}>
                      <div className="effect-detail-header">
                        <div className="effect-detail-title">
                          <span>{EFFECT_LABELS[fx.type].icon}</span>
                          <span>{EFFECT_LABELS[fx.type].label}</span>
                        </div>
                        <div className="effect-detail-actions">
                          <button className={`fx-toggle ${fx.enabled ? 'on' : 'off'}`} onClick={() => toggleEffect(selectedTrack.id, fx.id)}>
                            {fx.enabled ? 'ON' : 'OFF'}
                          </button>
                          {fx.type === 'autotune' && (
                            <button className="fx-apply-btn" onClick={() => applyAutotune(selectedTrack.id)} disabled={!selectedTrack.audioFile || selectedTrack.isProcessing}>
                              🎯 Uygula
                            </button>
                          )}
                          <button className="fx-remove" onClick={() => removeEffect(selectedTrack.id, fx.id)}>✕</button>
                        </div>
                      </div>

                      {/* Effect Parameter Controls */}
                      <div className="effect-params-grid">
                        {/* EQ */}
                        {fx.type === 'eq' && (
                          <>
                            <div className="param-control">
                              <label>Low ({fx.params.lowFreq ?? 200}Hz)</label>
                              <input type="range" min={-12} max={12} step={0.5} value={fx.params.lowGain ?? 0}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { lowGain: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.lowGain ?? 0} dB</span>
                            </div>
                            <div className="param-control">
                              <label>Mid ({fx.params.midFreq ?? 1000}Hz)</label>
                              <input type="range" min={-12} max={12} step={0.5} value={fx.params.midGain ?? 0}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { midGain: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.midGain ?? 0} dB</span>
                            </div>
                            <div className="param-control">
                              <label>High ({fx.params.highFreq ?? 5000}Hz)</label>
                              <input type="range" min={-12} max={12} step={0.5} value={fx.params.highGain ?? 0}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { highGain: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.highGain ?? 0} dB</span>
                            </div>
                            <div className="param-control">
                              <label>Low Freq</label>
                              <input type="range" min={40} max={500} value={fx.params.lowFreq ?? 200}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { lowFreq: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.lowFreq ?? 200} Hz</span>
                            </div>
                            <div className="param-control">
                              <label>Mid Freq</label>
                              <input type="range" min={200} max={5000} value={fx.params.midFreq ?? 1000}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { midFreq: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.midFreq ?? 1000} Hz</span>
                            </div>
                            <div className="param-control">
                              <label>High Freq</label>
                              <input type="range" min={2000} max={16000} value={fx.params.highFreq ?? 5000}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { highFreq: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.highFreq ?? 5000} Hz</span>
                            </div>
                          </>
                        )}
                        {/* Compressor */}
                        {fx.type === 'compressor' && (
                          <>
                            <div className="param-control">
                              <label>Threshold</label>
                              <input type="range" min={-60} max={0} step={1} value={fx.params.threshold ?? -24}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { threshold: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.threshold ?? -24} dB</span>
                            </div>
                            <div className="param-control">
                              <label>Ratio</label>
                              <input type="range" min={1} max={20} step={0.5} value={fx.params.ratio ?? 4}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { ratio: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.ratio ?? 4}:1</span>
                            </div>
                            <div className="param-control">
                              <label>Attack</label>
                              <input type="range" min={0} max={0.1} step={0.001} value={fx.params.attack ?? 0.003}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { attack: Number(e.target.value) })} />
                              <span className="param-val">{((fx.params.attack ?? 0.003) * 1000).toFixed(1)} ms</span>
                            </div>
                            <div className="param-control">
                              <label>Release</label>
                              <input type="range" min={0.01} max={1} step={0.01} value={fx.params.release ?? 0.25}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { release: Number(e.target.value) })} />
                              <span className="param-val">{((fx.params.release ?? 0.25) * 1000).toFixed(0)} ms</span>
                            </div>
                            <div className="param-control">
                              <label>Knee</label>
                              <input type="range" min={0} max={40} step={1} value={fx.params.knee ?? 30}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { knee: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.knee ?? 30} dB</span>
                            </div>
                          </>
                        )}
                        {/* Reverb */}
                        {fx.type === 'reverb' && (
                          <>
                            <div className="param-control">
                              <label>Mix (Wet/Dry)</label>
                              <input type="range" min={0} max={1} step={0.05} value={fx.params.reverbMix ?? 0.3}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { reverbMix: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.reverbMix ?? 0.3) * 100)}%</span>
                            </div>
                            <div className="param-control">
                              <label>Decay</label>
                              <input type="range" min={0.1} max={5} step={0.1} value={fx.params.reverbDecay ?? 2.0}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { reverbDecay: Number(e.target.value) })} />
                              <span className="param-val">{(fx.params.reverbDecay ?? 2.0).toFixed(1)} s</span>
                            </div>
                          </>
                        )}
                        {/* Delay */}
                        {fx.type === 'delay' && (
                          <>
                            <div className="param-control">
                              <label>Time</label>
                              <input type="range" min={0.01} max={2} step={0.01} value={fx.params.delayTime ?? 0.3}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { delayTime: Number(e.target.value) })} />
                              <span className="param-val">{((fx.params.delayTime ?? 0.3) * 1000).toFixed(0)} ms</span>
                            </div>
                            <div className="param-control">
                              <label>Feedback</label>
                              <input type="range" min={0} max={0.9} step={0.05} value={fx.params.delayFeedback ?? 0.4}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { delayFeedback: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.delayFeedback ?? 0.4) * 100)}%</span>
                            </div>
                            <div className="param-control">
                              <label>Mix</label>
                              <input type="range" min={0} max={1} step={0.05} value={fx.params.delayMix ?? 0.25}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { delayMix: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.delayMix ?? 0.25) * 100)}%</span>
                            </div>
                          </>
                        )}
                        {/* Chorus */}
                        {fx.type === 'chorus' && (
                          <>
                            <div className="param-control">
                              <label>Rate</label>
                              <input type="range" min={0.1} max={10} step={0.1} value={fx.params.chorusRate ?? 1.5}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { chorusRate: Number(e.target.value) })} />
                              <span className="param-val">{(fx.params.chorusRate ?? 1.5).toFixed(1)} Hz</span>
                            </div>
                            <div className="param-control">
                              <label>Depth</label>
                              <input type="range" min={0.001} max={0.02} step={0.001} value={fx.params.chorusDepth ?? 0.005}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { chorusDepth: Number(e.target.value) })} />
                              <span className="param-val">{((fx.params.chorusDepth ?? 0.005) * 1000).toFixed(1)} ms</span>
                            </div>
                            <div className="param-control">
                              <label>Mix</label>
                              <input type="range" min={0} max={1} step={0.05} value={fx.params.chorusMix ?? 0.3}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { chorusMix: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.chorusMix ?? 0.3) * 100)}%</span>
                            </div>
                          </>
                        )}
                        {/* Distortion */}
                        {fx.type === 'distortion' && (
                          <>
                            <div className="param-control">
                              <label>Amount</label>
                              <input type="range" min={1} max={100} step={1} value={fx.params.distortionAmount ?? 20}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { distortionAmount: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.distortionAmount ?? 20}</span>
                            </div>
                            <div className="param-control">
                              <label>Mix</label>
                              <input type="range" min={0} max={1} step={0.05} value={fx.params.distortionMix ?? 0.3}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { distortionMix: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.distortionMix ?? 0.3) * 100)}%</span>
                            </div>
                          </>
                        )}
                        {/* Noise Gate */}
                        {fx.type === 'noiseGate' && (
                          <div className="param-control">
                            <label>Threshold</label>
                            <input type="range" min={-80} max={0} step={1} value={fx.params.gateThreshold ?? -40}
                              onChange={e => updateEffectParams(selectedTrack.id, fx.id, { gateThreshold: Number(e.target.value) })} />
                            <span className="param-val">{fx.params.gateThreshold ?? -40} dB</span>
                          </div>
                        )}
                        {/* De-Esser */}
                        {fx.type === 'deEsser' && (
                          <>
                            <div className="param-control">
                              <label>Frequency</label>
                              <input type="range" min={3000} max={12000} step={100} value={fx.params.deEsserFreq ?? 6500}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { deEsserFreq: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.deEsserFreq ?? 6500} Hz</span>
                            </div>
                            <div className="param-control">
                              <label>Reduction</label>
                              <input type="range" min={-30} max={0} step={1} value={fx.params.deEsserThreshold ?? -20}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { deEsserThreshold: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.deEsserThreshold ?? -20} dB</span>
                            </div>
                          </>
                        )}
                        {/* Autotune */}
                        {fx.type === 'autotune' && (
                          <>
                            <div className="param-control">
                              <label>Key</label>
                              <select value={fx.params.autotuneKey ?? 'C'}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { autotuneKey: e.target.value })}>
                                {MUSICAL_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                              </select>
                            </div>
                            <div className="param-control">
                              <label>Speed (Doğallık)</label>
                              <input type="range" min={1} max={10} step={1} value={fx.params.autotuneSpeed ?? 5}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { autotuneSpeed: Number(e.target.value) })} />
                              <span className="param-val">{fx.params.autotuneSpeed ?? 5} ({(fx.params.autotuneSpeed ?? 5) <= 3 ? 'Hard' : (fx.params.autotuneSpeed ?? 5) <= 7 ? 'Doğal' : 'Yumuşak'})</span>
                            </div>
                            <div className="autotune-info">
                              ℹ️ Autotune backend'de uygulanır. Parametreleri ayarladıktan sonra "Uygula" butonuna basın.
                            </div>
                          </>
                        )}
                        {/* Phaser */}
                        {fx.type === 'phaser' && (
                          <>
                            <div className="param-control">
                              <label>Rate</label>
                              <input type="range" min={0.1} max={5} step={0.1} value={fx.params.phaserRate ?? 0.5}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { phaserRate: Number(e.target.value) })} />
                              <span className="param-val">{(fx.params.phaserRate ?? 0.5).toFixed(1)} Hz</span>
                            </div>
                            <div className="param-control">
                              <label>Depth</label>
                              <input type="range" min={0} max={1} step={0.05} value={fx.params.phaserDepth ?? 0.7}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { phaserDepth: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.phaserDepth ?? 0.7) * 100)}%</span>
                            </div>
                            <div className="param-control">
                              <label>Mix</label>
                              <input type="range" min={0} max={1} step={0.05} value={fx.params.phaserMix ?? 0.3}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { phaserMix: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.phaserMix ?? 0.3) * 100)}%</span>
                            </div>
                          </>
                        )}
                        {/* Flanger */}
                        {fx.type === 'flanger' && (
                          <>
                            <div className="param-control">
                              <label>Rate</label>
                              <input type="range" min={0.05} max={2} step={0.05} value={fx.params.flangerRate ?? 0.25}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { flangerRate: Number(e.target.value) })} />
                              <span className="param-val">{(fx.params.flangerRate ?? 0.25).toFixed(2)} Hz</span>
                            </div>
                            <div className="param-control">
                              <label>Depth</label>
                              <input type="range" min={0.001} max={0.01} step={0.001} value={fx.params.flangerDepth ?? 0.003}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { flangerDepth: Number(e.target.value) })} />
                              <span className="param-val">{((fx.params.flangerDepth ?? 0.003) * 1000).toFixed(1)} ms</span>
                            </div>
                            <div className="param-control">
                              <label>Mix</label>
                              <input type="range" min={0} max={1} step={0.05} value={fx.params.flangerMix ?? 0.3}
                                onChange={e => updateEffectParams(selectedTrack.id, fx.id, { flangerMix: Number(e.target.value) })} />
                              <span className="param-val">{Math.round((fx.params.flangerMix ?? 0.3) * 100)}%</span>
                            </div>
                          </>
                        )}
                        {/* Stereo Widener */}
                        {fx.type === 'stereoWidener' && (
                          <div className="param-control">
                            <label>Width</label>
                            <input type="range" min={0} max={2} step={0.05} value={fx.params.stereoWidth ?? 1.0}
                              onChange={e => updateEffectParams(selectedTrack.id, fx.id, { stereoWidth: Number(e.target.value) })} />
                            <span className="param-val">{(fx.params.stereoWidth ?? 1.0).toFixed(1)}x</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Quick Apply hint */}
              {isPlaying && selectedTrack.effects.length > 0 && (
                <div className="apply-hint">
                  💡 Efekt değişikliklerini dinlemek için ▶️ butonuna tekrar basın
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ======== NOISE REDUCTION ======== */}
      {activeSection === 'noise' && (
        <div className="studio-section">
          <div className="section-header">
            <h3>🚫 Gürültü Azaltma & Ses Temizleme</h3>
          </div>

          <div className="noise-panel">
            <div className="noise-info-card">
              <h4>🔬 Spectral Denoising</h4>
              <p>Yapay zeka destekli spektral gürültü azaltma. Arka plan gürültüsünü, hışırtıyı ve istenmeyen sesleri temizler.</p>
            </div>

            <div className="noise-controls">
              <div className="param-control wide">
                <label>Gürültü Azaltma Gücü</label>
                <input type="range" min={0.1} max={1.0} step={0.05} value={noiseReductionStrength}
                  onChange={e => setNoiseReductionStrength(Number(e.target.value))} />
                <span className="param-val">{Math.round(noiseReductionStrength * 100)}%</span>
              </div>
              <div className="noise-strength-labels">
                <span>Hafif (Doğal)</span>
                <span>Orta</span>
                <span>Güçlü (Agresif)</span>
              </div>
            </div>

            <div className="noise-track-list">
              <h4>Track Seç ve Uygula</h4>
              {tracks.length === 0 ? (
                <p className="noise-empty">Önce Mixer sekmesinden track ekleyin.</p>
              ) : (
                tracks.filter(t => t.audioFile).map(t => (
                  <div key={t.id} className="noise-track-item">
                    <div className="noise-track-info">
                      <span className="track-color-dot" style={{ background: t.color }} />
                      <span>{t.name}</span>
                      <span className="noise-file-name">{t.audioFile?.name}</span>
                    </div>
                    <button
                      className="btn"
                      onClick={() => applyNoiseReduction(t.id)}
                      disabled={isProcessingNoise || t.isProcessing}
                    >
                      {t.isProcessing ? '⏳ İşleniyor...' : '🧹 Gürültü Temizle'}
                    </button>
                  </div>
                ))
              )}
              {tracks.filter(t => t.audioFile).length === 0 && tracks.length > 0 && (
                <p className="noise-empty">Henüz hiçbir track'e ses dosyası yüklenmedi.</p>
              )}
            </div>

            <div className="noise-tips">
              <h4>💡 İpuçları</h4>
              <ul>
                <li><strong>Hafif (%20-40):</strong> Doğal ses korunur, sadece arka plan gürültüsü temizlenir</li>
                <li><strong>Orta (%50-60):</strong> Genel amaçlı temizleme, çoğu kayıt için ideal</li>
                <li><strong>Güçlü (%70-100):</strong> Agresif temizleme, gürültülü kayıtlar için. Ses kalitesi etkilenebilir</li>
                <li>Vokal track'leri için %40-60 arası önerilir</li>
                <li>Enstrümantal track'ler için %20-40 arası yeterlidir</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ======== MIX & EXPORT ======== */}
      {activeSection === 'export' && (
        <div className="studio-section">
          <div className="section-header">
            <h3>📥 Mix & Dışa Aktar</h3>
          </div>

          <div className="export-panel">
            <div className="export-summary">
              <h4>📋 Mix Özeti</h4>
              <div className="export-tracks-list">
                {tracks.length === 0 ? (
                  <p className="export-empty">Henüz track eklenmedi.</p>
                ) : (
                  tracks.map(t => (
                    <div key={t.id} className={`export-track-item ${!t.audioFile ? 'no-file' : ''} ${t.muted ? 'muted' : ''}`}>
                      <span className="track-color-dot" style={{ background: t.color }} />
                      <span className="export-track-name">{t.name}</span>
                      <span className="export-track-status">
                        {!t.audioFile ? '❌ Dosya yok' : t.muted ? '🔇 Sessiz' : `🔊 ${t.volume}%`}
                      </span>
                      <span className="export-track-fx">{t.effects.filter(e => e.enabled).length} FX</span>
                      <span className="export-track-pan">
                        Pan: {t.pan === 0 ? 'C' : t.pan < 0 ? `L${Math.abs(t.pan)}` : `R${t.pan}`}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="export-master-info">
                <div>
                  <span>Master Volume:</span>
                  <strong>{masterVolume}%</strong>
                </div>
                <div>
                  <span>Track Sayısı:</span>
                  <strong>{tracks.filter(t => t.audioFile && !t.muted).length} / {tracks.length}</strong>
                </div>
              </div>
            </div>

            <div className="export-actions">
              <button
                className="btn export-btn"
                onClick={exportMix}
                disabled={isExporting || tracks.filter(t => t.audioFile).length === 0}
              >
                {isExporting ? (
                  <>⏳ {exportProgress}</>
                ) : (
                  <>📥 WAV Olarak Dışa Aktar</>
                )}
              </button>

              {isExporting && (
                <div className="export-progress-section">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: '60%' }} />
                  </div>
                  <p>{exportProgress}</p>
                </div>
              )}
            </div>

            <div className="export-tips">
              <h4>💡 Dışa Aktarma İpuçları</h4>
              <ul>
                <li>Tüm track'lerin volume ve pan ayarlarını kontrol edin</li>
                <li>Mute edilmiş track'ler mixa dahil edilmez</li>
                <li>Dışa aktarma WAV formatında (44.1kHz, 16-bit) yapılır</li>
                <li>Master volume son çıkış seviyesini belirler</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
