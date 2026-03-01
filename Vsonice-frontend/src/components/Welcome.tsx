import { useNavigate } from 'react-router-dom'
import { Mic, AudioLines, Piano, SlidersHorizontal, Sliders, FileText, Music, Lightbulb, Zap, Sparkles, Waves } from 'lucide-react'

export default function Welcome() {
  const navigate = useNavigate()

  const mainFeatures = [
    {
      icon: <Mic size={28} />,
      title: 'Ses Klonlama',
      description: 'Sesinizi kaydedin, bir şarkı yükleyin — AI sesinizi şarkıya aktarsın.',
      color: '#6366f1',
      path: '/ses-klonla',
      badge: 'En Popüler'
    },
    {
      icon: <AudioLines size={28} />,
      title: 'Ses Ayırma (AI)',
      description: 'Demucs AI ile şarkıyı vokal, bas, davul ve enstrümanlara ayırın.',
      color: '#8b5cf6',
      path: '/stem-ayir',
      badge: 'Demucs AI'
    },
    {
      icon: <Piano size={28} />,
      title: 'Pro Studio',
      description: 'DAW tarzı profesyonel mixing ve mastering ortamı. Efekt zincirleri, EQ, kompresör ve daha fazlası.',
      color: '#ec4899',
      path: '/studio',
      badge: 'Gelişmiş'
    },
  ]

  const otherFeatures = [
    {
      icon: <SlidersHorizontal size={22} />,
      title: 'Stem Mixer',
      description: 'Ayrılmış stem\'leri istediğiniz oranda karıştırın.',
      path: '/stem-mixer'
    },
    {
      icon: <Sliders size={22} />,
      title: 'Stem Editör',
      description: 'Vokal ve müzik kanallarını bağımsız düzenleyin.',
      path: '/stem-editor'
    },
    {
      icon: <FileText size={22} />,
      title: 'Metin → Şarkı',
      description: 'Yazılan metni AI ile şarkıya dönüştürün.',
      path: '/metin-sarki'
    },
    {
      icon: <Music size={22} />,
      title: 'Müzik Üret',
      description: 'AI ile prompt tabanlı müzik oluşturun.',
      path: '/muzik-uret'
    },
  ]

  const stats = [
    { value: '4+', label: 'AI Model', color: '#6366f1' },
    { value: '12+', label: 'Ses Efekti', color: '#8b5cf6' },
    { value: 'HD', label: 'Ses Kalitesi', color: '#ec4899' },
    { value: '∞', label: 'Yaratıcılık', color: '#10b981' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Hero Section */}
      <div style={{
        textAlign: 'center',
        padding: '3rem 1.5rem',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(236,72,153,0.08) 100%)',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: 'var(--radius-lg)',
          background: 'linear-gradient(135deg, #6366f1, #ec4899)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.25rem',
        }}>
          <Waves size={32} color="white" />
        </div>
        <h1 style={{
          fontSize: '2.5rem',
          fontWeight: 800,
          marginBottom: '0.75rem',
          background: 'linear-gradient(135deg, #6366f1, #ec4899)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          VoiceSong Studio
        </h1>
        <p style={{
          fontSize: '1.15rem',
          color: 'var(--text-secondary)',
          maxWidth: '600px',
          margin: '0 auto 2rem',
          lineHeight: 1.6
        }}>
          AI destekli ses klonlama, stem ayırma ve profesyonel müzik üretim platformu
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/ses-klonla')} style={{ padding: '0.85rem 2rem' }}>
            Ses Klonla
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/stem-ayir')} style={{ padding: '0.85rem 2rem' }}>
            Ses Ayır
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/studio')} style={{ padding: '0.85rem 2rem' }}>
            Studio
          </button>
        </div>
      </div>

      {/* Main Features */}
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Ana Özellikler
        </h2>
        <div className="grid grid-3">
          {mainFeatures.map((feature) => (
            <div
              key={feature.title}
              onClick={() => navigate(feature.path)}
              style={{
                padding: '1.75rem',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = feature.color + '55'
                e.currentTarget.style.transform = 'translateY(-4px)'
                e.currentTarget.style.boxShadow = `0 8px 25px ${feature.color}22`
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {feature.badge && (
                <span style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '0.25rem 0.6rem',
                  borderRadius: '20px',
                  background: feature.color + '22',
                  color: feature.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {feature.badge}
                </span>
              )}
              <div style={{
                marginBottom: '1rem',
                width: '52px',
                height: '52px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-md)',
                background: feature.color + '15',
                color: feature.color,
              }}>
                {feature.icon}
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                {feature.title}
              </h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-4" style={{ textAlign: 'center' }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{
            padding: '1.25rem',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: stat.color, marginBottom: '0.25rem' }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Other Features */}
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Diğer Araçlar
        </h2>
        <div className="grid grid-4">
          {otherFeatures.map((feature) => (
            <div
              key={feature.title}
              onClick={() => navigate(feature.path)}
              style={{
                padding: '1.25rem',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-light)'
                e.currentTarget.style.transform = 'translateY(-2px)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              <div style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>{feature.icon}</div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                {feature.title}
              </h4>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div style={{
        padding: '1.5rem',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(236,72,153,0.06))',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Lightbulb size={18} /> Hızlı İpuçları
        </h3>
        <div className="grid grid-2">
          {[
            { icon: <Mic size={18} />, title: 'Net Ses Kaydı', desc: 'Ses klonlama için sessiz ortamda en az 20 saniye kayıt yapın.' },
            { icon: <Sparkles size={18} />, title: 'Yüksek Kalite', desc: 'Demucs AI shifts=3 ile en temiz vokal izolasyonunu sağlar.' },
            { icon: <SlidersHorizontal size={18} />, title: 'Efekt Zincirleri', desc: 'Studio\'da EQ, kompresör, reverb gibi efektleri sıralayın.' },
            { icon: <Zap size={18} />, title: 'Hızlı İşlem', desc: 'Tüm AI işlemleri backend\'de optimize edilmiş şekilde çalışır.' },
          ].map((tip) => (
            <div key={tip.title} style={{ display: 'flex', gap: '0.75rem', padding: '0.5rem' }}>
              <div style={{ flexShrink: 0, color: 'var(--text-secondary)', marginTop: '2px' }}>{tip.icon}</div>
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.2rem' }}>{tip.title}</h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{tip.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
