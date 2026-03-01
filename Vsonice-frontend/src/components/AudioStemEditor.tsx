import { useState } from 'react'

interface Stem {
  name: string
  label: string
  icon: string
  color: string
  waveData?: number[]
  volume: number
  bass: number      // -12 to +12 dB
  treble: number    // -12 to +12 dB
  muted: boolean
  solo: boolean
}

interface StemEditorState {
  vocals: Stem
  music: Stem
}

export default function AudioStemEditor() {
  const [separatedFile, setSeparatedFile] = useState<string | null>(null)
  const [stems, setStems] = useState<StemEditorState>({
    vocals: {
      name: 'vocals',
      label: 'Vokal',
      icon: '',
      color: 'rgba(99, 102, 241, 0.3)',
      volume: 1,
      bass: 0,
      treble: 0,
      muted: false,
      solo: false
    },
    music: {
      name: 'music',
      label: 'Müzik (Enstrümantal)',
      icon: '',
      color: 'rgba(34, 197, 94, 0.3)',
      volume: 1,
      bass: 0,
      treble: 0,
      muted: false,
      solo: false
    }
  })

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [presets, setPresets] = useState('none')
  const [exporting, setExporting] = useState(false)
  const [selectedStems, setSelectedStems] = useState({ vocals: true, music: true })

  // Waveform canvas render
  const renderWaveform = (stemKey: keyof StemEditorState) => {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        padding: '1.5rem',
        background: stems[stemKey].color,
        borderRadius: '8px',
        marginBottom: '1rem',
        border: '2px solid' + (stems[stemKey].solo ? 'var(--primary-color)' : 'transparent')
      }}>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: '600' }}>
            {stems[stemKey].label}
          </h4>
          <div style={{
            height: '60px',
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            fontSize: '0.9rem'
          }}>
            {/* Waveform placeholder - gerçek waveform data eklenebilir */}
            Ses dalgası görüntüsü
          </div>
        </div>
        <div style={{ marginLeft: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => toggleSolo(stemKey)}
            style={{
              padding: '0.5rem 1rem',
              background: stems[stemKey].solo ? 'var(--primary-color)' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              color: '#fff',
              fontWeight: '600',
              transition: 'all 0.2s'
            }}
          >
            S
          </button>
          <button
            onClick={() => toggleMute(stemKey)}
            style={{
              padding: '0.5rem 1rem',
              background: stems[stemKey].muted ? '#ef4444' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              color: '#fff',
              fontWeight: '600',
              transition: 'all 0.2s'
            }}
          >
            M
          </button>
        </div>
      </div>
    )
  }

  const toggleSolo = (stemKey: keyof StemEditorState) => {
    setStems(prev => ({
      ...prev,
      vocals: { ...prev.vocals, solo: stemKey === 'vocals' ? !prev.vocals.solo : false },
      music: { ...prev.music, solo: stemKey === 'music' ? !prev.music.solo : false }
    }))
  }

  const toggleMute = (stemKey: keyof StemEditorState) => {
    setStems(prev => ({
      ...prev,
      [stemKey]: { ...prev[stemKey], muted: !prev[stemKey].muted }
    }))
  }

  const applyPreset = (presetName: string) => {
    setPresets(presetName)
    // Preset'i uygulanacak stem'e göre belirle (user seçimi gerekli)
  }

  const handleVolumeChange = (stemKey: keyof StemEditorState, value: number) => {
    setStems(prev => ({
      ...prev,
      [stemKey]: { ...prev[stemKey], volume: value }
    }))
  }

  const handleBassChange = (stemKey: keyof StemEditorState, value: number) => {
    setStems(prev => ({
      ...prev,
      [stemKey]: { ...prev[stemKey], bass: value }
    }))
  }

  const handleTrebleChange = (stemKey: keyof StemEditorState, value: number) => {
    setStems(prev => ({
      ...prev,
      [stemKey]: { ...prev[stemKey], treble: value }
    }))
  }

  const exportStems = async () => {
    setExporting(true)
    try {
      // Seçili stems'leri indir
      for (const [stemName, selected] of Object.entries(selectedStems)) {
        if (selected && separatedFile) {
          const fileBase = separatedFile.substring(0, separatedFile.lastIndexOf('.')) || separatedFile
          const downloadUrl = `http://localhost:8000/api/download/${encodeURIComponent(fileBase)}/${stemName}`
          window.open(downloadUrl, '_blank')
          // İndirmeler arasında kısa bir gecikme
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="component-container">
      <h2>Profesyonel Stem Editörü</h2>
      <p style={{ marginBottom: '2rem', color: '#888' }}>
        Ayrılan sesleri detaylı şekilde düzenleyin, eşitleyin ve temizleyin
      </p>

      {!separatedFile ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1))' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>+</div>
          <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Ayrılmış Ses Dosyası Seç</h3>
          <p style={{ color: '#888', marginBottom: '2rem' }}>
            Önce "Ses Ayırma" kısmından bir dosya ayrıştırın, ardından buradan düzenleyin
          </p>
          <input
            type="text"
            placeholder="Dosya adı (ör: song_name)"
            onChange={(e) => setSeparatedFile(e.target.value || null)}
            style={{
              padding: '0.75rem',
              borderRadius: '8px',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#fff',
              marginBottom: '1rem',
              width: '100%'
            }}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value) {
                setSeparatedFile(e.currentTarget.value)
              }
            }}
          />
        </div>
      ) : (
        <>
          {/* Waveform ve Kontroller */}
          <div className="card" style={{ padding: '2rem', marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.3rem' }}>Ses Parçaları</h3>

            {renderWaveform('vocals')}
            {renderWaveform('music')}

            {/* Player Controls */}
            <div style={{
              display: 'flex',
              gap: '1rem',
              padding: '1rem',
              background: 'rgba(0, 0, 0, 0.2)',
              borderRadius: '8px',
              marginTop: '2rem'
            }}>
              <button
                onClick={() => setPlaying(!playing)}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'var(--primary-color)',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: '#fff',
                  fontWeight: '600'
                }}
              >
                {playing ? 'Duraklat' : 'Dinle'}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={currentTime}
                onChange={(e) => setCurrentTime(parseInt(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', minWidth: '100px', textAlign: 'right' }}>
                {Math.floor(currentTime / 60)}:{String(currentTime % 60).padStart(2, '0')}
              </span>
            </div>
          </div>

          {/* EQ ve Effects */}
          <div className="card" style={{ padding: '2rem', marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.3rem' }}>Eşitleme & Efektler</h3>

            {['vocals', 'music'].map((stemKey) => (
              <div key={stemKey} style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px' }}>
                <h4 style={{ marginBottom: '1rem', color: stems[stemKey as keyof StemEditorState].label.includes('Vokal') ? '#a5b4fc' : '#86efac' }}>
                  {stems[stemKey as keyof StemEditorState].label}
                </h4>

                {/* Volume */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#aaa' }}>
                    Ses Seviyesi: {Math.round(stems[stemKey as keyof StemEditorState].volume * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={stems[stemKey as keyof StemEditorState].volume}
                    onChange={(e) => handleVolumeChange(stemKey as keyof StemEditorState, parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Bass */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#aaa' }}>
                    Bass: {stems[stemKey as keyof StemEditorState].bass > 0 ? '+' : ''}{stems[stemKey as keyof StemEditorState].bass} dB
                  </label>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={stems[stemKey as keyof StemEditorState].bass}
                    onChange={(e) => handleBassChange(stemKey as keyof StemEditorState, parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Treble */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#aaa' }}>
                    Treble: {stems[stemKey as keyof StemEditorState].treble > 0 ? '+' : ''}{stems[stemKey as keyof StemEditorState].treble} dB
                  </label>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={stems[stemKey as keyof StemEditorState].treble}
                    onChange={(e) => handleTrebleChange(stemKey as keyof StemEditorState, parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            ))}

            {/* EQ Presets */}
            <div style={{ marginTop: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.9rem', color: '#aaa', fontWeight: '600' }}>
                Hazır Presetler
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
                {[
                  { id: 'vocal-boost', label: 'Vokal Boost' },
                  { id: 'vocal-clarity', label: 'Vokal Clarity' },
                  { id: 'vocal-warm', label: 'Vokal Warm' },
                  { id: 'music-bright', label: 'Müzik Bright' },
                  { id: 'music-warm', label: 'Müzik Warm' },
                  { id: 'music-bass-boost', label: 'Bass Boost' }
                ].map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset.id)}
                    style={{
                      padding: '0.75rem',
                      background: presets === preset.id ? 'var(--primary-color)' : 'rgba(99, 102, 241, 0.2)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      color: '#fff',
                      fontSize: '0.85rem',
                      transition: 'all 0.2s'
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Export Options */}
          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.3rem' }}>İndir</h3>

            {/* Stem Selection */}
            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: '#aaa' }}>İndirilecek parçaları seç:</p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                {['vocals', 'music'].map((stemKey) => (
                  <label key={stemKey} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedStems[stemKey as keyof typeof selectedStems]}
                      onChange={(e) => setSelectedStems(prev => ({
                        ...prev,
                        [stemKey]: e.target.checked
                      }))}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span>{stems[stemKey as keyof StemEditorState].label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={exportStems}
              disabled={exporting || !Object.values(selectedStems).some(v => v)}
              style={{
                width: '100%',
                padding: '1rem',
                background: Object.values(selectedStems).some(v => v) ? 'linear-gradient(135deg, var(--primary-color), var(--primary-hover))' : 'rgba(99, 102, 241, 0.3)',
                border: 'none',
                borderRadius: '8px',
                cursor: Object.values(selectedStems).some(v => v) ? 'pointer' : 'not-allowed',
                color: '#fff',
                fontSize: '1.1rem',
                fontWeight: '600',
                transition: 'all 0.2s'
              }}
            >
              {exporting ? 'İndiriliyor...' : 'Seçili Parçaları İndir'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
