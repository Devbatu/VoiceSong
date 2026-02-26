import { useState } from 'react'
import { apiService } from '../services/api'

export default function AudioUploader() {
  const [dragActive, setDragActive] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const handleFile = (file: File) => {
    setFile(file)
    setError(null)
    setResult(null)
  }

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first')
      return
    }

    setUploading(true)
    setError(null)
    setResult(null)

    try {
      const response = await apiService.uploadAudio(file)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="component-container">
      <h2>📤 Audio Uploader</h2>
      <p style={{ marginBottom: '2rem', color: '#888' }}>
        Upload audio files for processing
      </p>

      <div
        className={`upload-area ${dragActive ? 'dragover' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => document.getElementById('fileInput')?.click()}
      >
        <input
          type="file"
          id="fileInput"
          accept="audio/*"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
        
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📁</div>
        
        {file ? (
          <>
            <h3 style={{ color: '#646cff', marginBottom: '0.5rem' }}>
              {file.name}
            </h3>
            <p style={{ color: '#888' }}>
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </>
        ) : (
          <>
            <h3 style={{ marginBottom: '0.5rem' }}>
              Drag and drop your audio file here
            </h3>
            <p style={{ color: '#888' }}>
              or click to browse
            </p>
            <p style={{ color: '#666', fontSize: '0.9em', marginTop: '1rem' }}>
              Supported formats: MP3, WAV, FLAC, OGG
            </p>
          </>
        )}
      </div>

      {file && (
        <button
          onClick={handleUpload}
          className="btn"
          disabled={uploading}
          style={{ marginTop: '1rem' }}
        >
          {uploading ? '⏳ Uploading...' : '📤 Upload File'}
        </button>
      )}

      {result && (
        <div className="status-message success-message" style={{ marginTop: '2rem' }}>
          <h3>✅ Upload Successful</h3>
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
