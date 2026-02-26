import { useState, useRef } from 'react'
import { apiService } from '../services/api'

interface VoiceProfile {
  id: string
  name: string
  type: 'user' | 'ai' | 'library' | 'recorded'
  file?: File
}

interface CloneResult {
  message: string
  download_url: string
  user_pitch_hz?: number
  original_pitch_hz?: number
  pitch_shift_semitones?: number
  components?: {
    vocals: string
    instrumental: string
  }
}

export default function VoiceCloneSongMaker() {
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null)
  const [songFile, setSongFile] = useState<File | null>(null)
  const [lyrics, setLyrics] = useState('')
  const [generatedMusic, setGeneratedMusic] = useState<CloneResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [progress, setProgress] = useState(0)
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [showGuide, setShowGuide] = useState(true)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Ses kaydı için okunacak Türkçe metin — tüm temel sesleri (fonem) içerir
  const sampleTexts = [
    {
      title: '📖 Genel Metin (Önerilen)',
      text: 'Güneş doğarken kuşlar şarkı söylemeye başladı. Rüzgâr hafifçe esiyordu ve yapraklar yavaşça sallanıyordu. Uzaklarda bir çoban kaval çalıyor, sürüsünü otlatıyordu. Gökyüzü masmavi, bulutlar pamuk şekerleri gibi beyazdı. Bu güzel sabahta kahvaltımı bahçede yapmaya karar verdim. Sıcak çayımı yudumlarken kuşların melodisini dinledim.',
      duration: '~25 saniye'
    },
    {
      title: '🎵 Şarkı Sözü Tarzı',
      text: 'Yıldızlar altında yürüdüm bu gece, sensiz geçen günler bitmez bir çile. Rüzgâr fısıldıyor kulağıma yine, özledim seni diye. Gökyüzü ağlıyor benimle birlikte, yağmur damlaları düşüyor yüreğime. Bir gün dönersin belki diye bekliyorum hâlâ, umutlarım solmadan, sevgim bitmeden.',
      duration: '~20 saniye'
    },
    {
      title: '🗣️ Doğal Konuşma',
      text: 'Merhaba, bugün hava gerçekten çok güzel. Dışarı çıkıp biraz yürüyüş yapmayı düşünüyorum. Geçen hafta arkadaşlarımla buluştuk, çok eğlendik. Yeni açılan kafede oturduk, müziği harika. Bu akşam film izlemeyi planlıyorum, sen de gelmek ister misin? Neyse, görüşürüz, kendine iyi bak!',
      duration: '~20 saniye'
    }
  ]
  const [selectedText, setSelectedText] = useState(0)

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,    // Kapalı — AI zaten temizliyor
          noiseSuppression: false,    // Kapalı — doğal ses daha iyi sonuç verir
          autoGainControl: false,     // Kapalı — seviyeyi backend ayarlıyor
          sampleRate: 44100,
          channelCount: 1             // Mono — vokal kayıt için ideal
        } 
      })
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        setRecordedBlob(audioBlob)
        
        // Convert to File for upload
        const file = new File([audioBlob], `recording_${Date.now()}.webm`, { type: 'audio/webm' })
        setVoiceProfile({
          id: `recorded_${Date.now()}`,
          name: `Ses Kaydı (${recordingTime}s)`,
          type: 'recorded',
          file: file
        })
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop())
        setSuccess('✓ Ses kaydı tamamlandı!')
      }
      
      mediaRecorder.start(100)
      setIsRecording(true)
      setRecordingTime(0)
      setError(null)
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
      
    } catch (err) {
      setError('Mikrofon erişimi reddedildi. Lütfen mikrofon iznini kontrol edin.')
      console.error('Recording error:', err)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }

  const handleVoiceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (!file.type.startsWith('audio/')) {
        setError('Lütfen geçerli bir ses dosyası yükleyin')
        return
      }
      setVoiceProfile({
        id: `user_${Date.now()}`,
        name: file.name,
        type: 'user',
        file: file
      })
      setRecordedBlob(null)
      setError(null)
      setSuccess(`✓ Ses dosyası yüklendi: ${file.name}`)
    }
  }

  const handleSongUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (!file.type.startsWith('audio/')) {
        setError('Lütfen geçerli bir müzik dosyası yükleyin')
        return
      }
      setSongFile(file)
      setError(null)
      setSuccess(`✓ Şarkı dosyası yüklendi: ${file.name}`)
    }
  }

  const goToStep2 = () => {
    if (!voiceProfile) {
      setError('Lütfen önce bir ses dosyası yükleyin')
      return
    }
    setError(null)
    setSuccess(null)
    setStep(2)
  }

  const startProcessing = async () => {
    if (!songFile && !lyrics) {
      setError('Lütfen bir şarkı dosyası yükleyin veya metin girin')
      return
    }

    if (!songFile) {
      setError('⚠️ Sadece metin ile şarkı oluşturma henüz desteklenmiyor. Lütfen bir şarkı dosyası yükleyin.')
      return
    }

    if (!voiceProfile?.file) {
      setError('Lütfen önce ses kaydı yapın veya ses dosyası yükleyin')
      return
    }

    setError(null)
    setSuccess(null)
    setStep(3)
    setLoading(true)
    setProgress(0)

    let progressInterval: ReturnType<typeof setInterval> | null = null
    
    try {
      // Slow, realistic progress for Demucs AI processing (takes 2-5 min on CPU)
      progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return 90  // Cap at 90% until done
          if (prev < 10) return prev + 2   // Initial upload phase
          if (prev < 40) return prev + 0.8 // Demucs separation (slowest part)
          if (prev < 60) return prev + 1   // Pitch analysis
          if (prev < 75) return prev + 0.5 // Pitch shifting
          return prev + 0.3               // Mixing
        })
      }, 2000)

      setProgress(5)
      
      const result = await apiService.cloneVoiceAndSing(voiceProfile.file, songFile)
      
      if (progressInterval) clearInterval(progressInterval)
      setProgress(100)
      setGeneratedMusic(result as CloneResult)
      setSuccess('✓ Şarkınız başarıyla oluşturuldu!')

    } catch (err) {
      console.error('Voice cloning error:', err)
      const msg = err instanceof Error ? err.message : 'Şarkı oluşturma başarısız.'
      setError(`❌ ${msg}`)
      setProgress(0)
      setStep(2)
    } finally {
      if (progressInterval) clearInterval(progressInterval)
      setLoading(false)
    }
  }

  const resetProcess = () => {
    setVoiceProfile(null)
    setSongFile(null)
    setLyrics('')
    setGeneratedMusic(null)
    setError(null)
    setSuccess(null)
    setStep(1)
    setProgress(0)
    setRecordedBlob(null)
    setRecordingTime(0)
    setIsRecording(false)
  }

  const downloadResult = (url: string, filename: string) => {
    const fullUrl = `http://localhost:8000${url}`
    const link = document.createElement('a')
    link.href = fullUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="component-container">
      <h2>🎤 Kendi Sesinle Şarkı Yap</h2>
      <p style={{ marginBottom: '2rem', color: 'var(--text-muted)', fontSize: '1.1rem' }}>
        Kendi sesini kullanarak veya AI ses profilleri ile şarkı oluştur
      </p>

      <div className="card" style={{ marginBottom: '2rem', padding: '1.5rem', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(236, 72, 153, 0.1))' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>📚 Nasıl Kullanılır?</h3>
        <div className="grid grid-3">
          <div style={{ padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '2rem' }}>1️⃣</div>
            <h4>Sesini Yükle</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Kendi ses kaydını yükle</p>
          </div>
          <div style={{ padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '2rem' }}>2️⃣</div>
            <h4>Şarkı/Metin Ekle</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Müzik dosyası veya sözler</p>
          </div>
          <div style={{ padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '2rem' }}>3️⃣</div>
            <h4>AI İşlesin</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Senin sesinle şarkı üret</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center' }}>
        <div style={{
          padding: '1rem 2rem',
          borderRadius: '12px',
          background: step === 1 ? 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))' : 'rgba(255, 255, 255, 0.05)',
          border: `2px solid ${step === 1 ? 'var(--primary-color)' : 'rgba(255, 255, 255, 0.1)'}`,
          color: step === 1 ? 'white' : 'var(--text-muted)',
          fontWeight: '600'
        }}>
          <div style={{ fontSize: '1.5rem' }}>1</div>
          Ses Seç
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '1.5rem' }}>→</div>
        <div style={{
          padding: '1rem 2rem',
          borderRadius: '12px',
          background: step === 2 ? 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))' : 'rgba(255, 255, 255, 0.05)',
          border: `2px solid ${step === 2 ? 'var(--primary-color)' : 'rgba(255, 255, 255, 0.1)'}`,
          color: step === 2 ? 'white' : 'var(--text-muted)',
          fontWeight: '600'
        }}>
          <div style={{ fontSize: '1.5rem' }}>2</div>
          Şarkı/Metin
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '1.5rem' }}>→</div>
        <div style={{
          padding: '1rem 2rem',
          borderRadius: '12px',
          background: step === 3 ? 'linear-gradient(135deg, var(--primary-color), var(--secondary-color))' : 'rgba(255, 255, 255, 0.05)',
          border: `2px solid ${step === 3 ? 'var(--primary-color)' : 'rgba(255, 255, 255, 0.1)'}`,
          color: step === 3 ? 'white' : 'var(--text-muted)',
          fontWeight: '600'
        }}>
          <div style={{ fontSize: '1.5rem' }}>3</div>
          İşle
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {step === 1 && (
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.8rem', marginBottom: '1.5rem' }}>🎤 Adım 1: Sesini Kaydet veya Yükle</h3>
          
          {/* Recording Tips */}
          <div style={{ marginBottom: '1.5rem', padding: '1.2rem', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(147, 51, 234, 0.1))', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
            <h4 style={{ marginBottom: '0.8rem', color: '#60a5fa' }}>💡 En İyi Sonuç İçin Kayıt İpuçları</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>🎯</span>
                <span><strong>Süre:</strong> En az 15-30 saniye kaydedin. Uzun kayıt = daha iyi sonuç</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>🤫</span>
                <span><strong>Ortam:</strong> Sessiz bir odada kayıt yapın. Arka plan gürültüsü kaliteyi düşürür</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>📏</span>
                <span><strong>Mesafe:</strong> Mikrofona 15-20cm mesafede olun. Çok yakın = patlama sesi</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>🗣️</span>
                <span><strong>Ses tonu:</strong> Normal sesinizle, doğal konuşma hızında okuyun</span>
              </div>
            </div>
          </div>

          {/* Recording Section */}
          <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(234, 88, 12, 0.1))', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4>🎙️ Ses Kaydı Yap</h4>
              <button 
                className="btn btn-secondary" 
                onClick={() => setShowGuide(!showGuide)}
                style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
              >
                {showGuide ? '📖 Metni Gizle' : '📖 Okuma Metnini Göster'}
              </button>
            </div>

            {/* Teleprompter - Okunacak Metin */}
            {showGuide && (
              <div style={{ marginBottom: '1.5rem' }}>
                {/* Text selector */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {sampleTexts.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedText(i)}
                      style={{
                        padding: '0.4rem 0.8rem',
                        borderRadius: '8px',
                        border: selectedText === i ? '2px solid #f97316' : '1px solid rgba(255,255,255,0.15)',
                        background: selectedText === i ? 'rgba(249, 115, 22, 0.15)' : 'rgba(255,255,255,0.05)',
                        color: selectedText === i ? '#fb923c' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: selectedText === i ? '600' : '400',
                        transition: 'all 0.2s'
                      }}
                    >
                      {t.title}
                    </button>
                  ))}
                </div>

                {/* The actual teleprompter text */}
                <div style={{
                  padding: '1.5rem',
                  background: 'rgba(0, 0, 0, 0.4)',
                  borderRadius: '12px',
                  border: isRecording ? '2px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.1)',
                  position: 'relative',
                  transition: 'border-color 0.3s'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {isRecording ? '🔴 Kaydediliyor — Aşağıdaki metni okuyun' : '📖 Kayıt başlatınca bu metni okuyun'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>⏱️ {sampleTexts[selectedText].duration}</span>
                  </div>
                  <p style={{
                    fontSize: isRecording ? '1.25rem' : '1.1rem',
                    lineHeight: '2',
                    color: isRecording ? '#fbbf24' : 'rgba(255, 255, 255, 0.85)',
                    fontWeight: isRecording ? '500' : '400',
                    letterSpacing: '0.02em',
                    transition: 'all 0.3s'
                  }}>
                    {sampleTexts[selectedText].text}
                  </p>
                </div>
              </div>
            )}
            
            {/* Recording controls */}
            {isRecording ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: '3rem', 
                  animation: 'pulse 1s infinite',
                  color: '#ef4444'
                }}>🔴</div>
                <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '1rem 0' }}>
                  {formatTime(recordingTime)}
                </p>
                {/* Recording quality indicator */}
                <div style={{ marginBottom: '1rem' }}>
                  {recordingTime < 10 && (
                    <p style={{ fontSize: '0.85rem', color: '#f97316' }}>⚠️ En az 15 saniye kaydedin (şu an: {recordingTime}s)</p>
                  )}
                  {recordingTime >= 10 && recordingTime < 15 && (
                    <p style={{ fontSize: '0.85rem', color: '#eab308' }}>🟡 İyi — biraz daha devam edin ({recordingTime}s)</p>
                  )}
                  {recordingTime >= 15 && recordingTime < 25 && (
                    <p style={{ fontSize: '0.85rem', color: '#22c55e' }}>🟢 Güzel süre! Durdurabilirsiniz ({recordingTime}s)</p>
                  )}
                  {recordingTime >= 25 && (
                    <p style={{ fontSize: '0.85rem', color: '#10b981' }}>✨ Mükemmel! En yüksek kalite için yeterli ({recordingTime}s)</p>
                  )}
                </div>
                <button 
                  className="btn" 
                  onClick={stopRecording}
                  style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                >
                  ⏹️ Kaydı Durdur
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <button 
                  className="btn" 
                  onClick={startRecording}
                  style={{ 
                    background: 'linear-gradient(135deg, #ef4444, #f97316)',
                    padding: '1rem 2rem',
                    fontSize: '1.1rem'
                  }}
                >
                  🎙️ Kayda Başla
                </button>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.8rem' }}>
                  Yukarıdaki metni doğal sesinizle okuyun. AI sesinizi öğrenecek.
                </p>
              </div>
            )}
            
            {recordedBlob && !isRecording && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ color: '#10b981' }}>✅ Kayıt tamamlandı ({formatTime(recordingTime)})</p>
                  {recordingTime >= 15 
                    ? <span style={{ fontSize: '0.8rem', color: '#10b981' }}>🎯 Kaliteli kayıt</span>
                    : <span style={{ fontSize: '0.8rem', color: '#f97316' }}>⚠️ Kısa kayıt — sonuç kalitesi düşük olabilir</span>
                  }
                </div>
                <audio 
                  controls 
                  src={URL.createObjectURL(recordedBlob)} 
                  style={{ width: '100%', marginTop: '0.5rem' }}
                />
              </div>
            )}
          </div>
          
          <div style={{ textAlign: 'center', margin: '1rem 0', color: 'var(--text-muted)' }}>
            — veya —
          </div>
          
          {/* Upload Section */}
          <div className="upload-area"
            onClick={() => document.getElementById('voice-upload')?.click()}>
            {voiceProfile && voiceProfile.type === 'user' ? (
              <div>
                <div style={{ fontSize: '3rem' }}>✅</div>
                <h4>{voiceProfile.name}</h4>
                <p>{voiceProfile.file ? `${(voiceProfile.file.size / 1024 / 1024).toFixed(2)} MB` : ''}</p>
                <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setVoiceProfile(null); setRecordedBlob(null) }}>
                  Değiştir
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '4rem' }}>📁</div>
                <h4>Ses Dosyası Yükle</h4>
                <p>MP3, WAV, FLAC formatları desteklenir</p>
              </div>
            )}
          </div>
          <input id="voice-upload" type="file" accept="audio/*" onChange={handleVoiceUpload} style={{ display: 'none' }} />

          <button className="btn" onClick={goToStep2} disabled={!voiceProfile} style={{ marginTop: '2rem', padding: '1rem 2rem' }}>
            Devam Et →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.8rem', marginBottom: '1.5rem' }}>🎵 Adım 2: Şarkı veya Metin</h3>

          <div className="grid grid-2" style={{ gap: '2rem' }}>
            <div>
              <label className="input-label">Şarkı Dosyası</label>
              <div className="upload-area" onClick={() => document.getElementById('song-upload')?.click()}>
                {songFile ? (
                  <div>
                    <div style={{ fontSize: '3rem' }}>🎵</div>
                    <h4>{songFile.name}</h4>
                    <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setSongFile(null) }}>
                      Değiştir
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '3rem' }}>🎼</div>
                    <h4>Müzik Dosyası</h4>
                  </div>
                )}
              </div>
              <input id="song-upload" type="file" accept="audio/*" onChange={handleSongUpload} style={{ display: 'none' }} />
            </div>

            <div>
              <label className="input-label">Şarkı Sözleri</label>
              <textarea
                className="input-field"
                placeholder="Şarkı sözlerini yazın..."
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                style={{ minHeight: '200px' }}
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                ⚠️ Sadece metin ile şarkı oluşturma henüz desteklenmiyor. Lütfen bir şarkı dosyası yükleyin.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Geri</button>
            <button className="btn" onClick={startProcessing} disabled={!songFile}>
              İşlemi Başlat 🚀
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.8rem', marginBottom: '1.5rem' }}>⚙️ Adım 3: İşleniyor...</h3>

          {loading && (
            <div className="loading-container">
              <div className="spinner" />
              <div className="loading-text">
                {progress < 10 ? '📤 Dosyalar yükleniyor...' :
                 progress < 30 ? '🧠 Demucs AI vokal ayırma yapıyor... (en uzun adım)' :
                 progress < 50 ? '🎤 OpenVoice ses kimliği çıkarılıyor...' :
                 progress < 70 ? '🎵 Neural ses dönüşümü yapılıyor...' :
                 progress < 85 ? '🎛️ Profesyonel mastering uygulanıyor...' :
                 progress < 95 ? '🎧 Final mix hazırlanıyor...' :
                 '✨ Neredeyse bitti...'}
              </div>
              <div style={{ width: '100%', maxWidth: '500px' }}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.round(progress)}%` }} />
                </div>
                <p style={{ textAlign: 'center', marginTop: '1rem' }}>{Math.round(progress)}% tamamlandı</p>
                <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  ⏱️ Demucs AI + OpenVoice neural ses dönüşümü yapılıyor. CPU'da 3-7 dakika sürebilir.
                </p>
              </div>
            </div>
          )}

          {!loading && generatedMusic && (
            <div>
              <div style={{ textAlign: 'center', padding: '3rem', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1))', borderRadius: '16px' }}>
                <div style={{ fontSize: '5rem' }}>🎉</div>
                <h3 style={{ fontSize: '2rem', color: 'var(--success-color)' }}>Şarkınız Hazır!</h3>
                <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>{generatedMusic.message}</p>
                
                {generatedMusic.user_pitch_hz && generatedMusic.original_pitch_hz && (
                  <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      📊 Ses Analizi: Sizin sesiniz {generatedMusic.user_pitch_hz.toFixed(0)}Hz, 
                      Orijinal {generatedMusic.original_pitch_hz.toFixed(0)}Hz
                      {generatedMusic.pitch_shift_semitones && (
                        <span> ({generatedMusic.pitch_shift_semitones > 0 ? '+' : ''}{generatedMusic.pitch_shift_semitones.toFixed(1)} yarım ton)</span>
                      )}
                    </p>
                  </div>
                )}
                
                {/* Audio Player */}
                {generatedMusic.download_url ? (
                  <div style={{ marginTop: '2rem' }}>
                    <h4 style={{ marginBottom: '1rem' }}>🎧 Dinle</h4>
                    <audio 
                      controls 
                      src={`http://localhost:8000${generatedMusic.download_url}`}
                      style={{ width: '100%', maxWidth: '500px' }}
                    />
                  </div>
                ) : (
                  <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
                    <p style={{ color: '#ef4444' }}>⚠️ Ses dosyası oluşturulamadı. Lütfen tekrar deneyin.</p>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem', flexWrap: 'wrap' }}>
                {generatedMusic.download_url && (
                  <button 
                    className="btn" 
                    onClick={() => downloadResult(generatedMusic.download_url, 'cloned_song.wav')}
                  >
                    📥 Tam Mix İndir
                  </button>
                )}
                {generatedMusic.components?.vocals && (
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => downloadResult(generatedMusic.components!.vocals, 'cloned_vocals.wav')}
                  >
                    🎤 Vokal İndir
                  </button>
                )}
                {generatedMusic.components?.instrumental && (
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => downloadResult(generatedMusic.components!.instrumental, 'instrumental.wav')}
                  >
                    🎸 Enstrümantal İndir
                  </button>
                )}
                <button className="btn btn-secondary" onClick={resetProcess}>🔄 Yeni Şarkı</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
