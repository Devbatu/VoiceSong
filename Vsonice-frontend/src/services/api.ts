const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface ApiResponse<T = any> {
  message: string;
  data?: T;
  error?: string;
}

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  async healthCheck() {
    return this.request<{ status: string; services: any }>('/api/health');
  }

  async uploadAudio(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${this.baseUrl}/api/upload`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    return await response.json();
  }

  async generateMusic(prompt: string, duration: number = 10, temperature: number = 1.0) {
    return this.request('/api/generate/music', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, duration, temperature }),
    });
  }

  async convertVoice(audioFile: File, targetVoice: string = 'default') {
    const formData = new FormData();
    formData.append('audio_file', audioFile);
    formData.append('target_voice', targetVoice);

    const url = `${this.baseUrl}/api/convert/voice`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Voice conversion failed: ${response.statusText}`);
    }

    return await response.json();
  }

  async listModels() {
    return this.request<{
      audiocraft_models: string[];
      rvc_models: string[];
      demucs_models: string[];
    }>('/api/models');
  }

  async separateAudio(audioFile: File, model: string = 'htdemucs') {
    const formData = new FormData();
    formData.append('audio_file', audioFile);
    formData.append('model', model);

    const url = `${this.baseUrl}/api/separate`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Audio separation failed: ${response.statusText}`);
    }

    return await response.json();
  }

  async listDemucsModels() {
    return this.request<{
      models: Array<{
        name: string;
        description: string;
        stems: string[];
        recommended: boolean;
      }>;
    }>('/api/separate/models');
  }

  async generateTextToSong(params: {
    text: string;
    voiceProfileId?: string;
    voiceModelId?: string;
    speed?: string;
    language?: string;
    melodyIntensity?: number;
    key?: string;
    bpm?: number;
    genre?: string;
    style?: string;
    mood?: string;
    sections?: Array<{ type: string; text: string }>;
  }) {
    const url = `${this.baseUrl}/api/generate/text-to-song`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 min timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || `Vokal oluşturma başarısız: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('İşlem zaman aşımına uğradı (10 dakika).');
      }
      throw error;
    }
  }

  async cloneVoiceAndSing(voiceFile: File | null, songFile: File, voiceProfileId?: string) {
    const formData = new FormData();
    if (voiceFile) {
      formData.append('voice_file', voiceFile);
    }
    formData.append('song_file', songFile);
    if (voiceProfileId) {
      formData.append('voice_profile_id', voiceProfileId);
    }

    const url = `${this.baseUrl}/api/clone-voice-sing`;
    
    // 30 minute timeout for voice cloning (Demucs AI separation takes time on CPU)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800000);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || `Voice cloning failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('İşlem zaman aşımına uğradı (30 dakika). Daha kısa bir şarkı deneyin.');
      }
      throw error;
    }
  }

  // Voice Profiles (Kişisel Ses Paketleri)
  async saveVoiceProfile(voiceFile: File, name: string) {
    const formData = new FormData();
    formData.append('voice_file', voiceFile);
    formData.append('name', name);

    const url = `${this.baseUrl}/api/voice-profiles`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Profil kaydetme başarısız: ${response.statusText}`);
    }

    return await response.json();
  }

  async listVoiceProfiles() {
    return this.request<{
      profiles: Array<{
        id: string;
        name: string;
        created_at: string;
        duration: number;
        has_embedding: boolean;
        audio_url: string;
        audio_exists: boolean;
      }>;
    }>('/api/voice-profiles');
  }

  async deleteVoiceProfile(profileId: string) {
    return this.request<{ message: string }>(`/api/voice-profiles/${profileId}`, {
      method: 'DELETE',
    });
  }

  getVoiceProfileAudioUrl(profileId: string) {
    return `${this.baseUrl}/api/voice-profiles/${profileId}/audio`;
  }

  // Clone History (Geçmiş Sonuçlar)
  async listCloneHistory() {
    return this.request<{
      results: Array<{
        id: string;
        name: string;
        filename: string;
        created_at: string;
        duration: number;
        size_mb: number;
        download_url: string;
        components: {
          vocals?: string;
          instrumental?: string;
        };
      }>;
    }>('/api/clone-history');
  }

  async deleteCloneResult(resultId: string) {
    return this.request<{ message: string }>(`/api/clone-history/${resultId}`, {
      method: 'DELETE',
    });
  }

  async getVoiceLibrary() {
    return this.request<{
      voices: Array<{
        id: string;
        name: string;
        type: string;
        language: string;
        gender: string;
      }>;
    }>('/api/voice-library');
  }

  // Voice AI Training (Ses Modeli Eğitimi)
  async trainVoiceModel(voiceFiles: File[], modelName: string, profileIds: string[] = []) {
    const formData = new FormData();
    voiceFiles.forEach(file => formData.append('voice_files', file));
    formData.append('model_name', modelName);
    if (profileIds.length > 0) {
      formData.append('profile_ids', profileIds.join(','));
    }

    const url = `${this.baseUrl}/api/voice-training/train`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 min timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || `Model eğitimi başarısız: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Eğitim zaman aşımına uğradı (10 dakika).');
      }
      throw error;
    }
  }

  async addTrainingSamples(modelId: string, voiceFiles: File[]) {
    const formData = new FormData();
    formData.append('model_id', modelId);
    voiceFiles.forEach(file => formData.append('voice_files', file));

    const url = `${this.baseUrl}/api/voice-training/add-samples`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || `Örnek ekleme başarısız: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('İşlem zaman aşımına uğradı.');
      }
      throw error;
    }
  }

  async listTrainedModels() {
    return this.request<{
      models: Array<{
        id: string;
        name: string;
        created_at: string;
        updated_at?: string;
        num_samples: number;
        total_duration: number;
        consistency_score: number;
        quality_grade: string;
        has_embedding: boolean;
        sample_names?: string[];
      }>;
    }>('/api/voice-training/models');
  }

  async deleteTrainedModel(modelId: string) {
    return this.request<{ message: string }>(`/api/voice-training/models/${modelId}`, {
      method: 'DELETE',
    });
  }

  // Clone with trained model support
  async cloneWithTrainedModel(
    songFile: File,
    voiceModelId: string
  ) {
    const formData = new FormData();
    formData.append('song_file', songFile);
    formData.append('voice_model_id', voiceModelId);

    const url = `${this.baseUrl}/api/clone-voice-sing`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || `Voice cloning failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('İşlem zaman aşımına uğradı (30 dakika).');
      }
      throw error;
    }
  }
}

export const apiService = new ApiService();
export default apiService;
