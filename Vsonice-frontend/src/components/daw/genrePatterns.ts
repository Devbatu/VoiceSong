/* ============================================================
   genrePatterns - Professional Genre-Aware Music Generation
   20 genres, 5 drum kits, 13 drum instruments, 
   user-controllable BPM/bars/swing/density,
   professional multi-layer synthesis engine
   ============================================================ */

// Types
export type DrumKitType = '808' | '909' | 'acoustic' | 'electronic' | 'lofi'

export interface GenreDef {
  id: string
  name: string
  emoji: string
  category: string
  bpmRange: [number, number]
  timeSignature: [number, number]
  swingAmount: number
  bars: number
  defaultKit: DrumKitType
  drumPattern: DrumPatternGen
  chordProgressions: number[][]
  scales: number[][]
  bassStyle: BassStyle
  melodyDensity: number
  melodyRange: [number, number]
  synthType: OscillatorType
  padSynthType: OscillatorType
  bassSynthType: OscillatorType
  useArpeggio: boolean
  arpeggioSpeed: number
  usePadLayer: boolean
  useSubBass: boolean
  reverbAmount: number
  delayTime: number
  delayFeedback: number
  filterFreq: number
  chorusAmount: number
  distortion: number
  tags: string[]
}

export type BassStyle = 'root' | 'walking' | 'octave' | 'arpeggio' | 'syncopated' | 'offbeat' | 'slide' | 'pluck'

export interface DrumPatternGen {
  kick: number[]
  snare: number[]
  hihat: number[]
  openhat: number[]
  clap: number[]
  tom: number[]
  rim: number[]
  perc: number[]
  crash: number[]
  ride: number[]
  shaker: number[]
  conga: number[]
  cowbell: number[]
  kickProb: number
  snareProb: number
  hihatProb: number
  variation: number
}

export interface GenerationOptions {
  bpm?: number
  bars?: number
  swing?: number
  melodyDensity?: number
  drumKit?: DrumKitType
  complexity?: number
}

export interface GeneratedSong {
  bpm: number
  bars: number
  timeSignature: [number, number]
  drumKit: DrumKitType
  drums: GeneratedDrumTrack
  bass: GeneratedNoteTrack
  chords: GeneratedNoteTrack
  melody: GeneratedNoteTrack
  arpeggio: GeneratedNoteTrack | null
  pad: GeneratedNoteTrack | null
}

export interface GeneratedDrumTrack {
  steps: Map<string, boolean[]>
  velocities: Map<string, number[]>
}

export interface GeneratedNote {
  pitch: number
  startBeat: number
  durationBeats: number
  velocity: number
}

export interface GeneratedNoteTrack {
  notes: GeneratedNote[]
}

// Utilities
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const randf = (min: number, max: number) => min + Math.random() * (max - min)
const prob = (p: number) => Math.random() < p
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const shuffle = <T>(a: T[]): T[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = rand(0, i);[b[i], b[j]] = [b[j], b[i]] } return b }

// 20 Genre Definitions
const ALL_16: number[] = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]

const GENRES: GenreDef[] = [
  // HIP-HOP
  {
    id: 'trap', name: 'Trap', emoji: '🔥', category: 'hip-hop',
    bpmRange: [130, 170], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: '808',
    drumPattern: {
      kick: [0, 3, 6, 10, 14], snare: [4, 12], hihat: ALL_16,
      openhat: [6, 14], clap: [4, 12], tom: [], rim: [2, 10], perc: [7],
      crash: [0], ride: [], shaker: [], conga: [], cowbell: [],
      kickProb: 0.7, snareProb: 0.9, hihatProb: 0.95, variation: 0.3,
    },
    chordProgressions: [[0,3,5,7], [0,5,3,7], [0,7,5,3], [0,3,7,10]],
    scales: [[0,2,3,5,7,8,10], [0,3,5,6,7,10]],
    bassStyle: 'slide', melodyDensity: 0.14, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: true, arpeggioSpeed: 2, usePadLayer: true, useSubBass: true,
    reverbAmount: 0.3, delayTime: 0.375, delayFeedback: 0.3, filterFreq: 2000,
    chorusAmount: 0.1, distortion: 0.15,
    tags: ['808', 'Hi-Hat Rolls', 'Dark'],
  },
  {
    id: 'lofi', name: 'Lo-Fi Hip Hop', emoji: '🎧', category: 'hip-hop',
    bpmRange: [70, 90], timeSignature: [4, 4], swingAmount: 0.4, bars: 4,
    defaultKit: 'lofi',
    drumPattern: {
      kick: [0, 5, 8, 13], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [14], clap: [], tom: [], rim: [6, 10], perc: [3, 11],
      crash: [], ride: [0,4,8,12], shaker: [1,3,5,7,9,11,13,15], conga: [], cowbell: [],
      kickProb: 0.8, snareProb: 0.85, hihatProb: 0.9, variation: 0.2,
    },
    chordProgressions: [[0,4,5,3], [0,5,7,3], [0,3,5,4], [0,2,5,9]],
    scales: [[0,2,3,5,7,9,10], [0,2,4,5,7,9,11]],
    bassStyle: 'walking', melodyDensity: 0.14, melodyRange: [0, 1],
    synthType: 'sine', padSynthType: 'triangle', bassSynthType: 'triangle',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.5, delayTime: 0, delayFeedback: 0.3, filterFreq: 1200,
    chorusAmount: 0.35, distortion: 0.08,
    tags: ['Chill', 'Jazz Chords', 'Vinyl'],
  },
  {
    id: 'drill', name: 'UK Drill', emoji: '🗡️', category: 'hip-hop',
    bpmRange: [138, 148], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: '808',
    drumPattern: {
      kick: [0, 3, 7, 8, 11], snare: [4, 12], hihat: ALL_16,
      openhat: [6], clap: [4, 12], tom: [], rim: [3, 7, 11, 15], perc: [5, 13],
      crash: [0], ride: [], shaker: [], conga: [], cowbell: [],
      kickProb: 0.75, snareProb: 0.9, hihatProb: 0.92, variation: 0.35,
    },
    chordProgressions: [[0,3,7,5], [0,5,3,7], [0,1,5,3]],
    scales: [[0,1,3,5,7,8,10]],
    bassStyle: 'slide', melodyDensity: 0.10, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: true, arpeggioSpeed: 2, usePadLayer: true, useSubBass: true,
    reverbAmount: 0.25, delayTime: 0.333, delayFeedback: 0.3, filterFreq: 1800,
    chorusAmount: 0.05, distortion: 0.2,
    tags: ['Sliding 808', 'Phrygian', 'Aggressive'],
  },
  {
    id: 'boombap', name: 'Boom Bap', emoji: '🎤', category: 'hip-hop',
    bpmRange: [85, 98], timeSignature: [4, 4], swingAmount: 0.35, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 5, 8, 10], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [14], clap: [], tom: [], rim: [2, 10], perc: [],
      crash: [], ride: [], shaker: [1,5,9,13], conga: [], cowbell: [],
      kickProb: 0.85, snareProb: 0.92, hihatProb: 0.88, variation: 0.2,
    },
    chordProgressions: [[0,5,3,7], [0,3,5,4], [0,7,3,5]],
    scales: [[0,2,3,5,7,8,10], [0,2,3,5,7,9,10]],
    bassStyle: 'root', melodyDensity: 0.12, melodyRange: [0, 1],
    synthType: 'sine', padSynthType: 'triangle', bassSynthType: 'sine',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.35, delayTime: 0.2, delayFeedback: 0.3, filterFreq: 2200,
    chorusAmount: 0.15, distortion: 0.05,
    tags: ['Classic', '90s', 'Swing'],
  },
  // ELECTRONIC
  {
    id: 'house', name: 'House', emoji: '🏠', category: 'electronic',
    bpmRange: [120, 130], timeSignature: [4, 4], swingAmount: 0.05, bars: 4,
    defaultKit: '909',
    drumPattern: {
      kick: [0, 4, 8, 12], snare: [], hihat: [2,6,10,14], openhat: [6, 14],
      clap: [4, 12], tom: [], rim: [], perc: [1, 5, 9, 13],
      crash: [0], ride: [0,2,4,6,8,10,12,14], shaker: [1,3,5,7,9,11,13,15], conga: [3,7,11,15], cowbell: [],
      kickProb: 0.95, snareProb: 0, hihatProb: 0.9, variation: 0.15,
    },
    chordProgressions: [[0,5,7,3], [0,3,5,7], [0,7,3,5]],
    scales: [[0,2,4,5,7,9,11]],
    bassStyle: 'offbeat', melodyDensity: 0.14, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: true, arpeggioSpeed: 3, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.35, delayTime: 0.25, delayFeedback: 0.3, filterFreq: 3500,
    chorusAmount: 0.2, distortion: 0.1,
    tags: ['Four-on-floor', 'Groovy', 'Classic'],
  },
  {
    id: 'techno', name: 'Techno', emoji: '⚡', category: 'electronic',
    bpmRange: [125, 145], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: '909',
    drumPattern: {
      kick: [0, 4, 8, 12], snare: [], hihat: ALL_16,
      openhat: [4, 12], clap: [4, 12], tom: [6, 7, 14, 15], rim: [2, 10],
      perc: [0, 3, 8, 11], crash: [], ride: [0,2,4,6,8,10,12,14],
      shaker: [1,3,5,7,9,11,13,15], conga: [], cowbell: [0,4,8,12],
      kickProb: 0.98, snareProb: 0, hihatProb: 0.85, variation: 0.2,
    },
    chordProgressions: [[0,0,5,5], [0,3,0,5], [0,7,5,3]],
    scales: [[0,2,3,5,7,8,10]],
    bassStyle: 'root', melodyDensity: 0.1, melodyRange: [-1, 1],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: true, arpeggioSpeed: 1, usePadLayer: false, useSubBass: true,
    reverbAmount: 0.4, delayTime: 0.166, delayFeedback: 0.3, filterFreq: 2500,
    chorusAmount: 0.05, distortion: 0.22,
    tags: ['Industrial', 'Driving', 'Dark'],
  },
  {
    id: 'edm', name: 'EDM / Future Bass', emoji: '🎆', category: 'electronic',
    bpmRange: [140, 160], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: 'electronic',
    drumPattern: {
      kick: [0, 8], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [4, 12], clap: [4, 12], tom: [14, 15], rim: [],
      perc: [1, 5, 9, 13], crash: [0], ride: [],
      shaker: ALL_16, conga: [], cowbell: [],
      kickProb: 0.9, snareProb: 0.9, hihatProb: 0.85, variation: 0.25,
    },
    chordProgressions: [[0,5,7,3], [0,3,7,5], [0,5,3,7], [0,7,5,0]],
    scales: [[0,2,4,5,7,9,11]],
    bassStyle: 'arpeggio', melodyDensity: 0.18, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: true, arpeggioSpeed: 2, usePadLayer: true, useSubBass: true,
    reverbAmount: 0.4, delayTime: 0.25, delayFeedback: 0.3, filterFreq: 5000,
    chorusAmount: 0.3, distortion: 0.15,
    tags: ['Supersaw', 'Drop', 'Energetic'],
  },
  {
    id: 'dnb', name: 'Drum & Bass', emoji: '🥁', category: 'electronic',
    bpmRange: [170, 180], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: '909',
    drumPattern: {
      kick: [0, 10], snare: [4, 12], hihat: ALL_16,
      openhat: [6, 14], clap: [], tom: [3, 7, 11, 15], rim: [],
      perc: [1, 5, 9, 13], crash: [0], ride: [0,4,8,12],
      shaker: [1,3,5,7,9,11,13,15], conga: [], cowbell: [],
      kickProb: 0.7, snareProb: 0.9, hihatProb: 0.92, variation: 0.35,
    },
    chordProgressions: [[0,5,3,7], [0,3,7,5]],
    scales: [[0,2,3,5,7,8,10]],
    bassStyle: 'syncopated', melodyDensity: 0.12, melodyRange: [0, 1],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: false, arpeggioSpeed: 2, usePadLayer: true, useSubBass: true,
    reverbAmount: 0.2, delayTime: 0.125, delayFeedback: 0.3, filterFreq: 3000,
    chorusAmount: 0.1, distortion: 0.2,
    tags: ['Fast', 'Breakbeat', 'Reese Bass'],
  },
  {
    id: 'dubstep', name: 'Dubstep', emoji: '💀', category: 'electronic',
    bpmRange: [138, 142], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: 'electronic',
    drumPattern: {
      kick: [0, 8], snare: [4, 12], hihat: [2,6,10,14],
      openhat: [6, 14], clap: [4,12], tom: [13,14,15], rim: [3,11],
      perc: [1,5,9,13], crash: [0], ride: [],
      shaker: [], conga: [], cowbell: [],
      kickProb: 0.92, snareProb: 0.95, hihatProb: 0.8, variation: 0.3,
    },
    chordProgressions: [[0,5,3,7], [0,3,7,5], [0,7,3,0]],
    scales: [[0,2,3,5,7,8,10], [0,1,3,5,6,8,10]],
    bassStyle: 'syncopated', melodyDensity: 0.08, melodyRange: [0, 1],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: false, arpeggioSpeed: 1, usePadLayer: true, useSubBass: true,
    reverbAmount: 0.25, delayTime: 0.333, delayFeedback: 0.3, filterFreq: 1800,
    chorusAmount: 0.05, distortion: 0.4,
    tags: ['Wobble', 'Heavy', 'Halftime'],
  },
  {
    id: 'trance', name: 'Trance', emoji: '🌀', category: 'electronic',
    bpmRange: [135, 145], timeSignature: [4, 4], swingAmount: 0, bars: 8,
    defaultKit: '909',
    drumPattern: {
      kick: [0, 4, 8, 12], snare: [], hihat: [2,6,10,14],
      openhat: [6, 14], clap: [4, 12], tom: [], rim: [],
      perc: [1,5,9,13], crash: [0], ride: [0,4,8,12],
      shaker: [1,3,5,7,9,11,13,15], conga: [], cowbell: [],
      kickProb: 0.98, snareProb: 0, hihatProb: 0.88, variation: 0.12,
    },
    chordProgressions: [[0,5,3,7], [0,7,5,3], [0,3,5,0]],
    scales: [[0,2,3,5,7,8,10], [0,2,4,5,7,9,11]],
    bassStyle: 'offbeat', melodyDensity: 0.14, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: true, arpeggioSpeed: 2, usePadLayer: true, useSubBass: true,
    reverbAmount: 0.5, delayTime: 0.333, delayFeedback: 0.3, filterFreq: 4000,
    chorusAmount: 0.35, distortion: 0.08,
    tags: ['Uplifting', 'Euphoric', 'Arpeggiated'],
  },
  // POP / ROCK
  {
    id: 'pop', name: 'Pop', emoji: '🎤', category: 'pop-rock',
    bpmRange: [100, 130], timeSignature: [4, 4], swingAmount: 0.05, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 8], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [], clap: [4, 12], tom: [], rim: [],
      perc: [6, 14], crash: [0], ride: [],
      shaker: [1,3,5,7,9,11,13,15], conga: [], cowbell: [],
      kickProb: 0.9, snareProb: 0.9, hihatProb: 0.88, variation: 0.15,
    },
    chordProgressions: [[0,5,3,4], [0,4,5,3], [0,3,4,5], [0,5,4,3]],
    scales: [[0,2,4,5,7,9,11]],
    bassStyle: 'root', melodyDensity: 0.16, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sine',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.3, delayTime: 0.2, delayFeedback: 0.3, filterFreq: 4000,
    chorusAmount: 0.2, distortion: 0.05,
    tags: ['Catchy', 'Major Key', 'Radio'],
  },
  {
    id: 'rock', name: 'Rock', emoji: '🎸', category: 'pop-rock',
    bpmRange: [110, 145], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 6, 8, 14], snare: [4, 12], hihat: ALL_16,
      openhat: [14], clap: [], tom: [13,14,15], rim: [],
      perc: [], crash: [0], ride: [0,4,8,12],
      shaker: [], conga: [], cowbell: [],
      kickProb: 0.88, snareProb: 0.95, hihatProb: 0.85, variation: 0.22,
    },
    chordProgressions: [[0,5,3,4], [0,3,5,0], [0,7,5,3]],
    scales: [[0,2,4,5,7,9,11], [0,2,3,5,7,9,10]],
    bassStyle: 'root', melodyDensity: 0.14, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.3, delayTime: 0.15, delayFeedback: 0.3, filterFreq: 4500,
    chorusAmount: 0.15, distortion: 0.3,
    tags: ['Power Chords', 'Distortion', 'Driving'],
  },
  {
    id: 'rnb', name: 'R&B / Soul', emoji: '💜', category: 'pop-rock',
    bpmRange: [65, 85], timeSignature: [4, 4], swingAmount: 0.3, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 6, 8, 10], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [], clap: [], tom: [], rim: [2, 10, 14],
      perc: [7], crash: [], ride: [0,4,8,12],
      shaker: [1,3,5,7,9,11,13,15], conga: [], cowbell: [],
      kickProb: 0.8, snareProb: 0.85, hihatProb: 0.9, variation: 0.2,
    },
    chordProgressions: [[0,4,5,3], [0,5,3,4], [0,2,5,4], [0,4,2,5]],
    scales: [[0,2,4,5,7,9,11], [0,2,3,5,7,9,10]],
    bassStyle: 'walking', melodyDensity: 0.12, melodyRange: [0, 2],
    synthType: 'sine', padSynthType: 'triangle', bassSynthType: 'sine',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.45, delayTime: 0, delayFeedback: 0.3, filterFreq: 2800,
    chorusAmount: 0.3, distortion: 0.02,
    tags: ['Smooth', 'Jazz Chords', 'Soulful'],
  },
  {
    id: 'indie', name: 'Indie / Alt', emoji: '🌿', category: 'pop-rock',
    bpmRange: [105, 135], timeSignature: [4, 4], swingAmount: 0.08, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 8], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [6], clap: [], tom: [14,15], rim: [2,10],
      perc: [], crash: [0], ride: [],
      shaker: [1,3,5,7,9,11,13,15], conga: [], cowbell: [],
      kickProb: 0.82, snareProb: 0.88, hihatProb: 0.85, variation: 0.22,
    },
    chordProgressions: [[0,3,5,4], [0,5,4,3], [0,7,5,3]],
    scales: [[0,2,4,5,7,9,11], [0,2,3,5,7,8,10]],
    bassStyle: 'octave', melodyDensity: 0.22, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'triangle', bassSynthType: 'triangle',
    useArpeggio: true, arpeggioSpeed: 3, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.45, delayTime: 0.3, delayFeedback: 0.3, filterFreq: 3200,
    chorusAmount: 0.35, distortion: 0.08,
    tags: ['Dreamy', 'Reverb', 'Atmospheric'],
  },
  // WORLD / GROOVE
  {
    id: 'reggaeton', name: 'Reggaeton', emoji: '🌴', category: 'world',
    bpmRange: [88, 100], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: '808',
    drumPattern: {
      kick: [0, 3, 4, 7, 8, 11, 12, 15], snare: [3, 7, 11, 15],
      hihat: [0,2,4,6,8,10,12,14], openhat: [], clap: [4, 12],
      tom: [], rim: [1, 5, 9, 13], perc: [],
      crash: [], ride: [], shaker: ALL_16,
      conga: [2,6,10,14], cowbell: [],
      kickProb: 0.85, snareProb: 0.8, hihatProb: 0.9, variation: 0.15,
    },
    chordProgressions: [[0,3,5,7], [0,5,3,7]],
    scales: [[0,2,3,5,7,8,10]],
    bassStyle: 'root', melodyDensity: 0.12, melodyRange: [0, 1],
    synthType: 'triangle', padSynthType: 'triangle', bassSynthType: 'sine',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: false, useSubBass: true,
    reverbAmount: 0.2, delayTime: 0, delayFeedback: 0.3, filterFreq: 2500,
    chorusAmount: 0.1, distortion: 0.08,
    tags: ['Dembow', 'Latin', 'Perreo'],
  },
  {
    id: 'afrobeat', name: 'Afrobeats', emoji: '🌍', category: 'world',
    bpmRange: [95, 110], timeSignature: [4, 4], swingAmount: 0.15, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 5, 8, 13], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [6, 14], clap: [4, 12], tom: [3, 11], rim: [2, 10],
      perc: [1, 5, 9, 13], crash: [], ride: [],
      shaker: ALL_16, conga: [0,3,6,8,11,14], cowbell: [0,4,8,12],
      kickProb: 0.82, snareProb: 0.88, hihatProb: 0.92, variation: 0.25,
    },
    chordProgressions: [[0,3,5,7], [0,5,7,3], [0,7,3,5]],
    scales: [[0,2,4,5,7,9,11], [0,2,3,5,7,9,10]],
    bassStyle: 'octave', melodyDensity: 0.16, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'triangle', bassSynthType: 'sine',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.3, delayTime: 0.2, delayFeedback: 0.3, filterFreq: 3500,
    chorusAmount: 0.2, distortion: 0.05,
    tags: ['Groovy', 'Polyrhythm', 'Conga'],
  },
  {
    id: 'latin', name: 'Latin / Salsa', emoji: '💃', category: 'world',
    bpmRange: [160, 190], timeSignature: [4, 4], swingAmount: 0.1, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 6, 8, 14], snare: [4, 12], hihat: ALL_16,
      openhat: [], clap: [], tom: [2, 6, 10, 14], rim: [1, 3, 5, 7, 9, 11, 13, 15],
      perc: [0,4,8,12], crash: [], ride: [],
      shaker: ALL_16, conga: [0,1,4,5,8,9,12,13], cowbell: [0,4,8,12],
      kickProb: 0.78, snareProb: 0.85, hihatProb: 0.9, variation: 0.3,
    },
    chordProgressions: [[0,5,3,4], [0,3,5,7], [0,4,5,0]],
    scales: [[0,2,3,5,7,8,10], [0,2,4,5,7,9,11]],
    bassStyle: 'walking', melodyDensity: 0.25, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'triangle', bassSynthType: 'sine',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.3, delayTime: 0.15, delayFeedback: 0.3, filterFreq: 3800,
    chorusAmount: 0.15, distortion: 0.05,
    tags: ['Clave', 'Conga', 'Tropical'],
  },
  // EXPERIMENTAL / CHILL
  {
    id: 'jazz', name: 'Jazz', emoji: '🎷', category: 'experimental',
    bpmRange: [100, 140], timeSignature: [4, 4], swingAmount: 0.5, bars: 4,
    defaultKit: 'acoustic',
    drumPattern: {
      kick: [0, 10], snare: [], hihat: ALL_16,
      openhat: [], clap: [], tom: [], rim: [4, 12],
      perc: [2, 6, 10, 14], crash: [], ride: [0,2,4,6,8,10,12,14],
      shaker: [], conga: [], cowbell: [],
      kickProb: 0.5, snareProb: 0, hihatProb: 0.95, variation: 0.4,
    },
    chordProgressions: [[0,5,2,5], [0,4,2,5], [0,1,4,5], [0,5,4,2]],
    scales: [[0,2,3,5,7,9,10], [0,2,4,5,7,9,11]],
    bassStyle: 'walking', melodyDensity: 0.18, melodyRange: [0, 2],
    synthType: 'sine', padSynthType: 'triangle', bassSynthType: 'sine',
    useArpeggio: false, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.45, delayTime: 0, delayFeedback: 0.3, filterFreq: 4500,
    chorusAmount: 0.25, distortion: 0.02,
    tags: ['ii-V-I', 'Swing', 'Improvised'],
  },
  {
    id: 'ambient', name: 'Ambient', emoji: '🌊', category: 'experimental',
    bpmRange: [60, 80], timeSignature: [4, 4], swingAmount: 0, bars: 8,
    defaultKit: 'electronic',
    drumPattern: {
      kick: [], snare: [], hihat: [], openhat: [],
      clap: [], tom: [], rim: [0, 8], perc: [4, 12],
      crash: [0], ride: [0,8], shaker: [2,6,10,14], conga: [], cowbell: [],
      kickProb: 0, snareProb: 0, hihatProb: 0, variation: 0.1,
    },
    chordProgressions: [[0,7,5,0], [0,5,0,7], [0,2,5,7], [0,7,2,5]],
    scales: [[0,2,4,7,9], [0,2,5,7,9]],
    bassStyle: 'root', melodyDensity: 0.06, melodyRange: [0, 2],
    synthType: 'sine', padSynthType: 'sine', bassSynthType: 'sine',
    useArpeggio: true, arpeggioSpeed: 4, usePadLayer: true, useSubBass: false,
    reverbAmount: 0.82, delayTime: 0.5, delayFeedback: 0.3, filterFreq: 1500,
    chorusAmount: 0.5, distortion: 0,
    tags: ['Atmospheric', 'Pentatonic', 'Spacious'],
  },
  {
    id: 'synthwave', name: 'Synthwave', emoji: '🌆', category: 'experimental',
    bpmRange: [100, 120], timeSignature: [4, 4], swingAmount: 0, bars: 4,
    defaultKit: 'electronic',
    drumPattern: {
      kick: [0, 4, 8, 12], snare: [4, 12], hihat: [0,2,4,6,8,10,12,14],
      openhat: [6,14], clap: [4,12], tom: [14,15], rim: [],
      perc: [1,5,9,13], crash: [0], ride: [],
      shaker: [], conga: [], cowbell: [],
      kickProb: 0.92, snareProb: 0.9, hihatProb: 0.88, variation: 0.15,
    },
    chordProgressions: [[0,3,5,7], [0,5,3,0], [0,7,5,3]],
    scales: [[0,2,3,5,7,8,10], [0,2,4,5,7,9,11]],
    bassStyle: 'arpeggio', melodyDensity: 0.14, melodyRange: [0, 2],
    synthType: 'triangle', padSynthType: 'sawtooth', bassSynthType: 'sawtooth',
    useArpeggio: true, arpeggioSpeed: 2, usePadLayer: true, useSubBass: true,
    reverbAmount: 0.45, delayTime: 0.333, delayFeedback: 0.3, filterFreq: 3000,
    chorusAmount: 0.4, distortion: 0.12,
    tags: ['Retro', '80s', 'Neon'],
  },
]

export function getGenres(): GenreDef[] { return GENRES }
export function getGenre(id: string): GenreDef | undefined { return GENRES.find(g => g.id === id) }
export function getGenresByCategory(cat: string): GenreDef[] { return GENRES.filter(g => g.category === cat) }
export function getCategories(): string[] { return [...new Set(GENRES.map(g => g.category))] }

export const CATEGORY_NAMES: Record<string, string> = {
  'hip-hop': 'Hip-Hop / Rap',
  'electronic': 'Elektronik',
  'pop-rock': 'Pop / Rock',
  'world': 'Dünya / Latin',
  'experimental': 'Deneysel / Chill',
}

export const DRUM_KIT_NAMES: Record<DrumKitType, string> = {
  '808': 'TR-808',
  '909': 'TR-909',
  'acoustic': 'Akustik',
  'electronic': 'Elektronik',
  'lofi': 'Lo-Fi Vintage',
}

// Pattern Generation
const DRUM_INSTRUMENTS = [
  'kick','snare','hihat','openhat','clap','tom','rim','perc',
  'crash','ride','shaker','conga','cowbell'
] as const

function generateDrumBar(genre: GenreDef): GeneratedDrumTrack {
  const steps = new Map<string, boolean[]>()
  const velocities = new Map<string, number[]>()
  const pat = genre.drumPattern
  const probMap: Record<string, number> = {
    kick: pat.kickProb, snare: pat.snareProb, hihat: pat.hihatProb,
    openhat: 0.7, clap: 0.8, tom: 0.6, rim: 0.7, perc: 0.65,
    crash: 0.8, ride: 0.75, shaker: 0.7, conga: 0.65, cowbell: 0.6,
  }
  for (const inst of DRUM_INSTRUMENTS) {
    const baseSteps = pat[inst] || []
    const active = new Array(16).fill(false)
    const vel = new Array(16).fill(0)
    const p = probMap[inst] || 0.7
    for (const s of baseSteps) {
      if (prob(p)) { active[s] = true; vel[s] = rand(80, 120) }
    }
    for (let i = 0; i < 16; i++) {
      if (!active[i] && prob(pat.variation * 0.25)) { active[i] = true; vel[i] = rand(30, 65) }
      if (active[i] && prob(pat.variation * 0.12)) { active[i] = false; vel[i] = 0 }
    }
    for (let i = 0; i < 16; i++) {
      if (vel[i] > 0) vel[i] = clamp(vel[i] + rand(-8, 8), 20, 127)
    }
    steps.set(inst, active)
    velocities.set(inst, vel)
  }
  return { steps, velocities }
}

function generateDrumTrack(genre: GenreDef, bars: number): GeneratedDrumTrack {
  const allSteps = new Map<string, boolean[]>()
  const allVels = new Map<string, number[]>()
  for (const inst of DRUM_INSTRUMENTS) { allSteps.set(inst, []); allVels.set(inst, []) }
  const base = generateDrumBar(genre)
  for (let bar = 0; bar < bars; bar++) {
    const barData = bar === 0 ? base : generateDrumBar(genre)
    for (const inst of DRUM_INSTRUMENTS) {
      const bSteps = barData.steps.get(inst) || new Array(16).fill(false)
      const bVels = barData.velocities.get(inst) || new Array(16).fill(0)
      if (bar === bars - 1) {
        for (const fillInst of ['tom', 'snare', 'conga'] as const) {
          if (inst === fillInst) {
            for (let s = 12; s < 16; s++) {
              if (prob(0.55)) { bSteps[s] = true; bVels[s] = rand(90, 127) }
            }
          }
        }
        if (inst === 'crash') { bSteps[0] = true; bVels[0] = rand(100, 120) }
      }
      allSteps.get(inst)!.push(...bSteps)
      allVels.get(inst)!.push(...bVels)
    }
  }
  return { steps: allSteps, velocities: allVels }
}

// Chord building
function chordToMidi(root: number, semitone: number, scale: number[]): number[] {
  const chordRoot = root + semitone
  const notes = [chordRoot]
  const scaleSet = new Set(scale.map(s => s % 12))
  const rootPc = semitone % 12
  const maj3 = (rootPc + 4) % 12, min3 = (rootPc + 3) % 12
  if (scaleSet.has(maj3)) notes.push(chordRoot + 4)
  else if (scaleSet.has(min3)) notes.push(chordRoot + 3)
  const p5 = (rootPc + 7) % 12
  if (scaleSet.has(p5)) notes.push(chordRoot + 7)
  if (prob(0.5)) {
    const m7 = (rootPc + 10) % 12, M7 = (rootPc + 11) % 12
    if (scaleSet.has(m7)) notes.push(chordRoot + 10)
    else if (scaleSet.has(M7)) notes.push(chordRoot + 11)
  }
  if (prob(0.3)) {
    const ninth = (rootPc + 2) % 12
    if (scaleSet.has(ninth)) notes.push(chordRoot + 14)
  }
  return notes
}

function generateChords(genre: GenreDef, rootNote: number, bars: number): GeneratedNoteTrack {
  const notes: GeneratedNote[] = []
  const progression = pick(genre.chordProgressions)
  const scale = pick(genre.scales)
  const bpb = genre.timeSignature[0]
  for (let bar = 0; bar < bars; bar++) {
    const sem = progression[bar % progression.length]
    const cnotes = chordToMidi(rootNote + 48, sem, scale)
    const start = bar * bpb
    const dur = bpb * (prob(0.35) ? 0.5 : 1)
    for (const p of cnotes) {
      notes.push({ pitch: clamp(p, 36, 96), startBeat: start, durationBeats: dur, velocity: rand(55, 88) })
    }
    if (prob(0.45) && dur < bpb) {
      for (const p of cnotes) {
        notes.push({ pitch: clamp(p, 36, 96), startBeat: start + bpb / 2, durationBeats: bpb / 2, velocity: rand(45, 72) })
      }
    }
  }
  return { notes }
}

function generateBass(genre: GenreDef, rootNote: number, bars: number): GeneratedNoteTrack {
  const notes: GeneratedNote[] = []
  const progression = pick(genre.chordProgressions)
  const scale = pick(genre.scales)
  const bpb = genre.timeSignature[0]
  const bo = rootNote + 36
  for (let bar = 0; bar < bars; bar++) {
    const cs = progression[bar % progression.length]
    const br = bo + cs
    switch (genre.bassStyle) {
      case 'root':
        notes.push({ pitch: br, startBeat: bar * bpb, durationBeats: bpb, velocity: rand(85, 110) })
        break
      case 'octave': {
        notes.push({ pitch: br, startBeat: bar * bpb, durationBeats: bpb / 2, velocity: rand(90, 110) })
        notes.push({ pitch: br + 12, startBeat: bar * bpb + bpb / 2, durationBeats: bpb / 2, velocity: rand(75, 95) })
        break
      }
      case 'walking': {
        const d = bpb / 4
        for (let s = 0; s < 4; s++) {
          const off = scale[s % scale.length]
          notes.push({ pitch: clamp(br + off, 28, 72), startBeat: bar * bpb + s * d, durationBeats: d * 0.9, velocity: rand(75, 100) })
        }
        break
      }
      case 'arpeggio': {
        const d = bpb / 4
        const an = [0, scale[2] || 4, scale[4] || 7, scale[2] || 4]
        for (let s = 0; s < 4; s++) {
          notes.push({ pitch: clamp(br + an[s], 28, 72), startBeat: bar * bpb + s * d, durationBeats: d * 0.8, velocity: rand(80, 105) })
        }
        break
      }
      case 'syncopated': {
        const hits = [0, 0.75, 1.5, 2.5, 3]
        for (const h of hits) {
          if (prob(0.75)) {
            notes.push({ pitch: clamp(br + (prob(0.3) ? pick(scale.slice(0, 3)) : 0), 28, 72), startBeat: bar * bpb + h, durationBeats: 0.5, velocity: rand(85, 115) })
          }
        }
        break
      }
      case 'offbeat':
        for (let s = 0; s < 4; s++) {
          notes.push({ pitch: br, startBeat: bar * bpb + s + 0.5, durationBeats: 0.4, velocity: rand(80, 100) })
        }
        break
      case 'slide': {
        const hits = prob(0.5) ? [0, 1.5, 2.5] : [0, 0.75, 2, 3]
        for (let i = 0; i < hits.length; i++) {
          const pitch = i === 0 ? br : clamp(br + pick(scale.slice(0, 4)), 28, 72)
          notes.push({ pitch, startBeat: bar * bpb + hits[i], durationBeats: prob(0.4) ? 1.2 : 0.7, velocity: rand(95, 125) })
        }
        break
      }
      case 'pluck': {
        for (let s = 0; s < 4; s++) {
          if (prob(0.7)) {
            const off = prob(0.4) ? pick(scale.slice(0, 3)) : 0
            notes.push({ pitch: clamp(br + off, 28, 72), startBeat: bar * bpb + s, durationBeats: 0.25, velocity: rand(85, 110) })
          }
        }
        break
      }
    }
  }
  return { notes }
}

function generateMelody(genre: GenreDef, rootNote: number, bars: number, density: number): GeneratedNoteTrack {
  const notes: GeneratedNote[] = []
  const scale = pick(genre.scales)
  const bpb = genre.timeSignature[0]
  const totalBeats = bars * bpb
  const base = rootNote + 60 + genre.melodyRange[0] * 12

  // Musical phrase-based generation — creates real melodies, not random bleeps
  const phraseRhythms = [
    [0.5, 0.5, 1], [1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5],
    [1, 1], [0.75, 0.25, 0.5, 0.5], [1.5, 0.5], [0.5, 1, 0.5],
    [0.25, 0.25, 0.5, 1], [1, 1, 0.5, 0.5],
  ]

  let beat = prob(0.5) ? 0 : randf(0.25, 1)
  let deg = rand(0, scale.length - 1)
  let direction = prob(0.5) ? 1 : -1

  while (beat < totalBeats) {
    // Rest between phrases — sparser = more professional
    if (!prob(Math.min(density * 1.8, 0.55))) {
      beat += pick([0.5, 1, 1.5, 2, 2.5])
      continue
    }

    // Generate a musical phrase (2-5 notes)
    const phraseLen = rand(2, Math.min(5, Math.ceil(density * 8)))
    const rhythm = pick(phraseRhythms)

    for (let n = 0; n < phraseLen && beat < totalBeats; n++) {
      // Mostly step-wise motion — the key to musicality
      const step = prob(0.78) ? direction : (prob(0.5) ? direction * 2 : -direction)
      deg = ((deg + step) % scale.length + scale.length) % scale.length
      if (prob(0.2)) direction = -direction

      const octave = genre.melodyRange[0] + (prob(0.06) ? rand(0, genre.melodyRange[1] - genre.melodyRange[0]) : 0)
      const pitch = clamp(base + octave * 12 + scale[deg], 48, 96)
      const dur = rhythm[n % rhythm.length]
      const actualDur = Math.min(dur, totalBeats - beat)

      if (actualDur > 0) {
        notes.push({ pitch, startBeat: beat, durationBeats: actualDur, velocity: rand(50, 85) })
      }
      beat += dur
    }

    // Rest after phrase
    beat += pick([1, 1.5, 2, 2.5, 3, 4])
  }

  return { notes }
}

function generateArpeggio(genre: GenreDef, rootNote: number, bars: number): GeneratedNoteTrack | null {
  if (!genre.useArpeggio) return null
  const notes: GeneratedNote[] = []
  const progression = pick(genre.chordProgressions)
  const scale = pick(genre.scales)
  const bpb = genre.timeSignature[0]
  const arpStep = genre.arpeggioSpeed * 0.25
  const ao = rootNote + 60
  for (let bar = 0; bar < bars; bar++) {
    const sem = progression[bar % progression.length]
    const ct = [0, scale[2] || 3, scale[4] || 7]
    const pattern = [...ct, ct[1], ...ct.map(c => c + 12), ct[1] + 12]
    const shuffled = prob(0.3) ? shuffle(pattern) : pattern
    let idx = 0
    for (let b = 0; b < bpb; b += arpStep) {
      const pitch = clamp(ao + sem + shuffled[idx % shuffled.length], 48, 96)
      notes.push({ pitch, startBeat: bar * bpb + b, durationBeats: arpStep * 0.8, velocity: rand(55, 88) })
      idx++
    }
  }
  return { notes }
}

function generatePadLayer(genre: GenreDef, rootNote: number, bars: number): GeneratedNoteTrack | null {
  if (!genre.usePadLayer) return null
  const notes: GeneratedNote[] = []
  const progression = pick(genre.chordProgressions)
  const scale = pick(genre.scales)
  const bpb = genre.timeSignature[0]
  for (let bar = 0; bar < bars; bar++) {
    const sem = progression[bar % progression.length]
    const root = rootNote + 60 + sem
    const third = scale.includes((sem + 4) % 12) ? 4 : 3
    const fifth = 7
    for (const interval of [0, third, fifth]) {
      notes.push({
        pitch: clamp(root + interval, 60, 96),
        startBeat: bar * bpb,
        durationBeats: bpb,
        velocity: rand(35, 55),
      })
    }
  }
  return { notes }
}

// Main Generate Function (with user overrides)
export function generateSong(genreId: string, rootNote: number = 0, options: GenerationOptions = {}): GeneratedSong {
  const genre = getGenre(genreId)
  if (!genre) throw new Error('Unknown genre: ' + genreId)
  const bpm = options.bpm ?? rand(genre.bpmRange[0], genre.bpmRange[1])
  const bars = options.bars ?? genre.bars
  const density = options.melodyDensity ?? genre.melodyDensity
  const kit = options.drumKit ?? genre.defaultKit
  return {
    bpm,
    bars,
    timeSignature: genre.timeSignature,
    drumKit: kit,
    drums: generateDrumTrack(genre, bars),
    bass: generateBass(genre, rootNote, bars),
    chords: generateChords(genre, rootNote, bars),
    melody: generateMelody(genre, rootNote, bars, density),
    arpeggio: generateArpeggio(genre, rootNote, bars),
    pad: generatePadLayer(genre, rootNote, bars),
  }
}

// Professional Audio Rendering Engine
function makeSatCurve(drive: number): Float32Array<ArrayBuffer> {
  const ab = new ArrayBuffer(8192 * 4)
  const c = new Float32Array(ab)
  for (let i = 0; i < 8192; i++) { const x = (i * 2) / 8192 - 1; c[i] = Math.tanh(x * drive) }
  return c
}

function buildReverbIR(ctx: OfflineAudioContext, sr: number, time: number): AudioBuffer {
  const len = Math.ceil(sr * time)
  const buf = ctx.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    const pre = Math.ceil(sr * 0.015)
    const taps: [number, number][] = [[.011,.72],[.019,.58],[.026,.47],[.035,.38],[.047,.3],[.062,.23],[.079,.18],[.098,.13]]
    for (const [t, a] of taps) {
      const idx = Math.floor(t * sr) + pre
      for (let j = 0; j < 48; j++) if (idx + j < len) d[idx + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / 20)
    }
    const late = Math.ceil(sr * 0.1)
    for (let i = late; i < len; i++) {
      const t2 = (i - late) / sr
      d[i] += (Math.random() * 2 - 1) * Math.exp(-t2 * 2.8 / time) * 0.38
      d[i] += (Math.random() * 2 - 1) * Math.exp(-t2 * 6.5 / time) * 0.18
    }
    let pk = 0
    for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]))
    if (pk > 0) for (let i = 0; i < len; i++) d[i] /= pk
  }
  return buf
}

// Drum Kit Params
interface KitParams {
  kickPitch: number; kickDecay: number; kickClick: number; kickSub: number
  snarePitch: number; snareDecay: number; snareNoise: number; snareBright: number
  hhBright: number; hhDecay: number; hhOpen: number
  clapTight: number; clapBright: number
  tomPitch: number; tomDecay: number
}

const KIT_PARAMS: Record<DrumKitType, KitParams> = {
  '808': {
    kickPitch: 55, kickDecay: 0.7, kickClick: 0.3, kickSub: 0.55,
    snarePitch: 180, snareDecay: 0.35, snareNoise: 0.6, snareBright: 3500,
    hhBright: 6500, hhDecay: 0.04, hhOpen: 0.3,
    clapTight: 0.25, clapBright: 2200,
    tomPitch: 100, tomDecay: 0.4,
  },
  '909': {
    kickPitch: 60, kickDecay: 0.5, kickClick: 0.45, kickSub: 0.4,
    snarePitch: 220, snareDecay: 0.28, snareNoise: 0.75, snareBright: 5000,
    hhBright: 7500, hhDecay: 0.045, hhOpen: 0.35,
    clapTight: 0.2, clapBright: 2800,
    tomPitch: 120, tomDecay: 0.32,
  },
  'acoustic': {
    kickPitch: 70, kickDecay: 0.4, kickClick: 0.55, kickSub: 0.25,
    snarePitch: 260, snareDecay: 0.22, snareNoise: 0.82, snareBright: 6000,
    hhBright: 8500, hhDecay: 0.035, hhOpen: 0.28,
    clapTight: 0.15, clapBright: 3200,
    tomPitch: 150, tomDecay: 0.28,
  },
  'electronic': {
    kickPitch: 48, kickDecay: 0.55, kickClick: 0.35, kickSub: 0.5,
    snarePitch: 200, snareDecay: 0.3, snareNoise: 0.65, snareBright: 4500,
    hhBright: 7000, hhDecay: 0.05, hhOpen: 0.32,
    clapTight: 0.22, clapBright: 2600,
    tomPitch: 110, tomDecay: 0.35,
  },
  'lofi': {
    kickPitch: 65, kickDecay: 0.45, kickClick: 0.2, kickSub: 0.35,
    snarePitch: 200, snareDecay: 0.25, snareNoise: 0.5, snareBright: 2800,
    hhBright: 5500, hhDecay: 0.055, hhOpen: 0.25,
    clapTight: 0.3, clapBright: 1800,
    tomPitch: 130, tomDecay: 0.35,
  },
}

async function synthKick(sr: number, p: KitParams): Promise<AudioBuffer> {
  const dur = 0.1 + p.kickDecay
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const body = ctx.createOscillator(); body.type = 'sine'
  body.frequency.setValueAtTime(165, 0)
  body.frequency.exponentialRampToValueAtTime(p.kickPitch, 0.035)
  body.frequency.exponentialRampToValueAtTime(Math.max(p.kickPitch * 0.7, 30), 0.18)
  const bE = ctx.createGain()
  bE.gain.setValueAtTime(1.0, 0); bE.gain.setValueAtTime(0.85, 0.04)
  bE.gain.exponentialRampToValueAtTime(0.001, dur - 0.02)
  body.connect(bE)
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 40
  const sE = ctx.createGain()
  sE.gain.setValueAtTime(p.kickSub, 0); sE.gain.exponentialRampToValueAtTime(0.001, dur * 0.8)
  sub.connect(sE)
  const nB = ctx.createBuffer(1, Math.ceil(sr * 0.02), sr)
  const nd = nB.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.001))
  const clk = ctx.createBufferSource(); clk.buffer = nB
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800
  const cG = ctx.createGain(); cG.gain.value = p.kickClick
  clk.connect(hp); hp.connect(cG)
  const sat = ctx.createWaveShaper(); sat.curve = makeSatCurve(2.0); sat.oversample = '2x'
  const out = ctx.createGain(); out.gain.value = 0.82
  bE.connect(sat); sE.connect(sat); cG.connect(sat)
  sat.connect(out); out.connect(ctx.destination)
  body.start(0); body.stop(dur); sub.start(0); sub.stop(dur); clk.start(0)
  return ctx.startRendering()
}

async function synthSnare(sr: number, p: KitParams): Promise<AudioBuffer> {
  const dur = 0.08 + p.snareDecay
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const body = ctx.createOscillator(); body.type = 'sine'
  body.frequency.setValueAtTime(p.snarePitch, 0)
  body.frequency.exponentialRampToValueAtTime(p.snarePitch * 0.55, 0.018)
  body.frequency.exponentialRampToValueAtTime(100, 0.08)
  const bE = ctx.createGain()
  bE.gain.setValueAtTime(0.82, 0); bE.gain.exponentialRampToValueAtTime(0.001, dur * 0.65)
  body.connect(bE)
  const nLen = Math.ceil(sr * dur)
  const nB = ctx.createBuffer(1, nLen, sr), nd0 = nB.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd0[i] = Math.random() * 2 - 1
  const n1 = ctx.createBufferSource(); n1.buffer = nB
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.snareBright; bp.Q.value = 0.9
  const nE = ctx.createGain(); nE.gain.setValueAtTime(p.snareNoise, 0); nE.gain.exponentialRampToValueAtTime(0.001, dur * 0.8)
  n1.connect(bp); bp.connect(nE)
  const nB2 = ctx.createBuffer(1, nLen, sr), nd2 = nB2.getChannelData(0)
  for (let i = 0; i < nLen; i++) nd2[i] = Math.random() * 2 - 1
  const n2 = ctx.createBufferSource(); n2.buffer = nB2
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 7200
  const sE2 = ctx.createGain(); sE2.gain.setValueAtTime(0.32, 0); sE2.gain.exponentialRampToValueAtTime(0.001, dur * 0.45)
  n2.connect(hpf); hpf.connect(sE2)
  const mix = ctx.createGain(); mix.gain.value = 0.78
  bE.connect(mix); nE.connect(mix); sE2.connect(mix); mix.connect(ctx.destination)
  body.start(0); body.stop(dur); n1.start(0); n2.start(0)
  return ctx.startRendering()
}

async function synthHihat(sr: number, p: KitParams, open: boolean): Promise<AudioBuffer> {
  const dur = open ? (0.1 + p.hhOpen) : (0.01 + p.hhDecay)
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const freqs = [1047, 1175, 1397, 1568, 2093, 2637]
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'
  hpf.frequency.value = open ? p.hhBright * 0.82 : p.hhBright; hpf.Q.value = open ? 0.4 : 0.6
  for (const f of freqs) {
    const o = ctx.createOscillator(); o.type = 'square'
    o.frequency.value = f * (0.97 + Math.random() * 0.06)
    o.connect(hpf); o.start(0); o.stop(dur)
  }
  const env = ctx.createGain()
  env.gain.setValueAtTime(open ? 0.22 : 0.28, 0)
  env.gain.exponentialRampToValueAtTime(0.001, open ? dur * 0.85 : dur * 0.8)
  hpf.connect(env); env.connect(ctx.destination)
  return ctx.startRendering()
}

async function synthClap(sr: number, p: KitParams): Promise<AudioBuffer> {
  const dur = 0.1 + p.clapTight
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = p.clapBright; bpf.Q.value = 0.6
  for (const d of [0, 0.007, 0.013, 0.021]) {
    const nL = Math.ceil(sr * 0.012), nB = ctx.createBuffer(1, nL, sr), nD = nB.getChannelData(0)
    for (let i = 0; i < nL; i++) nD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.003))
    const s = ctx.createBufferSource(); s.buffer = nB; s.connect(bpf); s.start(d)
  }
  const tB = ctx.createBuffer(1, Math.ceil(sr * dur), sr), tD = tB.getChannelData(0)
  for (let i = 0; i < tD.length; i++) tD[i] = Math.random() * 2 - 1
  const tail = ctx.createBufferSource(); tail.buffer = tB; tail.connect(bpf); tail.start(0.025)
  const env = ctx.createGain(); env.gain.setValueAtTime(0.72, 0); env.gain.exponentialRampToValueAtTime(0.001, dur * 0.9)
  bpf.connect(env); env.connect(ctx.destination)
  return ctx.startRendering()
}

async function synthTom(sr: number, p: KitParams): Promise<AudioBuffer> {
  const dur = 0.08 + p.tomDecay
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const body = ctx.createOscillator(); body.type = 'sine'
  body.frequency.setValueAtTime(p.tomPitch * 1.8, 0)
  body.frequency.exponentialRampToValueAtTime(p.tomPitch, 0.055)
  body.frequency.exponentialRampToValueAtTime(p.tomPitch * 0.7, dur * 0.6)
  const bE = ctx.createGain(); bE.gain.setValueAtTime(0.72, 0); bE.gain.exponentialRampToValueAtTime(0.001, dur * 0.85)
  body.connect(bE)
  const nB = ctx.createBuffer(1, Math.ceil(sr * 0.008), sr), nD = nB.getChannelData(0)
  for (let i = 0; i < nD.length; i++) nD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.0015))
  const c = ctx.createBufferSource(); c.buffer = nB; const cG = ctx.createGain(); cG.gain.value = 0.3; c.connect(cG)
  const m = ctx.createGain(); m.gain.value = 0.65; bE.connect(m); cG.connect(m); m.connect(ctx.destination)
  body.start(0); body.stop(dur); c.start(0)
  return ctx.startRendering()
}

async function synthRim(sr: number): Promise<AudioBuffer> {
  const dur = 0.05, ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 820
  const e = ctx.createGain(); e.gain.setValueAtTime(0.6, 0); e.gain.exponentialRampToValueAtTime(0.001, 0.04)
  o.connect(e)
  const nB = ctx.createBuffer(1, Math.ceil(sr * 0.004), sr), nD = nB.getChannelData(0)
  for (let i = 0; i < nD.length; i++) nD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.0004))
  const c = ctx.createBufferSource(); c.buffer = nB; const cG = ctx.createGain(); cG.gain.value = 0.55; c.connect(cG)
  const m = ctx.createGain(); m.gain.value = 0.5; e.connect(m); cG.connect(m); m.connect(ctx.destination)
  o.start(0); o.stop(dur); c.start(0)
  return ctx.startRendering()
}

async function synthPerc(sr: number): Promise<AudioBuffer> {
  const dur = 0.15, ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(420, 0); o.frequency.exponentialRampToValueAtTime(200, 0.03)
  const e = ctx.createGain(); e.gain.setValueAtTime(0.52, 0); e.gain.exponentialRampToValueAtTime(0.001, 0.1)
  o.connect(e); e.connect(ctx.destination); o.start(0); o.stop(dur)
  return ctx.startRendering()
}

async function synthCrash(sr: number): Promise<AudioBuffer> {
  const dur = 1.2, ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const freqs = [523, 587, 659, 784, 988, 1175, 1397, 1760, 2217]
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500; hp.Q.value = 0.3
  for (const f of freqs) {
    const o = ctx.createOscillator(); o.type = 'square'
    o.frequency.value = f * (0.96 + Math.random() * 0.08)
    o.connect(hp); o.start(0); o.stop(dur)
  }
  const nB = ctx.createBuffer(1, Math.ceil(sr * dur), sr), nD = nB.getChannelData(0)
  for (let i = 0; i < nD.length; i++) nD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.35))
  const n = ctx.createBufferSource(); n.buffer = nB
  const nhp = ctx.createBiquadFilter(); nhp.type = 'highpass'; nhp.frequency.value = 5000
  const nG = ctx.createGain(); nG.gain.value = 0.25
  n.connect(nhp); nhp.connect(nG); nG.connect(ctx.destination)
  const env = ctx.createGain()
  env.gain.setValueAtTime(0.35, 0); env.gain.exponentialRampToValueAtTime(0.001, dur * 0.85)
  hp.connect(env); env.connect(ctx.destination)
  n.start(0)
  return ctx.startRendering()
}

async function synthRide(sr: number): Promise<AudioBuffer> {
  const dur = 0.6, ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const freqs = [1175, 1397, 1760, 2217, 2637]
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5800; hp.Q.value = 0.4
  for (const f of freqs) {
    const o = ctx.createOscillator(); o.type = 'square'
    o.frequency.value = f * (0.98 + Math.random() * 0.04); o.connect(hp); o.start(0); o.stop(dur)
  }
  const env = ctx.createGain()
  env.gain.setValueAtTime(0.18, 0); env.gain.exponentialRampToValueAtTime(0.001, dur * 0.9)
  hp.connect(env); env.connect(ctx.destination)
  return ctx.startRendering()
}

async function synthShaker(sr: number): Promise<AudioBuffer> {
  const dur = 0.07, ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const nB = ctx.createBuffer(1, Math.ceil(sr * dur), sr), nD = nB.getChannelData(0)
  for (let i = 0; i < nD.length; i++) nD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.015))
  const n = ctx.createBufferSource(); n.buffer = nB
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 1.2
  const env = ctx.createGain(); env.gain.setValueAtTime(0.32, 0); env.gain.exponentialRampToValueAtTime(0.001, dur * 0.85)
  n.connect(hp); hp.connect(bp); bp.connect(env); env.connect(ctx.destination); n.start(0)
  return ctx.startRendering()
}

async function synthConga(sr: number): Promise<AudioBuffer> {
  const dur = 0.22, ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(320, 0); o.frequency.exponentialRampToValueAtTime(180, 0.02)
  o.frequency.exponentialRampToValueAtTime(140, 0.08)
  const env = ctx.createGain(); env.gain.setValueAtTime(0.65, 0); env.gain.exponentialRampToValueAtTime(0.001, dur * 0.8)
  o.connect(env)
  const nB = ctx.createBuffer(1, Math.ceil(sr * 0.006), sr), nD = nB.getChannelData(0)
  for (let i = 0; i < nD.length; i++) nD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.001))
  const c = ctx.createBufferSource(); c.buffer = nB; const cG = ctx.createGain(); cG.gain.value = 0.4; c.connect(cG)
  const m = ctx.createGain(); m.gain.value = 0.55; env.connect(m); cG.connect(m); m.connect(ctx.destination)
  o.start(0); o.stop(dur); c.start(0)
  return ctx.startRendering()
}

async function synthCowbell(sr: number): Promise<AudioBuffer> {
  const dur = 0.12, ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr)
  const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = 545
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 815
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 680; bp.Q.value = 2.5
  const env = ctx.createGain(); env.gain.setValueAtTime(0.45, 0); env.gain.exponentialRampToValueAtTime(0.001, dur * 0.85)
  o1.connect(bp); o2.connect(bp); bp.connect(env); env.connect(ctx.destination)
  o1.start(0); o1.stop(dur); o2.start(0); o2.stop(dur)
  return ctx.startRendering()
}

async function prerenderDrumKit(sr: number, kit: DrumKitType): Promise<Map<string, AudioBuffer>> {
  const p = KIT_PARAMS[kit]
  const [kick, snare, hh, oh, cl, tom, rim, perc, crash, ride, shaker, conga, cowbell] = await Promise.all([
    synthKick(sr, p), synthSnare(sr, p), synthHihat(sr, p, false), synthHihat(sr, p, true),
    synthClap(sr, p), synthTom(sr, p), synthRim(sr), synthPerc(sr),
    synthCrash(sr), synthRide(sr), synthShaker(sr), synthConga(sr), synthCowbell(sr),
  ])
  const m = new Map<string, AudioBuffer>()
  m.set('kick', kick); m.set('snare', snare); m.set('hihat', hh); m.set('openhat', oh)
  m.set('clap', cl); m.set('tom', tom); m.set('rim', rim); m.set('perc', perc)
  m.set('crash', crash); m.set('ride', ride); m.set('shaker', shaker); m.set('conga', conga); m.set('cowbell', cowbell)
  return m
}

// Main Render
export async function renderSongToBuffer(song: GeneratedSong, genre: GenreDef): Promise<AudioBuffer> {
  const sr = 44100
  const bpb = song.timeSignature[0]
  const totalBeats = song.bars * bpb
  const totalSec = (totalBeats / song.bpm) * 60
  const tail = 3.5
  const offline = new OfflineAudioContext(2, Math.ceil((totalSec + tail) * sr), sr)
  const b2s = (b: number) => Math.max(0, (b / song.bpm) * 60)
  const m2f = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
  const safeStart = (t: number) => Math.max(0, t)

  const drumKit = await prerenderDrumKit(sr, song.drumKit)

  // ═══ Master Chain ═══
  const limiter = offline.createDynamicsCompressor()
  limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20
  limiter.attack.value = 0.001; limiter.release.value = 0.04
  limiter.connect(offline.destination)

  const comp = offline.createDynamicsCompressor()
  comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 3.0
  comp.attack.value = 0.008; comp.release.value = 0.15
  comp.connect(limiter)

  const masterGain = offline.createGain(); masterGain.gain.value = 0.92; masterGain.connect(comp)

  // Soft saturation on master
  const masterSat = offline.createWaveShaper()
  masterSat.curve = makeSatCurve(1.0 + genre.distortion * 1.8)
  masterSat.oversample = '4x'; masterSat.connect(masterGain)

  // Master EQ - gentle high shelf cut to reduce harshness
  const masterHiCut = offline.createBiquadFilter()
  masterHiCut.type = 'lowshelf'; masterHiCut.frequency.value = 120; masterHiCut.gain.value = 2.5
  masterHiCut.connect(masterSat)
  const masterAirCut = offline.createBiquadFilter()
  masterAirCut.type = 'highshelf'; masterAirCut.frequency.value = 8000; masterAirCut.gain.value = -2.0
  masterAirCut.connect(masterHiCut)

  // Reverb
  const conv = offline.createConvolver()
  conv.buffer = buildReverbIR(offline, sr, 2.5)
  const revWet = offline.createGain(); revWet.gain.value = genre.reverbAmount * 0.55
  const revLP = offline.createBiquadFilter()
  revLP.type = 'lowpass'; revLP.frequency.value = 4500; revLP.Q.value = 0.5
  conv.connect(revLP); revLP.connect(revWet); revWet.connect(masterGain)

  // Ping Pong Delay
  let delDst: AudioNode = masterGain
  if (genre.delayTime > 0) {
    const preDelay = offline.createGain(); preDelay.gain.value = 0.28
    const dL = offline.createDelay(2); dL.delayTime.value = genre.delayTime
    const dR = offline.createDelay(2); dR.delayTime.value = genre.delayTime * 0.75
    const fb = offline.createGain(); fb.gain.value = genre.delayFeedback * 0.7
    const dWet = offline.createGain(); dWet.gain.value = 0.18
    const dLP = offline.createBiquadFilter(); dLP.type = 'lowpass'; dLP.frequency.value = 3200
    const merge = offline.createChannelMerger(2)
    preDelay.connect(dL); dL.connect(fb); fb.connect(dR); dR.connect(dL)
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1)
    merge.connect(dLP); dLP.connect(dWet); dWet.connect(masterGain)
    delDst = preDelay
  }

  // Main Filter
  const mainLP = offline.createBiquadFilter()
  mainLP.type = 'lowpass'; mainLP.frequency.value = Math.min(genre.filterFreq, 12000); mainLP.Q.value = 0.5
  mainLP.connect(masterAirCut); mainLP.connect(conv)
  if (genre.delayTime > 0) mainLP.connect(delDst)

  // ═══ Instrument Buses ═══
  const drumBus = offline.createGain(); drumBus.gain.value = 0.78; drumBus.connect(mainLP)
  const padBus = offline.createGain(); padBus.gain.value = 0.32; padBus.connect(mainLP)
  const padLayerBus = offline.createGain(); padLayerBus.gain.value = 0.18; padLayerBus.connect(mainLP)

  // Bass chain: LP + gentle saturation for warmth
  const bassBus = offline.createGain(); bassBus.gain.value = 0.44
  const bassLP = offline.createBiquadFilter(); bassLP.type = 'lowpass'; bassLP.frequency.value = 750; bassLP.Q.value = 0.8
  const bassSat = offline.createWaveShaper(); bassSat.curve = makeSatCurve(1.8); bassSat.oversample = '2x'
  bassBus.connect(bassLP); bassLP.connect(bassSat); bassSat.connect(mainLP)

  // Lead — sits BEHIND the beat, not in front
  const leadBus = offline.createGain(); leadBus.gain.value = 0.07; leadBus.connect(mainLP)

  const arpBus = offline.createGain(); arpBus.gain.value = 0.05; arpBus.connect(mainLP)

  // ═══ Render Drums ═══
  const panMap: Record<string,number> = {
    kick:0, snare:0, clap:0.05, hihat:0.3, openhat:-0.3,
    tom:-0.2, rim:0.15, perc:-0.4, crash:-0.5, ride:0.5,
    shaker:0.4, conga:-0.35, cowbell:0.25
  }
  const stepsPerBar = 16
  const stepDur = bpb / stepsPerBar
  for (const inst of DRUM_INSTRUMENTS) {
    const stepsArr = song.drums.steps.get(inst)
    const velsArr = song.drums.velocities.get(inst)
    if (!stepsArr || !velsArr) continue
    const pan = panMap[inst] ?? 0
    for (let i = 0; i < stepsArr.length; i++) {
      if (!stepsArr[i]) continue
      const vel = (velsArr[i] || 80) / 127
      const beatPos = i * stepDur
      const sampleBuf = drumKit.get(inst)
      if (!sampleBuf) continue
      const src = offline.createBufferSource(); src.buffer = sampleBuf
      const hGain = offline.createGain()
      hGain.gain.value = clamp(vel * (0.88 + randf(0, 0.12)), 0, 1.1)
      const sp = offline.createStereoPanner(); sp.pan.value = clamp(pan + randf(-0.04, 0.04), -1, 1)
      src.connect(hGain); hGain.connect(sp); sp.connect(drumBus)
      // humanize timing but NEVER go negative
      const humanize = beatPos > 0 ? randf(-0.002, 0.002) : randf(0, 0.001)
      src.start(safeStart(b2s(beatPos) + humanize))
    }
  }

  // ═══ Render Pad Chords — warm filtered sound ═══
  for (const ch of song.chords.notes) {
    const freq = m2f(ch.pitch)
    const start = b2s(ch.startBeat); const dur = b2s(ch.durationBeats)
    if (dur <= 0) continue
    const atkT = Math.min(0.25, dur * 0.2); const relT = Math.min(0.5, dur * 0.3)
    const vel = ch.velocity / 127
    const detunes = [-12, -4, 0, 4, 12]
    const pans = [-0.45, -0.2, 0, 0.2, 0.45]
    const ampPer = vel * 0.035

    for (let d = 0; d < detunes.length; d++) {
      const osc = offline.createOscillator()
      osc.type = genre.padSynthType
      osc.frequency.value = freq; osc.detune.value = detunes[d]

      // LP filter per voice — essential for warm pads
      const flt = offline.createBiquadFilter()
      flt.type = 'lowpass'
      flt.frequency.setValueAtTime(200, safeStart(start))
      flt.frequency.linearRampToValueAtTime(Math.min(freq * 3, 2800), safeStart(start) + atkT * 0.8)
      flt.frequency.setValueAtTime(Math.min(freq * 2.5, 2200), safeStart(start) + dur - relT)
      flt.frequency.linearRampToValueAtTime(200, safeStart(start) + dur)
      flt.Q.value = 0.6

      const g = offline.createGain(); g.gain.value = 0
      g.gain.setValueAtTime(0, safeStart(start))
      g.gain.linearRampToValueAtTime(ampPer, safeStart(start) + atkT)
      g.gain.setValueAtTime(ampPer * 0.85, safeStart(start) + dur - relT)
      g.gain.linearRampToValueAtTime(0, safeStart(start) + dur)

      const sp = offline.createStereoPanner(); sp.pan.value = pans[d]
      osc.connect(flt); flt.connect(g); g.connect(sp); sp.connect(padBus)
      osc.start(safeStart(start)); osc.stop(safeStart(start) + dur + 0.05)
    }
  }

  // ═══ Render Extra Pad Layer — soft sine warmth ═══
  if (song.pad) {
    for (const n of song.pad.notes) {
      const freq = m2f(n.pitch)
      const start = b2s(n.startBeat); const dur = b2s(n.durationBeats)
      if (dur <= 0) continue
      const atkT = Math.min(0.4, dur * 0.25); const relT = Math.min(0.6, dur * 0.3)
      const vel = n.velocity / 127

      for (const dt of [-5, 0, 5]) {
        const osc = offline.createOscillator(); osc.type = 'sine'
        osc.frequency.value = freq; osc.detune.value = dt

        const flt = offline.createBiquadFilter()
        flt.type = 'lowpass'; flt.frequency.value = 1800; flt.Q.value = 0.4

        const g = offline.createGain(); g.gain.value = 0
        g.gain.setValueAtTime(0, safeStart(start))
        g.gain.linearRampToValueAtTime(vel * 0.04, safeStart(start) + atkT)
        g.gain.setValueAtTime(vel * 0.035, safeStart(start) + dur - relT)
        g.gain.linearRampToValueAtTime(0, safeStart(start) + dur)

        osc.connect(flt); flt.connect(g); g.connect(padLayerBus)
        osc.start(safeStart(start)); osc.stop(safeStart(start) + dur + 0.05)
      }
    }
  }

  // ═══ Render Bass — warm, filtered, punchy ═══
  for (const n of song.bass.notes) {
    const freq = m2f(n.pitch)
    const start = b2s(n.startBeat); const dur = b2s(n.durationBeats)
    if (dur <= 0) continue
    const vel = n.velocity / 127

    // Main bass oscillator
    const osc = offline.createOscillator()
    osc.type = genre.bassSynthType
    osc.frequency.value = freq

    // Filter envelope — opens fast then closes for warmth
    const flt = offline.createBiquadFilter()
    flt.type = 'lowpass'; flt.Q.value = 2.0
    flt.frequency.setValueAtTime(Math.min(freq * 8, 3000), safeStart(start))
    flt.frequency.exponentialRampToValueAtTime(Math.max(freq * 2.5, 120), safeStart(start) + Math.min(dur * 0.4, 0.25))

    const g = offline.createGain(); g.gain.value = 0
    g.gain.setValueAtTime(0, safeStart(start))
    g.gain.linearRampToValueAtTime(vel * 0.32, safeStart(start) + 0.006)
    g.gain.setValueAtTime(vel * 0.26, safeStart(start) + Math.min(dur * 0.7, 0.3))
    g.gain.linearRampToValueAtTime(0, safeStart(start) + dur)

    osc.connect(flt); flt.connect(g); g.connect(bassBus)
    osc.start(safeStart(start)); osc.stop(safeStart(start) + dur + 0.02)

    // Sub bass layer — pure sine, no harmonics
    if (genre.useSubBass && freq < 200) {
      const sub = offline.createOscillator(); sub.type = 'sine'
      sub.frequency.value = freq * 0.5
      const sLP = offline.createBiquadFilter(); sLP.type = 'lowpass'; sLP.frequency.value = 180; sLP.Q.value = 0.5
      const sg = offline.createGain(); sg.gain.value = 0
      sg.gain.setValueAtTime(0, safeStart(start))
      sg.gain.linearRampToValueAtTime(vel * 0.18, safeStart(start) + 0.015)
      sg.gain.setValueAtTime(vel * 0.15, safeStart(start) + dur * 0.7)
      sg.gain.linearRampToValueAtTime(0, safeStart(start) + dur)
      sub.connect(sLP); sLP.connect(sg); sg.connect(bassBus)
      sub.start(safeStart(start)); sub.stop(safeStart(start) + dur + 0.02)
    }
  }

  // ═══ Render Melody — additive sine synthesis (warm, never harsh) ═══
  for (const n of song.melody.notes) {
    const freq = m2f(n.pitch)
    const start = b2s(n.startBeat); const dur = b2s(n.durationBeats)
    if (dur <= 0) continue
    const vel = n.velocity / 127
    const atkT = Math.min(0.035, dur * 0.10)
    const relT = Math.min(0.12, dur * 0.22)

    // Vibrato LFO (shared by fundamental oscillators)
    const vib = offline.createOscillator(); vib.frequency.value = 4.5
    const vibG = offline.createGain(); vibG.gain.value = 0
    if (dur > 0.3) {
      const vibDelay = Math.min(dur * 0.5, 0.3)
      vibG.gain.setValueAtTime(0, safeStart(start))
      vibG.gain.linearRampToValueAtTime(1.2, safeStart(start) + vibDelay)
    }
    vib.connect(vibG)

    // Additive synthesis: fundamental + soft harmonics (all sine — never digital/harsh)
    const partials: [number, number, number[]][] = [
      [1, 0.055, [-10, 10]],      // fundamental with slight chorus
      [2, 0.016, [0]],            // soft octave harmonic
      [3, 0.004, [0]],            // gentle 5th harmonic
    ]

    for (const [ratio, amp, detunes] of partials) {
      for (const dt of detunes) {
        const osc = offline.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = freq * ratio; osc.detune.value = dt

        // Connect vibrato to fundamental oscillators only
        if (ratio === 1) vibG.connect(osc.frequency)

        // Gentle LP — roll off everything above warmth zone
        const flt = offline.createBiquadFilter()
        flt.type = 'lowpass'; flt.Q.value = 0.5
        flt.frequency.setValueAtTime(Math.min(freq * 4, 2800), safeStart(start))
        flt.frequency.exponentialRampToValueAtTime(Math.min(freq * 2, 1800), safeStart(start) + Math.min(dur * 0.3, 0.12))

        const g = offline.createGain(); g.gain.value = 0
        g.gain.setValueAtTime(0, safeStart(start))
        g.gain.linearRampToValueAtTime(vel * amp, safeStart(start) + atkT)
        g.gain.setValueAtTime(vel * amp * 0.82, safeStart(start) + dur - relT)
        g.gain.linearRampToValueAtTime(0, safeStart(start) + dur)

        osc.connect(flt); flt.connect(g); g.connect(leadBus)
        osc.start(safeStart(start)); osc.stop(safeStart(start) + dur + 0.02)
      }
    }

    vib.start(safeStart(start)); vib.stop(safeStart(start) + dur + 0.02)
  }

  // ═══ Render Arpeggio — plucky, filtered sweep ═══
  if (song.arpeggio) {
    for (const n of song.arpeggio.notes) {
      const freq = m2f(n.pitch)
      const start = b2s(n.startBeat); const dur = b2s(n.durationBeats)
      if (dur <= 0) continue
      const vel = n.velocity / 127

      const osc = offline.createOscillator()
      osc.type = 'triangle'; osc.frequency.value = freq

      // Resonant filter sweep — the key to good arpeggios
      const flt = offline.createBiquadFilter()
      flt.type = 'lowpass'; flt.Q.value = 3
      flt.frequency.setValueAtTime(Math.min(freq * 6, 4000), safeStart(start))
      flt.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.5, 300), safeStart(start) + Math.min(dur, 0.2))

      const g = offline.createGain(); g.gain.value = 0
      g.gain.setValueAtTime(0, safeStart(start))
      g.gain.linearRampToValueAtTime(vel * 0.08, safeStart(start) + 0.004)
      g.gain.exponentialRampToValueAtTime(0.001, safeStart(start) + Math.min(dur * 0.85, 0.3))

      osc.connect(flt); flt.connect(g); g.connect(arpBus)
      osc.start(safeStart(start)); osc.stop(safeStart(start) + dur + 0.02)
    }
  }

  // ═══ Sidechain Ducking — pads breathe with the kick (modern production essential) ═══
  const kickSteps = song.drums.steps.get('kick')
  if (kickSteps) {
    const basePad = 0.32, basePadL = 0.18
    for (let i = 0; i < kickSteps.length; i++) {
      if (!kickSteps[i]) continue
      const t = safeStart(b2s(i * stepDur))
      // Duck pads to 25% on kick, release over 140ms
      padBus.gain.setValueAtTime(basePad, t)
      padBus.gain.linearRampToValueAtTime(basePad * 0.25, t + 0.004)
      padBus.gain.linearRampToValueAtTime(basePad, t + 0.14)
      padLayerBus.gain.setValueAtTime(basePadL, t)
      padLayerBus.gain.linearRampToValueAtTime(basePadL * 0.25, t + 0.004)
      padLayerBus.gain.linearRampToValueAtTime(basePadL, t + 0.14)
    }
  }

  return offline.startRendering()
}
