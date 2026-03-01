/* ============================================================
   useDAWEngine — Core Web Audio API engine for the DAW
   Manages: AudioContext, tracks, transport, playback, recording
   ============================================================ */
import { useState, useRef, useCallback, useEffect } from 'react'

// ---- Types ----
export interface AudioClip {
  id: string
  trackId: string
  name: string
  startBeat: number      // position in beats
  durationBeats: number  // length in beats
  offsetBeats: number    // trim offset from start of source
  buffer: AudioBuffer | null
  waveformPeaks: number[]
  color: string
  selected: boolean
  fadeIn: number         // seconds
  fadeOut: number        // seconds
  gain: number           // 0..2
}

export interface MidiNote {
  id: string
  pitch: number          // MIDI 0-127
  startBeat: number
  durationBeats: number
  velocity: number       // 0-127
  selected: boolean
}

export interface DAWTrack {
  id: string
  name: string
  type: 'audio' | 'midi' | 'bus'
  color: string
  volume: number         // 0-1
  pan: number            // -1 to 1
  muted: boolean
  solo: boolean
  armed: boolean         // record-armed
  clips: AudioClip[]
  midiNotes: MidiNote[]
  height: number         // px
  gainNode: GainNode | null
  panNode: StereoPannerNode | null
  analyserNode: AnalyserNode | null
  vuLevel: number
  effects: TrackEffect[]
}

export interface TrackEffect {
  id: string
  type: string
  enabled: boolean
  params: Record<string, number | string>
}

export interface DAWState {
  bpm: number
  timeSignature: [number, number]
  isPlaying: boolean
  isRecording: boolean
  isLooping: boolean
  loopStart: number      // beats
  loopEnd: number        // beats
  playheadBeat: number
  totalBeats: number
  snapValue: number      // 1=whole, 0.5=half, 0.25=quarter, 0.125=8th, 0.0625=16th
  zoom: number           // px per beat
  scrollX: number        // horizontal scroll in px
  scrollY: number        // vertical scroll in px
  masterVolume: number
}

// ---- Constants ----
const TRACK_COLORS = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#84cc16', '#f97316', '#a855f7',
  '#14b8a6', '#e879f9', '#22d3ee', '#facc15', '#fb923c'
]

let _colorIndex = 0
const nextColor = () => TRACK_COLORS[_colorIndex++ % TRACK_COLORS.length]

let _idCounter = 0
export const uid = () => `${Date.now()}_${++_idCounter}`

// ---- Beats <-> Seconds conversion ----
export const beatsToSeconds = (beats: number, bpm: number) => (beats / bpm) * 60
export const secondsToBeats = (seconds: number, bpm: number) => (seconds / 60) * bpm

// ---- Extract waveform peaks for display ----
export function extractPeaks(buffer: AudioBuffer, numPeaks: number): number[] {
  const chan = buffer.getChannelData(0)
  const step = Math.max(1, Math.floor(chan.length / numPeaks))
  const peaks: number[] = []
  for (let i = 0; i < numPeaks; i++) {
    let max = 0
    const start = i * step
    const end = Math.min(start + step, chan.length)
    for (let j = start; j < end; j++) {
      const abs = Math.abs(chan[j])
      if (abs > max) max = abs
    }
    peaks.push(max)
  }
  return peaks
}

// ---- Hook ----
export function useDAWEngine() {
  const ctxRef = useRef<AudioContext | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const masterAnalyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef(0)
  const playStartRef = useRef(0)
  const playOffsetRef = useRef(0)
  const activeSourcesRef = useRef<(AudioBufferSourceNode | OscillatorNode)[]>([])

  const [tracks, setTracks] = useState<DAWTrack[]>([])
  const [state, setState] = useState<DAWState>({
    bpm: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 32,
    playheadBeat: 0,
    totalBeats: 128,
    snapValue: 0.25,
    zoom: 40,
    scrollX: 0,
    scrollY: 0,
    masterVolume: 0.8,
  })

  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const stateRef = useRef(state)
  stateRef.current = state

  // ---- Init AudioContext ----
  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext()
      masterGainRef.current = ctxRef.current.createGain()
      masterAnalyserRef.current = ctxRef.current.createAnalyser()
      masterAnalyserRef.current.fftSize = 2048
      masterGainRef.current.connect(masterAnalyserRef.current)
      masterAnalyserRef.current.connect(ctxRef.current.destination)
      masterGainRef.current.gain.value = stateRef.current.masterVolume
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])

  // ---- Cleanup ----
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      activeSourcesRef.current.forEach(s => { try { s.stop() } catch {} })
      ctxRef.current?.close()
    }
  }, [])

  // ---- Master volume ----
  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = state.masterVolume
  }, [state.masterVolume])

  // ---- Add Track ----
  const addTrack = useCallback((type: 'audio' | 'midi' = 'audio', name?: string) => {
    const ctx = getCtx()
    const gain = ctx.createGain()
    const pan = ctx.createStereoPanner()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    gain.connect(pan)
    pan.connect(analyser)
    analyser.connect(masterGainRef.current!)

    const track: DAWTrack = {
      id: uid(),
      name: name || `Track ${tracksRef.current.length + 1}`,
      type,
      color: nextColor(),
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      armed: false,
      clips: [],
      midiNotes: [],
      height: 80,
      gainNode: gain,
      panNode: pan,
      analyserNode: analyser,
      vuLevel: 0,
      effects: [],
    }
    setTracks(prev => [...prev, track])
    return track.id
  }, [getCtx])

  // ---- Remove Track ----
  const removeTrack = useCallback((trackId: string) => {
    setTracks(prev => prev.filter(t => t.id !== trackId))
  }, [])

  // ---- Update Track ----
  const updateTrack = useCallback((trackId: string, changes: Partial<DAWTrack>) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t
      const updated = { ...t, ...changes }
      if (changes.volume !== undefined && t.gainNode) t.gainNode.gain.value = changes.volume
      if (changes.pan !== undefined && t.panNode) t.panNode.pan.value = changes.pan
      if (changes.muted !== undefined && t.gainNode) {
        t.gainNode.gain.value = changes.muted ? 0 : (updated.volume)
      }
      return updated
    }))
  }, [])

  // ---- Load audio file into a clip ----
  const loadAudioFile = useCallback(async (file: File, trackId: string): Promise<AudioClip | null> => {
    const ctx = getCtx()
    try {
      const arrayBuf = await file.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuf)
      const durationSec = audioBuffer.duration
      const durationBeats = secondsToBeats(durationSec, stateRef.current.bpm)
      const peaks = extractPeaks(audioBuffer, Math.max(200, Math.floor(durationBeats * stateRef.current.zoom)))

      const clip: AudioClip = {
        id: uid(),
        trackId,
        name: file.name.replace(/\.[^.]+$/, ''),
        startBeat: 0,
        durationBeats,
        offsetBeats: 0,
        buffer: audioBuffer,
        waveformPeaks: peaks,
        color: tracksRef.current.find(t => t.id === trackId)?.color || '#6366f1',
        selected: false,
        fadeIn: 0,
        fadeOut: 0,
        gain: 1,
      }
      setTracks(prev => prev.map(t =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
      ))

      // Update total beats if needed
      const endBeat = clip.startBeat + clip.durationBeats
      if (endBeat > stateRef.current.totalBeats) {
        setState(s => ({ ...s, totalBeats: Math.ceil(endBeat / 4) * 4 + 16 }))
      }

      return clip
    } catch (e) {
      console.error('Failed to load audio:', e)
      return null
    }
  }, [getCtx])

  // ---- Load audio from URL ----
  const loadAudioUrl = useCallback(async (url: string, trackId: string, name: string): Promise<AudioClip | null> => {
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const file = new File([blob], name + '.wav', { type: 'audio/wav' })
      return loadAudioFile(file, trackId)
    } catch (e) {
      console.error('Failed to load audio URL:', e)
      return null
    }
  }, [loadAudioFile])

  // ---- Update clip ----
  const updateClip = useCallback((trackId: string, clipId: string, changes: Partial<AudioClip>) => {
    setTracks(prev => prev.map(t =>
      t.id !== trackId ? t : {
        ...t,
        clips: t.clips.map(c => c.id !== clipId ? c : { ...c, ...changes })
      }
    ))
  }, [])

  // ---- Remove clip ----
  const removeClip = useCallback((trackId: string, clipId: string) => {
    setTracks(prev => prev.map(t =>
      t.id !== trackId ? t : { ...t, clips: t.clips.filter(c => c.id !== clipId) }
    ))
  }, [])

  // ---- Duplicate clip ----
  const duplicateClip = useCallback((trackId: string, clipId: string, targetTrackId?: string) => {
    const track = tracksRef.current.find(t => t.id === trackId)
    const clip = track?.clips.find(c => c.id === clipId)
    if (!clip) return null

    const newClip: AudioClip = {
      ...clip,
      id: uid(),
      trackId: targetTrackId || trackId,
      startBeat: clip.startBeat + clip.durationBeats,
      selected: false,
    }

    const tgtId = targetTrackId || trackId
    setTracks(prev => prev.map(t =>
      t.id !== tgtId ? t : { ...t, clips: [...t.clips, newClip] }
    ))
    return newClip.id
  }, [])

  // ---- Split clip at beat position ----
  const splitClip = useCallback((trackId: string, clipId: string, atBeat: number) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t
      const idx = t.clips.findIndex(c => c.id === clipId)
      if (idx === -1) return t
      const clip = t.clips[idx]
      if (atBeat <= clip.startBeat || atBeat >= clip.startBeat + clip.durationBeats) return t

      const splitPoint = atBeat - clip.startBeat
      const left: AudioClip = {
        ...clip,
        durationBeats: splitPoint,
      }
      const right: AudioClip = {
        ...clip,
        id: uid(),
        startBeat: atBeat,
        offsetBeats: clip.offsetBeats + splitPoint,
        durationBeats: clip.durationBeats - splitPoint,
      }
      const newClips = [...t.clips]
      newClips.splice(idx, 1, left, right)
      return { ...t, clips: newClips }
    }))
  }, [])

  // ---- MIDI Notes ----
  const addMidiNote = useCallback((trackId: string, note: Omit<MidiNote, 'id' | 'selected'>) => {
    const midiNote: MidiNote = { ...note, id: uid(), selected: false }
    setTracks(prev => prev.map(t =>
      t.id !== trackId ? t : { ...t, midiNotes: [...t.midiNotes, midiNote] }
    ))
    return midiNote.id
  }, [])

  const updateMidiNote = useCallback((trackId: string, noteId: string, changes: Partial<MidiNote>) => {
    setTracks(prev => prev.map(t =>
      t.id !== trackId ? t : {
        ...t,
        midiNotes: t.midiNotes.map(n => n.id !== noteId ? n : { ...n, ...changes })
      }
    ))
  }, [])

  const removeMidiNote = useCallback((trackId: string, noteId: string) => {
    setTracks(prev => prev.map(t =>
      t.id !== trackId ? t : { ...t, midiNotes: t.midiNotes.filter(n => n.id !== noteId) }
    ))
  }, [])

  // ---- Playback ----
  const stopAll = useCallback(() => {
    activeSourcesRef.current.forEach(s => { try { s.stop() } catch {} })
    activeSourcesRef.current = []
  }, [])

  const schedulePlayback = useCallback((fromBeat: number) => {
    const ctx = getCtx()
    stopAll()

    const bpm = stateRef.current.bpm
    const hasSolo = tracksRef.current.some(t => t.solo)

    tracksRef.current.forEach(track => {
      if (track.muted) return
      if (hasSolo && !track.solo) return
      if (!track.gainNode) return

      track.clips.forEach(clip => {
        if (!clip.buffer) return
        const clipStartBeat = clip.startBeat
        const clipEndBeat = clipStartBeat + clip.durationBeats
        if (clipEndBeat <= fromBeat) return // clip already passed

        const src = ctx.createBufferSource()
        src.buffer = clip.buffer
        const clipGain = ctx.createGain()
        clipGain.gain.value = clip.gain
        src.connect(clipGain)
        clipGain.connect(track.gainNode!)

        const clipStartSec = beatsToSeconds(clipStartBeat, bpm)
        const fromSec = beatsToSeconds(fromBeat, bpm)
        const offsetSec = beatsToSeconds(clip.offsetBeats, bpm)

        if (clipStartBeat >= fromBeat) {
          // Clip starts in the future
          const delay = clipStartSec - fromSec
          src.start(ctx.currentTime + delay, offsetSec)
        } else {
          // Clip started before current position
          const elapsed = fromSec - clipStartSec
          src.start(0, offsetSec + elapsed)
        }

        activeSourcesRef.current.push(src)
      })

      // ---- MIDI synth playback ----
      if (track.type === 'midi' && track.midiNotes.length > 0) {
        track.midiNotes.forEach(note => {
          const noteStartBeat = note.startBeat
          const noteEndBeat = noteStartBeat + note.durationBeats
          if (noteEndBeat <= fromBeat) return

          const freq = 440 * Math.pow(2, (note.pitch - 69) / 12)
          const noteStartSec = beatsToSeconds(noteStartBeat, bpm)
          const noteDurSec = beatsToSeconds(note.durationBeats, bpm)
          const fromSec = beatsToSeconds(fromBeat, bpm)
          const vel = note.velocity / 127

          // Warm sine + subtle triangle layered synth
          const osc1 = ctx.createOscillator()
          osc1.type = 'sine'
          osc1.frequency.value = freq
          const osc2 = ctx.createOscillator()
          osc2.type = 'triangle'
          osc2.frequency.value = freq
          osc2.detune.value = 5

          const g1 = ctx.createGain()
          const g2 = ctx.createGain()
          osc1.connect(g1)
          osc2.connect(g2)
          g1.connect(track.gainNode!)
          g2.connect(track.gainNode!)

          if (noteStartBeat >= fromBeat) {
            const delay = noteStartSec - fromSec
            const t0 = ctx.currentTime + delay
            const atkEnd = t0 + Math.min(0.02, noteDurSec * 0.1)
            const relStart = t0 + noteDurSec - Math.min(0.08, noteDurSec * 0.2)
            g1.gain.setValueAtTime(0, t0)
            g1.gain.linearRampToValueAtTime(vel * 0.18, atkEnd)
            g1.gain.setValueAtTime(vel * 0.15, relStart)
            g1.gain.linearRampToValueAtTime(0, t0 + noteDurSec)
            g2.gain.setValueAtTime(0, t0)
            g2.gain.linearRampToValueAtTime(vel * 0.06, atkEnd)
            g2.gain.setValueAtTime(vel * 0.04, relStart)
            g2.gain.linearRampToValueAtTime(0, t0 + noteDurSec)
            osc1.start(t0); osc1.stop(t0 + noteDurSec + 0.02)
            osc2.start(t0); osc2.stop(t0 + noteDurSec + 0.02)
          } else {
            const elapsed = fromSec - noteStartSec
            const remaining = noteDurSec - elapsed
            if (remaining <= 0) return
            const t0 = ctx.currentTime
            g1.gain.setValueAtTime(vel * 0.15, t0)
            g1.gain.linearRampToValueAtTime(0, t0 + remaining)
            g2.gain.setValueAtTime(vel * 0.04, t0)
            g2.gain.linearRampToValueAtTime(0, t0 + remaining)
            osc1.start(0); osc1.stop(t0 + remaining + 0.02)
            osc2.start(0); osc2.stop(t0 + remaining + 0.02)
          }

          activeSourcesRef.current.push(osc1, osc2)
        })
      }
    })
  }, [getCtx, stopAll])

  const play = useCallback(() => {
    const ctx = getCtx()
    const fromBeat = stateRef.current.playheadBeat
    playStartRef.current = ctx.currentTime
    playOffsetRef.current = beatsToSeconds(fromBeat, stateRef.current.bpm)
    schedulePlayback(fromBeat)

    setState(s => ({ ...s, isPlaying: true }))

    const tick = () => {
      const elapsed = ctxRef.current!.currentTime - playStartRef.current + playOffsetRef.current
      const beat = secondsToBeats(elapsed, stateRef.current.bpm)

      // Loop handling
      if (stateRef.current.isLooping && beat >= stateRef.current.loopEnd) {
        playStartRef.current = ctxRef.current!.currentTime
        playOffsetRef.current = beatsToSeconds(stateRef.current.loopStart, stateRef.current.bpm)
        schedulePlayback(stateRef.current.loopStart)
        setState(s => ({ ...s, playheadBeat: s.loopStart }))
      } else {
        setState(s => ({ ...s, playheadBeat: beat }))
      }

      // VU meters
      tracksRef.current.forEach(t => {
        if (t.analyserNode) {
          const data = new Uint8Array(t.analyserNode.frequencyBinCount)
          t.analyserNode.getByteTimeDomainData(data)
          let max = 0
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] - 128) / 128
            if (v > max) max = v
          }
          t.vuLevel = max
        }
      })

      if (stateRef.current.isPlaying) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [getCtx, schedulePlayback])

  const pause = useCallback(() => {
    stopAll()
    cancelAnimationFrame(rafRef.current)
    setState(s => ({ ...s, isPlaying: false }))
  }, [stopAll])

  const stop = useCallback(() => {
    stopAll()
    cancelAnimationFrame(rafRef.current)
    setState(s => ({ ...s, isPlaying: false, playheadBeat: 0 }))
    playOffsetRef.current = 0
  }, [stopAll])

  const seek = useCallback((beat: number) => {
    const wasPlaying = stateRef.current.isPlaying
    if (wasPlaying) {
      stopAll()
      cancelAnimationFrame(rafRef.current)
    }
    setState(s => ({ ...s, playheadBeat: Math.max(0, beat) }))
    if (wasPlaying) {
      setTimeout(() => {
        const ctx = getCtx()
        playStartRef.current = ctx.currentTime
        playOffsetRef.current = beatsToSeconds(Math.max(0, beat), stateRef.current.bpm)
        schedulePlayback(Math.max(0, beat))
        const tick = () => {
          const elapsed = ctxRef.current!.currentTime - playStartRef.current + playOffsetRef.current
          const b = secondsToBeats(elapsed, stateRef.current.bpm)
          setState(s => ({ ...s, playheadBeat: b }))
          if (stateRef.current.isPlaying) rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }, 10)
    }
  }, [getCtx, stopAll, schedulePlayback])

  // ---- Export mix to WAV ----
  const exportMix = useCallback(async (): Promise<Blob | null> => {
    const bpm = stateRef.current.bpm
    const maxBeat = Math.max(
      ...tracksRef.current.flatMap(t => t.clips.map(c => c.startBeat + c.durationBeats)),
      ...tracksRef.current.flatMap(t => t.midiNotes.map(n => n.startBeat + n.durationBeats)),
      4
    )
    const totalSec = beatsToSeconds(maxBeat, bpm)
    const sr = 44100
    const offline = new OfflineAudioContext(2, Math.ceil(totalSec * sr), sr)
    const masterGain = offline.createGain()
    masterGain.gain.value = stateRef.current.masterVolume
    masterGain.connect(offline.destination)

    const hasSolo = tracksRef.current.some(t => t.solo)

    tracksRef.current.forEach(track => {
      if (track.muted) return
      if (hasSolo && !track.solo) return

      const gain = offline.createGain()
      gain.gain.value = track.volume
      const pan = offline.createStereoPanner()
      pan.pan.value = track.pan
      gain.connect(pan)
      pan.connect(masterGain)

      track.clips.forEach(clip => {
        if (!clip.buffer) return
        const src = offline.createBufferSource()
        src.buffer = clip.buffer
        const cGain = offline.createGain()
        cGain.gain.value = clip.gain
        src.connect(cGain)
        cGain.connect(gain)
        const startSec = beatsToSeconds(clip.startBeat, bpm)
        src.start(startSec, beatsToSeconds(clip.offsetBeats, bpm))
      })

      // ---- MIDI synth for export ----
      if (track.type === 'midi' && track.midiNotes.length > 0) {
        track.midiNotes.forEach(note => {
          const freq = 440 * Math.pow(2, (note.pitch - 69) / 12)
          const start = beatsToSeconds(note.startBeat, bpm)
          const dur = beatsToSeconds(note.durationBeats, bpm)
          const vel = note.velocity / 127
          const atkEnd = start + Math.min(0.02, dur * 0.1)
          const relStart = start + dur - Math.min(0.08, dur * 0.2)

          const osc1 = offline.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = freq
          const osc2 = offline.createOscillator(); osc2.type = 'triangle'; osc2.frequency.value = freq; osc2.detune.value = 5
          const g1 = offline.createGain(); const g2 = offline.createGain()
          osc1.connect(g1); osc2.connect(g2)
          g1.connect(gain); g2.connect(gain)
          g1.gain.setValueAtTime(0, start)
          g1.gain.linearRampToValueAtTime(vel * 0.18, atkEnd)
          g1.gain.setValueAtTime(vel * 0.15, relStart)
          g1.gain.linearRampToValueAtTime(0, start + dur)
          g2.gain.setValueAtTime(0, start)
          g2.gain.linearRampToValueAtTime(vel * 0.06, atkEnd)
          g2.gain.setValueAtTime(vel * 0.04, relStart)
          g2.gain.linearRampToValueAtTime(0, start + dur)
          osc1.start(start); osc1.stop(start + dur + 0.02)
          osc2.start(start); osc2.stop(start + dur + 0.02)
        })
      }
    })

    try {
      const rendered = await offline.startRendering()
      // Encode to WAV
      const numCh = rendered.numberOfChannels
      const length = rendered.length
      const buffer = new ArrayBuffer(44 + length * numCh * 2)
      const view = new DataView(buffer)
      const writeStr = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
      writeStr(0, 'RIFF')
      view.setUint32(4, 36 + length * numCh * 2, true)
      writeStr(8, 'WAVE')
      writeStr(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, numCh, true)
      view.setUint32(24, sr, true)
      view.setUint32(28, sr * numCh * 2, true)
      view.setUint16(32, numCh * 2, true)
      view.setUint16(34, 16, true)
      writeStr(36, 'data')
      view.setUint32(40, length * numCh * 2, true)
      let off = 44
      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numCh; ch++) {
          const s = Math.max(-1, Math.min(1, rendered.getChannelData(ch)[i]))
          view.setInt16(off, s * 0x7FFF, true)
          off += 2
        }
      }
      return new Blob([buffer], { type: 'audio/wav' })
    } catch (e) {
      console.error('Export failed:', e)
      return null
    }
  }, [])

  return {
    tracks, setTracks, state, setState,
    getCtx, masterAnalyserRef,
    addTrack, removeTrack, updateTrack,
    loadAudioFile, loadAudioUrl,
    updateClip, removeClip, duplicateClip, splitClip,
    addMidiNote, updateMidiNote, removeMidiNote,
    play, pause, stop, seek,
    exportMix,
  }
}

export type DAWEngine = ReturnType<typeof useDAWEngine>
