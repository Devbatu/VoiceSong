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
    voiceModel: string;
    musicStyle: string;
    tempo: number;
    key: string;
  }) {
    return this.request('/api/generate/text-to-song', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
  }

  async cloneVoiceAndSing(voiceFile: File, songFile: File) {
    const formData = new FormData();
    formData.append('voice_file', voiceFile);
    formData.append('song_file', songFile);

    const url = `${this.baseUrl}/api/clone-voice-sing`;
    
    // 10 minute timeout for voice cloning (Demucs AI separation takes time on CPU)
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
        throw new Error(errorData?.detail || `Voice cloning failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('İşlem zaman aşımına uğradı (10 dakika). Daha kısa bir şarkı deneyin.');
      }
      throw error;
    }
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
}

export const apiService = new ApiService();
export default apiService;
