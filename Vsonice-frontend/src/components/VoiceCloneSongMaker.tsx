import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiService } from '../services/api'

const API_BASE = 'http://localhost:8000'

interface VoiceProfile {
  id: string
  name: string
  type: 'user' | 'ai' | 'library' | 'recorded' | 'saved'
  file?: File
  savedProfileId?: string  // For saved profiles from backend
}

interface SavedProfile {
  id: string
  name: string
  created_at: string
  duration: number
  has_embedding: boolean
  audio_url: string
  audio_exists: boolean
}

interface CloneHistoryItem {
  id: string
  name: string
  filename: string
  created_at: string
  duration: number
  size_mb: number
  download_url: string
  components: {
    vocals?: string
    instrumental?: string
  }
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

interface TrainedModel {
  id: string
  name: string
  created_at: string
  updated_at?: string
  num_samples: number
  total_duration: number
  consistency_score: number
  quality_grade: string
  has_embedding: boolean
  sample_names?: string[]
}

export default function VoiceCloneSongMaker() {
  const navigate = useNavigate()
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
  const recordingTimeRef = useRef(0)
  const [autoSaving, setAutoSaving] = useState(false)

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeLoading, setYoutubeLoading] = useState(false)
  const [youtubeTitle, setYoutubeTitle] = useState('')

  // Ses kaydı için okunacak Türkçe metin — tüm temel sesleri (fonem) içerir
  const sampleTexts = [
    {
      title: 'Genel Metin (Önerilen)',
      text: 'Güneş doğarken kuşlar şarkı söylemeye başladı. Rüzgâr hafifçe esiyordu ve yapraklar yavaşça sallanıyordu. Uzaklarda bir çoban kaval çalıyor, sürüsünü otlatıyordu. Gökyüzü masmavi, bulutlar pamuk şekerleri gibi beyazdı. Bu güzel sabahta kahvaltımı bahçede yapmaya karar verdim. Sıcak çayımı yudumlarken kuşların melodisini dinledim.',
      duration: '~25 saniye'
    },
    {
      title: 'Şarkı Sözü Tarzı',
      text: 'Yıldızlar altında yürüdüm bu gece, sensiz geçen günler bitmez bir çile. Rüzgâr fısıldıyor kulağıma yine, özledim seni diye. Gökyüzü ağlıyor benimle birlikte, yağmur damlaları düşüyor yüreğime. Bir gün dönersin belki diye bekliyorum hâlâ, umutlarım solmadan, sevgim bitmeden.',
      duration: '~20 saniye'
    },
    {
      title: 'Doğal Konuşma',
      text: 'Merhaba, bugün hava gerçekten çok güzel. Dışarı çıkıp biraz yürüyüş yapmayı düşünüyorum. Geçen hafta arkadaşlarımla buluştuk, çok eğlendik. Yeni açılan kafede oturduk, müziği harika. Bu akşam film izlemeyi planlıyorum, sen de gelmek ister misin? Neyse, görüşürüz, kendine iyi bak!',
      duration: '~20 saniye'
    }
  ]
  const [selectedText, setSelectedText] = useState(0)

  // Voice profile library state
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([])
  const [profileName, setProfileName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  // Clone history state
  const [cloneHistory, setCloneHistory] = useState<CloneHistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Voice AI Training state
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [trainingFiles, setTrainingFiles] = useState<File[]>([])
  const [trainingModelName, setTrainingModelName] = useState('')
  const [trainingInProgress, setTrainingInProgress] = useState(false)
  const [showTrainingSection, setShowTrainingSection] = useState(false)
  const [selectedProfilesForTraining, setSelectedProfilesForTraining] = useState<string[]>([])
  const trainingFileInputRef = useRef<HTMLInputElement>(null)

  // Load saved profiles and history on mount
  useEffect(() => {
    loadSavedProfiles()
    loadCloneHistory()
    loadTrainedModels()
  }, [])

  const loadSavedProfiles = async () => {
    try {
      const res = await apiService.listVoiceProfiles()
      setSavedProfiles(res.profiles || [])
    } catch (err) {
      console.error('Failed to load profiles:', err)
    }
  }

  const loadCloneHistory = async () => {
    try {
      setLoadingHistory(true)
      const res = await apiService.listCloneHistory()
      setCloneHistory(res.results || [])
    } catch (err) {
      console.error('Failed to load clone history:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const saveVoiceProfile = async () => {
    const fileToSave = voiceProfile?.file
    if (!fileToSave) {
      setError('Kaydedilecek ses dosyası bulunamadı')
      return
    }
    const name = profileName.trim() || `Ses Profili ${savedProfiles.length + 1}`
    setSavingProfile(true)
    try {
      await apiService.saveVoiceProfile(fileToSave, name)
      setSuccess(`Ses profili kaydedildi: ${name}`)
      setShowSaveDialog(false)
      setProfileName('')
      await loadSavedProfiles()
    } catch (err) {
      setError(`Profil kaydetme hatası: ${err instanceof Error ? err.message : 'Bilinmeyen hata'}`)
    } finally {
      setSavingProfile(false)
    }
  }

  // Auto-save a recording to voice profiles
  const autoSaveRecording = async (file: File, durationSec: number) => {
    setAutoSaving(true)
    try {
      const now = new Date()
      const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const name = `Ses Kaydı — ${dateStr} (${durationSec}s)`
      await apiService.saveVoiceProfile(file, name)
      await loadSavedProfiles()
      setSuccess(`Ses kaydı tamamlandı ve otomatik kaydedildi!`)
    } catch (err) {
      console.error('Auto-save failed:', err)
      // Don't show error — manual save is still available
    } finally {
      setAutoSaving(false)
    }
  }

  const selectSavedProfile = (profile: SavedProfile) => {
    setSelectedModelId(null)
    setVoiceProfile({
      id: profile.id,
      name: profile.name,
      type: 'saved',
      savedProfileId: profile.id,
    })
    setRecordedBlob(null)
    setError(null)
    setSuccess(`Kayıtlı profil seçildi: ${profile.name}`)
  }

  const deleteSavedProfile = async (profileId: string) => {
    try {
      await apiService.deleteVoiceProfile(profileId)
      setSavedProfiles(prev => prev.filter(p => p.id !== profileId))
      if (voiceProfile?.savedProfileId === profileId) {
        setVoiceProfile(null)
      }
      setSuccess('Profil silindi')
    } catch (err) {
      setError('Profil silinemedi')
    }
  }

  // ===== VOICE AI TRAINING FUNCTIONS =====
  const loadTrainedModels = async () => {
    try {
      const res = await apiService.listTrainedModels()
      setTrainedModels(res.models || [])
    } catch (err) {
      console.error('Failed to load trained models:', err)
    }
  }

  const handleTrainModel = async () => {
    if (trainingFiles.length === 0 && selectedProfilesForTraining.length === 0) {
      setError('En az 1 ses dosyası veya kayıtlı profil seçin')
      return
    }

    const name = trainingModelName.trim() || `Ses Modeli ${trainedModels.length + 1}`
    setTrainingInProgress(true)
    setError(null)

    try {
      const res = await apiService.trainVoiceModel(trainingFiles, name, selectedProfilesForTraining)
      setSuccess(`AI ses modeli eğitildi: ${name} (Kalite: ${res.quality_grade || 'D'})`)
      setTrainingFiles([])
      setTrainingModelName('')
      setSelectedProfilesForTraining([])
      await loadTrainedModels()
    } catch (err) {
      setError(`Model eğitim hatası: ${err instanceof Error ? err.message : 'Bilinmeyen hata'}`)
    } finally {
      setTrainingInProgress(false)
    }
  }

  const selectTrainedModel = (model: TrainedModel) => {
    setSelectedModelId(model.id)
    setVoiceProfile({
      id: model.id,
      name: `🎓 ${model.name}`,
      type: 'ai',
      savedProfileId: undefined,
    })
    setRecordedBlob(null)
    setError(null)
    setSuccess(`AI model seçildi: ${model.name} (${model.quality_grade} kalite)`)
  }

  const deleteTrainedModel = async (modelId: string) => {
    try {
      await apiService.deleteTrainedModel(modelId)
      setTrainedModels(prev => prev.filter(m => m.id !== modelId))
      if (selectedModelId === modelId) {
        setSelectedModelId(null)
        setVoiceProfile(null)
      }
      setSuccess('Model silindi')
    } catch (err) {
      setError('Model silinemedi')
    }
  }

  const addSamplesToModel = async (modelId: string) => {
    if (trainingFiles.length === 0) {
      setError('Eklemek için ses dosyası seçin')
      return
    }
    setTrainingInProgress(true)
    setError(null)
    try {
      const res = await apiService.addTrainingSamples(modelId, trainingFiles)
      setSuccess(`Model güncellendi: ${res.samples_added || 0} örnek eklendi (Kalite: ${res.quality_grade || 'D'})`)
      setTrainingFiles([])
      await loadTrainedModels()
    } catch (err) {
      setError(`Örnek ekleme hatası: ${err instanceof Error ? err.message : 'Bilinmeyen hata'}`)
    } finally {
      setTrainingInProgress(false)
    }
  }

  const toggleProfileForTraining = (profileId: string) => {
    setSelectedProfilesForTraining(prev =>
      prev.includes(profileId)
        ? prev.filter(id => id !== profileId)
        : [...prev, profileId]
    )
  }

  const getQualityColor = (grade: string) => {
    switch (grade) {
      case 'A+': return '#16a34a'
      case 'A': return '#22c55e'
      case 'B': return '#3b82f6'
      case 'C': return '#f59e0b'
      case 'D': return '#ef4444'
      default: return '#94a3b8'
    }
  }

  const deleteHistoryItem = async (resultId: string) => {
    try {
      await apiService.deleteCloneResult(resultId)
      setCloneHistory(prev => prev.filter(h => h.id !== resultId))
      setSuccess('Sonuç silindi')
    } catch (err) {
      setError('Sonuç silinemedi')
    }
  }

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
        
        // Use ref for accurate time (closure captures stale state)
        const finalTime = recordingTimeRef.current
        
        // Convert to File for upload
        const file = new File([audioBlob], `recording_${Date.now()}.webm`, { type: 'audio/webm' })
        setSelectedModelId(null)
        setVoiceProfile({
          id: `recorded_${Date.now()}`,
          name: `Ses Kaydı (${finalTime}s)`,
          type: 'recorded',
          file: file
        })
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop())
        
        // Auto-save recording to voice profiles (if >= 5 seconds)
        if (finalTime >= 5) {
          autoSaveRecording(file, finalTime)
        } else {
          setSuccess('✓ Ses kaydı tamamlandı! (Kayıt çok kısa olduğu için otomatik kaydedilmedi)')
        }
      }
      
      mediaRecorder.start(100)
      setIsRecording(true)
      setRecordingTime(0)
      recordingTimeRef.current = 0
      setError(null)
      
      // Start timer
      timerRef.current = setInterval(() => {
        recordingTimeRef.current += 1
        setRecordingTime(recordingTimeRef.current)
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
      setSelectedModelId(null)
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
      setYoutubeUrl('')
      setYoutubeTitle('')
      setError(null)
      setSuccess(`✓ Şarkı dosyası yüklendi: ${file.name}`)
    }
  }

  const handleYoutubeDownload = async () => {
    if (!youtubeUrl.trim()) {
      setError('Lütfen bir YouTube URL\'si girin')
      return
    }
    setYoutubeLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const formData = new FormData()
      formData.append('url', youtubeUrl.trim())
      const response = await fetch(`${API_BASE}/api/youtube/extract-audio`, {
        method: 'POST',
        body: formData
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.detail || 'YouTube indirme başarısız')
      }
      const rawTitle = response.headers.get('X-Audio-Title') || 'youtube_audio'
      const title = decodeURIComponent(rawTitle)
      const blob = await response.blob()
      const file = new File([blob], `${title}.wav`, { type: 'audio/wav' })
      setSongFile(file)
      setYoutubeTitle(title)
      setSuccess(`✓ YouTube'dan indirildi: ${title}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'YouTube indirme hatası'
      setError(msg)
    } finally {
      setYoutubeLoading(false)
    }
  }

  const goToStep2 = () => {
    if (!voiceProfile) {
      setError('Lütfen önce bir ses dosyası yükleyin, kayıtlı profil seçin veya AI model eğitin')
      return
    }
    if (!voiceProfile.file && !voiceProfile.savedProfileId && !selectedModelId) {
      setError('Lütfen önce bir ses dosyası yükleyin, kayıtlı profil seçin veya AI model eğitin')
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
      setError('Sadece metin ile şarkı oluşturma henüz desteklenmiyor. Lütfen bir şarkı dosyası yükleyin.')
      return
    }

    if (!voiceProfile?.file && !voiceProfile?.savedProfileId && !selectedModelId) {
      setError('Lütfen önce ses kaydı yapın, ses dosyası yükleyin, profil seçin veya AI model eğitin')
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
      
      let result
      if (selectedModelId) {
        // Use trained AI model
        result = await apiService.cloneWithTrainedModel(
          songFile,
          selectedModelId
        )
      } else {
        // Use voice file or saved profile
        result = await apiService.cloneVoiceAndSing(
          voiceProfile.file || null,
          songFile,
          voiceProfile.savedProfileId
        )
      }
      
      if (progressInterval) clearInterval(progressInterval)
      setProgress(100)
      setGeneratedMusic(result as CloneResult)
      setSuccess('✓ Şarkınız başarıyla oluşturuldu!')
      // Refresh clone history
      loadCloneHistory()

    } catch (err) {
      console.error('Voice cloning error:', err)
      const msg = err instanceof Error ? err.message : 'Şarkı oluşturma başarısız.'
      setError(`${msg}`)
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
    setYoutubeUrl('')
    setYoutubeTitle('')
    setGeneratedMusic(null)
    setError(null)
    setSuccess(null)
    setStep(1)
    setProgress(0)
    setRecordedBlob(null)
    setRecordingTime(0)
    setIsRecording(false)
    setSelectedModelId(null)
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
      <h2>Kendi Sesinle Şarkı Yap</h2>
      <p style={{ marginBottom: '2rem', color: 'var(--text-muted)', fontSize: '1.1rem' }}>
        Kendi sesini kullanarak veya AI ses profilleri ile şarkı oluştur
      </p>

      <div className="card" style={{ marginBottom: '2rem', padding: '1.5rem', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(236, 72, 153, 0.1))' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Nasıl Kullanılır?</h3>
        <div className="grid grid-3">
          <div style={{ padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '2rem' }}>1</div>
            <h4>Sesini Yükle</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Kendi ses kaydını yükle</p>
          </div>
          <div style={{ padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '2rem' }}>2</div>
            <h4>Şarkı/Metin Ekle</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Müzik dosyası veya sözler</p>
          </div>
          <div style={{ padding: '1rem', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '2rem' }}>3</div>
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
          <h3 style={{ fontSize: '1.8rem', marginBottom: '1.5rem' }}>Adım 1: Sesini Kaydet veya Yükle</h3>
          
          {/* Recording Tips */}
          <div style={{ marginBottom: '1.5rem', padding: '1.2rem', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(147, 51, 234, 0.1))', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
            <h4 style={{ marginBottom: '0.8rem', color: '#60a5fa' }}>En İyi Sonuç İçin Kayıt İpuçları</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>•</span>
                <span><strong>Süre:</strong> En az 15-30 saniye kaydedin. Uzun kayıt = daha iyi sonuç</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>•</span>
                <span><strong>Ortam:</strong> Sessiz bir odada kayıt yapın. Arka plan gürültüsü kaliteyi düşürür</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>•</span>
                <span><strong>Mesafe:</strong> Mikrofona 15-20cm mesafede olun. Çok yakın = patlama sesi</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span>•</span>
                <span><strong>Ses tonu:</strong> Normal sesinizle, doğal konuşma hızında okuyun</span>
              </div>
            </div>
          </div>

          {/* Recording Section */}
          <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(234, 88, 12, 0.1))', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4>Ses Kaydı Yap</h4>
              <button 
                className="btn btn-secondary" 
                onClick={() => setShowGuide(!showGuide)}
                style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
              >
                {showGuide ? 'Metni Gizle' : 'Okuma Metnini Göster'}
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
                      {isRecording ? 'Kaydediliyor — Aşağıdaki metni okuyun' : 'Kayıt başlatınca bu metni okuyun'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sampleTexts[selectedText].duration}</span>
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
                }}>●</div>
                <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '1rem 0' }}>
                  {formatTime(recordingTime)}
                </p>
                {/* Recording quality indicator */}
                <div style={{ marginBottom: '1rem' }}>
                  {recordingTime < 10 && (
                    <p style={{ fontSize: '0.85rem', color: '#f97316' }}>En az 15 saniye kaydedin (şu an: {recordingTime}s)</p>
                  )}
                  {recordingTime >= 10 && recordingTime < 15 && (
                    <p style={{ fontSize: '0.85rem', color: '#eab308' }}>İyi — biraz daha devam edin ({recordingTime}s)</p>
                  )}
                  {recordingTime >= 15 && recordingTime < 25 && (
                    <p style={{ fontSize: '0.85rem', color: '#22c55e' }}>Güzel süre! Durdurabilirsiniz ({recordingTime}s)</p>
                  )}
                  {recordingTime >= 25 && (
                    <p style={{ fontSize: '0.85rem', color: '#10b981' }}>Mükemmel! En yüksek kalite için yeterli ({recordingTime}s)</p>
                  )}
                </div>
                <button 
                  className="btn" 
                  onClick={stopRecording}
                  style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                >
                  Kaydı Durdur
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
                  Kayda Başla
                </button>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.8rem' }}>
                  Yukarıdaki metni doğal sesinizle okuyun. AI sesinizi öğrenecek.
                </p>
              </div>
            )}
            
            {recordedBlob && !isRecording && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ color: '#10b981' }}>Kayıt tamamlandı ({formatTime(recordingTime)})</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {autoSaving && (
                      <span style={{ fontSize: '0.8rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} /> Kaydediliyor...
                      </span>
                    )}
                    {recordingTime >= 15 
                      ? <span style={{ fontSize: '0.8rem', color: '#10b981' }}>Kaliteli kayıt</span>
                      : <span style={{ fontSize: '0.8rem', color: '#f97316' }}>Kısa kayıt — sonuç kalitesi düşük olabilir</span>
                    }
                    <button
                      onClick={() => {
                        const url = URL.createObjectURL(recordedBlob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `ses_kaydi_${new Date().toISOString().slice(0,10)}.webm`
                        document.body.appendChild(a)
                        a.click()
                        document.body.removeChild(a)
                        URL.revokeObjectURL(url)
                      }}
                      style={{
                        padding: '0.3rem 0.7rem', borderRadius: '8px', border: 'none',
                        background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa',
                        cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'
                      }}
                      title="Kaydı indir"
                    >
                      ⬇ İndir
                    </button>
                  </div>
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
                <div style={{ fontSize: '2rem', color: 'var(--success-color)' }}>✓</div>
                <h4>{voiceProfile.name}</h4>
                <p>{voiceProfile.file ? `${(voiceProfile.file.size / 1024 / 1024).toFixed(2)} MB` : ''}</p>
                <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setVoiceProfile(null); setRecordedBlob(null) }}>
                  Değiştir
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '2rem', opacity: 0.5 }}>+</div>
                <h4>Ses Dosyası Yükle</h4>
                <p>MP3, WAV, FLAC formatları desteklenir</p>
              </div>
            )}
          </div>
          <input id="voice-upload" type="file" accept="audio/*" onChange={handleVoiceUpload} style={{ display: 'none' }} />

          {/* Manual save for uploaded files (recordings auto-save) */}
          {voiceProfile && voiceProfile.file && voiceProfile.type === 'user' && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              {!showSaveDialog ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowSaveDialog(true)}
                  style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.2))', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#34d399' }}
                >
                  Bu Sesi Kaydet (Sonra Tekrar Kullan)
                </button>
              ) : (
                <div style={{ padding: '1.2rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <h4 style={{ marginBottom: '0.8rem', color: '#34d399' }}>Ses Profili Kaydet</h4>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="text"
                      placeholder="Profil adı (ör: Benim Sesim)"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      style={{
                        padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)',
                        background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '0.9rem', width: '250px'
                      }}
                    />
                    <button
                      className="btn"
                      onClick={saveVoiceProfile}
                      disabled={savingProfile}
                      style={{ padding: '0.6rem 1.2rem', background: 'linear-gradient(135deg, #10b981, #059669)' }}
                    >
                      {savingProfile ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setShowSaveDialog(false)}
                      style={{ padding: '0.6rem 0.8rem' }}
                    >
                      ✕
                    </button>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    AI ses kimliği (speaker embedding) de kaydedilir — sonraki kullanımlarda daha hızlı işlem!
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ===== SAVED VOICE RECORDINGS / PROFILES ===== */}
          <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.08))', borderRadius: '16px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <span style={{ fontSize: '1.4rem' }}></span> Geçmiş Ses Kayıtları
                {savedProfiles.length > 0 && (
                  <span style={{ 
                    fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '12px',
                    background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8'
                  }}>
                    {savedProfiles.length} kayıt
                  </span>
                )}
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Kayıtlar otomatik kaydedilir • Bir kaydı seçerek hemen kullanabilirsiniz
              </p>
            </div>

            {savedProfiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem', opacity: 0.5 }}></div>
                <p style={{ fontSize: '0.9rem' }}>Henüz kayıtlı ses kaydı yok</p>
                <p style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                  Yukarıdan ses kaydı yapın — otomatik olarak buraya kaydedilecek
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
                {savedProfiles.map(profile => (
                  <div
                    key={profile.id}
                    onClick={() => selectSavedProfile(profile)}
                    style={{
                      padding: '1rem 1.2rem',
                      background: voiceProfile?.savedProfileId === profile.id
                        ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.25))'
                        : 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '12px',
                      border: voiceProfile?.savedProfileId === profile.id
                        ? '2px solid rgba(99, 102, 241, 0.6)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '600', marginBottom: '0.3rem', fontSize: '0.95rem' }}>
                          {voiceProfile?.savedProfileId === profile.id ? '✓ ' : ''}{profile.name}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                          <span>{profile.duration.toFixed(0)}s</span>
                          <span>{profile.has_embedding ? 'Hızlı İşlem' : 'Normal'}</span>
                          <span>{new Date(profile.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                        {profile.audio_exists && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const audio = new Audio(apiService.getVoiceProfileAudioUrl(profile.id))
                              audio.play()
                            }}
                            style={{
                              padding: '0.3rem 0.6rem', borderRadius: '8px', border: 'none',
                              background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', cursor: 'pointer', fontSize: '0.85rem'
                            }}
                            title="Dinle"
                          >
                            ▶️
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSavedProfile(profile.id) }}
                          style={{
                            padding: '0.3rem 0.6rem', borderRadius: '8px', border: 'none',
                            background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', cursor: 'pointer', fontSize: '0.85rem'
                          }}
                          title="Sil"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ===== VOICE AI TRAINING SECTION ===== */}
          <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(249, 115, 22, 0.08))', borderRadius: '16px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <span style={{ fontSize: '1.4rem' }}>🎓</span> AI Ses Modeli Eğitimi
                {trainedModels.length > 0 && (
                  <span style={{ 
                    fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '12px',
                    background: 'rgba(234, 179, 8, 0.2)', color: '#fbbf24'
                  }}>
                    {trainedModels.length} model
                  </span>
                )}
              </h4>
              <button
                className="btn btn-secondary"
                onClick={() => setShowTrainingSection(!showTrainingSection)}
                style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
              >
                {showTrainingSection ? 'Gizle' : 'Model Eğit / Seç'}
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.8rem 0' }}>
              Birden fazla ses kaydıyla özel AI ses modeli eğitin — daha doğal ve tutarlı sonuçlar!
            </p>

            {/* Trained Models List (always visible if models exist) */}
            {trainedModels.length > 0 && (
              <div style={{ marginBottom: showTrainingSection ? '1.5rem' : 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
                  {trainedModels.map(model => (
                    <div
                      key={model.id}
                      onClick={() => selectTrainedModel(model)}
                      style={{
                        padding: '1rem 1.2rem',
                        background: selectedModelId === model.id
                          ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.25), rgba(249, 115, 22, 0.25))'
                          : 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        border: selectedModelId === model.id
                          ? '2px solid rgba(234, 179, 8, 0.6)'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600', marginBottom: '0.3rem', fontSize: '0.95rem' }}>
                            {selectedModelId === model.id ? '✓ ' : '🎓 '}{model.name}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                            <span style={{ color: getQualityColor(model.quality_grade), fontWeight: '600' }}>
                              {model.quality_grade} Kalite
                            </span>
                            <span>{model.num_samples} örnek</span>
                            <span>{model.total_duration.toFixed(0)}s</span>
                            <span>Tutarlılık: %{(model.consistency_score * 100).toFixed(0)}</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                            {new Date(model.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {model.updated_at && ' (güncellendi)'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); addSamplesToModel(model.id) }}
                            disabled={trainingFiles.length === 0 || trainingInProgress}
                            style={{
                              padding: '0.3rem 0.6rem', borderRadius: '8px', border: 'none',
                              background: trainingFiles.length > 0 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(100,100,100,0.2)',
                              color: trainingFiles.length > 0 ? '#60a5fa' : '#666', cursor: trainingFiles.length > 0 ? 'pointer' : 'default',
                              fontSize: '0.75rem'
                            }}
                            title="Seçili dosyaları bu modele ekle"
                          >
                            + Ekle
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteTrainedModel(model.id) }}
                            style={{
                              padding: '0.3rem 0.6rem', borderRadius: '8px', border: 'none',
                              background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', cursor: 'pointer', fontSize: '0.85rem'
                            }}
                            title="Sil"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Training Form */}
            {showTrainingSection && (
              <div style={{ padding: '1.2rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                <h5 style={{ marginBottom: '1rem', color: '#fbbf24' }}>Yeni Ses Modeli Eğit</h5>

                {/* Tips */}
                <div style={{ marginBottom: '1rem', padding: '0.8rem', background: 'rgba(234, 179, 8, 0.1)', borderRadius: '8px', fontSize: '0.82rem' }}>
                  <strong>İpuçları:</strong>
                  <ul style={{ margin: '0.3rem 0 0 1.2rem', padding: 0, lineHeight: 1.6 }}>
                    <li>En az <strong>3 farklı ses kaydı</strong> kullanın (ideal: 5-10 kayıt)</li>
                    <li>Her kayıt <strong>10-30 saniye</strong> arası olsun</li>
                    <li>Farklı cümleler ve tonlarda konuşun — çeşitlilik daha iyi model üretir</li>
                    <li>Mevcut kayıtlı profillerinizi de ekleyebilirsiniz</li>
                  </ul>
                </div>

                {/* File Upload */}
                <div style={{ marginBottom: '1rem' }}>
                  <input
                    ref={trainingFileInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || [])
                      setTrainingFiles(prev => [...prev, ...files])
                    }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={() => trainingFileInputRef.current?.click()}
                    style={{ padding: '0.6rem 1.2rem', marginRight: '0.5rem' }}
                  >
                    📁 Ses Dosyaları Seç
                  </button>
                  {trainingFiles.length > 0 && (
                    <span style={{ fontSize: '0.85rem', color: '#fbbf24' }}>
                      {trainingFiles.length} dosya seçildi
                    </span>
                  )}
                </div>

                {/* Selected Files List */}
                {trainingFiles.length > 0 && (
                  <div style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {trainingFiles.map((file, idx) => (
                      <span key={idx} style={{
                        padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem',
                        background: 'rgba(234, 179, 8, 0.15)', color: '#fbbf24',
                        display: 'flex', alignItems: 'center', gap: '0.3rem'
                      }}>
                        🎵 {file.name}
                        <button
                          onClick={() => setTrainingFiles(prev => prev.filter((_, i) => i !== idx))}
                          style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0 0.2rem', fontSize: '0.9rem' }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Include Existing Profiles */}
                {savedProfiles.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
                      Mevcut kayıtlardan da ekleyin:
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {savedProfiles.map(profile => (
                        <button
                          key={profile.id}
                          onClick={() => toggleProfileForTraining(profile.id)}
                          style={{
                            padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem',
                            background: selectedProfilesForTraining.includes(profile.id)
                              ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.05)',
                            border: selectedProfilesForTraining.includes(profile.id)
                              ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(255,255,255,0.1)',
                            color: selectedProfilesForTraining.includes(profile.id) ? '#818cf8' : 'var(--text-muted)',
                            cursor: 'pointer', transition: 'all 0.2s'
                          }}
                        >
                          {selectedProfilesForTraining.includes(profile.id) ? '✓ ' : ''}{profile.name} ({profile.duration.toFixed(0)}s)
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Model Name & Train Button */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Model adı (opsiyonel)"
                    value={trainingModelName}
                    onChange={(e) => setTrainingModelName(e.target.value)}
                    style={{
                      padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '0.9rem', width: '220px'
                    }}
                  />
                  <button
                    className="btn"
                    onClick={handleTrainModel}
                    disabled={trainingInProgress || (trainingFiles.length === 0 && selectedProfilesForTraining.length === 0)}
                    style={{
                      padding: '0.6rem 1.5rem',
                      background: trainingInProgress
                        ? 'rgba(100,100,100,0.3)'
                        : 'linear-gradient(135deg, #f59e0b, #d97706)',
                    }}
                  >
                    {trainingInProgress ? (
                      <span>⏳ Eğitiliyor...</span>
                    ) : (
                      <span>🎓 Modeli Eğit</span>
                    )}
                  </button>
                </div>

                {trainingInProgress && (
                  <div style={{ marginTop: '0.8rem', padding: '0.8rem', background: 'rgba(234, 179, 8, 0.1)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                      <div className="pulse-dot" style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: '#fbbf24', animation: 'pulse 1.5s infinite'
                      }} />
                      AI ses modeliniz eğitiliyor... Bu işlem ses sayısına göre 10-60 saniye sürebilir.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button className="btn" onClick={goToStep2} disabled={!voiceProfile} style={{ marginTop: '2rem', padding: '1rem 2rem' }}>
            Devam Et →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.8rem', marginBottom: '1.5rem' }}>Adım 2: Şarkı Seç</h3>

          {/* YouTube URL Section */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">YouTube'dan Şarkı İndir</label>
            <div style={{
              padding: '1.5rem',
              background: 'rgba(239, 68, 68, 0.04)',
              borderRadius: '12px',
              border: '1px solid rgba(239, 68, 68, 0.15)',
            }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'stretch' }}>
                <input
                  className="input-field"
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=... veya https://youtu.be/..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !youtubeLoading) handleYoutubeDownload() }}
                  disabled={youtubeLoading}
                  style={{ flex: 1, margin: 0 }}
                />
                <button
                  className="btn"
                  onClick={handleYoutubeDownload}
                  disabled={youtubeLoading || !youtubeUrl.trim()}
                  style={{
                    whiteSpace: 'nowrap',
                    padding: '0.75rem 1.5rem',
                    background: youtubeLoading ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
                    opacity: (!youtubeUrl.trim() || youtubeLoading) ? 0.5 : 1
                  }}
                >
                  {youtubeLoading ? 'İndiriliyor...' : 'Sesi Çıkar'}
                </button>
              </div>
              {youtubeLoading && (
                <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    YouTube'dan ses çıkarılıyor... Bu işlem 10-30 saniye sürebilir.
                  </span>
                </div>
              )}
              {youtubeTitle && songFile && (
                <div style={{ marginTop: '0.75rem', padding: '0.6rem 1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', fontSize: '0.85rem', color: '#6ee7b7' }}>
                  ✓ İndirildi: {youtubeTitle}
                </div>
              )}
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', lineHeight: 1.5 }}>
                YouTube, YouTube Music veya YouTube Shorts linklerini destekler. Maksimum 15 dakikalık videolar indirilebilir.
              </p>
            </div>
          </div>

          {/* Separator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '1.5rem 0' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>veya</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
          </div>

          {/* File Upload Section */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="input-label">Dosyadan Yükle</label>
            <div className="upload-area" onClick={() => document.getElementById('song-upload')?.click()}>
              {songFile && !youtubeTitle ? (
                <div>
                  <div style={{ fontSize: '2rem', color: 'var(--success-color)' }}>✓</div>
                  <h4>{songFile.name}</h4>
                  <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setSongFile(null); setYoutubeUrl(''); setYoutubeTitle('') }}>
                    Değiştir
                  </button>
                </div>
              ) : songFile && youtubeTitle ? (
                <div>
                  <div style={{ fontSize: '2rem', color: 'var(--success-color)' }}>✓</div>
                  <h4>{youtubeTitle}</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>YouTube'dan indirildi</p>
                  <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setSongFile(null); setYoutubeUrl(''); setYoutubeTitle('') }} style={{ marginTop: '0.5rem' }}>
                    Değiştir
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '2rem', opacity: 0.5 }}>+</div>
                  <h4>MP3, WAV, FLAC...</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Bilgisayardan müzik dosyası seç</p>
                </div>
              )}
            </div>
            <input id="song-upload" type="file" accept="audio/*" onChange={handleSongUpload} style={{ display: 'none' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Geri</button>
            <button className="btn" onClick={startProcessing} disabled={!songFile}>
              İşlemi Başlat
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.8rem', marginBottom: '1.5rem' }}>Adım 3: İşleniyor...</h3>

          {loading && (
            <div className="loading-container">
              <div className="spinner" />
              <div className="loading-text">
                {progress < 10 ? 'Dosyalar yükleniyor...' :
                 progress < 30 ? 'Demucs AI vokal ayırma yapıyor... (en uzun adım)' :
                 progress < 50 ? 'OpenVoice ses kimliği çıkarılıyor...' :
                 progress < 70 ? 'Neural ses dönüşümü yapılıyor...' :
                 progress < 85 ? 'Profesyonel mastering uygulanıyor...' :
                 progress < 95 ? 'Final mix hazırlanıyor...' :
                 'Neredeyse bitti...'}
              </div>
              <div style={{ width: '100%', maxWidth: '500px' }}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.round(progress)}%` }} />
                </div>
                <p style={{ textAlign: 'center', marginTop: '1rem' }}>{Math.round(progress)}% tamamlandı</p>
                <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  Demucs AI + OpenVoice neural ses dönüşümü yapılıyor. CPU'da 3-7 dakika sürebilir.
                </p>
              </div>
            </div>
          )}

          {!loading && generatedMusic && (
            <div>
              <div style={{ textAlign: 'center', padding: '3rem', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1))', borderRadius: '16px' }}>
                <div style={{ fontSize: '3rem', color: 'var(--success-color)' }}>✓</div>
                <h3 style={{ fontSize: '2rem', color: 'var(--success-color)' }}>Şarkınız Hazır!</h3>
                <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>{generatedMusic.message}</p>
                
                {generatedMusic.user_pitch_hz && generatedMusic.original_pitch_hz && (
                  <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      Ses Analizi: Sizin sesiniz {generatedMusic.user_pitch_hz.toFixed(0)}Hz, 
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
                    <h4 style={{ marginBottom: '1rem' }}>Dinle</h4>
                    <audio 
                      controls 
                      src={`http://localhost:8000${generatedMusic.download_url}`}
                      style={{ width: '100%', maxWidth: '500px' }}
                    />
                  </div>
                ) : (
                  <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
                    <p style={{ color: '#ef4444' }}>Ses dosyası oluşturulamadı. Lütfen tekrar deneyin.</p>
                  </div>
                )}


              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem', flexWrap: 'wrap' }}>
                {generatedMusic.download_url && (
                  <button 
                    className="btn" 
                    onClick={() => downloadResult(generatedMusic.download_url, 'cloned_song.wav')}
                  >
                    Tam Mix İndir
                  </button>
                )}
                {generatedMusic.components?.vocals && (
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => downloadResult(generatedMusic.components!.vocals, 'cloned_vocals.wav')}
                  >
                    Vokal İndir
                  </button>
                )}
                {generatedMusic.components?.instrumental && (
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => downloadResult(generatedMusic.components!.instrumental, 'instrumental.wav')}
                  >
                    Enstrümantal İndir
                  </button>
                )}
                <button className="btn btn-secondary" onClick={resetProcess}>Yeni Şarkı</button>
                {(generatedMusic.components?.vocals || generatedMusic.download_url) && (
                  <button
                    className="btn"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    onClick={() => {
                      const tracks: { url: string; name: string; type: string }[] = []
                      if (generatedMusic.components?.vocals) {
                        tracks.push({ url: `${API_BASE}${generatedMusic.components.vocals}`, name: 'Vokal', type: 'vocal' })
                      }
                      if (generatedMusic.components?.instrumental) {
                        tracks.push({ url: `${API_BASE}${generatedMusic.components.instrumental}`, name: 'Enstrümantal', type: 'instrumental' })
                      }
                      if (tracks.length === 0 && generatedMusic.download_url) {
                        tracks.push({ url: `${API_BASE}${generatedMusic.download_url}`, name: 'Full Mix', type: 'mix' })
                      }
                      localStorage.setItem('daw_import_tracks', JSON.stringify(tracks))
                      navigate('/studio')
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                      <path d="M4 6h2v4H4zM7 5h2v5H7zM10 7h2v3h-2z" fill="currentColor"/>
                    </svg>
                    Studio'ya Gönder
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Clone History Section */}
      <div style={{ marginTop: '2rem' }}>
        <button
          className="btn btn-secondary"
          onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadCloneHistory() }}
          style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        >
          <span style={{ fontSize: '1.3rem' }}></span>
          Geçmiş Sonuçlar ({cloneHistory.length})
          <span style={{ fontSize: '0.8rem' }}>{showHistory ? '▲' : '▼'}</span>
        </button>

        {showHistory && (
          <div className="card" style={{ marginTop: '0.5rem', padding: '1.5rem' }}>
            {loadingHistory ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="spinner" />
                <p>Yükleniyor...</p>
              </div>
            ) : cloneHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2rem', opacity: 0.5 }}></div>
                <p>Henüz kayıtlı sonuç yok. İlk şarkınızı oluşturun!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {cloneHistory.map(item => (
                  <div
                    key={item.id}
                    style={{
                      padding: '1rem 1.2rem',
                      background: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '0.3rem' }}>{item.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {item.duration}s • {item.size_mb} MB • {new Date(item.created_at).toLocaleDateString('tr-TR', {
                            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                          })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <audio
                          controls
                          src={`${API_BASE}${item.download_url}`}
                          style={{ height: '32px', maxWidth: '200px' }}
                        />
                        <button
                          onClick={() => downloadResult(item.download_url, item.filename)}
                          style={{
                            padding: '0.3rem 0.7rem', borderRadius: '6px', border: 'none',
                            background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', cursor: 'pointer', fontSize: '0.8rem'
                          }}
                        >
                          ↓
                        </button>
                        {item.components.vocals && (
                          <button
                            onClick={() => downloadResult(item.components.vocals!, 'vocals.wav')}
                            style={{
                              padding: '0.3rem 0.7rem', borderRadius: '6px', border: 'none',
                              background: 'rgba(147, 51, 234, 0.2)', color: '#a78bfa', cursor: 'pointer', fontSize: '0.8rem'
                            }}
                          >
                            V
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const tracks: { url: string; name: string; type: string }[] = []
                            if (item.components.vocals) {
                              tracks.push({ url: `${API_BASE}${item.components.vocals}`, name: `${item.name} - Vokal`, type: 'vocal' })
                            }
                            if (item.components.instrumental) {
                              tracks.push({ url: `${API_BASE}${item.components.instrumental}`, name: `${item.name} - Enstrümantal`, type: 'instrumental' })
                            }
                            if (tracks.length === 0) {
                              tracks.push({ url: `${API_BASE}${item.download_url}`, name: item.name, type: 'mix' })
                            }
                            localStorage.setItem('daw_import_tracks', JSON.stringify(tracks))
                            navigate('/studio')
                          }}
                          style={{
                            padding: '0.3rem 0.7rem', borderRadius: '6px', border: 'none',
                            background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', cursor: 'pointer', fontSize: '0.8rem'
                          }}
                          title="Studio'ya Gönder"
                        >
                          🎛
                        </button>
                        <button
                          onClick={() => deleteHistoryItem(item.id)}
                          style={{
                            padding: '0.3rem 0.7rem', borderRadius: '6px', border: 'none',
                            background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', cursor: 'pointer', fontSize: '0.8rem'
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
