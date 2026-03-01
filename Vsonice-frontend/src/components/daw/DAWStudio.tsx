/* ============================================================
   DAWStudio — Main FL Studio-like layout component
   Assembles: Transport, Timeline, Piano Roll, Mixer, Beat Seq
   ============================================================ */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDAWEngine, extractPeaks, uid } from './useDAWEngine'
import DAWTransport from './DAWTransport'
import DAWTimeline from './DAWTimeline'
import DAWPianoRoll from './DAWPianoRoll'
import DAWMixer from './DAWMixer'
import DAWBeatSequencer from './DAWBeatSequencer'
import DAWSmartComposer from './DAWSmartComposer'
import DAWClipEditor from './DAWClipEditor'
import '../../styles/daw.css'

type BottomPanel = 'mixer' | 'pianoroll' | 'beats' | 'composer' | 'library' | 'clipeditor' | null

interface SavedLibraryItem {
  id: string
  name: string
  type: string
  url: string
  savedAt: number
}

const LIBRARY_KEY = 'daw_saved_library'

function loadLibrary(): SavedLibraryItem[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveLibrary(items: SavedLibraryItem[]) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(items))
}

const DAWStudio: React.FC = () => {
  const engine = useDAWEngine()
  const { tracks, state, setState, setTracks } = engine

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [pianoRollTrackId, setPianoRollTrackId] = useState<string | null>(null)
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>('mixer')
  const [bottomPanelHeight, setBottomPanelHeight] = useState(280)
  const [isResizingPanel, setIsResizingPanel] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [libraryItems, setLibraryItems] = useState<SavedLibraryItem[]>(() => loadLibrary())
  const [editingClipTrackId, setEditingClipTrackId] = useState<string | null>(null)
  const [editingClipId, setEditingClipId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- Auto-import tracks from VoiceCloneSongMaker ----
  useEffect(() => {
    const raw = localStorage.getItem('daw_import_tracks')
    if (!raw) return
    localStorage.removeItem('daw_import_tracks')
    try {
      const items: { url: string; name: string; type: string }[] = JSON.parse(raw)
      if (!Array.isArray(items) || items.length === 0) return

      // Save to persistent library
      const newLibItems: SavedLibraryItem[] = items.map(item => ({
        id: `lib_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: item.name,
        type: item.type,
        url: item.url,
        savedAt: Date.now(),
      }))
      setLibraryItems(prev => {
        const updated = [...newLibItems, ...prev].slice(0, 50)
        saveLibrary(updated)
        return updated
      })

      // Delay slightly to ensure AudioContext is warm  
      const doImport = () => {
        setImportStatus(`${items.length} parça yükleniyor...`)
        let loaded = 0
        let failed = 0
        items.forEach(item => {
          const trackId = engine.addTrack('audio', item.name)
          engine.loadAudioUrl(item.url, trackId, item.name).then(() => {
            loaded++
            if (loaded + failed >= items.length) {
              setImportStatus(failed > 0 ? `${loaded} eklendi, ${failed} başarısız` : 'Parçalar Studio\'ya eklendi!')
              setTimeout(() => setImportStatus(null), 5000)
            }
          }).catch((err) => {
            console.error('Import failed for', item.name, err)
            failed++
            if (loaded + failed >= items.length) {
              setImportStatus(failed === items.length 
                ? 'Yükleme başarısız! Backend çalışıyor mu kontrol edin.' 
                : `${loaded} eklendi, ${failed} başarısız`)
              setTimeout(() => setImportStatus(null), 8000)
            }
          })
        })
      }
      // Small delay to ensure component is mounted and AudioContext is ready
      setTimeout(doImport, 300)
    } catch { /* invalid JSON, ignore */ }
  }, [])

  // ---- State change helper ----
  const handleStateChange = useCallback((changes: Partial<typeof state>) => {
    setState(s => ({ ...s, ...changes }))
  }, [setState])

  // ---- Track operations ----
  const handleAddTrack = useCallback((type: 'audio' | 'midi') => {
    const id = engine.addTrack(type)
    setSelectedTrackId(id)
  }, [engine])

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId(trackId)
  }, [])

  const handleSelectClip = useCallback((trackId: string, clipId: string) => {
    setSelectedTrackId(trackId)
    // Deselect all then select target
    setTracks(prev => prev.map(t => ({
      ...t,
      clips: t.clips.map(c => ({ ...c, selected: c.id === clipId && t.id === trackId }))
    })))
  }, [setTracks])

  // ---- File loading ----
  const handleLoadFile = useCallback((file: File, trackId: string) => {
    engine.loadAudioFile(file, trackId)
  }, [engine])

  // ---- Open piano roll ----
  const handleOpenPianoRoll = useCallback((trackId: string) => {
    setPianoRollTrackId(trackId)
    setBottomPanel('pianoroll')
  }, [])

  // ---- Open clip editor ----
  const handleOpenClipEditor = useCallback((trackId: string, clipId: string) => {
    setEditingClipTrackId(trackId)
    setEditingClipId(clipId)
    setSelectedTrackId(trackId)
    setBottomPanel('clipeditor')
  }, [])

  // ---- Export ----
  const handleExport = useCallback(async () => {
    setExportStatus('Dışa aktarılıyor...')
    const blob = await engine.exportMix()
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mix_${new Date().toISOString().slice(0, 10)}.wav`
      a.click()
      URL.revokeObjectURL(url)
      setExportStatus('Dışa aktarıldı!')
      setTimeout(() => setExportStatus(null), 3000)
    } else {
      setExportStatus('Hata oluştu!')
      setTimeout(() => setExportStatus(null), 3000)
    }
  }, [engine])

  // ---- Smart composer export → add as clip ----
  const handleComposerExport = useCallback((buffer: AudioBuffer, name: string, songBpm: number) => {
    let trackId = selectedTrackId
    if (!trackId || tracks.find(t => t.id === trackId)?.type !== 'audio') {
      trackId = engine.addTrack('audio', name)
    }
    const durationBeats = (buffer.duration / 60) * state.bpm
    const peaks = extractPeaks(buffer, Math.max(200, Math.floor(durationBeats * state.zoom)))
    const clip = {
      id: uid(),
      trackId: trackId!,
      name,
      startBeat: state.playheadBeat,
      durationBeats,
      offsetBeats: 0,
      buffer,
      waveformPeaks: peaks,
      color: tracks.find(t => t.id === trackId)?.color || '#6366f1',
      selected: false,
      fadeIn: 0,
      fadeOut: 0,
      gain: 1,
    }
    setTracks(prev => prev.map(t =>
      t.id !== trackId ? t : { ...t, clips: [...t.clips, clip] }
    ))
    // Auto-expand total beats if needed
    const endBeat = state.playheadBeat + durationBeats
    if (endBeat > state.totalBeats) {
      setState(s => ({ ...s, totalBeats: Math.ceil(endBeat / 4) * 4 + 16 }))
    }
  }, [selectedTrackId, tracks, state, engine, setTracks, setState])

  // ---- Beat pattern export → add as clip ----
  const handleBeatExport = useCallback((buffer: AudioBuffer) => {
    // Add to a new track or selected track
    let trackId = selectedTrackId
    if (!trackId || tracks.find(t => t.id === trackId)?.type !== 'audio') {
      trackId = engine.addTrack('audio', 'Beat Pattern')
    }
    // Create clip from buffer
    const bpm = state.bpm
    const durationBeats = (buffer.duration / 60) * bpm
    const peaks = extractPeaks(buffer, Math.max(200, Math.floor(durationBeats * state.zoom)))
    const clip = {
      id: uid(),
      trackId: trackId!,
      name: 'Beat Pattern',
      startBeat: state.playheadBeat,
      durationBeats,
      offsetBeats: 0,
      buffer,
      waveformPeaks: peaks,
      color: tracks.find(t => t.id === trackId)?.color || '#6366f1',
      selected: false,
      fadeIn: 0,
      fadeOut: 0,
      gain: 1,
    }
    setTracks(prev => prev.map(t =>
      t.id !== trackId ? t : { ...t, clips: [...t.clips, clip] }
    ))
  }, [selectedTrackId, tracks, state, engine, setTracks])

  // ---- Library: load item into timeline ----
  const handleLibraryLoad = useCallback((item: SavedLibraryItem) => {
    const trackId = engine.addTrack('audio', item.name)
    setImportStatus(`"${item.name}" yükleniyor...`)
    engine.loadAudioUrl(item.url, trackId, item.name).then((clip) => {
      if (clip) {
        setImportStatus(`"${item.name}" eklendi!`)
      } else {
        setImportStatus(`"${item.name}" yüklenemedi — backend çalışıyor mu?`)
      }
      setTimeout(() => setImportStatus(null), 4000)
    }).catch((err) => {
      console.error('Library load failed:', err)
      setImportStatus('Yükleme başarısız! Backend çalışıyor mu kontrol edin.')
      setTimeout(() => setImportStatus(null), 5000)
    })
  }, [engine])

  // ---- Library: remove item ----
  const handleLibraryRemove = useCallback((id: string) => {
    setLibraryItems(prev => {
      const updated = prev.filter(i => i.id !== id)
      saveLibrary(updated)
      return updated
    })
  }, [])

  // ---- Panel resizing ----
  useEffect(() => {
    if (!isResizingPanel) return
    const handleMove = (e: MouseEvent) => {
      const windowH = window.innerHeight
      const newH = windowH - e.clientY
      setBottomPanelHeight(Math.max(120, Math.min(windowH * 0.7, newH)))
    }
    const handleUp = () => setIsResizingPanel(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [isResizingPanel])

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        state.isPlaying ? engine.pause() : engine.play()
      }
      if (e.code === 'Home') {
        e.preventDefault()
        engine.stop()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [state.isPlaying, engine])

  // ---- Drop on empty area → create track + add clip ----
  const handleRootDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i)
    )
    files.forEach(f => {
      const trackId = engine.addTrack('audio', f.name.replace(/\.[^.]+$/, ''))
      engine.loadAudioFile(f, trackId)
    })
  }, [engine])

  const pianoRollTrack = pianoRollTrackId ? tracks.find(t => t.id === pianoRollTrackId) || null : null

  return (
    <div
      className="daw-studio"
      onDrop={handleRootDrop}
      onDragOver={e => e.preventDefault()}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          if (!e.target.files) return
          Array.from(e.target.files).forEach(f => {
            const tid = selectedTrackId || engine.addTrack('audio', f.name.replace(/\.[^.]+$/, ''))
            engine.loadAudioFile(f, tid)
          })
          e.target.value = ''
        }}
      />

      {/* Top bar: Transport */}
      <DAWTransport
        state={state}
        onChange={handleStateChange}
        onPlay={engine.play}
        onPause={engine.pause}
        onStop={engine.stop}
        onExport={handleExport}
      />

      {/* Export status toast */}
      {exportStatus && (
        <div className="daw-toast">{exportStatus}</div>
      )}

      {/* Import status toast */}
      {importStatus && (
        <div className="daw-toast" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>{importStatus}</div>
      )}

      {/* Main area: Timeline */}
      <div className="daw-main-area" style={{ flex: 1, minHeight: 200 }}>
        {tracks.length === 0 ? (
          <div className="daw-empty-state">
            <div className="daw-empty-icon">
              <svg width="64" height="64" viewBox="0 0 64 64">
                <rect x="8" y="16" width="48" height="32" rx="4" stroke="#555" strokeWidth="2" fill="none"/>
                <path d="M22 28v8M32 24v12M42 26v10" stroke="#666" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </div>
            <h2>VoiceSong Studio</h2>
            <p>Müzik üretmeye başlamak için ses dosyalarını sürükle bırak veya kanal ekle</p>
            <div className="daw-empty-actions">
              <button className="daw-btn daw-btn-primary" onClick={() => handleAddTrack('audio')}>
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
                Ses Kanalı Ekle
              </button>
              <button className="daw-btn daw-btn-primary" onClick={() => handleAddTrack('midi')}>
                <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="4" width="12" height="8" rx="1" stroke="currentColor" fill="none" strokeWidth="1.5"/><rect x="4" y="8" width="2" height="4" fill="currentColor"/><rect x="7" y="8" width="2" height="4" fill="currentColor"/><rect x="10" y="8" width="2" height="4" fill="currentColor"/></svg>
                MIDI Kanalı Ekle
              </button>
              <button className="daw-btn" onClick={() => fileInputRef.current?.click()}>
                Dosya Yükle
              </button>
            </div>
          </div>
        ) : (
          <DAWTimeline
            tracks={tracks}
            state={state}
            onStateChange={handleStateChange}
            onClipMove={engine.updateClip}
            onClipRemove={engine.removeClip}
            onClipDuplicate={engine.duplicateClip}
            onClipSplit={engine.splitClip}
            onTrackUpdate={engine.updateTrack}
            onTrackAdd={handleAddTrack}
            onTrackRemove={engine.removeTrack}
            onLoadAudioFile={handleLoadFile}
            onSeek={engine.seek}
            selectedTrackId={selectedTrackId}
            onSelectTrack={handleSelectTrack}
            onSelectClip={handleSelectClip}
            onOpenPianoRoll={handleOpenPianoRoll}
            onOpenClipEditor={handleOpenClipEditor}
          />
        )}
      </div>

      {/* Panel tabs */}
      <div className="daw-panel-tabs">
        <button className={`daw-panel-tab ${bottomPanel === 'mixer' ? 'active' : ''}`}
          onClick={() => setBottomPanel(bottomPanel === 'mixer' ? null : 'mixer')}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2v10M7 4v8M11 1v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          Mikser
        </button>
        <button className={`daw-panel-tab ${bottomPanel === 'pianoroll' ? 'active' : ''}`}
          onClick={() => {
            if (bottomPanel === 'pianoroll') { setBottomPanel(null); return }
            // Open piano roll for selected MIDI track or first MIDI track
            const midiTrack = selectedTrackId && tracks.find(t => t.id === selectedTrackId && t.type === 'midi')
              ? selectedTrackId
              : tracks.find(t => t.type === 'midi')?.id
            if (midiTrack) {
              setPianoRollTrackId(midiTrack)
              setBottomPanel('pianoroll')
            } else {
              // Create a midi track
              const newId = engine.addTrack('midi', 'Piano')
              setPianoRollTrackId(newId)
              setBottomPanel('pianoroll')
            }
          }}>
          <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="2" width="12" height="10" rx="1" stroke="currentColor" fill="none" strokeWidth="1.2"/><rect x="3" y="2" width="2" height="6" fill="currentColor"/><rect x="6" y="2" width="2" height="6" fill="currentColor"/><rect x="9" y="2" width="2" height="6" fill="currentColor"/></svg>
          Piyano Rulosu
        </button>
        <button className={`daw-panel-tab ${bottomPanel === 'beats' ? 'active' : ''}`}
          onClick={() => setBottomPanel(bottomPanel === 'beats' ? null : 'beats')}>
          <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.6"/><rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/><rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/><rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.6"/></svg>
          Beat Yapıcı
        </button>
        <button className={`daw-panel-tab ${bottomPanel === 'composer' ? 'active' : ''}`}
          onClick={() => setBottomPanel(bottomPanel === 'composer' ? null : 'composer')}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" fill="currentColor"/></svg>
          🎲 Beste Yapıcı
        </button>
        <button className={`daw-panel-tab ${bottomPanel === 'clipeditor' ? 'active' : ''}`}
          onClick={() => setBottomPanel(bottomPanel === 'clipeditor' ? null : 'clipeditor')}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 10l3-3 2 2 3-4 2 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
          ✂️ Klip Editör
        </button>
        <button className={`daw-panel-tab ${bottomPanel === 'library' ? 'active' : ''}`}
          onClick={() => setBottomPanel(bottomPanel === 'library' ? null : 'library')}>
          <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M4 4h6M4 7h6M4 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          📂 Kütüphane{libraryItems.length > 0 ? ` (${libraryItems.length})` : ''}
        </button>
        <div className="daw-panel-tabs-spacer" />
        <button className="daw-panel-tab" onClick={() => fileInputRef.current?.click()}>
          Dosya Ekle
        </button>
      </div>

      {/* Resize handle */}
      {bottomPanel && (
        <div
          className="daw-panel-resize"
          onMouseDown={() => setIsResizingPanel(true)}
        />
      )}

      {/* Bottom panel */}
      {bottomPanel && (
        <div className="daw-bottom-panel" style={{ height: bottomPanelHeight }}>
          {bottomPanel === 'mixer' && (
            <DAWMixer
              tracks={tracks}
              state={state}
              masterAnalyser={engine.masterAnalyserRef}
              onTrackUpdate={engine.updateTrack}
              onStateChange={handleStateChange}
              onSelectTrack={handleSelectTrack}
              selectedTrackId={selectedTrackId}
            />
          )}
          {bottomPanel === 'pianoroll' && (
            <DAWPianoRoll
              track={pianoRollTrack}
              state={state}
              onAddNote={engine.addMidiNote}
              onUpdateNote={engine.updateMidiNote}
              onRemoveNote={engine.removeMidiNote}
              onClose={() => setBottomPanel(null)}
            />
          )}
          {bottomPanel === 'beats' && (
            <DAWBeatSequencer
              bpm={state.bpm}
              onPatternExport={handleBeatExport}
            />
          )}
          {bottomPanel === 'composer' && (
            <DAWSmartComposer
              bpm={state.bpm}
              onSongExport={handleComposerExport}
            />
          )}
          {bottomPanel === 'clipeditor' && (() => {
            const editTrack = editingClipTrackId ? tracks.find(t => t.id === editingClipTrackId) || null : null
            const editClip = editTrack ? editTrack.clips.find(c => c.id === editingClipId) || null : null
            return (
              <DAWClipEditor
                clip={editClip}
                track={editTrack}
                bpm={state.bpm}
                onClipUpdate={engine.updateClip}
                onClose={() => setBottomPanel(null)}
              />
            )
          })()}
          {bottomPanel === 'library' && (
            <div className="daw-library">
              <div className="daw-library-header">
                <h3>📂 Kayıtlı Kütüphane</h3>
                <span className="daw-library-count">{libraryItems.length} öğe</span>
              </div>
              {libraryItems.length === 0 ? (
                <div className="daw-library-empty">
                  <p>Henüz kayıtlı ses yok.</p>
                  <p style={{fontSize: '0.8em', opacity: 0.6}}>Ses Klonlama sonuçlarını "Studio'ya Gönder" ile buraya ekleyebilirsiniz.</p>
                </div>
              ) : (
                <div className="daw-library-list">
                  {libraryItems.map(item => (
                    <div key={item.id} className="daw-library-item">
                      <div className="daw-library-item-info">
                        <span className={`daw-library-badge ${item.type}`}>{item.type === 'vocal' ? '🎤' : item.type === 'instrumental' ? '🎵' : item.type === 'generated' ? '🎲' : '🎶'}</span>
                        <span className="daw-library-item-name" title={item.name}>{item.name}</span>
                        <span className="daw-library-item-date">{new Date(item.savedAt).toLocaleDateString('tr-TR')}</span>
                      </div>
                      <div className="daw-library-item-actions">
                        <button className="daw-library-btn load" onClick={() => handleLibraryLoad(item)}>▶ Yükle</button>
                        <button className="daw-library-btn remove" onClick={() => handleLibraryRemove(item.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DAWStudio
