import { useState } from 'react'
import { apiService } from '../services/api'

export default function MusicGenerator() {
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(10)
  const [temperature, setTemperature] = useState(1.0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await apiService.generateMusic(prompt, duration, temperature)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate music')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="component-container">
      <h2>🎹 Music Generator</h2>
      <p style={{ marginBottom: '2rem', color: '#888' }}>
        Generate music using AI with AudioCraft MusicGen
      </p>

      <form onSubmit={handleGenerate}>
        <div className="form-group">
          <label htmlFor="prompt">Music Description</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the music you want to generate... (e.g., 'upbeat electronic dance music with strong bass')"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="duration">Duration (seconds): {duration}s</label>
          <input
            type="range"
            id="duration"
            min="5"
            max="30"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>

        <div className="form-group">
          <label htmlFor="temperature">Creativity (Temperature): {temperature.toFixed(1)}</label>
          <input
            type="range"
            id="temperature"
            min="0.5"
            max="1.5"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
          <small style={{ color: '#888' }}>Lower = More predictable, Higher = More creative</small>
        </div>

        <button type="submit" className="btn" disabled={loading || !prompt}>
          {loading ? '⏳ Generating...' : '🎵 Generate Music'}
        </button>
      </form>

      {result && (
        <div className="status-message success-message" style={{ marginTop: '2rem' }}>
          <h3>✅ Generation Started</h3>
          <pre style={{ textAlign: 'left', overflow: 'auto' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {error && (
        <div className="status-message error-message" style={{ marginTop: '2rem' }}>
          <h3>❌ Error</h3>
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}
