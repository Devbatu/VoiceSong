/* ============================================================
   DAWMixer — Channel strip mixer with faders, pan, VU meters,
   mute/solo, effects sends, master bus
   ============================================================ */
import React, { memo, useRef, useEffect } from 'react'
import type { DAWTrack, DAWState } from './useDAWEngine'

interface Props {
  tracks: DAWTrack[]
  state: DAWState
  masterAnalyser: React.RefObject<AnalyserNode | null>
  onTrackUpdate: (trackId: string, changes: Partial<DAWTrack>) => void
  onStateChange: (changes: Partial<DAWState>) => void
  onSelectTrack: (trackId: string) => void
  selectedTrackId: string | null
}

const VUMeter: React.FC<{ level: number; color: string }> = memo(({ level, color }) => {
  const pct = Math.min(100, level * 100)
  const getGradient = () => {
    if (pct > 90) return '#ef4444'
    if (pct > 70) return '#f59e0b'
    return color
  }
  return (
    <div className="daw-mixer-vu">
      <div className="daw-mixer-vu-fill" style={{ height: `${pct}%`, background: getGradient() }} />
      <div className="daw-mixer-vu-peak" style={{ bottom: `${Math.min(100, pct)}%` }} />
    </div>
  )
})
VUMeter.displayName = 'VUMeter'

const MasterVU: React.FC<{ analyserRef: React.RefObject<AnalyserNode | null> }> = ({ analyserRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')!
    const barCount = 24

    // Resize canvas backing store to match CSS layout size
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.scale(dpr, dpr)
    }
    resizeCanvas()
    const ro = new ResizeObserver(resizeCanvas)
    ro.observe(canvas)

    const draw = () => {
      const analyser = analyserRef.current
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const barWidth = w / barCount

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#0f0f24')
      bg.addColorStop(1, '#0a0a18')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // Horizontal guide lines
      for (let y = 0; y < h; y += 15) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)'
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)

        let hasSignal = false
        for (let i = 0; i < data.length; i++) {
          if (data[i] > 2) { hasSignal = true; break }
        }

        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor(i * data.length / barCount)
          const val = data[idx] / 255

          if (hasSignal && val > 0.01) {
            const bh = Math.max(2, val * h)
            const hue = 120 - val * 120
            const grad = ctx.createLinearGradient(0, h - bh, 0, h)
            grad.addColorStop(0, `hsl(${hue}, 85%, 55%)`)
            grad.addColorStop(1, `hsl(${hue}, 70%, 30%)`)
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.roundRect(i * barWidth + 1, h - bh, barWidth - 2, bh, 1)
            ctx.fill()
            // Glow cap
            if (val > 0.1) {
              ctx.fillStyle = `hsla(${hue}, 90%, 70%, 0.4)`
              ctx.fillRect(i * barWidth, h - bh - 1, barWidth, 2)
            }
          } else {
            const baseH = 3 + Math.sin(i * 0.6 + Date.now() * 0.001) * 2
            ctx.fillStyle = 'rgba(99, 102, 241, 0.2)'
            ctx.fillRect(i * barWidth + 1, h - baseH, barWidth - 2, baseH)
          }
        }
      } else {
        // No analyser yet — animated idle bars
        for (let i = 0; i < barCount; i++) {
          const baseH = 3 + Math.sin(i * 0.6 + Date.now() * 0.001) * 2
          ctx.fillStyle = 'rgba(99, 102, 241, 0.2)'
          ctx.fillRect(i * barWidth + 1, h - baseH, barWidth - 2, baseH)
        }
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect() }
  }, [analyserRef])

  return <canvas ref={canvasRef} className="daw-mixer-master-vu" />
}
MasterVU.displayName = 'MasterVU'

const DAWMixer: React.FC<Props> = memo(({
  tracks, state, masterAnalyser,
  onTrackUpdate, onStateChange, onSelectTrack, selectedTrackId,
}) => {
  return (
    <div className="daw-mixer">
      <div className="daw-mixer-channels">
        {tracks.map(track => (
          <div
            key={track.id}
            className={`daw-mixer-channel ${selectedTrackId === track.id ? 'selected' : ''}`}
            onClick={() => onSelectTrack(track.id)}
          >
            {/* Track name */}
            <div className="daw-mixer-ch-name" style={{ color: track.color }}>
              {track.name}
            </div>

            {/* Type badge */}
            <div className="daw-mixer-ch-type">{track.type === 'midi' ? 'MIDI' : 'AUD'}</div>

            {/* Pan knob */}
            <div className="daw-mixer-pan">
              <label className="daw-mixer-pan-label">PAN</label>
              <input
                type="range"
                className="daw-mixer-pan-knob"
                min={-1} max={1} step={0.01}
                value={track.pan}
                onChange={e => onTrackUpdate(track.id, { pan: Number(e.target.value) })}
                onClick={e => e.stopPropagation()}
              />
              <span className="daw-mixer-pan-value">
                {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}
              </span>
            </div>

            {/* VU + Fader section */}
            <div className="daw-mixer-fader-section">
              <VUMeter level={track.vuLevel} color={track.color} />
              <input
                type="range"
                className="daw-mixer-fader"
                min={0} max={1.5} step={0.01}
                value={track.volume}
                onChange={e => onTrackUpdate(track.id, { volume: Number(e.target.value) })}
                onClick={e => e.stopPropagation()}
                // @ts-ignore orient for vertical slider
                orient="vertical"
              />
              <span className="daw-mixer-db">
                {track.volume === 0 ? '-∞' : `${(20 * Math.log10(track.volume)).toFixed(1)} dB`}
              </span>
            </div>

            {/* Mute / Solo / Arm */}
            <div className="daw-mixer-buttons">
              <button
                className={`daw-mixer-btn ${track.muted ? 'muted' : ''}`}
                onClick={e => { e.stopPropagation(); onTrackUpdate(track.id, { muted: !track.muted }) }}
              >M</button>
              <button
                className={`daw-mixer-btn ${track.solo ? 'solo' : ''}`}
                onClick={e => { e.stopPropagation(); onTrackUpdate(track.id, { solo: !track.solo }) }}
              >S</button>
              <button
                className={`daw-mixer-btn ${track.armed ? 'armed' : ''}`}
                onClick={e => { e.stopPropagation(); onTrackUpdate(track.id, { armed: !track.armed }) }}
              >R</button>
            </div>

            {/* Color indicator */}
            <div className="daw-mixer-ch-color" style={{ background: track.color }} />
          </div>
        ))}

        {/* Master channel */}
        <div className="daw-mixer-channel daw-mixer-master">
          <div className="daw-mixer-ch-name master">MASTER</div>
          <div className="daw-mixer-ch-type">BUS</div>

          <MasterVU analyserRef={masterAnalyser} />

          <div className="daw-mixer-fader-section">
            <input
              type="range"
              className="daw-mixer-fader master"
              min={0} max={1.5} step={0.01}
              value={state.masterVolume}
              onChange={e => onStateChange({ masterVolume: Number(e.target.value) })}
              // @ts-ignore orient for vertical slider
              orient="vertical"
            />
            <span className="daw-mixer-db">
              {state.masterVolume === 0 ? '-∞' : `${(20 * Math.log10(state.masterVolume)).toFixed(1)} dB`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
})

DAWMixer.displayName = 'DAWMixer'
export default DAWMixer
