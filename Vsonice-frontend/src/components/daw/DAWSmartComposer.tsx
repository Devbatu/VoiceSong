/* ============================================================
   DAWSmartComposer — Genre-based random music generator
   20 genres, 5 drum kits, user-controllable BPM/bars/swing/
   density, category-based selection, professional audio output
   ============================================================ */
import React, { useState, useCallback, useRef, useEffect, memo } from 'react'
import {
  getGenres, getGenre, getCategories, getGenresByCategory,
  generateSong, renderSongToBuffer,
  CATEGORY_NAMES, DRUM_KIT_NAMES,
} from './genrePatterns'
import type { GeneratedSong, DrumKitType, GenerationOptions } from './genrePatterns'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BARS_OPTIONS = [2, 4, 8, 16]

interface Props {
  bpm: number
  onSongExport: (buffer: AudioBuffer, name: string, bpm: number) => void
}

const DAWSmartComposer: React.FC<Props> = memo(({ bpm: dawBpm, onSongExport }) => {
  const genres = getGenres()
  const categories = getCategories()
  const [selectedGenre, setSelectedGenre] = useState(genres[0].id)
  const [rootNote, setRootNote] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [generatedSong, setGeneratedSong] = useState<GeneratedSong | null>(null)
  const [renderedBuffer, setRenderedBuffer] = useState<AudioBuffer | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ genre: string; buffer: AudioBuffer; name: string; bpm: number }>>([])

  // User controls
  const [customBpm, setCustomBpm] = useState<number | null>(null)
  const [customBars, setCustomBars] = useState<number | null>(null)
  const [swingOverride, setSwingOverride] = useState<number | null>(null)
  const [densityOverride, setDensityOverride] = useState<number | null>(null)
  const [selectedKit, setSelectedKit] = useState<DrumKitType | null>(null)

  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const analyserRef = useRef<AnalyserNode | null>(null)

  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
      analyserRef.current = ctxRef.current.createAnalyser()
      analyserRef.current.fftSize = 256
      analyserRef.current.connect(ctxRef.current.destination)
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])

  // When genre changes, reset kit to genre default
  useEffect(() => {
    const g = getGenre(selectedGenre)
    if (g) setSelectedKit(null)
  }, [selectedGenre])

  // ---- Generate ----
  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    setStatus('Şarkı oluşturuluyor...')
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch {}
      sourceRef.current = null
    }
    setIsPlaying(false)

    try {
      await new Promise(r => setTimeout(r, 50))

      const options: GenerationOptions = {}
      if (customBpm !== null) options.bpm = customBpm
      if (customBars !== null) options.bars = customBars
      if (swingOverride !== null) options.swing = swingOverride
      if (densityOverride !== null) options.melodyDensity = densityOverride
      if (selectedKit !== null) options.drumKit = selectedKit

      const song = generateSong(selectedGenre, rootNote, options)
      setGeneratedSong(song)

      const genre = getGenre(selectedGenre)!
      setStatus('Ses sentezleniyor (' + song.bpm + ' BPM, ' + DRUM_KIT_NAMES[song.drumKit] + ')...')
      await new Promise(r => setTimeout(r, 50))

      const buffer = await renderSongToBuffer(song, genre)
      setRenderedBuffer(buffer)

      setStatus('\u2713 ' + genre.name + ' \u2014 ' + song.bpm + ' BPM \u2014 ' + song.bars + ' bar \u2014 ' + DRUM_KIT_NAMES[song.drumKit])
    } catch (e) {
      console.error('Generation failed:', e)
      setStatus('Hata oluştu!')
    } finally {
      setIsGenerating(false)
    }
  }, [selectedGenre, rootNote, customBpm, customBars, swingOverride, densityOverride, selectedKit])

  // ---- Preview play/stop ----
  const handlePlay = useCallback(() => {
    if (!renderedBuffer) return
    if (isPlaying && sourceRef.current) {
      try { sourceRef.current.stop() } catch {}
      sourceRef.current = null
      setIsPlaying(false)
      return
    }
    const ctx = getCtx()
    const src = ctx.createBufferSource()
    src.buffer = renderedBuffer
    const gain = ctx.createGain(); gain.gain.value = 0.8
    src.connect(gain); gain.connect(analyserRef.current!)
    src.onended = () => setIsPlaying(false)
    src.start()
    sourceRef.current = src
    setIsPlaying(true)
  }, [renderedBuffer, isPlaying, getCtx])

  // ---- Export to DAW timeline ----
  const handleExport = useCallback(() => {
    if (!renderedBuffer || !generatedSong) return
    const genre = getGenre(selectedGenre)!
    const name = genre.emoji + ' ' + genre.name + ' \u2014 ' + NOTE_NAMES[rootNote] + ' \u2014 ' + generatedSong.bpm + 'bpm'
    onSongExport(renderedBuffer, name, generatedSong.bpm)
    setHistory(prev => [
      { genre: genre.name, buffer: renderedBuffer, name, bpm: generatedSong.bpm },
      ...prev.slice(0, 9),
    ])
    setStatus('\u2713 Timeline\'a eklendi!')
    setTimeout(() => {
      setStatus('\u2713 ' + genre.name + ' \u2014 ' + generatedSong.bpm + ' BPM \u2014 ' + generatedSong.bars + ' bar')
    }, 2000)
  }, [renderedBuffer, generatedSong, selectedGenre, rootNote, onSongExport])

  const handleReroll = useCallback(() => { handleGenerate() }, [handleGenerate])

  // Sync DAW BPM suggestion
  const handleUseDawBpm = useCallback(() => { setCustomBpm(dawBpm) }, [dawBpm])

  // ---- Visualizer canvas ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx2d.scale(dpr, dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const genre = getGenre(selectedGenre)
    const accentColor = genre ? genreColor(genre.id) : '#6366f1'
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const w = rect.width; const h = rect.height
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx2d.clearRect(0, 0, w, h)
      const bg = ctx2d.createLinearGradient(0, 0, w, 0)
      bg.addColorStop(0, '#0a0a18'); bg.addColorStop(0.5, '#0d0d20'); bg.addColorStop(1, '#0a0a18')
      ctx2d.fillStyle = bg; ctx2d.fillRect(0, 0, w, h)
      if (isPlaying && analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        const barCount = 48; const barW = w / barCount
        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor(i * data.length / barCount)
          const val = data[idx] / 255
          const bh = Math.max(1, val * h * 0.9)
          const grad = ctx2d.createLinearGradient(0, h - bh, 0, h)
          grad.addColorStop(0, accentColor); grad.addColorStop(1, accentColor + '40')
          ctx2d.fillStyle = grad
          ctx2d.beginPath(); ctx2d.roundRect(i * barW + 1, h - bh, barW - 2, bh, 2); ctx2d.fill()
        }
      } else if (renderedBuffer) {
        const chan = renderedBuffer.getChannelData(0)
        const step = Math.floor(chan.length / w)
        ctx2d.strokeStyle = accentColor; ctx2d.lineWidth = 1.5; ctx2d.beginPath()
        for (let x = 0; x < w; x++) {
          const idx = x * step; let max = 0
          for (let j = idx; j < Math.min(idx + step, chan.length); j++) { const a = Math.abs(chan[j]); if (a > max) max = a }
          const y = h / 2 - max * h * 0.45; if (x === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y)
        }
        for (let x = w - 1; x >= 0; x--) {
          const idx = x * step; let max = 0
          for (let j = idx; j < Math.min(idx + step, chan.length); j++) { const a = Math.abs(chan[j]); if (a > max) max = a }
          ctx2d.lineTo(x, h / 2 + max * h * 0.45)
        }
        ctx2d.closePath(); ctx2d.fillStyle = accentColor + '25'; ctx2d.fill(); ctx2d.stroke()
      } else {
        const barCount = 32; const barW = w / barCount
        for (let i = 0; i < barCount; i++) {
          const bh = 3 + Math.sin(i * 0.4 + Date.now() * 0.001) * 2
          ctx2d.fillStyle = accentColor + '30'; ctx2d.fillRect(i * barW + 1, h - bh, barW - 2, bh)
        }
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect() }
  }, [isPlaying, renderedBuffer, selectedGenre])

  // Cleanup
  useEffect(() => {
    return () => {
      if (sourceRef.current) try { sourceRef.current.stop() } catch {}
      ctxRef.current?.close()
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const currentGenre = getGenre(selectedGenre)
  const effectiveBpm = customBpm ?? (currentGenre ? Math.round((currentGenre.bpmRange[0] + currentGenre.bpmRange[1]) / 2) : 120)
  const effectiveBars = customBars ?? currentGenre?.bars ?? 4
  const effectiveKit = selectedKit ?? currentGenre?.defaultKit ?? '808'

  return (
    <div className="daw-composer">
      {/* Left: Genre selector with categories */}
      <div className="daw-composer-genres">
        <div className="daw-composer-genres-title">Tarz Se&#231;</div>
        <div className="daw-composer-genre-list">
          {categories.map(cat => (
            <React.Fragment key={cat}>
              <div className="daw-composer-category-header">{CATEGORY_NAMES[cat]}</div>
              {getGenresByCategory(cat).map(g => (
                <button
                  key={g.id}
                  className={'daw-composer-genre-btn' + (selectedGenre === g.id ? ' active' : '')}
                  onClick={() => setSelectedGenre(g.id)}
                  style={{
                    borderColor: selectedGenre === g.id ? genreColor(g.id) : undefined,
                    background: selectedGenre === g.id ? genreColor(g.id) + '18' : undefined,
                  }}
                >
                  <span className="daw-composer-genre-emoji">{g.emoji}</span>
                  <span className="daw-composer-genre-name">{g.name}</span>
                  <span className="daw-composer-genre-bpm">{g.bpmRange[0]}-{g.bpmRange[1]}</span>
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Right: Controls + preview */}
      <div className="daw-composer-main">
        {/* Top controls */}
        <div className="daw-composer-controls">
          {/* Row 1: Core parameters */}
          <div className="daw-composer-params-row">
            <div className="daw-composer-control-group">
              <label className="daw-label">K&#246;k Nota</label>
              <select className="daw-select" value={rootNote} onChange={e => setRootNote(Number(e.target.value))}>
                {NOTE_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </div>

            <div className="daw-composer-control-group">
              <label className="daw-label">BPM {customBpm !== null && <span className="daw-label-badge">&#246;zel</span>}</label>
              <div className="daw-composer-bpm-ctrl">
                <input type="number" className="daw-input-sm" min={40} max={220}
                  value={effectiveBpm} onChange={e => setCustomBpm(Number(e.target.value) || null)} />
                <input type="range" className="daw-range" min={40} max={220}
                  value={effectiveBpm} onChange={e => setCustomBpm(Number(e.target.value))} />
                {dawBpm > 0 && (
                  <button className="daw-btn-xs" onClick={handleUseDawBpm} title={'DAW BPM: ' + dawBpm}>
                    DAW
                  </button>
                )}
                {customBpm !== null && (
                  <button className="daw-btn-xs" onClick={() => setCustomBpm(null)} title="Varsay&#305;lana d&#246;n">&#10005;</button>
                )}
              </div>
            </div>

            <div className="daw-composer-control-group">
              <label className="daw-label">Bar Say&#305;s&#305;</label>
              <div className="daw-composer-bars-ctrl">
                {BARS_OPTIONS.map(b => (
                  <button key={b}
                    className={'daw-btn-bar' + (effectiveBars === b ? ' active' : '')}
                    onClick={() => setCustomBars(b === (currentGenre?.bars ?? 4) ? null : b)}
                  >{b}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Advanced controls */}
          <div className="daw-composer-params-row">
            <div className="daw-composer-control-group">
              <label className="daw-label">Davul Kiti</label>
              <select className="daw-select" value={effectiveKit}
                onChange={e => setSelectedKit(e.target.value as DrumKitType)}>
                {(Object.entries(DRUM_KIT_NAMES) as [DrumKitType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="daw-composer-control-group">
              <label className="daw-label">Melodi Yo&#287;unlu&#287;u</label>
              <div className="daw-composer-slider-ctrl">
                <input type="range" className="daw-range" min={0.1} max={1} step={0.05}
                  value={densityOverride ?? currentGenre?.melodyDensity ?? 0.5}
                  onChange={e => setDensityOverride(Number(e.target.value))} />
                <span className="daw-range-val">{Math.round((densityOverride ?? currentGenre?.melodyDensity ?? 0.5) * 100)}%</span>
                {densityOverride !== null && (
                  <button className="daw-btn-xs" onClick={() => setDensityOverride(null)}>&#10005;</button>
                )}
              </div>
            </div>

            <div className="daw-composer-control-group">
              <label className="daw-label">Swing</label>
              <div className="daw-composer-slider-ctrl">
                <input type="range" className="daw-range" min={0} max={1} step={0.05}
                  value={swingOverride ?? currentGenre?.swingAmount ?? 0}
                  onChange={e => setSwingOverride(Number(e.target.value))} />
                <span className="daw-range-val">{Math.round((swingOverride ?? currentGenre?.swingAmount ?? 0) * 100)}%</span>
                {swingOverride !== null && (
                  <button className="daw-btn-xs" onClick={() => setSwingOverride(null)}>&#10005;</button>
                )}
              </div>
            </div>
          </div>

          {/* Genre info tags */}
          {currentGenre && (
            <div className="daw-composer-genre-info">
              {currentGenre.tags.map((t, i) => (
                <span key={i} className="daw-composer-info-tag">{t}</span>
              ))}
              <span className="daw-composer-info-tag">Bass: {currentGenre.bassStyle}</span>
              <span className="daw-composer-info-tag">{currentGenre.useArpeggio ? '\u2713 Arpej' : '\u2717 Arpej'}</span>
              <span className="daw-composer-info-tag">{currentGenre.usePadLayer ? '\u2713 Pad' : '\u2717 Pad'}</span>
              <span className="daw-composer-info-tag">{currentGenre.useSubBass ? '\u2713 SubBass' : '\u2717 SubBass'}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="daw-composer-actions">
            <button className="daw-btn daw-btn-primary daw-composer-generate-btn"
              onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? (<><span className="daw-spinner" /> Olu&#351;turuluyor...</>) : (<>&#127922; Rastgele Olu&#351;tur</>)}
            </button>
            {renderedBuffer && (
              <>
                <button className="daw-btn daw-composer-action-btn" onClick={handleReroll} title="Yeniden olu&#351;tur">&#128260; Yenile</button>
                <button className={'daw-btn daw-composer-action-btn' + (isPlaying ? ' active' : '')} onClick={handlePlay}>
                  {isPlaying ? '\u23F9 Durdur' : '\u25B6 \u00D6nizle'}
                </button>
                <button className="daw-btn daw-btn-export daw-composer-action-btn" onClick={handleExport}>
                  &#128229; Timeline'a Ekle
                </button>
              </>
            )}
          </div>
        </div>

        {/* Visualizer */}
        <div className="daw-composer-visualizer">
          <canvas ref={canvasRef} className="daw-composer-canvas" />
          {status && <div className="daw-composer-status">{status}</div>}
          {!renderedBuffer && !isGenerating && (
            <div className="daw-composer-empty">
              <span className="daw-composer-empty-icon">{currentGenre?.emoji || '\uD83C\uDFB5'}</span>
              <span>Bir tarz se&#231; ve "Rastgele Olu&#351;tur" butonuna t&#305;kla</span>
            </div>
          )}
        </div>

        {/* Song details */}
        {generatedSong && (
          <div className="daw-composer-details">
            <div className="daw-composer-detail-card">
              <div className="daw-composer-detail-icon">&#129345;</div>
              <div className="daw-composer-detail-label">Davul</div>
              <div className="daw-composer-detail-value">{generatedSong.drums.steps.size} enstr&#252;man</div>
            </div>
            <div className="daw-composer-detail-card">
              <div className="daw-composer-detail-icon">&#127928;</div>
              <div className="daw-composer-detail-label">Bas</div>
              <div className="daw-composer-detail-value">{generatedSong.bass.notes.length} nota</div>
            </div>
            <div className="daw-composer-detail-card">
              <div className="daw-composer-detail-icon">&#127929;</div>
              <div className="daw-composer-detail-label">Akor</div>
              <div className="daw-composer-detail-value">{generatedSong.chords.notes.length} nota</div>
            </div>
            <div className="daw-composer-detail-card">
              <div className="daw-composer-detail-icon">&#127925;</div>
              <div className="daw-composer-detail-label">Melodi</div>
              <div className="daw-composer-detail-value">{generatedSong.melody.notes.length} nota</div>
            </div>
            {generatedSong.arpeggio && (
              <div className="daw-composer-detail-card">
                <div className="daw-composer-detail-icon">&#10024;</div>
                <div className="daw-composer-detail-label">Arpej</div>
                <div className="daw-composer-detail-value">{generatedSong.arpeggio.notes.length} nota</div>
              </div>
            )}
            {generatedSong.pad && (
              <div className="daw-composer-detail-card">
                <div className="daw-composer-detail-icon">&#9729;</div>
                <div className="daw-composer-detail-label">Pad</div>
                <div className="daw-composer-detail-value">{generatedSong.pad.notes.length} nota</div>
              </div>
            )}
            <div className="daw-composer-detail-card">
              <div className="daw-composer-detail-icon">&#9201;</div>
              <div className="daw-composer-detail-label">Tempo</div>
              <div className="daw-composer-detail-value">{generatedSong.bpm} BPM</div>
            </div>
            <div className="daw-composer-detail-card">
              <div className="daw-composer-detail-icon">&#129345;</div>
              <div className="daw-composer-detail-label">Kit</div>
              <div className="daw-composer-detail-value">{DRUM_KIT_NAMES[generatedSong.drumKit]}</div>
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="daw-composer-history">
            <div className="daw-composer-history-title">Ge&#231;mi&#351; &#220;retimler</div>
            <div className="daw-composer-history-list">
              {history.map((h, i) => (
                <button key={i} className="daw-composer-history-item"
                  onClick={() => onSongExport(h.buffer, h.name, h.bpm)} title="Timeline'a ekle">
                  <span>{h.name}</span>
                  <span className="daw-composer-history-add">+</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

// ---- Genre accent colors ----
function genreColor(id: string): string {
  const map: Record<string, string> = {
    trap: '#ef4444', lofi: '#a78bfa', house: '#10b981', techno: '#06b6d4',
    drill: '#f97316', rnb: '#c084fc', edm: '#f43f5e', reggaeton: '#22d3ee',
    ambient: '#818cf8', pop: '#f472b6', jazz: '#fbbf24', dnb: '#34d399',
    boombap: '#d97706', dubstep: '#7c3aed', trance: '#2dd4bf', rock: '#dc2626',
    indie: '#fb923c', afrobeat: '#84cc16', latin: '#f59e0b', synthwave: '#e879f9',
  }
  return map[id] || '#6366f1'
}

DAWSmartComposer.displayName = 'DAWSmartComposer'
export default DAWSmartComposer
