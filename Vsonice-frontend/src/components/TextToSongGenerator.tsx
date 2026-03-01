import { useState } from 'react'
import { apiService } from '../services/api'

interface TextToSongParams {
  text: string
  voiceModel: string
  musicStyle: string
  tempo: number
  key: string
}

export default function TextToSongGenerator() {
  const [params, setParams] = useState<TextToSongParams>({
    text: '',
    voiceModel: 'default',
    musicStyle: 'pop',
    tempo: 120,
    key: 'C'
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const musicStyles = [
    'pop', 'rock', 'jazz', 'classical', 'electronic', 'hip-hop', 'country', 'blues'
  ]

  const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!params.text) {
      setError('Lütfen metin girin')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      // API call - metin + ses modeli ile şarkı üret
      const response = await apiService.generateTextToSong(params)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Şarkı üretimi başarısız')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="component-container">
      <h2>Metin ile Şarkı Oluştur</h2>
      <p style={{ marginBottom: '2rem', color: '#888' }}>
        Herhangi bir metni AI ile şarkıya dönüştür
      </p>

      <form onSubmit={handleGenerate}>
        {/* Metin Girişi */}
        <div className="form-group">
          <label htmlFor="text">
            Şarkı Sözleri veya Metin
            <span style={{ color: '#888', fontSize: '0.9em', marginLeft: '0.5rem' }}>
              (En az 50 karakter)
            </span>
          </label>
          <textarea
            id="text"
            value={params.text}
            onChange={(e) => setParams({ ...params, text: e.target.value })}
            placeholder="Şarkı sözlerinizi buraya yazın... &#10;&#10;Örnek:&#10;Gözlerinde kayboldum bu gece&#10;Yıldızlar parlar seninle&#10;Rüzgar fısıldar adını..."
            style={{ minHeight: '200px' }}
            required
          />
          <small style={{ color: '#888' }}>
            {params.text.length} karakter
          </small>
        </div>

        {/* Ses Modeli Seçimi */}
        <div className="form-group">
          <label htmlFor="voiceModel">Ses Modeli</label>
          <select
            id="voiceModel"
            value={params.voiceModel}
            onChange={(e) => setParams({ ...params, voiceModel: e.target.value })}
          >
            <option value="default">Varsayılan AI Ses</option>
            <option value="male-warm">Erkek - Sıcak</option>
            <option value="male-energetic">Erkek - Enerjik</option>
            <option value="female-soft">Kadın - Yumuşak</option>
            <option value="female-powerful">Kadın - Güçlü</option>
            <option value="custom">Özel Yüklenen Ses</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {/* Müzik Stili */}
          <div className="form-group">
            <label htmlFor="musicStyle">Müzik Stili</label>
            <select
              id="musicStyle"
              value={params.musicStyle}
              onChange={(e) => setParams({ ...params, musicStyle: e.target.value })}
            >
              {musicStyles.map(style => (
                <option key={style} value={style}>
                  {style.charAt(0).toUpperCase() + style.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Tempo */}
          <div className="form-group">
            <label htmlFor="tempo">Tempo (BPM): {params.tempo}</label>
            <input
              type="range"
              id="tempo"
              min="60"
              max="180"
              value={params.tempo}
              onChange={(e) => setParams({ ...params, tempo: Number(e.target.value) })}
            />
            <small style={{ color: '#888' }}>
              {params.tempo < 80 && 'Yavaş'}
              {params.tempo >= 80 && params.tempo < 120 && 'Orta'}
              {params.tempo >= 120 && 'Hızlı'}
            </small>
          </div>

          {/* Anahtar */}
          <div className="form-group">
            <label htmlFor="key">Anahtar (Key)</label>
            <select
              id="key"
              value={params.key}
              onChange={(e) => setParams({ ...params, key: e.target.value })}
            >
              {keys.map(key => (
                <option key={key} value={key}>{key} Major</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="btn"
          disabled={loading || params.text.length < 50}
        >
          {loading ? 'Oluşturuluyor...' : 'Şarkı Oluştur'}
        </button>
      </form>

      {/* Sonuç */}
      {result && (
        <div className="status-message success-message" style={{ marginTop: '2rem' }}>
          <h3>Şarkı Oluşturuldu!</h3>
          <div style={{ marginTop: '1rem' }}>
            <p><strong>Stil:</strong> {params.musicStyle}</p>
            <p><strong>Tempo:</strong> {params.tempo} BPM</p>
            <p><strong>Anahtar:</strong> {params.key}</p>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button className="btn">Dinle</button>
            <button className="btn">İndir</button>
            <button className="btn">Düzenle</button>
          </div>
        </div>
      )}

      {error && (
        <div className="status-message error-message" style={{ marginTop: '2rem' }}>
          <h3>Hata</h3>
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}
