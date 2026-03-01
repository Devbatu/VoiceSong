/* ============================================================
   DAWClipEditor — Audio clip manipulation panel
   LIVE real-time effects chain, spectrum analyser, VU meters,
   waveform visualization, trim, manipulations
   ============================================================ */
import React, { useRef, useState, useCallback, useEffect, memo } from 'react'
import type { AudioClip, DAWTrack } from './useDAWEngine'
import { extractPeaks } from './useDAWEngine'

// ---- Effect preset definitions ----
interface ClipEffect {
  id: string
  type: EffectType
  enabled: boolean
  params: Record<string, number>
}

type EffectType = 'eq3' | 'reverb' | 'delay' | 'compressor' | 'distortion' | 'chorus' | 'filter' | 'phaser'

interface EffectDef {
  type: EffectType
  label: string
  emoji: string
  defaults: Record<string, number>
  paramDefs: { key: string; label: string; min: number; max: number; step: number; unit?: string }[]
}

const EFFECT_DEFS: EffectDef[] = [
  {
    type: 'eq3', label: '3-Band EQ', emoji: '📊',
    defaults: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 320, highFreq: 3200 },
    paramDefs: [
      { key: 'lowGain', label: 'Bas', min: -12, max: 12, step: 0.5, unit: 'dB' },
      { key: 'midGain', label: 'Orta', min: -12, max: 12, step: 0.5, unit: 'dB' },
      { key: 'highGain', label: 'Tiz', min: -12, max: 12, step: 0.5, unit: 'dB' },
      { key: 'lowFreq', label: 'Bas Freq', min: 60, max: 800, step: 10, unit: 'Hz' },
      { key: 'highFreq', label: 'Tiz Freq', min: 1000, max: 8000, step: 100, unit: 'Hz' },
    ],
  },
  {
    type: 'reverb', label: 'Reverb', emoji: '🏛️',
    defaults: { mix: 0.3, decay: 2.0, preDelay: 0.02 },
    paramDefs: [
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
      { key: 'decay', label: 'Decay', min: 0.1, max: 6, step: 0.1, unit: 's' },
      { key: 'preDelay', label: 'Pre-Delay', min: 0, max: 0.1, step: 0.005, unit: 's' },
    ],
  },
  {
    type: 'delay', label: 'Delay', emoji: '📡',
    defaults: { time: 0.375, feedback: 0.35, mix: 0.25 },
    paramDefs: [
      { key: 'time', label: 'Süre', min: 0.05, max: 1.5, step: 0.01, unit: 's' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.85, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    type: 'compressor', label: 'Kompresör', emoji: '🔧',
    defaults: { threshold: -18, ratio: 4, attack: 0.003, release: 0.15, knee: 6, makeupGain: 0 },
    paramDefs: [
      { key: 'threshold', label: 'Eşik', min: -60, max: 0, step: 1, unit: 'dB' },
      { key: 'ratio', label: 'Oran', min: 1, max: 20, step: 0.5 },
      { key: 'attack', label: 'Atak', min: 0, max: 0.1, step: 0.001, unit: 's' },
      { key: 'release', label: 'Bırakma', min: 0.01, max: 1, step: 0.01, unit: 's' },
      { key: 'knee', label: 'Knee', min: 0, max: 30, step: 1, unit: 'dB' },
      { key: 'makeupGain', label: 'Kazanç', min: 0, max: 24, step: 0.5, unit: 'dB' },
    ],
  },
  {
    type: 'distortion', label: 'Distorsiyon', emoji: '🔥',
    defaults: { amount: 0.3, tone: 3000 },
    paramDefs: [
      { key: 'amount', label: 'Miktar', min: 0, max: 1, step: 0.01 },
      { key: 'tone', label: 'Ton', min: 500, max: 8000, step: 100, unit: 'Hz' },
    ],
  },
  {
    type: 'chorus', label: 'Chorus', emoji: '🌊',
    defaults: { rate: 1.5, depth: 0.005, mix: 0.4 },
    paramDefs: [
      { key: 'rate', label: 'Hız', min: 0.1, max: 8, step: 0.1, unit: 'Hz' },
      { key: 'depth', label: 'Derinlik', min: 0.001, max: 0.02, step: 0.001, unit: 's' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    type: 'filter', label: 'Filtre', emoji: '🎚️',
    defaults: { frequency: 2000, q: 1, type: 0 },
    paramDefs: [
      { key: 'frequency', label: 'Frekans', min: 20, max: 18000, step: 10, unit: 'Hz' },
      { key: 'q', label: 'Q', min: 0.1, max: 15, step: 0.1 },
      { key: 'type', label: 'Tip', min: 0, max: 2, step: 1 },
    ],
  },
  {
    type: 'phaser', label: 'Phaser', emoji: '🌀',
    defaults: { rate: 0.5, depth: 2000, mix: 0.4 },
    paramDefs: [
      { key: 'rate', label: 'Hız', min: 0.1, max: 8, step: 0.1, unit: 'Hz' },
      { key: 'depth', label: 'Derinlik', min: 100, max: 5000, step: 50, unit: 'Hz' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01 },
    ],
  },
]

const FILTER_TYPES = ['Lowpass', 'Highpass', 'Bandpass']

// ---- Utility ----
let _eid = 0
const eid = () => `fx_${Date.now()}_${++_eid}`

function makeDistCurve(amount: number, samples = 256): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples)
  const k = amount * 100
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve as Float32Array<ArrayBuffer>
}

function buildReverbIR(ctx: BaseAudioContext, sr: number, decay: number): AudioBuffer {
  const len = Math.ceil(sr * Math.min(decay, 6))
  const buf = ctx.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp((-i / sr) * (3.0 / decay))
    }
  }
  return buf
}

// ---- Live FX node tracking ----
interface LiveFxNode {
  fxId: string
  inputNode: AudioNode
  outputNode: AudioNode
  updateParam: (key: string, value: number) => void
  oscillators: OscillatorNode[]
  analyser: AnalyserNode
}

interface LiveChain {
  inputGain: GainNode
  inputAnalyser: AnalyserNode
  outputAnalyser: AnalyserNode
  outputGain: GainNode
  fxNodes: LiveFxNode[]
}

// ---- Props ----
interface Props {
  clip: AudioClip | null
  track: DAWTrack | null
  bpm: number
  onClipUpdate: (trackId: string, clipId: string, changes: Partial<AudioClip>) => void
  onClose: () => void
}

const DAWClipEditor: React.FC<Props> = memo(({ clip, track, bpm, onClipUpdate, onClose }) => {
  // Canvas refs
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null)
  const vuCanvasRef = useRef<HTMLCanvasElement>(null)

  // Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const fadeGainRef = useRef<GainNode | null>(null)
  const liveChainRef = useRef<LiveChain | null>(null)
  const rafRef = useRef<number>(0)
  const playStartTimeRef = useRef(0)
  const playDurationRef = useRef(0)
  const fxLevelsRef = useRef<Map<string, number>>(new Map())

  // State
  const [tab, setTab] = useState<'trim' | 'effects' | 'manipulate'>('trim')
  const [effects, setEffects] = useState<ClipEffect[]>([])
  const [expandedFx, setExpandedFx] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [processStatus, setProcessStatus] = useState<string | null>(null)
  const [playheadPos, setPlayheadPos] = useState(0)
  const [inputLevel, setInputLevel] = useState(-60)
  const [outputLevel, setOutputLevel] = useState(-60)
  const [fxLevels, setFxLevels] = useState<Map<string, number>>(new Map())
  const [loopEnabled, setLoopEnabled] = useState(false)

  // Trim state
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(1)
  const [clipGain, setClipGain] = useState(1)
  const [clipFadeIn, setClipFadeIn] = useState(0)
  const [clipFadeOut, setClipFadeOut] = useState(0)

  // Sync from clip
  useEffect(() => {
    if (!clip) return
    setClipGain(clip.gain)
    setClipFadeIn(clip.fadeIn)
    setClipFadeOut(clip.fadeOut)
    setTrimStart(0)
    setTrimEnd(1)
    setEffects([])
  }, [clip?.id])

  // ============================================================
  // AUDIO CONTEXT — persistent
  // ============================================================
  const getAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }, [])

  // ============================================================
  // BUILD LIVE EFFECT CHAIN
  // inputGain → inputAnalyser → [fx1 → fx2 → ...] → outputAnalyser → outputGain → destination
  // ============================================================
  const buildLiveChain = useCallback((ctx: AudioContext, fxList: ClipEffect[]): LiveChain => {
    const inputGain = ctx.createGain()
    inputGain.gain.value = 1

    const inputAnalyser = ctx.createAnalyser()
    inputAnalyser.fftSize = 2048
    inputAnalyser.smoothingTimeConstant = 0.8

    const outputAnalyser = ctx.createAnalyser()
    outputAnalyser.fftSize = 2048
    outputAnalyser.smoothingTimeConstant = 0.8

    const outputGain = ctx.createGain()
    outputGain.gain.value = 1

    inputGain.connect(inputAnalyser)

    let lastNode: AudioNode = inputAnalyser
    const fxNodes: LiveFxNode[] = []
    const activeFx = fxList.filter(fx => fx.enabled)

    for (const fx of activeFx) {
      const fxAnalyser = ctx.createAnalyser()
      fxAnalyser.fftSize = 256
      fxAnalyser.smoothingTimeConstant = 0.85

      const oscs: OscillatorNode[] = []
      let fxInput: AudioNode
      let fxOutput: AudioNode
      let updateParam: (key: string, value: number) => void

      switch (fx.type) {
        case 'eq3': {
          const low = ctx.createBiquadFilter()
          low.type = 'lowshelf'; low.frequency.value = fx.params.lowFreq; low.gain.value = fx.params.lowGain
          const mid = ctx.createBiquadFilter()
          mid.type = 'peaking'; mid.frequency.value = Math.sqrt(fx.params.lowFreq * fx.params.highFreq); mid.Q.value = 0.7; mid.gain.value = fx.params.midGain
          const high = ctx.createBiquadFilter()
          high.type = 'highshelf'; high.frequency.value = fx.params.highFreq; high.gain.value = fx.params.highGain
          low.connect(mid); mid.connect(high)
          fxInput = low; fxOutput = high
          updateParam = (key, val) => {
            switch (key) {
              case 'lowGain': low.gain.value = val; break
              case 'midGain': mid.gain.value = val; break
              case 'highGain': high.gain.value = val; break
              case 'lowFreq': low.frequency.value = val; mid.frequency.value = Math.sqrt(val * high.frequency.value); break
              case 'highFreq': high.frequency.value = val; mid.frequency.value = Math.sqrt(low.frequency.value * val); break
            }
          }
          break
        }
        case 'reverb': {
          const dry = ctx.createGain(); dry.gain.value = 1 - fx.params.mix
          const wet = ctx.createGain(); wet.gain.value = fx.params.mix
          const conv = ctx.createConvolver()
          conv.buffer = buildReverbIR(ctx, ctx.sampleRate, fx.params.decay)
          const merge = ctx.createGain(); merge.gain.value = 1
          const split = ctx.createGain(); split.gain.value = 1
          split.connect(dry); dry.connect(merge)
          split.connect(conv); conv.connect(wet); wet.connect(merge)
          fxInput = split; fxOutput = merge
          updateParam = (key, val) => {
            switch (key) {
              case 'mix': dry.gain.value = 1 - val; wet.gain.value = val; break
              case 'decay': conv.buffer = buildReverbIR(ctx, ctx.sampleRate, val); break
            }
          }
          break
        }
        case 'delay': {
          const dry = ctx.createGain(); dry.gain.value = 1 - fx.params.mix
          const wet = ctx.createGain(); wet.gain.value = fx.params.mix
          const dn = ctx.createDelay(5); dn.delayTime.value = fx.params.time
          const fb = ctx.createGain(); fb.gain.value = fx.params.feedback
          const merge = ctx.createGain(); merge.gain.value = 1
          const split = ctx.createGain(); split.gain.value = 1
          split.connect(dry); dry.connect(merge)
          split.connect(dn); dn.connect(fb); fb.connect(dn); dn.connect(wet); wet.connect(merge)
          fxInput = split; fxOutput = merge
          updateParam = (key, val) => {
            switch (key) {
              case 'time': dn.delayTime.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'feedback': fb.gain.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'mix': dry.gain.setTargetAtTime(1 - val, ctx.currentTime, 0.02); wet.gain.setTargetAtTime(val, ctx.currentTime, 0.02); break
            }
          }
          break
        }
        case 'compressor': {
          const comp = ctx.createDynamicsCompressor()
          comp.threshold.value = fx.params.threshold; comp.ratio.value = fx.params.ratio
          comp.attack.value = fx.params.attack; comp.release.value = fx.params.release; comp.knee.value = fx.params.knee
          const makeup = ctx.createGain(); makeup.gain.value = Math.pow(10, fx.params.makeupGain / 20)
          comp.connect(makeup)
          fxInput = comp; fxOutput = makeup
          updateParam = (key, val) => {
            switch (key) {
              case 'threshold': comp.threshold.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'ratio': comp.ratio.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'attack': comp.attack.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'release': comp.release.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'knee': comp.knee.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'makeupGain': makeup.gain.setTargetAtTime(Math.pow(10, val / 20), ctx.currentTime, 0.02); break
            }
          }
          break
        }
        case 'distortion': {
          const ws = ctx.createWaveShaper()
          ws.curve = makeDistCurve(fx.params.amount); ws.oversample = '4x'
          const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = fx.params.tone
          ws.connect(tone)
          fxInput = ws; fxOutput = tone
          updateParam = (key, val) => {
            switch (key) {
              case 'amount': ws.curve = makeDistCurve(val); break
              case 'tone': tone.frequency.setTargetAtTime(val, ctx.currentTime, 0.02); break
            }
          }
          break
        }
        case 'chorus': {
          const dry = ctx.createGain(); dry.gain.value = 1 - fx.params.mix
          const wet = ctx.createGain(); wet.gain.value = fx.params.mix
          const dL = ctx.createDelay(0.1); dL.delayTime.value = fx.params.depth
          const dR = ctx.createDelay(0.1); dR.delayTime.value = fx.params.depth * 1.3
          const lfo = ctx.createOscillator(); lfo.frequency.value = fx.params.rate
          const lfoG = ctx.createGain(); lfoG.gain.value = fx.params.depth * 0.5
          lfo.connect(lfoG); lfoG.connect(dL.delayTime); lfoG.connect(dR.delayTime); lfo.start()
          oscs.push(lfo)
          const merge = ctx.createGain(); merge.gain.value = 1
          const split = ctx.createGain(); split.gain.value = 1
          split.connect(dry); dry.connect(merge)
          split.connect(dL); dL.connect(wet); split.connect(dR); dR.connect(wet); wet.connect(merge)
          fxInput = split; fxOutput = merge
          updateParam = (key, val) => {
            switch (key) {
              case 'rate': lfo.frequency.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'depth':
                dL.delayTime.setTargetAtTime(val, ctx.currentTime, 0.02)
                dR.delayTime.setTargetAtTime(val * 1.3, ctx.currentTime, 0.02)
                lfoG.gain.setTargetAtTime(val * 0.5, ctx.currentTime, 0.02)
                break
              case 'mix': dry.gain.setTargetAtTime(1 - val, ctx.currentTime, 0.02); wet.gain.setTargetAtTime(val, ctx.currentTime, 0.02); break
            }
          }
          break
        }
        case 'filter': {
          const flt = ctx.createBiquadFilter()
          const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass']
          flt.type = types[Math.round(fx.params.type)] || 'lowpass'
          flt.frequency.value = fx.params.frequency; flt.Q.value = fx.params.q
          fxInput = flt; fxOutput = flt
          updateParam = (key, val) => {
            switch (key) {
              case 'frequency': flt.frequency.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'q': flt.Q.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'type': flt.type = (['lowpass', 'highpass', 'bandpass'] as BiquadFilterType[])[Math.round(val)] || 'lowpass'; break
            }
          }
          break
        }
        case 'phaser': {
          const dry = ctx.createGain(); dry.gain.value = 1 - fx.params.mix
          const wet = ctx.createGain(); wet.gain.value = fx.params.mix
          const stages: BiquadFilterNode[] = []
          for (let s = 0; s < 4; s++) {
            const ap = ctx.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 1000 + s * 500; ap.Q.value = 0.5; stages.push(ap)
          }
          const lfo = ctx.createOscillator(); lfo.frequency.value = fx.params.rate
          const lfoG = ctx.createGain(); lfoG.gain.value = fx.params.depth
          lfo.connect(lfoG); stages.forEach(s => lfoG.connect(s.frequency)); lfo.start()
          oscs.push(lfo)
          for (let i = 1; i < stages.length; i++) stages[i - 1].connect(stages[i])
          const merge = ctx.createGain(); merge.gain.value = 1
          const split = ctx.createGain(); split.gain.value = 1
          split.connect(dry); dry.connect(merge)
          split.connect(stages[0]); stages[stages.length - 1].connect(wet); wet.connect(merge)
          fxInput = split; fxOutput = merge
          updateParam = (key, val) => {
            switch (key) {
              case 'rate': lfo.frequency.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'depth': lfoG.gain.setTargetAtTime(val, ctx.currentTime, 0.02); break
              case 'mix': dry.gain.setTargetAtTime(1 - val, ctx.currentTime, 0.02); wet.gain.setTargetAtTime(val, ctx.currentTime, 0.02); break
            }
          }
          break
        }
        default: {
          const pass = ctx.createGain(); pass.gain.value = 1
          fxInput = pass; fxOutput = pass
          updateParam = () => {}
        }
      }

      fxOutput.connect(fxAnalyser)
      fxNodes.push({ fxId: fx.id, inputNode: fxInput, outputNode: fxOutput, updateParam, oscillators: oscs, analyser: fxAnalyser })
    }

    // Wire chain
    if (fxNodes.length > 0) {
      lastNode.connect(fxNodes[0].inputNode)
      for (let i = 1; i < fxNodes.length; i++) fxNodes[i - 1].outputNode.connect(fxNodes[i].inputNode)
      fxNodes[fxNodes.length - 1].outputNode.connect(outputAnalyser)
    } else {
      lastNode.connect(outputAnalyser)
    }
    outputAnalyser.connect(outputGain)
    outputGain.connect(ctx.destination)

    return { inputGain, inputAnalyser, outputAnalyser, outputGain, fxNodes }
  }, [])

  // ============================================================
  // TEARDOWN LIVE CHAIN
  // ============================================================
  const teardownChain = useCallback(() => {
    const chain = liveChainRef.current
    if (!chain) return
    try {
      chain.fxNodes.forEach(n => n.oscillators.forEach(o => { try { o.stop() } catch {} }))
      chain.inputGain.disconnect()
      chain.inputAnalyser.disconnect()
      chain.outputAnalyser.disconnect()
      chain.outputGain.disconnect()
      chain.fxNodes.forEach(n => { try { n.inputNode.disconnect() } catch {}; try { n.outputNode.disconnect() } catch {}; try { n.analyser.disconnect() } catch {} })
    } catch {}
    liveChainRef.current = null
  }, [])

  // ============================================================
  // REBUILD CHAIN (preserving playback if active)
  // ============================================================
  const rebuildChain = useCallback((newEffects: ClipEffect[]) => {
    const ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'closed') return

    const oldSource = sourceRef.current
    const oldFadeGain = fadeGainRef.current

    // Disconnect fadeGain from old chain
    if (oldFadeGain) { try { oldFadeGain.disconnect() } catch {} }

    teardownChain()

    const chain = buildLiveChain(ctx, newEffects)
    liveChainRef.current = chain

    // Reconnect source if playing
    if (oldSource && oldFadeGain) {
      oldFadeGain.connect(chain.inputGain)
    }
  }, [buildLiveChain, teardownChain])

  // ============================================================
  // UPDATE LIVE PARAM — instant real-time
  // ============================================================
  const updateLiveParam = useCallback((fxId: string, key: string, value: number) => {
    const chain = liveChainRef.current
    if (!chain) return
    const node = chain.fxNodes.find(n => n.fxId === fxId)
    if (node) node.updateParam(key, value)
  }, [])

  // ============================================================
  // PLAY PREVIEW with live chain
  // ============================================================
  const stopPreview = useCallback(() => {
    try { sourceRef.current?.stop() } catch {}
    sourceRef.current = null
    fadeGainRef.current = null
    setIsPlaying(false)
    cancelAnimationFrame(rafRef.current)
    setPlayheadPos(0)
    setInputLevel(-60)
    setOutputLevel(-60)
  }, [])

  const playPreview = useCallback(() => {
    if (!clip?.buffer) return
    stopPreview()

    const ctx = getAudioCtx()

    // Build chain
    teardownChain()
    const chain = buildLiveChain(ctx, effects)
    liveChainRef.current = chain

    // Source
    const src = ctx.createBufferSource()
    src.buffer = clip.buffer
    src.loop = loopEnabled

    // Fade/gain node
    const fg = ctx.createGain()
    fg.gain.value = clipGain
    src.connect(fg)
    fg.connect(chain.inputGain)
    fadeGainRef.current = fg

    const dur = clip.buffer.duration
    const startSec = trimStart * dur
    const endSec = trimEnd * dur
    const playDur = endSec - startSec

    // Fades
    if (clipFadeIn > 0) {
      fg.gain.setValueAtTime(0, ctx.currentTime)
      fg.gain.linearRampToValueAtTime(clipGain, ctx.currentTime + Math.min(clipFadeIn, playDur))
    }
    if (clipFadeOut > 0 && !loopEnabled) {
      fg.gain.setValueAtTime(clipGain, ctx.currentTime + Math.max(0, playDur - clipFadeOut))
      fg.gain.linearRampToValueAtTime(0, ctx.currentTime + playDur)
    }

    if (loopEnabled) {
      src.loopStart = startSec
      src.loopEnd = endSec
      src.start(0, startSec)
    } else {
      src.start(0, startSec, playDur)
    }

    sourceRef.current = src
    playStartTimeRef.current = ctx.currentTime
    playDurationRef.current = playDur
    setIsPlaying(true)

    src.onended = () => {
      if (sourceRef.current === src) {
        setIsPlaying(false)
        sourceRef.current = null
        fadeGainRef.current = null
        setPlayheadPos(0)
      }
    }
  }, [clip?.buffer, effects, trimStart, trimEnd, clipGain, clipFadeIn, clipFadeOut, loopEnabled, getAudioCtx, buildLiveChain, teardownChain, stopPreview])

  // ============================================================
  // VISUALIZATION ANIMATION LOOP
  // ============================================================
  useEffect(() => {
    if (!isPlaying) return

    const inputBuf = new Uint8Array(1024)
    const outputBuf = new Uint8Array(1024)
    const fftBuf = new Uint8Array(1024)
    const fxBufs = new Map<string, Uint8Array>()

    const animate = () => {
      const chain = liveChainRef.current
      const ctx = audioCtxRef.current
      if (!chain || !ctx) { rafRef.current = requestAnimationFrame(animate); return }

      // Input level
      chain.inputAnalyser.getByteTimeDomainData(inputBuf)
      let inPeak = 0
      for (let i = 0; i < inputBuf.length; i++) { const v = Math.abs((inputBuf[i] - 128) / 128); if (v > inPeak) inPeak = v }
      const inDb = inPeak > 0 ? 20 * Math.log10(inPeak) : -60
      setInputLevel(Math.max(-60, inDb))

      // Output level
      chain.outputAnalyser.getByteTimeDomainData(outputBuf)
      let outPeak = 0
      for (let i = 0; i < outputBuf.length; i++) { const v = Math.abs((outputBuf[i] - 128) / 128); if (v > outPeak) outPeak = v }
      const outDb = outPeak > 0 ? 20 * Math.log10(outPeak) : -60
      setOutputLevel(Math.max(-60, outDb))

      // Per-effect levels
      const newLevels = new Map<string, number>()
      chain.fxNodes.forEach(n => {
        let buf = fxBufs.get(n.fxId)
        if (!buf) { buf = new Uint8Array(128); fxBufs.set(n.fxId, buf) }
        n.analyser.getByteTimeDomainData(buf)
        let pk = 0
        for (let i = 0; i < buf.length; i++) { const v = Math.abs((buf[i] - 128) / 128); if (v > pk) pk = v }
        newLevels.set(n.fxId, pk)
      })
      fxLevelsRef.current = newLevels
      setFxLevels(new Map(newLevels))

      // Playhead
      const elapsed = ctx.currentTime - playStartTimeRef.current
      const dur = playDurationRef.current
      if (dur > 0) setPlayheadPos(loopEnabled ? (elapsed % dur) / dur : Math.min(elapsed / dur, 1))

      // Draw spectrum
      drawSpectrum(chain.outputAnalyser, fftBuf)
      // Draw VU
      drawVU(inDb, outDb)

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, loopEnabled])

  // ============================================================
  // DRAW SPECTRUM ANALYZER
  // ============================================================
  const drawSpectrum = useCallback((analyser: AnalyserNode, buf: Uint8Array) => {
    const canvas = spectrumCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      ctx.scale(dpr, dpr)
    }
    const w = rect.width; const h = rect.height

    analyser.getByteFrequencyData(buf)

    ctx.clearRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1
    for (let y = 0; y < h; y += h / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

    const barCount = Math.min(128, buf.length)
    const barW = w / barCount
    const maxH = h * 0.95

    for (let i = 0; i < barCount; i++) {
      const val = buf[i] / 255
      const barH = val * maxH
      const x = i * barW
      const hue = 240 - (i / barCount) * 280
      const sat = 70 + val * 30
      const light = 30 + val * 40
      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`
      ctx.fillRect(x, h - barH, Math.max(barW - 1, 1), barH)
      if (val > 0.3) {
        ctx.fillStyle = `hsla(${hue}, 90%, 70%, ${val * 0.6})`
        ctx.fillRect(x, h - barH, Math.max(barW - 1, 1), 3)
      }
    }

    // Freq labels
    ctx.fillStyle = '#555'; ctx.font = '9px monospace'
    const sr = audioCtxRef.current?.sampleRate || 44100
    ;[100, 500, 1000, 5000, 10000].forEach(f => {
      const idx = Math.round((f / (sr / 2)) * barCount)
      if (idx < barCount) ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, idx * barW, h - 2)
    })
  }, [])

  // ============================================================
  // DRAW VU METERS
  // ============================================================
  const drawVU = useCallback((inDb: number, outDb: number) => {
    const canvas = vuCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      ctx.scale(dpr, dpr)
    }
    const w = rect.width; const h = rect.height

    ctx.clearRect(0, 0, w, h)

    const drawMeter = (y: number, mh: number, db: number, label: string, color: string) => {
      const level = Math.max(0, (db + 60) / 60)
      const barW = level * (w - 50)
      ctx.fillStyle = '#0a0a18'; ctx.fillRect(44, y, w - 50, mh)
      if (barW > 0) {
        const grad = ctx.createLinearGradient(44, 0, w - 6, 0)
        grad.addColorStop(0, color); grad.addColorStop(0.7, color); grad.addColorStop(0.85, '#f59e0b'); grad.addColorStop(1, '#ef4444')
        ctx.fillStyle = grad; ctx.fillRect(44, y, barW, mh)
      }
      ctx.fillStyle = '#333'
      ;[-48, -36, -24, -12, -6, 0].forEach(t => { ctx.fillRect(44 + ((t + 60) / 60) * (w - 50), y, 1, mh) })
      ctx.fillStyle = '#888'; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.fillText(label, 2, y + mh - 2)
      ctx.fillStyle = level > 0.9 ? '#ef4444' : '#aaa'; ctx.textAlign = 'right'; ctx.fillText(`${db.toFixed(1)}`, w - 2, y + mh - 2); ctx.textAlign = 'left'
    }

    drawMeter(2, 14, inDb, 'IN', '#22c55e')
    drawMeter(20, 14, outDb, 'OUT', '#6366f1')
  }, [])

  // ============================================================
  // DRAW WAVEFORM with playhead
  // ============================================================
  useEffect(() => {
    if (!clip?.buffer || !waveformCanvasRef.current) return
    const canvas = waveformCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr)
    ctx.scale(dpr, dpr)
    const w = rect.width; const h = rect.height
    const peaks = extractPeaks(clip.buffer, Math.floor(w))

    ctx.clearRect(0, 0, w, h)
    const trimStartPx = trimStart * w; const trimEndPx = trimEnd * w

    // Dimmed
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, trimStartPx, h); ctx.fillRect(trimEndPx, 0, w - trimEndPx, h)

    // Waveform
    const mid = h / 2
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * w; const amp = peaks[i] * mid * 0.9
      const inTrim = x >= trimStartPx && x <= trimEndPx
      ctx.fillStyle = inTrim ? (track?.color || '#6366f1') : '#333'
      ctx.fillRect(x, mid - amp, 1.2, amp * 2)
    }

    // Fades
    if (clipFadeIn > 0 && clip.buffer) {
      const fp = (clipFadeIn / clip.buffer.duration) * w
      const g = ctx.createLinearGradient(trimStartPx, 0, trimStartPx + fp, 0)
      g.addColorStop(0, 'rgba(100, 200, 255, 0.35)'); g.addColorStop(1, 'rgba(100, 200, 255, 0)')
      ctx.fillStyle = g; ctx.fillRect(trimStartPx, 0, fp, h)
      ctx.strokeStyle = '#64c8ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(trimStartPx, h); ctx.lineTo(trimStartPx + fp, 0); ctx.stroke()
    }
    if (clipFadeOut > 0 && clip.buffer) {
      const fp = (clipFadeOut / clip.buffer.duration) * w
      const g = ctx.createLinearGradient(trimEndPx - fp, 0, trimEndPx, 0)
      g.addColorStop(0, 'rgba(255, 100, 100, 0)'); g.addColorStop(1, 'rgba(255, 100, 100, 0.35)')
      ctx.fillStyle = g; ctx.fillRect(trimEndPx - fp, 0, fp, h)
      ctx.strokeStyle = '#ff6464'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(trimEndPx - fp, 0); ctx.lineTo(trimEndPx, h); ctx.stroke()
    }

    // Trim handles
    ctx.fillStyle = '#ffcc00'; ctx.fillRect(trimStartPx - 2, 0, 4, h); ctx.fillRect(trimEndPx - 2, 0, 4, h)

    // Time
    ctx.fillStyle = '#888'; ctx.font = '10px monospace'
    const dur = clip.buffer.duration
    const step = dur > 30 ? 5 : dur > 10 ? 2 : dur > 5 ? 1 : 0.5
    for (let t = 0; t <= dur; t += step) {
      const x = (t / dur) * w
      ctx.fillText(t.toFixed(1) + 's', x + 3, 12); ctx.fillStyle = '#444'; ctx.fillRect(x, 0, 1, h); ctx.fillStyle = '#888'
    }

    // Playhead
    if (isPlaying && playheadPos > 0) {
      const phx = trimStartPx + playheadPos * (trimEndPx - trimStartPx)
      ctx.save()
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 10
      ctx.fillStyle = '#fff'; ctx.fillRect(phx - 1, 0, 2, h)
      ctx.restore()
      // Time indicator
      const timeSec = trimStart * dur + playheadPos * (trimEnd - trimStart) * dur
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'
      ctx.fillText(timeSec.toFixed(1) + 's', phx + 4, h - 4)
    }
  }, [clip?.buffer, trimStart, trimEnd, clipFadeIn, clipFadeOut, track?.color, isPlaying, playheadPos])

  // ============================================================
  // EFFECT MANAGEMENT with live chain rebuild
  // ============================================================
  const addEffect = useCallback((type: EffectType) => {
    const def = EFFECT_DEFS.find(d => d.type === type)
    if (!def) return
    const fx: ClipEffect = { id: eid(), type, enabled: true, params: { ...def.defaults } }
    setEffects(prev => {
      const next = [...prev, fx]
      if (isPlaying) rebuildChain(next)
      return next
    })
    setExpandedFx(fx.id)
  }, [isPlaying, rebuildChain])

  const removeEffect = useCallback((fxId: string) => {
    setEffects(prev => {
      const next = prev.filter(f => f.id !== fxId)
      if (isPlaying) rebuildChain(next)
      return next
    })
    if (expandedFx === fxId) setExpandedFx(null)
  }, [expandedFx, isPlaying, rebuildChain])

  const toggleEffect = useCallback((fxId: string) => {
    setEffects(prev => {
      const next = prev.map(f => f.id === fxId ? { ...f, enabled: !f.enabled } : f)
      if (isPlaying) rebuildChain(next)
      return next
    })
  }, [isPlaying, rebuildChain])

  const updateEffectParam = useCallback((fxId: string, key: string, value: number) => {
    setEffects(prev => prev.map(f => f.id === fxId ? { ...f, params: { ...f.params, [key]: value } } : f))
    updateLiveParam(fxId, key, value)
  }, [updateLiveParam])

  // Cleanup
  useEffect(() => {
    return () => {
      stopPreview()
      teardownChain()
      try { audioCtxRef.current?.close() } catch {}
    }
  }, [])

  // ============================================================
  // APPLY TRIM
  // ============================================================
  const applyTrim = useCallback(() => {
    if (!clip || !track || !clip.buffer) return
    const dur = clip.buffer.duration; const startSec = trimStart * dur; const endSec = trimEnd * dur; const trimDurSec = endSec - startSec
    const sr = clip.buffer.sampleRate; const ch = clip.buffer.numberOfChannels
    const startSample = Math.floor(startSec * sr); const endSample = Math.floor(endSec * sr); const newLen = endSample - startSample
    if (newLen <= 0) return
    const nb = new AudioBuffer({ length: newLen, sampleRate: sr, numberOfChannels: ch })
    for (let c = 0; c < ch; c++) { const s = clip.buffer.getChannelData(c); const d = nb.getChannelData(c); for (let i = 0; i < newLen; i++) d[i] = s[startSample + i] }
    if (clipFadeIn > 0) { const fs = Math.floor(clipFadeIn * sr); for (let c = 0; c < ch; c++) { const d = nb.getChannelData(c); for (let i = 0; i < Math.min(fs, newLen); i++) d[i] *= i / fs } }
    if (clipFadeOut > 0) { const fs = Math.floor(clipFadeOut * sr); for (let c = 0; c < ch; c++) { const d = nb.getChannelData(c); for (let i = 0; i < Math.min(fs, newLen); i++) d[newLen - 1 - i] *= i / fs } }
    const durationBeats = (trimDurSec / 60) * bpm
    const peaks = extractPeaks(nb, Math.max(200, Math.floor(durationBeats * 40)))
    onClipUpdate(track.id, clip.id, { buffer: nb, waveformPeaks: peaks, durationBeats, offsetBeats: 0, gain: clipGain, fadeIn: clipFadeIn, fadeOut: clipFadeOut })
    setTrimStart(0); setTrimEnd(1)
    setProcessStatus('Kırpma uygulandı!'); setTimeout(() => setProcessStatus(null), 2500)
  }, [clip, track, trimStart, trimEnd, clipGain, clipFadeIn, clipFadeOut, bpm, onClipUpdate])

  // ============================================================
  // APPLY EFFECTS (bake to buffer)
  // ============================================================
  const applyEffects = useCallback(async () => {
    if (!clip?.buffer || !track || effects.length === 0) return
    setProcessStatus('Efektler uygulanıyor...')
    const srcBuf = clip.buffer; const sr = srcBuf.sampleRate; const ch = srcBuf.numberOfChannels; const len = srcBuf.length; const dur = srcBuf.duration

    try {
      const offline = new OfflineAudioContext(ch, len, sr)
      const src = offline.createBufferSource(); src.buffer = srcBuf
      let lastNode: AudioNode = src
      const activeEffects = effects.filter(fx => fx.enabled)

      for (const fx of activeEffects) {
        switch (fx.type) {
          case 'eq3': {
            const low = offline.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = fx.params.lowFreq; low.gain.value = fx.params.lowGain
            const mid = offline.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = Math.sqrt(fx.params.lowFreq * fx.params.highFreq); mid.Q.value = 0.7; mid.gain.value = fx.params.midGain
            const high = offline.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = fx.params.highFreq; high.gain.value = fx.params.highGain
            lastNode.connect(low); low.connect(mid); mid.connect(high); lastNode = high; break
          }
          case 'reverb': {
            const dry = offline.createGain(); dry.gain.value = 1 - fx.params.mix; const wet = offline.createGain(); wet.gain.value = fx.params.mix
            const conv = offline.createConvolver(); conv.buffer = buildReverbIR(offline, sr, fx.params.decay)
            const merge = offline.createGain(); merge.gain.value = 1
            lastNode.connect(dry); dry.connect(merge); lastNode.connect(conv); conv.connect(wet); wet.connect(merge); lastNode = merge; break
          }
          case 'delay': {
            const dry = offline.createGain(); dry.gain.value = 1 - fx.params.mix; const wet = offline.createGain(); wet.gain.value = fx.params.mix
            const dn = offline.createDelay(5); dn.delayTime.value = fx.params.time; const fb = offline.createGain(); fb.gain.value = fx.params.feedback
            const merge = offline.createGain(); merge.gain.value = 1
            lastNode.connect(dry); dry.connect(merge); lastNode.connect(dn); dn.connect(fb); fb.connect(dn); dn.connect(wet); wet.connect(merge); lastNode = merge; break
          }
          case 'compressor': {
            const comp = offline.createDynamicsCompressor(); comp.threshold.value = fx.params.threshold; comp.ratio.value = fx.params.ratio; comp.attack.value = fx.params.attack; comp.release.value = fx.params.release; comp.knee.value = fx.params.knee
            const mu = offline.createGain(); mu.gain.value = Math.pow(10, fx.params.makeupGain / 20)
            lastNode.connect(comp); comp.connect(mu); lastNode = mu; break
          }
          case 'distortion': {
            const ws = offline.createWaveShaper(); ws.curve = makeDistCurve(fx.params.amount); ws.oversample = '4x'
            const tone = offline.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = fx.params.tone
            lastNode.connect(ws); ws.connect(tone); lastNode = tone; break
          }
          case 'chorus': {
            const dry = offline.createGain(); dry.gain.value = 1 - fx.params.mix; const wet = offline.createGain(); wet.gain.value = fx.params.mix
            const dL = offline.createDelay(0.1); dL.delayTime.value = fx.params.depth; const dR = offline.createDelay(0.1); dR.delayTime.value = fx.params.depth * 1.3
            const lfo = offline.createOscillator(); lfo.frequency.value = fx.params.rate; const lg = offline.createGain(); lg.gain.value = fx.params.depth * 0.5
            lfo.connect(lg); lg.connect(dL.delayTime); lg.connect(dR.delayTime); lfo.start(0)
            const merge = offline.createGain(); merge.gain.value = 1
            lastNode.connect(dry); dry.connect(merge); lastNode.connect(dL); dL.connect(wet); lastNode.connect(dR); dR.connect(wet); wet.connect(merge); lastNode = merge; break
          }
          case 'filter': {
            const flt = offline.createBiquadFilter(); const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass']
            flt.type = types[Math.round(fx.params.type)] || 'lowpass'; flt.frequency.value = fx.params.frequency; flt.Q.value = fx.params.q
            lastNode.connect(flt); lastNode = flt; break
          }
          case 'phaser': {
            const dry = offline.createGain(); dry.gain.value = 1 - fx.params.mix; const wet = offline.createGain(); wet.gain.value = fx.params.mix
            const stages: BiquadFilterNode[] = []
            for (let s = 0; s < 4; s++) { const ap = offline.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 1000 + s * 500; ap.Q.value = 0.5; stages.push(ap) }
            const lfo = offline.createOscillator(); lfo.frequency.value = fx.params.rate; const lg = offline.createGain(); lg.gain.value = fx.params.depth
            lfo.connect(lg); stages.forEach(s => lg.connect(s.frequency)); lfo.start(0)
            let prev: AudioNode = lastNode; for (const s of stages) { prev.connect(s); prev = s }
            const merge = offline.createGain(); merge.gain.value = 1
            lastNode.connect(dry); dry.connect(merge); prev.connect(wet); wet.connect(merge); lastNode = merge; break
          }
        }
      }

      lastNode.connect(offline.destination); src.start(0)
      const rendered = await offline.startRendering()
      const durationBeats = (dur / 60) * bpm
      const peaks = extractPeaks(rendered, Math.max(200, Math.floor(durationBeats * 40)))
      onClipUpdate(track.id, clip.id, { buffer: rendered, waveformPeaks: peaks })
      setEffects([]) // clear effects after baking
      setProcessStatus('Efektler kalıcı uygulandı!'); setTimeout(() => setProcessStatus(null), 2500)
    } catch (e) {
      console.error('Effect processing failed:', e)
      setProcessStatus('Hata oluştu!'); setTimeout(() => setProcessStatus(null), 3000)
    }
  }, [clip, track, effects, bpm, onClipUpdate])

  // ============================================================
  // MANIPULATIONS
  // ============================================================
  const normalizeClip = useCallback(() => {
    if (!clip?.buffer || !track) return
    const buf = clip.buffer; const sr = buf.sampleRate; const ch = buf.numberOfChannels; const len = buf.length
    let peak = 0
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a } }
    if (peak === 0) return
    const g = 0.98 / peak
    const nb = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: ch })
    for (let c = 0; c < ch; c++) { const s = buf.getChannelData(c); const d = nb.getChannelData(c); for (let i = 0; i < len; i++) d[i] = s[i] * g }
    const db = (buf.duration / 60) * bpm
    onClipUpdate(track.id, clip.id, { buffer: nb, waveformPeaks: extractPeaks(nb, Math.max(200, Math.floor(db * 40))) })
    setProcessStatus('Normalize uygulandı!'); setTimeout(() => setProcessStatus(null), 2500)
  }, [clip, track, bpm, onClipUpdate])

  const reverseClip = useCallback(() => {
    if (!clip?.buffer || !track) return
    const buf = clip.buffer; const sr = buf.sampleRate; const ch = buf.numberOfChannels; const len = buf.length
    const nb = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: ch })
    for (let c = 0; c < ch; c++) { const s = buf.getChannelData(c); const d = nb.getChannelData(c); for (let i = 0; i < len; i++) d[i] = s[len - 1 - i] }
    const db = (buf.duration / 60) * bpm
    onClipUpdate(track.id, clip.id, { buffer: nb, waveformPeaks: extractPeaks(nb, Math.max(200, Math.floor(db * 40))) })
    setProcessStatus('Ters çevirme uygulandı!'); setTimeout(() => setProcessStatus(null), 2500)
  }, [clip, track, bpm, onClipUpdate])

  const changeSpeed = useCallback((factor: number) => {
    if (!clip?.buffer || !track) return
    const buf = clip.buffer; const sr = buf.sampleRate; const ch = buf.numberOfChannels; const newLen = Math.floor(buf.length / factor)
    if (newLen <= 0) return
    const nb = new AudioBuffer({ length: newLen, sampleRate: sr, numberOfChannels: ch })
    for (let c = 0; c < ch; c++) {
      const s = buf.getChannelData(c); const d = nb.getChannelData(c)
      for (let i = 0; i < newLen; i++) { const si = i * factor; const idx = Math.floor(si); const f = si - idx; d[i] = s[Math.min(idx, buf.length - 1)] + (s[Math.min(idx + 1, buf.length - 1)] - s[Math.min(idx, buf.length - 1)]) * f }
    }
    const db = (nb.duration / 60) * bpm
    onClipUpdate(track.id, clip.id, { buffer: nb, waveformPeaks: extractPeaks(nb, Math.max(200, Math.floor(db * 40))), durationBeats: db })
    setProcessStatus(`Hız: ${factor}x uygulandı!`); setTimeout(() => setProcessStatus(null), 2500)
  }, [clip, track, bpm, onClipUpdate])

  const halfSpeed = useCallback(() => changeSpeed(0.5), [changeSpeed])
  const doubleSpeed = useCallback(() => changeSpeed(2), [changeSpeed])

  const monoClip = useCallback(() => {
    if (!clip?.buffer || !track || clip.buffer.numberOfChannels < 2) return
    const buf = clip.buffer; const sr = buf.sampleRate; const len = buf.length
    const nb = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 })
    const d = nb.getChannelData(0); const l = buf.getChannelData(0); const r = buf.getChannelData(1)
    for (let i = 0; i < len; i++) d[i] = (l[i] + r[i]) * 0.5
    const db = (buf.duration / 60) * bpm
    onClipUpdate(track.id, clip.id, { buffer: nb, waveformPeaks: extractPeaks(nb, Math.max(200, Math.floor(db * 40))) })
    setProcessStatus('Mono dönüşüm uygulandı!'); setTimeout(() => setProcessStatus(null), 2500)
  }, [clip, track, bpm, onClipUpdate])

  const invertPhase = useCallback(() => {
    if (!clip?.buffer || !track) return
    const buf = clip.buffer; const sr = buf.sampleRate; const ch = buf.numberOfChannels; const len = buf.length
    const nb = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: ch })
    for (let c = 0; c < ch; c++) { const s = buf.getChannelData(c); const d = nb.getChannelData(c); for (let i = 0; i < len; i++) d[i] = -s[i] }
    const db = (buf.duration / 60) * bpm
    onClipUpdate(track.id, clip.id, { buffer: nb, waveformPeaks: extractPeaks(nb, Math.max(200, Math.floor(db * 40))) })
    setProcessStatus('Faz ters çevirme uygulandı!'); setTimeout(() => setProcessStatus(null), 2500)
  }, [clip, track, bpm, onClipUpdate])

  const silenceSelection = useCallback(() => {
    if (!clip?.buffer || !track) return
    const buf = clip.buffer; const sr = buf.sampleRate; const ch = buf.numberOfChannels; const len = buf.length
    const ss = Math.floor(trimStart * len); const se = Math.floor(trimEnd * len)
    const nb = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: ch })
    for (let c = 0; c < ch; c++) { const s = buf.getChannelData(c); const d = nb.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (i >= ss && i <= se) ? 0 : s[i] }
    const db = (buf.duration / 60) * bpm
    onClipUpdate(track.id, clip.id, { buffer: nb, waveformPeaks: extractPeaks(nb, Math.max(200, Math.floor(db * 40))) })
    setProcessStatus('Seçim sessize alındı!'); setTimeout(() => setProcessStatus(null), 2500)
  }, [clip, track, trimStart, trimEnd, bpm, onClipUpdate])

  // ============================================================
  // TRIM HANDLE DRAG
  // ============================================================
  const handleWaveformMouseDown = useCallback((e: React.MouseEvent) => {
    if (!waveformCanvasRef.current || !clip?.buffer) return
    const rect = waveformCanvasRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const nearStart = Math.abs(x - trimStart) < 0.02
    const nearEnd = Math.abs(x - trimEnd) < 0.02
    if (!nearStart && !nearEnd) return
    const handle = nearStart ? 'start' : 'end'
    const onMove = (me: MouseEvent) => {
      const mx = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
      if (handle === 'start') setTrimStart(Math.min(mx, trimEnd - 0.01))
      else setTrimEnd(Math.max(mx, trimStart + 0.01))
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [trimStart, trimEnd, clip?.buffer])

  // ============================================================
  // RENDER
  // ============================================================
  if (!clip || !track) {
    return (
      <div className="daw-clip-editor">
        <div className="daw-clip-editor-empty">
          <p>Düzenlemek için bir ses klibine çift tıklayın</p>
          <button className="daw-btn daw-btn-close" onClick={onClose}>✕</button>
        </div>
      </div>
    )
  }

  const duration = clip.buffer?.duration || 0
  const channels = clip.buffer?.numberOfChannels || 0
  const sampleRate = clip.buffer?.sampleRate || 44100

  return (
    <div className="daw-clip-editor">
      {/* Header */}
      <div className="daw-clip-editor-header">
        <div className="daw-clip-editor-title">
          <span className="daw-clip-editor-color" style={{ background: track.color }} />
          <span className="daw-clip-editor-name">{clip.name}</span>
          <span className="daw-clip-editor-info">
            {duration.toFixed(2)}s · {channels}ch · {(sampleRate / 1000).toFixed(1)}kHz
          </span>
          {isPlaying && <span className="daw-clip-live-badge">🔴 CANLI</span>}
        </div>
        <div className="daw-clip-editor-tabs">
          <button className={`daw-clip-tab ${tab === 'trim' ? 'active' : ''}`} onClick={() => setTab('trim')}>✂️ Kırp & Fade</button>
          <button className={`daw-clip-tab ${tab === 'effects' ? 'active' : ''}`} onClick={() => setTab('effects')}>🎛️ Efektler</button>
          <button className={`daw-clip-tab ${tab === 'manipulate' ? 'active' : ''}`} onClick={() => setTab('manipulate')}>🔧 Manipülasyon</button>
        </div>
        <div className="daw-clip-editor-actions">
          <button className={`daw-btn daw-btn-sm ${loopEnabled ? 'daw-btn-active' : ''}`} onClick={() => setLoopEnabled(l => !l)} title="Döngü">🔁</button>
          {isPlaying ? (
            <button className="daw-btn daw-btn-sm daw-btn-danger" onClick={stopPreview}>⏹ Dur</button>
          ) : (
            <button className="daw-btn daw-btn-sm daw-btn-primary" onClick={playPreview}>▶ Canlı Dinle</button>
          )}
          <button className="daw-btn daw-btn-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Status toast */}
      {processStatus && <div className="daw-clip-editor-toast">{processStatus}</div>}

      {/* Visualization area */}
      <div className="daw-clip-editor-viz">
        {/* Waveform + playhead */}
        <div className="daw-clip-editor-waveform">
          <canvas ref={waveformCanvasRef} className="daw-clip-editor-canvas" onMouseDown={handleWaveformMouseDown} style={{ cursor: 'ew-resize' }} />
        </div>

        {/* Spectrum + VU */}
        <div className="daw-clip-editor-meters">
          <div className="daw-clip-vu-container">
            <canvas ref={vuCanvasRef} className="daw-clip-vu-canvas" />
          </div>
          <div className="daw-clip-spectrum-container">
            <canvas ref={spectrumCanvasRef} className="daw-clip-spectrum-canvas" />
            {!isPlaying && (
              <div className="daw-clip-spectrum-overlay">
                <span>▶ Canlı dinlemeyi başlatın</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="daw-clip-editor-content">
        {/* =========== TRIM TAB =========== */}
        {tab === 'trim' && (
          <div className="daw-clip-editor-trim">
            <div className="daw-clip-editor-controls">
              <div className="daw-clip-ctrl-group">
                <label>Başlangıç</label>
                <input type="range" min="0" max="0.99" step="0.001" value={trimStart}
                  onChange={e => setTrimStart(Math.min(Number(e.target.value), trimEnd - 0.01))} />
                <span className="daw-clip-ctrl-val">{(trimStart * duration).toFixed(2)}s</span>
              </div>
              <div className="daw-clip-ctrl-group">
                <label>Bitiş</label>
                <input type="range" min="0.01" max="1" step="0.001" value={trimEnd}
                  onChange={e => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.01))} />
                <span className="daw-clip-ctrl-val">{(trimEnd * duration).toFixed(2)}s</span>
              </div>
              <div className="daw-clip-ctrl-group">
                <label>Kazanç</label>
                <input type="range" min="0" max="2" step="0.01" value={clipGain}
                  onChange={e => setClipGain(Number(e.target.value))} />
                <span className="daw-clip-ctrl-val">{(clipGain * 100).toFixed(0)}%</span>
              </div>
              <div className="daw-clip-ctrl-group">
                <label>Fade In</label>
                <input type="range" min="0" max={duration * 0.5} step="0.01" value={clipFadeIn}
                  onChange={e => setClipFadeIn(Number(e.target.value))} />
                <span className="daw-clip-ctrl-val">{clipFadeIn.toFixed(2)}s</span>
              </div>
              <div className="daw-clip-ctrl-group">
                <label>Fade Out</label>
                <input type="range" min="0" max={duration * 0.5} step="0.01" value={clipFadeOut}
                  onChange={e => setClipFadeOut(Number(e.target.value))} />
                <span className="daw-clip-ctrl-val">{clipFadeOut.toFixed(2)}s</span>
              </div>
            </div>
            <div className="daw-clip-editor-apply">
              <button className="daw-btn daw-btn-primary" onClick={applyTrim}>✂️ Kırpma & Fade Uygula</button>
              <span className="daw-clip-apply-info">
                Seçim: {(trimStart * duration).toFixed(2)}s — {(trimEnd * duration).toFixed(2)}s ({((trimEnd - trimStart) * duration).toFixed(2)}s)
              </span>
            </div>
          </div>
        )}

        {/* =========== EFFECTS TAB =========== */}
        {tab === 'effects' && (
          <div className="daw-clip-editor-effects">
            {/* Live banner */}
            {isPlaying && (
              <div className="daw-clip-fx-live-banner">
                <span className="daw-clip-fx-live-dot" />
                CANLI MOD — Parametreleri değiştirdiğinizde anında duyacaksınız
              </div>
            )}

            {/* Signal flow */}
            {effects.length > 0 && (
              <div className="daw-clip-fx-signal-flow">
                <div className="daw-clip-fx-signal-node input">
                  <div className="daw-clip-fx-signal-led" style={{ background: isPlaying && inputLevel > -50 ? '#22c55e' : '#333' }} />
                  <span>GİRİŞ</span>
                  {isPlaying && <span className="daw-clip-fx-signal-db">{inputLevel.toFixed(0)}dB</span>}
                </div>
                {effects.map(fx => {
                  const lvl = fxLevels.get(fx.id) || 0
                  const active = isPlaying && fx.enabled && lvl > 0.01
                  const def = EFFECT_DEFS.find(d => d.type === fx.type)
                  return (
                    <React.Fragment key={fx.id}>
                      <div className={`daw-clip-fx-signal-arrow ${active ? 'active' : ''}`}>→</div>
                      <div className={`daw-clip-fx-signal-node ${fx.enabled ? '' : 'bypassed'} ${active ? 'active' : ''}`}>
                        <div className="daw-clip-fx-signal-led" style={{ background: active ? '#6366f1' : fx.enabled ? '#444' : '#2a2a2a' }} />
                        <span>{def?.emoji} {def?.label}</span>
                        {isPlaying && fx.enabled && (
                          <div className="daw-clip-fx-signal-meter">
                            <div className="daw-clip-fx-signal-meter-fill" style={{ width: `${Math.min(100, lvl * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  )
                })}
                <div className={`daw-clip-fx-signal-arrow ${isPlaying ? 'active' : ''}`}>→</div>
                <div className="daw-clip-fx-signal-node output">
                  <div className="daw-clip-fx-signal-led" style={{ background: isPlaying && outputLevel > -50 ? '#6366f1' : '#333' }} />
                  <span>ÇIKIŞ</span>
                  {isPlaying && <span className="daw-clip-fx-signal-db">{outputLevel.toFixed(0)}dB</span>}
                </div>
              </div>
            )}

            <div className="daw-clip-fx-toolbar">
              <span className="daw-label">Efekt Ekle:</span>
              <div className="daw-clip-fx-buttons">
                {EFFECT_DEFS.map(def => (
                  <button key={def.type} className="daw-btn daw-btn-sm" onClick={() => addEffect(def.type)}>
                    {def.emoji} {def.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="daw-clip-fx-chain">
              {effects.length === 0 ? (
                <div className="daw-clip-fx-empty">Henüz efekt eklenmedi. Ekleyip canlı dinleyerek ayarlayın.</div>
              ) : (
                effects.map((fx, idx) => {
                  const def = EFFECT_DEFS.find(d => d.type === fx.type)!
                  const isExpanded = expandedFx === fx.id
                  const lvl = fxLevels.get(fx.id) || 0
                  const active = isPlaying && fx.enabled && lvl > 0.01
                  return (
                    <div key={fx.id} className={`daw-clip-fx-item ${fx.enabled ? '' : 'disabled'} ${active ? 'active' : ''}`}>
                      <div className="daw-clip-fx-item-header" onClick={() => setExpandedFx(isExpanded ? null : fx.id)}>
                        <span className="daw-clip-fx-num">{idx + 1}</span>
                        <button className={`daw-clip-fx-toggle ${fx.enabled ? 'on' : ''}`} onClick={e => { e.stopPropagation(); toggleEffect(fx.id) }}>
                          {fx.enabled ? '●' : '○'}
                        </button>
                        <span className="daw-clip-fx-label">{def.emoji} {def.label}</span>
                        {isPlaying && fx.enabled && (
                          <span className="daw-clip-fx-activity">
                            <span className="daw-clip-fx-activity-bar" style={{ width: `${Math.min(100, lvl * 100)}%` }} />
                          </span>
                        )}
                        <span className="daw-clip-fx-expand">{isExpanded ? '▾' : '▸'}</span>
                        <button className="daw-clip-fx-remove" onClick={e => { e.stopPropagation(); removeEffect(fx.id) }}>✕</button>
                      </div>
                      {isExpanded && (
                        <div className="daw-clip-fx-params">
                          {def.paramDefs.map(p => (
                            <div key={p.key} className="daw-clip-fx-param">
                              <label>{p.label}</label>
                              {p.key === 'type' && fx.type === 'filter' ? (
                                <select value={fx.params[p.key]}
                                  onChange={e => updateEffectParam(fx.id, p.key, Number(e.target.value))}>
                                  {FILTER_TYPES.map((t, i) => <option key={i} value={i}>{t}</option>)}
                                </select>
                              ) : (
                                <input type="range" min={p.min} max={p.max} step={p.step}
                                  value={fx.params[p.key]}
                                  onChange={e => updateEffectParam(fx.id, p.key, Number(e.target.value))} />
                              )}
                              <span className="daw-clip-fx-val">
                                {typeof fx.params[p.key] === 'number'
                                  ? (p.key === 'type' && fx.type === 'filter' ? FILTER_TYPES[Math.round(fx.params[p.key])] : Number(fx.params[p.key]).toFixed(p.step < 0.01 ? 3 : p.step < 1 ? 2 : 0))
                                  : fx.params[p.key]}
                                {p.unit && ` ${p.unit}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            {effects.filter(f => f.enabled).length > 0 && (
              <div className="daw-clip-editor-apply">
                <button className="daw-btn daw-btn-primary" onClick={applyEffects}>
                  💾 Efektleri Kalıcı Uygula (Buffer'a yaz)
                </button>
                <span className="daw-clip-apply-info">{effects.filter(f => f.enabled).length} efekt aktif{isPlaying ? ' — şu an canlı dinliyorsunuz' : ''}</span>
              </div>
            )}
          </div>
        )}

        {/* =========== MANIPULATE TAB =========== */}
        {tab === 'manipulate' && (
          <div className="daw-clip-editor-manipulate">
            <div className="daw-clip-manip-grid">
              <button className="daw-clip-manip-btn" onClick={normalizeClip}>
                <span className="daw-clip-manip-icon">📈</span>
                <span className="daw-clip-manip-label">Normalize</span>
                <span className="daw-clip-manip-desc">Sesi en yüksek seviyeye getir</span>
              </button>
              <button className="daw-clip-manip-btn" onClick={reverseClip}>
                <span className="daw-clip-manip-icon">🔄</span>
                <span className="daw-clip-manip-label">Ters Çevir</span>
                <span className="daw-clip-manip-desc">Sesi tersten oynat</span>
              </button>
              <button className="daw-clip-manip-btn" onClick={halfSpeed}>
                <span className="daw-clip-manip-icon">🐢</span>
                <span className="daw-clip-manip-label">0.5x Yavaşlat</span>
                <span className="daw-clip-manip-desc">Hızı yarıya düşür</span>
              </button>
              <button className="daw-clip-manip-btn" onClick={doubleSpeed}>
                <span className="daw-clip-manip-icon">🐇</span>
                <span className="daw-clip-manip-label">2x Hızlandır</span>
                <span className="daw-clip-manip-desc">Hızı iki katına çıkar</span>
              </button>
              <button className="daw-clip-manip-btn" onClick={monoClip}>
                <span className="daw-clip-manip-icon">🔊</span>
                <span className="daw-clip-manip-label">Mono Yap</span>
                <span className="daw-clip-manip-desc">Stereoyu tekle birleştir</span>
              </button>
              <button className="daw-clip-manip-btn" onClick={invertPhase}>
                <span className="daw-clip-manip-icon">🔃</span>
                <span className="daw-clip-manip-label">Faz Ters Çevir</span>
                <span className="daw-clip-manip-desc">Ses fazını tersine çevir</span>
              </button>
              <button className="daw-clip-manip-btn" onClick={silenceSelection}>
                <span className="daw-clip-manip-icon">🔇</span>
                <span className="daw-clip-manip-label">Seçimi Sessizle</span>
                <span className="daw-clip-manip-desc">Kırpılmış bölgeyi sustur</span>
              </button>
              <button className="daw-clip-manip-btn" onClick={() => {
                onClipUpdate(track.id, clip.id, { gain: clipGain })
                setProcessStatus('Kazanç güncellendi!'); setTimeout(() => setProcessStatus(null), 2000)
              }}>
                <span className="daw-clip-manip-icon">🎚️</span>
                <span className="daw-clip-manip-label">Kazanç Ayarla</span>
                <span className="daw-clip-manip-desc">Klip seviyesini güncelle</span>
              </button>
            </div>
            <div className="daw-clip-manip-gain">
              <label>Klip Kazancı</label>
              <input type="range" min="0" max="2" step="0.01" value={clipGain}
                onChange={e => setClipGain(Number(e.target.value))} />
              <span>{(clipGain * 100).toFixed(0)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

DAWClipEditor.displayName = 'DAWClipEditor'
export default DAWClipEditor
