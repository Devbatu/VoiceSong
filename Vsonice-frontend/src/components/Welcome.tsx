import { useState } from 'react'

export default function Welcome() {
  const [currentStep, setCurrentStep] = useState(0)

  const features = [
    {
      icon: '🎤',
      title: 'Voice Clone Song Maker',
      description: 'Kendi sesinizi veya AI ses modellerini kullanarak şarkı oluşturun',
      steps: [
        '1. Ses dosyanızı yükleyin veya AI ses modeli seçin',
        '2. İstediğiniz şarkıyı seçin veya metninizi yazın',
        '3. AI ile ses klonlama ve üretim işlemini başlatın'
      ]
    },
    {
      icon: '✍️',
      title: 'Text to Song',
      description: 'Metinden AI ile tam bir şarkı üretin',
      steps: [
        '1. Şarkınızın sözlerini yazın',
        '2. Müzik stilini, tempoyu ve tonunu ayarlayın',
        '3. AI ses modelini seçin ve üretin'
      ]
    },
    {
      icon: '🎛️',
      title: 'Professional Studio',
      description: 'DAW tarzı profesyonel mixing ve mastering ortamı',
      steps: [
        '1. Track\'lere ses dosyası yükleyin',
        '2. Volume, Pan, ve efektleri ayarlayın',
        '3. AI Assistant ile otomatik optimizasyon yapın'
      ]
    },
    {
      icon: '🎼',
      title: 'Audio Separator',
      description: 'Müziği farklı stem\'lere ayırın (Demucs)',
      steps: [
        '1. Ayırmak istediğiniz müzik dosyasını yükleyin',
        '2. Ayırma modelini seçin (2, 4, veya 6 stem)',
        '3. Vokal, drums, bass ve diğer parçaları indirin'
      ]
    },
    {
      icon: '🎵',
      title: 'Music Generator',
      description: 'AI ile instrumental müzik üretin (AudioCraft)',
      steps: [
        '1. Üretmek istediğiniz müziği tanımlayın',
        '2. Süre ve parametreleri ayarlayın',
        '3. AI ile benzersiz müzik oluşturun'
      ]
    },
    {
      icon: '🎭',
      title: 'Voice Converter',
      description: 'Ses dönüştürme ve klonlama (RVC)',
      steps: [
        '1. Dönüştürmek istediğiniz ses dosyasını yükleyin',
        '2. Hedef ses modelini seçin',
        '3. Pitch ve diğer ayarları yapın ve dönüştürün'
      ]
    }
  ]

  return (
    <div className="component-container">
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ 
          fontSize: '4rem', 
          marginBottom: '1rem',
          background: 'linear-gradient(135deg, var(--primary-color), var(--secondary-color), var(--accent-color))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}>
          🎵 VoiceSong'a Hoş Geldiniz!
        </h1>
        <p style={{ fontSize: '1.5rem', color: 'var(--text-muted)', maxWidth: '800px', margin: '0 auto' }}>
          AI destekli profesyonel müzik prodüksiyon platformu
        </p>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-3" style={{ marginBottom: '3rem' }}>
        {features.map((feature, index) => (
          <div
            key={index}
            className="card"
            style={{
              cursor: 'pointer',
              transform: currentStep === index ? 'scale(1.05)' : 'scale(1)',
              transition: 'all 0.3s ease'
            }}
            onClick={() => setCurrentStep(index)}
          >
            <div style={{ fontSize: '4rem', marginBottom: '1rem', textAlign: 'center' }}>
              {feature.icon}
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.75rem', textAlign: 'center' }}>
              {feature.title}
            </h3>
            <p style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '1.5rem', textAlign: 'center' }}>
              {feature.description}
            </p>
            {currentStep === index && (
              <div style={{ 
                marginTop: '1.5rem', 
                paddingTop: '1.5rem', 
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                animation: 'fadeIn 0.5s ease-in-out'
              }}>
                <h4 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--primary-color)' }}>
                  📋 Nasıl Kullanılır:
                </h4>
                {feature.steps.map((step, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0.75rem',
                      marginBottom: '0.5rem',
                      background: 'rgba(99, 102, 241, 0.05)',
                      borderRadius: '8px',
                      borderLeft: '3px solid var(--primary-color)',
                      fontSize: '0.9rem'
                    }}
                  >
                    {step}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.8rem', marginBottom: '2rem' }}>🚀 Platformun Gücü</h3>
        <div className="grid grid-4">
          <div>
            <div style={{ fontSize: '3rem', fontWeight: '700', color: 'var(--primary-color)', marginBottom: '0.5rem' }}>
              6
            </div>
            <div style={{ color: 'var(--text-muted)' }}>Güçlü Özellik</div>
          </div>
          <div>
            <div style={{ fontSize: '3rem', fontWeight: '700', color: 'var(--secondary-color)', marginBottom: '0.5rem' }}>
              8+
            </div>
            <div style={{ color: 'var(--text-muted)' }}>Profesyonel Efekt</div>
          </div>
          <div>
            <div style={{ fontSize: '3rem', fontWeight: '700', color: 'var(--accent-color)', marginBottom: '0.5rem' }}>
              AI
            </div>
            <div style={{ color: 'var(--text-muted)' }}>Yapay Zeka Desteği</div>
          </div>
          <div>
            <div style={{ fontSize: '3rem', fontWeight: '700', color: 'var(--success-color)', marginBottom: '0.5rem' }}>
              ∞
            </div>
            <div style={{ color: 'var(--text-muted)' }}>Sınırsız Yaratıcılık</div>
          </div>
        </div>
      </div>

      {/* Getting Started */}
      <div style={{ marginTop: '3rem', textAlign: 'center' }}>
        <h3 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>🎯 Hemen Başlayın!</h3>
        <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '2rem' }}>
          Üstteki menüden bir özellik seçerek yaratıcı yolculuğunuza başlayın
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn" style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
            🎤 Voice Clone ile Başla
          </button>
          <button className="btn btn-secondary" style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
            🎛️ Studio'yu Keşfet
          </button>
          <button className="btn btn-secondary" style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}>
            📚 Tüm Özellikleri Gör
          </button>
        </div>
      </div>

      {/* Tips */}
      <div className="card" style={{ marginTop: '3rem', padding: '2rem', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(236, 72, 153, 0.1))' }}>
        <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          💡 İpuçları
        </h3>
        <div className="grid grid-2">
          <div style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
            <div style={{ fontSize: '2rem' }}>✨</div>
            <div>
              <h4 style={{ marginBottom: '0.5rem' }}>Professional Studio</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Track'lere dosya sürükleyip bırakabilir ve hızlıca mix yapabilirsiniz
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
            <div style={{ fontSize: '2rem' }}>🤖</div>
            <div>
              <h4 style={{ marginBottom: '0.5rem' }}>AI Assistant</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                AI Mixing Assistant otomatik mastering ve optimizasyon önerileri sunar
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
            <div style={{ fontSize: '2rem' }}>🎼</div>
            <div>
              <h4 style={{ marginBottom: '0.5rem' }}>Efekt Zincirleri</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Reverb, Delay, EQ gibi efektleri sıralayarak profesyonel sonuçlar elde edin
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
            <div style={{ fontSize: '2rem' }}>⚡</div>
            <div>
              <h4 style={{ marginBottom: '0.5rem' }}>Hızlı İşlem</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Tüm AI işlemleri backend'de optimize edilmiş şekilde çalışır
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
