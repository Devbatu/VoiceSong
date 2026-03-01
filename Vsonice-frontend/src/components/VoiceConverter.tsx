import { useState, useEffect } from 'react'
import { apiService } from '../services/api'

export default function VoiceConverter() {
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [targetVoice, setTargetVoice] = useState('default')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = async () => {
    try {
      const models = await apiService.listModels()
      setAvailableModels(models.rvc_models || ['default'])
    } catch (err) {
      console.error('Failed to load models:', err)
      setAvailableModels(['default'])
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0])
      setError(null)
    }
  }

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!audioFile) {
      setError('Please select an audio file')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await apiService.convertVoice(audioFile, targetVoice)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert voice')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="component-container">
      <h2>Voice Converter</h2>
      <p style={{ marginBottom: '2rem', color: '#888' }}>
        Convert any voice to different voice models using RVC
      </p>

      <form onSubmit={handleConvert}>
        <div className="form-group">
          <label htmlFor="audioFile">Select Audio File</label>
          <input
            type="file"
            id="audioFile"
            accept="audio/*"
            onChange={handleFileChange}
            style={{ padding: '0.5rem' }}
          />
          {audioFile && (
            <p style={{ marginTop: '0.5rem', color: '#888' }}>
              Selected: {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="targetVoice">Target Voice Model</label>
          <select
            id="targetVoice"
            value={targetVoice}
            onChange={(e) => setTargetVoice(e.target.value)}
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn" disabled={loading || !audioFile}>
          {loading ? 'Converting...' : 'Convert Voice'}
        </button>
      </form>

      {result && (
        <div className="status-message success-message" style={{ marginTop: '2rem' }}>
          <h3>Conversion Started</h3>
          <pre style={{ textAlign: 'left', overflow: 'auto' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {error && (
        <div className="status-message error-message" style={{ marginTop: '2rem' }}>
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}
