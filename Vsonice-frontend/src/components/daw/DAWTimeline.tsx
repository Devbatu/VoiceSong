/* ============================================================
   DAWTimeline — Multi-track timeline with waveforms, 
   drag-drop clips, region selection, copy/paste, playhead
   ============================================================ */
import React, { useRef, useState, useCallback, useEffect, memo } from 'react'
import type { DAWTrack, AudioClip, DAWState } from './useDAWEngine'

interface Props {
  tracks: DAWTrack[]
  state: DAWState
  onStateChange: (changes: Partial<DAWState>) => void
  onClipMove: (trackId: string, clipId: string, changes: Partial<AudioClip>) => void
  onClipRemove: (trackId: string, clipId: string) => void
  onClipDuplicate: (trackId: string, clipId: string, targetTrackId?: string) => void
  onClipSplit: (trackId: string, clipId: string, atBeat: number) => void
  onTrackUpdate: (trackId: string, changes: Partial<DAWTrack>) => void
  onTrackAdd: (type: 'audio' | 'midi') => void
  onTrackRemove: (trackId: string) => void
  onLoadAudioFile: (file: File, trackId: string) => void
  onSeek: (beat: number) => void
  selectedTrackId: string | null
  onSelectTrack: (trackId: string) => void
  onSelectClip: (trackId: string, clipId: string) => void
  onOpenPianoRoll: (trackId: string) => void
  onOpenClipEditor: (trackId: string, clipId: string) => void
}

const HEADER_WIDTH = 200
const RULER_HEIGHT = 30

// Snap beat to grid
function snapBeat(beat: number, snap: number): number {
  if (snap <= 0) return beat
  return Math.round(beat / snap) * snap
}

const DAWTimeline: React.FC<Props> = memo(({
  tracks, state, onStateChange,
  onClipMove, onClipRemove, onClipDuplicate, onClipSplit,
  onTrackUpdate, onTrackAdd, onTrackRemove,
  onLoadAudioFile, onSeek,
  selectedTrackId, onSelectTrack, onSelectClip,
  onOpenPianoRoll, onOpenClipEditor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize-left' | 'resize-right' | null
    trackId: string
    clipId: string
    startX: number
    startBeat: number
    origClip: AudioClip | null
  }>({ type: null, trackId: '', clipId: '', startX: 0, startBeat: 0, origClip: null })

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId: string; clipId?: string; beat: number } | null>(null)
  const [_selectionRegion, _setSelectionRegion] = useState<{ startBeat: number; endBeat: number; trackIds: string[] } | null>(null)
  const [clipboard, setClipboard] = useState<AudioClip[]>([])
  const [isDragOver, setIsDragOver] = useState<string | null>(null)

  const zoom = state.zoom // px per beat
  const totalWidth = state.totalBeats * zoom

  // ---- Beat from px ----
  const pxToBeat = useCallback((px: number) => px / zoom, [zoom])
  const beatToPx = useCallback((beat: number) => beat * zoom, [zoom])

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete selected clips
        tracks.forEach(t => t.clips.filter(c => c.selected).forEach(c => onClipRemove(t.id, c.id)))
      }
      if (e.ctrlKey && e.key === 'c') {
        // Copy selected
        const sel = tracks.flatMap(t => t.clips.filter(c => c.selected))
        if (sel.length) setClipboard(sel)
      }
      if (e.ctrlKey && e.key === 'v') {
        // Paste at playhead
        clipboard.forEach(c => {
          onClipDuplicate(c.trackId, c.id)
        })
      }
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        tracks.forEach(t => t.clips.filter(c => c.selected).forEach(c => onClipDuplicate(t.id, c.id)))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [tracks, clipboard, onClipRemove, onClipDuplicate])

  // ---- Drag clip ----
  const handleClipMouseDown = useCallback((e: React.MouseEvent, trackId: string, clip: AudioClip, type: 'move' | 'resize-left' | 'resize-right') => {
    e.stopPropagation()
    e.preventDefault()
    onSelectClip(trackId, clip.id)
    setDragState({ type, trackId, clipId: clip.id, startX: e.clientX, startBeat: clip.startBeat, origClip: { ...clip } })
  }, [onSelectClip])

  useEffect(() => {
    if (!dragState.type) return

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX
      const dBeat = pxToBeat(dx)
      const snap = state.snapValue

      if (dragState.type === 'move' && dragState.origClip) {
        const newStart = snapBeat(Math.max(0, dragState.origClip.startBeat + dBeat), snap)
        onClipMove(dragState.trackId, dragState.clipId, { startBeat: newStart })
      }
      if (dragState.type === 'resize-right' && dragState.origClip) {
        const newDur = snapBeat(Math.max(0.25, dragState.origClip.durationBeats + dBeat), snap)
        onClipMove(dragState.trackId, dragState.clipId, { durationBeats: newDur })
      }
      if (dragState.type === 'resize-left' && dragState.origClip) {
        const orig = dragState.origClip
        const newStart = snapBeat(Math.max(0, orig.startBeat + dBeat), snap)
        const diff = newStart - orig.startBeat
        if (orig.durationBeats - diff > 0.25) {
          onClipMove(dragState.trackId, dragState.clipId, {
            startBeat: newStart,
            durationBeats: orig.durationBeats - diff,
            offsetBeats: orig.offsetBeats + diff,
          })
        }
      }
    }

    const handleUp = () => {
      setDragState({ type: null, trackId: '', clipId: '', startX: 0, startBeat: 0, origClip: null })
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragState, pxToBeat, state.snapValue, onClipMove])

  // ---- Click on ruler to seek ----
  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left + state.scrollX
    const beat = snapBeat(pxToBeat(x), state.snapValue)
    onSeek(beat)
  }, [state.scrollX, pxToBeat, state.snapValue, onSeek])

  // ---- Right click context menu ----
  const handleContextMenu = useCallback((e: React.MouseEvent, trackId: string, clipId?: string) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + state.scrollX - HEADER_WIDTH
    const beat = pxToBeat(x)
    setContextMenu({ x: e.clientX, y: e.clientY, trackId, clipId, beat })
  }, [state.scrollX, pxToBeat])

  // ---- File drop handler ----
  const handleDrop = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault()
    setIsDragOver(null)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i))
    files.forEach(f => onLoadAudioFile(f, trackId))
  }, [onLoadAudioFile])

  const handleDragOver = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault()
    setIsDragOver(trackId)
  }, [])

  // ---- Render ruler ----
  const renderRuler = () => {
    const bars: React.JSX.Element[] = []
    const beatsPerBar = state.timeSignature[0]
    const totalBars = Math.ceil(state.totalBeats / beatsPerBar)

    for (let bar = 0; bar <= totalBars; bar++) {
      const beat = bar * beatsPerBar
      const x = beatToPx(beat)
      bars.push(
        <g key={`bar-${bar}`}>
          <line x1={x} y1={0} x2={x} y2={RULER_HEIGHT} stroke="#555" strokeWidth={1} />
          <text x={x + 4} y={14} fill="#999" fontSize={11} fontFamily="monospace">{bar + 1}</text>
        </g>
      )
      // Sub-beats
      for (let sub = 1; sub < beatsPerBar; sub++) {
        const sx = beatToPx(beat + sub)
        bars.push(
          <line key={`sub-${bar}-${sub}`} x1={sx} y1={RULER_HEIGHT * 0.6} x2={sx} y2={RULER_HEIGHT} stroke="#444" strokeWidth={0.5} />
        )
      }
    }
    return bars
  }

  // ---- Render waveform ----
  const renderWaveform = (clip: AudioClip, height: number) => {
    const peaks = clip.waveformPeaks
    if (!peaks.length) return null
    const w = clip.durationBeats * zoom
    const step = w / peaks.length
    const mid = height / 2

    let d = `M 0 ${mid}`
    for (let i = 0; i < peaks.length; i++) {
      const x = i * step
      const amp = peaks[i] * mid * 0.9
      d += ` L ${x} ${mid - amp}`
    }
    for (let i = peaks.length - 1; i >= 0; i--) {
      const x = i * step
      const amp = peaks[i] * mid * 0.9
      d += ` L ${x} ${mid + amp}`
    }
    d += ' Z'

    return (
      <svg width={w} height={height} className="daw-waveform-svg">
        <path d={d} fill={clip.color + '60'} stroke={clip.color} strokeWidth={0.5} />
      </svg>
    )
  }

  // ---- Render clips for a track ----
  const renderClips = (track: DAWTrack) => {
    return track.clips.map(clip => {
      const left = beatToPx(clip.startBeat)
      const width = Math.max(4, beatToPx(clip.durationBeats))
      const isSelected = clip.selected
      return (
        <div
          key={clip.id}
          className={`daw-clip ${isSelected ? 'selected' : ''}`}
          style={{
            left,
            width,
            height: track.height - 4,
            borderColor: clip.color,
            background: `${clip.color}15`,
          }}
          onMouseDown={e => handleClipMouseDown(e, track.id, clip, 'move')}
          onContextMenu={e => handleContextMenu(e, track.id, clip.id)}
          onDoubleClick={() => {
            if (track.type === 'midi') onOpenPianoRoll(track.id)
            else onOpenClipEditor(track.id, clip.id)
          }}
        >
          {/* Resize handles */}
          <div
            className="daw-clip-handle daw-clip-handle-left"
            onMouseDown={e => handleClipMouseDown(e, track.id, clip, 'resize-left')}
          />
          <div
            className="daw-clip-handle daw-clip-handle-right"
            onMouseDown={e => handleClipMouseDown(e, track.id, clip, 'resize-right')}
          />
          {/* Waveform */}
          <div className="daw-clip-waveform">
            {renderWaveform(clip, track.height - 8)}
          </div>
          {/* Label */}
          <div className="daw-clip-label">{clip.name}</div>
        </div>
      )
    })
  }

  // ---- Render MIDI notes as visual blocks in the timeline ----
  const renderMidiNotes = (track: DAWTrack) => {
    if (track.type !== 'midi' || track.midiNotes.length === 0) return null
    // Find the pitch range for vertical positioning
    const pitches = track.midiNotes.map(n => n.pitch)
    const minP = Math.min(...pitches)
    const maxP = Math.max(...pitches)
    const range = Math.max(maxP - minP, 12) // at least 1 octave
    const h = track.height - 8
    return track.midiNotes.map(note => {
      const left = beatToPx(note.startBeat)
      const width = Math.max(2, beatToPx(note.durationBeats))
      const top = h - ((note.pitch - minP) / range) * h
      const noteH = Math.max(2, h / range)
      const alpha = Math.round((note.velocity / 127) * 200 + 55).toString(16).padStart(2, '0')
      return (
        <div
          key={note.id}
          className="daw-midi-note-block"
          style={{
            position: 'absolute',
            left,
            width,
            top: Math.max(0, top),
            height: noteH,
            background: `${track.color}${alpha}`,
            borderRadius: 2,
            border: `1px solid ${track.color}88`,
            pointerEvents: 'none',
          }}
        />
      )
    })
  }

  // ---- Render track headers ----
  const renderTrackHeader = (track: DAWTrack, _index: number) => (
    <div
      key={track.id}
      className={`daw-track-header ${selectedTrackId === track.id ? 'selected' : ''}`}
      style={{ height: track.height, borderLeftColor: track.color }}
      onClick={() => onSelectTrack(track.id)}
    >
      <div className="daw-track-header-top">
        <div className="daw-track-color" style={{ background: track.color }} />
        <input
          className="daw-track-name-input"
          value={track.name}
          onChange={e => onTrackUpdate(track.id, { name: e.target.value })}
          onClick={e => e.stopPropagation()}
        />
        <span className="daw-track-type-badge">{track.type === 'midi' ? 'MIDI' : 'AUD'}</span>
      </div>
      <div className="daw-track-header-controls">
        <button
          className={`daw-track-btn ${track.muted ? 'active-mute' : ''}`}
          onClick={e => { e.stopPropagation(); onTrackUpdate(track.id, { muted: !track.muted }) }}
          title="Sessiz"
        >M</button>
        <button
          className={`daw-track-btn ${track.solo ? 'active-solo' : ''}`}
          onClick={e => { e.stopPropagation(); onTrackUpdate(track.id, { solo: !track.solo }) }}
          title="Solo"
        >S</button>
        <button
          className={`daw-track-btn ${track.armed ? 'active-arm' : ''}`}
          onClick={e => { e.stopPropagation(); onTrackUpdate(track.id, { armed: !track.armed }) }}
          title="Kayıt"
        >R</button>
        <input
          type="range"
          className="daw-track-vol"
          min={0} max={1} step={0.01}
          value={track.volume}
          onChange={e => { e.stopPropagation(); onTrackUpdate(track.id, { volume: Number(e.target.value) }) }}
          onClick={e => e.stopPropagation()}
          title={`Ses: ${Math.round(track.volume * 100)}%`}
        />
        {/* VU meter */}
        <div className="daw-track-vu">
          <div className="daw-track-vu-fill" style={{ width: `${track.vuLevel * 100}%` }} />
        </div>
        <button
          className="daw-track-btn daw-track-btn-remove"
          onClick={e => { e.stopPropagation(); onTrackRemove(track.id) }}
          title="Sil"
        >×</button>
      </div>
    </div>
  )

  // ---- Playhead position ----
  const playheadPx = beatToPx(state.playheadBeat)

  // ---- Grid lines ----
  const renderGridLines = () => {
    const lines: React.JSX.Element[] = []
    const beatsPerBar = state.timeSignature[0]
    const totalBars = Math.ceil(state.totalBeats / beatsPerBar)
    for (let bar = 0; bar <= totalBars; bar++) {
      const x = beatToPx(bar * beatsPerBar)
      lines.push(
        <div key={`grid-${bar}`} className="daw-grid-line daw-grid-bar" style={{ left: x }} />
      )
      for (let sub = 1; sub < beatsPerBar; sub++) {
        const sx = beatToPx(bar * beatsPerBar + sub)
        lines.push(
          <div key={`grid-${bar}-${sub}`} className="daw-grid-line daw-grid-beat" style={{ left: sx }} />
        )
      }
    }
    return lines
  }

  // ---- Loop region highlight ----
  const renderLoopRegion = () => {
    if (!state.isLooping) return null
    const left = beatToPx(state.loopStart)
    const width = beatToPx(state.loopEnd - state.loopStart)
    return <div className="daw-loop-region" style={{ left, width }} />
  }

  return (
    <div className="daw-timeline" ref={containerRef}>
      {/* Context menu */}
      {contextMenu && (
        <div className="daw-context-menu" style={{ left: contextMenu.x, top: contextMenu.y, position: 'fixed', zIndex: 9999 }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {contextMenu.clipId && (
            <>
              <button onClick={() => { onClipDuplicate(contextMenu.trackId, contextMenu.clipId!); setContextMenu(null) }}>
                Kopyala & Yapıştır
              </button>
              <button onClick={() => { onClipSplit(contextMenu.trackId, contextMenu.clipId!, snapBeat(contextMenu.beat, state.snapValue)); setContextMenu(null) }}>
                Böl (Split)
              </button>
              <button onClick={() => { onClipRemove(contextMenu.trackId, contextMenu.clipId!); setContextMenu(null) }}>
                Sil
              </button>
              <hr />
            </>
          )}
          <button onClick={() => { onTrackAdd('audio'); setContextMenu(null) }}>Ses Kaydı Ekle</button>
          <button onClick={() => { onTrackAdd('midi'); setContextMenu(null) }}>MIDI Kanal Ekle</button>
          <button onClick={() => { onTrackRemove(contextMenu.trackId); setContextMenu(null) }}>Kanalı Sil</button>
        </div>
      )}

      {/* Top-left corner */}
      <div className="daw-timeline-corner">
        <button className="daw-btn daw-btn-add-track" onClick={() => onTrackAdd('audio')} title="Ses Kanalı Ekle">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
        </button>
        <button className="daw-btn daw-btn-add-track" onClick={() => onTrackAdd('midi')} title="MIDI Kanalı Ekle">
          <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="4" width="10" height="6" rx="1" stroke="currentColor" fill="none"/><rect x="3" y="7" width="2" height="3" fill="currentColor"/><rect x="6" y="7" width="2" height="3" fill="currentColor"/><rect x="9" y="7" width="2" height="3" fill="currentColor"/></svg>
        </button>
      </div>

      {/* Ruler — synced with body horizontal scroll */}
      <div className="daw-ruler" onClick={handleRulerClick}
        style={{ marginLeft: HEADER_WIDTH, overflow: 'hidden' }}
      >
        <svg width={totalWidth} height={RULER_HEIGHT}
          style={{ transform: `translateX(-${state.scrollX}px)` }}
        >
          {renderRuler()}
          {/* Playhead on ruler */}
          <line x1={playheadPx} y1={0} x2={playheadPx} y2={RULER_HEIGHT} stroke="#ff4444" strokeWidth={2} />
        </svg>
      </div>

      {/* Body: headers + lanes */}
      <div className="daw-timeline-body"
        onScroll={e => {
          const el = e.currentTarget
          onStateChange({ scrollX: el.scrollLeft, scrollY: el.scrollTop })
        }}
      >
        {/* Track headers column */}
        <div className="daw-track-headers" style={{ width: HEADER_WIDTH }}>
          {tracks.map((track, i) => renderTrackHeader(track, i))}
          {/* Add track button at bottom */}
          <div className="daw-track-header daw-add-track-row" style={{ height: 40 }}>
            <button className="daw-btn-text" onClick={() => onTrackAdd('audio')}>+ Ses Kanalı</button>
            <button className="daw-btn-text" onClick={() => onTrackAdd('midi')}>+ MIDI</button>
          </div>
        </div>

        {/* Track lanes */}
        <div className="daw-track-lanes" style={{ width: totalWidth }}>
          {renderGridLines()}
          {renderLoopRegion()}

          {tracks.map(track => (
            <div
              key={track.id}
              className={`daw-track-lane ${selectedTrackId === track.id ? 'selected' : ''} ${isDragOver === track.id ? 'drag-over' : ''} ${track.muted ? 'muted' : ''}`}
              style={{ height: track.height }}
              onClick={() => onSelectTrack(track.id)}
              onDoubleClick={() => { if (track.type === 'midi') onOpenPianoRoll(track.id) }}
              onContextMenu={e => handleContextMenu(e, track.id)}
              onDrop={e => handleDrop(e, track.id)}
              onDragOver={e => handleDragOver(e, track.id)}
              onDragLeave={() => setIsDragOver(null)}
            >
              {renderClips(track)}
              {renderMidiNotes(track)}
            </div>
          ))}

          {/* Playhead line */}
          <div className="daw-playhead" style={{ left: playheadPx }} />
        </div>
      </div>
    </div>
  )
})

DAWTimeline.displayName = 'DAWTimeline'
export default DAWTimeline
