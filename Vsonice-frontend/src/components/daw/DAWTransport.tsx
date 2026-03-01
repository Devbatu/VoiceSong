/* ============================================================
   DAWTransport — Top bar with play/stop/record, BPM, snap, zoom
   ============================================================ */
import React, { memo } from 'react'
import type { DAWState } from './useDAWEngine'

interface Props {
  state: DAWState
  onChange: (changes: Partial<DAWState>) => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onExport: () => void
}

const SNAP_OPTIONS = [
  { label: '1/1', value: 4 },
  { label: '1/2', value: 2 },
  { label: '1/4', value: 1 },
  { label: '1/8', value: 0.5 },
  { label: '1/16', value: 0.25 },
  { label: '1/32', value: 0.125 },
  { label: 'Off', value: 0 },
]

function formatTime(beat: number, bpm: number): string {
  const totalSec = (beat / bpm) * 60
  const min = Math.floor(totalSec / 60)
  const sec = Math.floor(totalSec % 60)
  const ms = Math.floor((totalSec % 1) * 100)
  return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

function formatBeat(beat: number, timeSig: [number, number]): string {
  const bar = Math.floor(beat / timeSig[0]) + 1
  const b = Math.floor(beat % timeSig[0]) + 1
  return `${bar}.${b}`
}

const DAWTransport: React.FC<Props> = memo(({ state, onChange, onPlay, onPause, onStop, onExport }) => {
  return (
    <div className="daw-transport">
      {/* Left: Transport buttons */}
      <div className="daw-transport-buttons">
        <button
          className={`daw-btn daw-btn-stop ${!state.isPlaying ? 'active' : ''}`}
          onClick={onStop}
          title="Durdur"
        >
          <svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" fill="currentColor"/></svg>
        </button>
        <button
          className={`daw-btn daw-btn-play ${state.isPlaying ? 'active' : ''}`}
          onClick={state.isPlaying ? onPause : onPlay}
          title={state.isPlaying ? 'Duraklat' : 'Oynat'}
        >
          {state.isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 16 16">
              <rect x="3" y="2" width="3.5" height="12" fill="currentColor"/>
              <rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16"><polygon points="3,2 14,8 3,14" fill="currentColor"/></svg>
          )}
        </button>
        <button
          className={`daw-btn daw-btn-record ${state.isRecording ? 'active' : ''}`}
          onClick={() => onChange({ isRecording: !state.isRecording })}
          title="Kayıt"
        >
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>
        </button>
        <button
          className={`daw-btn daw-btn-loop ${state.isLooping ? 'active' : ''}`}
          onClick={() => onChange({ isLooping: !state.isLooping })}
          title="Döngü"
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M12 4H5L7 2M4 12H11L9 14M12 4V10M4 6V12" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
        </button>
      </div>

      {/* Center: Time display */}
      <div className="daw-transport-time">
        <div className="daw-time-display">
          <span className="daw-time-label">Zaman</span>
          <span className="daw-time-value">{formatTime(state.playheadBeat, state.bpm)}</span>
        </div>
        <div className="daw-time-display">
          <span className="daw-time-label">Ölçü</span>
          <span className="daw-time-value">{formatBeat(state.playheadBeat, state.timeSignature)}</span>
        </div>
      </div>

      {/* BPM */}
      <div className="daw-transport-bpm">
        <label className="daw-label">BPM</label>
        <input
          type="number"
          className="daw-input daw-input-bpm"
          value={state.bpm}
          min={20}
          max={300}
          onChange={e => onChange({ bpm: Math.max(20, Math.min(300, Number(e.target.value) || 120)) })}
        />
      </div>

      {/* Snap */}
      <div className="daw-transport-snap">
        <label className="daw-label">Snap</label>
        <select
          className="daw-select"
          value={state.snapValue}
          onChange={e => onChange({ snapValue: Number(e.target.value) })}
        >
          {SNAP_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Zoom */}
      <div className="daw-transport-zoom">
        <label className="daw-label">Zoom</label>
        <input
          type="range"
          className="daw-range"
          min={10}
          max={120}
          value={state.zoom}
          onChange={e => onChange({ zoom: Number(e.target.value) })}
        />
      </div>

      {/* Master Volume */}
      <div className="daw-transport-master">
        <label className="daw-label">Master</label>
        <input
          type="range"
          className="daw-range"
          min={0}
          max={1}
          step={0.01}
          value={state.masterVolume}
          onChange={e => onChange({ masterVolume: Number(e.target.value) })}
        />
        <span className="daw-vol-value">{Math.round(state.masterVolume * 100)}%</span>
      </div>

      {/* Export */}
      <button className="daw-btn daw-btn-export" onClick={onExport} title="Dışa Aktar">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M8 2v8M4 7l4 4 4-4M2 12v2h12v-2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        </svg>
        <span>Dışa Aktar</span>
      </button>

      {/* Signature */}
      <div className="daw-transport-sig">
        <label className="daw-label">Ölçü</label>
        <select
          className="daw-select"
          value={`${state.timeSignature[0]}/${state.timeSignature[1]}`}
          onChange={e => {
            const [n, d] = e.target.value.split('/').map(Number)
            onChange({ timeSignature: [n, d] as [number, number] })
          }}
        >
          <option value="4/4">4/4</option>
          <option value="3/4">3/4</option>
          <option value="6/8">6/8</option>
          <option value="2/4">2/4</option>
          <option value="5/4">5/4</option>
          <option value="7/8">7/8</option>
        </select>
      </div>
    </div>
  )
})

DAWTransport.displayName = 'DAWTransport'
export default DAWTransport
