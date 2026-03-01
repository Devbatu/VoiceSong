/* ============================================================
   DAWPianoRoll — MIDI note editor grid with keyboard,
   drag-to-create notes, velocity editing, quantize
   ============================================================ */
import React, { useRef, useState, useCallback, useEffect, memo } from 'react'
import type { DAWTrack, MidiNote, DAWState } from './useDAWEngine'

interface Props {
  track: DAWTrack | null
  state: DAWState
  onAddNote: (trackId: string, note: Omit<MidiNote, 'id' | 'selected'>) => void
  onUpdateNote: (trackId: string, noteId: string, changes: Partial<MidiNote>) => void
  onRemoveNote: (trackId: string, noteId: string) => void
  onClose: () => void
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const KEY_HEIGHT = 16
const KEY_WIDTH = 50
const TOTAL_KEYS = 88 // piano range
const START_MIDI = 21 // A0

const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

function midiToName(midi: number): string {
  const note = midi % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[note]}${octave}`
}

function isBlackKey(midi: number): boolean {
  return BLACK_KEYS.has(midi % 12)
}

function snapBeat(beat: number, snap: number): number {
  if (snap <= 0) return beat
  return Math.round(beat / snap) * snap
}

// Scales for highlighting
const SCALES: Record<string, number[]> = {
  'Majör': [0, 2, 4, 5, 7, 9, 11],
  'Minör': [0, 2, 3, 5, 7, 8, 10],
  'Pentatonik': [0, 2, 4, 7, 9],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
}

const NOTE_COLORS = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#84cc16', '#f97316', '#a855f7',
]

const DAWPianoRoll: React.FC<Props> = memo(({ track, state, onAddNote, onUpdateNote, onRemoveNote, onClose }) => {
  const gridRef = useRef<HTMLDivElement>(null)
  const [rootNote, setRootNote] = useState(0) // C
  const [scale, setScale] = useState('Majör')
  const [tool, setTool] = useState<'draw' | 'select' | 'erase'>('draw')
  const [drawingNote, setDrawingNote] = useState<{ pitch: number; startBeat: number; currentBeat: number } | null>(null)
  const [dragNote, setDragNote] = useState<{ noteId: string; startX: number; startY: number; origNote: MidiNote } | null>(null)
  const [velocityEdit, setVelocityEdit] = useState<string | null>(null)
  const previewCtxRef = useRef<AudioContext | null>(null)

  const zoom = state.zoom
  const totalWidth = state.totalBeats * zoom
  const totalHeight = TOTAL_KEYS * KEY_HEIGHT

  // ---- ALL HOOKS MUST BE ABOVE THE EARLY RETURN ----

  // ---- Grid click → add/remove note ----
  const handleGridMouseDown = useCallback((e: React.MouseEvent) => {
    if (!track || e.button !== 0) return
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left + (gridRef.current?.parentElement?.scrollLeft || 0)
    const y = e.clientY - rect.top + (gridRef.current?.parentElement?.scrollTop || 0)
    const beat = snapBeat(x / zoom, state.snapValue)
    const pitch = START_MIDI + TOTAL_KEYS - 1 - Math.floor(y / KEY_HEIGHT)

    if (tool === 'draw') {
      setDrawingNote({ pitch, startBeat: beat, currentBeat: beat + (state.snapValue || 0.25) })
    } else if (tool === 'erase') {
      // Find and remove note at position
      const note = track.midiNotes.find(n =>
        n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats
      )
      if (note) onRemoveNote(track.id, note.id)
    }
  }, [track, zoom, state.snapValue, tool, onRemoveNote])

  const handleGridMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawingNote || !gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + (gridRef.current.parentElement?.scrollLeft || 0)
    const beat = snapBeat(x / zoom, state.snapValue)
    setDrawingNote(prev => prev ? { ...prev, currentBeat: Math.max(prev.startBeat + (state.snapValue || 0.25), beat) } : null)
  }, [drawingNote, zoom, state.snapValue])

  const handleGridMouseUp = useCallback(() => {
    if (drawingNote && track) {
      const startBeat = Math.min(drawingNote.startBeat, drawingNote.currentBeat)
      const endBeat = Math.max(drawingNote.startBeat, drawingNote.currentBeat)
      onAddNote(track.id, {
        pitch: drawingNote.pitch,
        startBeat,
        durationBeats: Math.max(state.snapValue || 0.25, endBeat - startBeat),
        velocity: 100,
      })
    }
    setDrawingNote(null)
  }, [drawingNote, track, state.snapValue, onAddNote])

  // ---- Drag existing note ----
  const handleNoteMouseDown = useCallback((e: React.MouseEvent, note: MidiNote) => {
    e.stopPropagation()
    if (!track) return
    if (tool === 'erase') {
      onRemoveNote(track.id, note.id)
      return
    }
    if (tool === 'select' || tool === 'draw') {
      onUpdateNote(track.id, note.id, { selected: true })
      setDragNote({ noteId: note.id, startX: e.clientX, startY: e.clientY, origNote: { ...note } })
    }
  }, [tool, track, onRemoveNote, onUpdateNote])

  useEffect(() => {
    if (!dragNote || !track) return
    const trackId = track.id
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragNote.startX
      const dy = e.clientY - dragNote.startY
      const dBeat = dx / zoom
      const dPitch = -Math.round(dy / KEY_HEIGHT)
      const newStart = snapBeat(Math.max(0, dragNote.origNote.startBeat + dBeat), state.snapValue)
      const newPitch = Math.max(START_MIDI, Math.min(START_MIDI + TOTAL_KEYS - 1, dragNote.origNote.pitch + dPitch))
      onUpdateNote(trackId, dragNote.noteId, { startBeat: newStart, pitch: newPitch })
    }
    const handleUp = () => setDragNote(null)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [dragNote, zoom, state.snapValue, track, onUpdateNote])

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        track?.midiNotes.filter(n => n.selected).forEach(n => onRemoveNote(track!.id, n.id))
      }
      if (e.key === '1') setTool('select')
      if (e.key === '2') setTool('draw')
      if (e.key === '3') setTool('erase')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [track, onRemoveNote])

  // ---- Play note sound (quick preview) — reuse single AudioContext ----
  const playNotePreview = useCallback((pitch: number) => {
    try {
      if (!previewCtxRef.current || previewCtxRef.current.state === 'closed') {
        previewCtxRef.current = new AudioContext()
      }
      const ctx = previewCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12)
      osc.type = 'sine'
      gain.gain.value = 0.15
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.3)
    } catch {}
  }, [])

  // Cleanup preview AudioContext on unmount
  useEffect(() => {
    return () => { previewCtxRef.current?.close() }
  }, [])

  // ---- EARLY RETURN AFTER ALL HOOKS ----
  if (!track) return null

  const scaleNotes = SCALES[scale] || SCALES['Majör']
  const isInScale = (midi: number) => scaleNotes.includes((midi - rootNote + 12) % 12)

  // ---- Render ----
  const renderKeyboard = () => {
    const keys: React.JSX.Element[] = []
    for (let i = TOTAL_KEYS - 1; i >= 0; i--) {
      const midi = START_MIDI + i
      const name = midiToName(midi)
      const black = isBlackKey(midi)
      const inScale = isInScale(midi)
      keys.push(
        <div
          key={midi}
          className={`daw-piano-key ${black ? 'black' : 'white'} ${inScale ? 'in-scale' : ''}`}
          style={{ height: KEY_HEIGHT }}
          onMouseDown={() => playNotePreview(midi)}
        >
          <span className="daw-piano-key-label">{name}</span>
        </div>
      )
    }
    return keys
  }

  const renderGrid = () => {
    const rows: React.JSX.Element[] = []
    for (let i = TOTAL_KEYS - 1; i >= 0; i--) {
      const midi = START_MIDI + i
      const black = isBlackKey(midi)
      const inScale = isInScale(midi)
      rows.push(
        <div
          key={midi}
          className={`daw-pianoroll-row ${black ? 'black' : 'white'} ${inScale ? 'in-scale' : ''}`}
          style={{ height: KEY_HEIGHT }}
        />
      )
    }
    return rows
  }

  const renderNotes = () => {
    return track.midiNotes.map(note => {
      const top = (START_MIDI + TOTAL_KEYS - 1 - note.pitch) * KEY_HEIGHT
      const left = note.startBeat * zoom
      const width = Math.max(4, note.durationBeats * zoom)
      const colorIdx = note.pitch % NOTE_COLORS.length
      const alpha = Math.round(note.velocity / 127 * 255).toString(16).padStart(2, '0')
      return (
        <div
          key={note.id}
          className={`daw-pianoroll-note ${note.selected ? 'selected' : ''}`}
          style={{
            top,
            left,
            width,
            height: KEY_HEIGHT - 1,
            background: NOTE_COLORS[colorIdx] + alpha,
            borderColor: NOTE_COLORS[colorIdx],
          }}
          onMouseDown={e => handleNoteMouseDown(e, note)}
          onDoubleClick={e => {
            e.stopPropagation()
            setVelocityEdit(note.id)
          }}
          title={`${midiToName(note.pitch)} | Vel: ${note.velocity} | ${note.startBeat.toFixed(2)}`}
        >
          {velocityEdit === note.id && (
            <input
              type="number"
              className="daw-velocity-input"
              value={note.velocity}
              min={1} max={127}
              autoFocus
              onChange={e => onUpdateNote(track.id, note.id, { velocity: Math.max(1, Math.min(127, Number(e.target.value))) })}
              onBlur={() => setVelocityEdit(null)}
              onKeyDown={e => { if (e.key === 'Enter') setVelocityEdit(null) }}
              onClick={e => e.stopPropagation()}
            />
          )}
        </div>
      )
    })
  }

  const renderDrawingNote = () => {
    if (!drawingNote) return null
    const top = (START_MIDI + TOTAL_KEYS - 1 - drawingNote.pitch) * KEY_HEIGHT
    const startBeat = Math.min(drawingNote.startBeat, drawingNote.currentBeat)
    const endBeat = Math.max(drawingNote.startBeat, drawingNote.currentBeat)
    const left = startBeat * zoom
    const width = Math.max(4, (endBeat - startBeat) * zoom)
    return (
      <div
        className="daw-pianoroll-note drawing"
        style={{ top, left, width, height: KEY_HEIGHT - 1 }}
      />
    )
  }

  // Vertical grid lines
  const renderVerticalGrid = () => {
    const lines: React.JSX.Element[] = []
    const beatsPerBar = state.timeSignature[0]
    const totalBars = Math.ceil(state.totalBeats / beatsPerBar)
    for (let bar = 0; bar <= totalBars; bar++) {
      const x = bar * beatsPerBar * zoom
      lines.push(<div key={`bar-${bar}`} className="daw-pianoroll-vline bar" style={{ left: x }} />)
      for (let sub = 1; sub < beatsPerBar; sub++) {
        const sx = (bar * beatsPerBar + sub) * zoom
        lines.push(<div key={`sub-${bar}-${sub}`} className="daw-pianoroll-vline beat" style={{ left: sx }} />)
      }
    }
    return lines
  }

  // Playhead
  const playheadLeft = state.playheadBeat * zoom

  return (
    <div className="daw-pianoroll">
      {/* Toolbar */}
      <div className="daw-pianoroll-toolbar">
        <div className="daw-pianoroll-tools">
          <button className={`daw-btn ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} title="Seç (1)">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 1l4 12 2-5 5-2z" fill="currentColor"/></svg>
          </button>
          <button className={`daw-btn ${tool === 'draw' ? 'active' : ''}`} onClick={() => setTool('draw')} title="Çiz (2)">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 12L11 3l1 1L3 13zM10 2l2-1 1 1-1 2z" fill="currentColor"/></svg>
          </button>
          <button className={`daw-btn ${tool === 'erase' ? 'active' : ''}`} onClick={() => setTool('erase')} title="Sil (3)">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 5l6-4 6 4-3 8H4z" stroke="currentColor" fill="none" strokeWidth="1.5"/><line x1="4" y1="13" x2="10" y2="13" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
        </div>

        <div className="daw-pianoroll-scale">
          <label className="daw-label">Kök</label>
          <select className="daw-select" value={rootNote} onChange={e => setRootNote(Number(e.target.value))}>
            {NOTE_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
          <label className="daw-label">Skala</label>
          <select className="daw-select" value={scale} onChange={e => setScale(e.target.value)}>
            {Object.keys(SCALES).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="daw-pianoroll-info">
          <span className="daw-label">{track.name}</span>
        </div>

        <button className="daw-btn daw-btn-close" onClick={onClose} title="Kapat">✕</button>
      </div>

      {/* Body: keyboard + grid */}
      <div className="daw-pianoroll-body">
        {/* Keyboard */}
        <div className="daw-pianoroll-keyboard" style={{ width: KEY_WIDTH }}>
          {renderKeyboard()}
        </div>

        {/* Grid area */}
        <div className="daw-pianoroll-grid-scroll">
          <div
            ref={gridRef}
            className="daw-pianoroll-grid"
            style={{ width: totalWidth, height: totalHeight }}
            onMouseDown={handleGridMouseDown}
            onMouseMove={handleGridMouseMove}
            onMouseUp={handleGridMouseUp}
          >
            {renderGrid()}
            {renderVerticalGrid()}
            {renderNotes()}
            {renderDrawingNote()}
            {/* Playhead */}
            <div className="daw-pianoroll-playhead" style={{ left: playheadLeft }} />
          </div>
        </div>
      </div>

      {/* Velocity lane (bottom) */}
      <div className="daw-pianoroll-velocity">
        <div className="daw-pianoroll-velocity-label">Velocity</div>
        <div className="daw-pianoroll-velocity-grid" style={{ width: totalWidth }}>
          {track.midiNotes.map(note => {
            const left = note.startBeat * zoom
            const width = Math.max(3, note.durationBeats * zoom)
            const height = (note.velocity / 127) * 60
            const colorIdx = note.pitch % NOTE_COLORS.length
            return (
              <div
                key={note.id}
                className="daw-velocity-bar"
                style={{
                  left,
                  width,
                  height,
                  bottom: 0,
                  background: NOTE_COLORS[colorIdx],
                }}
                onMouseDown={e => {
                  e.stopPropagation()
                  const startY = e.clientY
                  const origVel = note.velocity
                  const onMove = (me: MouseEvent) => {
                    const dy = startY - me.clientY
                    const newVel = Math.max(1, Math.min(127, origVel + Math.round(dy)))
                    onUpdateNote(track.id, note.id, { velocity: newVel })
                  }
                  const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                  window.addEventListener('mousemove', onMove)
                  window.addEventListener('mouseup', onUp)
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
})

DAWPianoRoll.displayName = 'DAWPianoRoll'
export default DAWPianoRoll
