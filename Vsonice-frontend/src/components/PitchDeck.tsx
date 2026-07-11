import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Maximize, PlayCircle } from 'lucide-react';
import './PitchDeck.css';

// ─── Slide Data Types ───
interface SlideBase { id: number; title: string; type: string }
interface CoverSlide extends SlideBase { type: 'cover'; subtitle: string; quote: string; icon: string }
interface BulletsSlide extends SlideBase { type: 'bullets'; items: string[] }
interface GridSlide extends SlideBase { type: 'grid'; subtitle?: string; quote?: string; items: { icon: string; title: string; desc: string }[] }
interface ProcessSlide extends SlideBase { type: 'process'; subtitle: string; items: { step: string; title: string; desc: string }[] }
interface SplitSlide extends SlideBase { type: 'split'; subtitle: string; leftContent: { title: string; desc: string }[]; rightTitle: string; rightContent: string[] }
interface StatsSlide extends SlideBase { type: 'stats'; subtitle: string; stats: { label: string; value: string; sub: string }[]; footerInfo: string }
interface TableSlide extends SlideBase { type: 'table'; subtitle: string; headers: string[]; rows: string[][] }
interface PricingSlide extends SlideBase { type: 'pricing'; subtitle: string; tiers: { name: string; price: string; desc: string }[]; extra: string }
interface RoadmapSlide extends SlideBase { type: 'roadmap'; items: { date: string; status: string; title: string }[] }
interface ClosingSlide extends SlideBase { type: 'closing'; subtitle: string; demand: string; funds: { percent: string; label: string }[]; contact: { email: string }; quote: string }
type Slide = CoverSlide | BulletsSlide | GridSlide | ProcessSlide | SplitSlide | StatsSlide | TableSlide | PricingSlide | RoadmapSlide | ClosingSlide;

// ─── Slide Data ───
const slideData: Slide[] = [
  { id: 1, type: 'cover', title: 'Vsonice', subtitle: 'AI-Powered Voice & Music Studio', quote: '"Sesinizi Dönüştürün, Müziğinizi Yaratın"', icon: '🎼🤖' },
  { id: 2, type: 'bullets', title: '🎧 Problem: Müzik Üretimindeki Büyük Sorun', items: [
    'Profesyonel müzik prodüksiyonu için birden fazla pahalı yazılım gerekiyor\n(Pro Tools: $599/yıl, iZotope RX: $499, stüdyo: $50–200/saat)',
    'AI ses araçları dağınık ve entegre değil',
    'Kullanıcılar birden fazla platform arasında geçiş yapmak zorunda',
    'Ses klonlama ve müzik üretimi teknik bilgi gerektiriyor',
    'Bağımsız sanatçılar ve içerik üreticileri bu maliyetleri karşılayamıyor',
    'Mevcut çözümler uçtan uca iş akışı sunmuyor'
  ]},
  { id: 3, type: 'grid', title: '🚀 Çözüm: Hepsi Bir Arada AI Müzik Stüdyosu', quote: '"Ses klonlama, müzik üretme, vokal ayırma ve profesyonel miksaj — tek bir web platformunda."', items: [
    { icon: '🎤', title: 'AI Ses Klonlama', desc: 'Herhangi bir sesi saniyeler içinde klonla' },
    { icon: '🎼', title: 'AI Ses Ayırma', desc: 'Şarkıları vokal, davul, bas ve enstrümanlara ayır' },
    { icon: '🎹', title: 'DAW Studio', desc: 'Tarayıcıda tam donanımlı müzik prodüksiyon ortamı' },
    { icon: '🎵', title: 'AI Müzik Üretimi', desc: 'Metinden müzik üret' }
  ]},
  { id: 4, type: 'grid', title: '🖥️ Ürünümüz: Ana Modüller', quote: 'Gerçek ekran görüntüleri entegrasyonu için hazır modüller:', items: [
    { icon: '1️⃣', title: 'DAW Studio', desc: 'Piano Roll, Timeline, Mixer, Clip Editor' },
    { icon: '2️⃣', title: 'Ses Ayırma Paneli', desc: 'Waveform gösterimi + stem export' },
    { icon: '3️⃣', title: 'Ses Klonlama Arayüzü', desc: 'Model yükleme & eğitim paneli' },
    { icon: '4️⃣', title: 'Stem Mixer & Editor', desc: 'Ayrıştırılmış parçaları miksleme' }
  ]},
  { id: 5, type: 'process', title: '⚙️ Nasıl Çalışır?', subtitle: '3 Adımda Müzik Üretin', items: [
    { step: '1', title: 'Yükle veya Kaydet', desc: 'Ses dosyanı yükle veya tarayıcıdan kayıt al' },
    { step: '2', title: 'AI İşlesin', desc: 'Ayırma, klonlama veya müzik üretimi' },
    { step: '3', title: 'Mixle & İndir', desc: "DAW Studio'da düzenle ve profesyonel çıktı al" }
  ]},
  { id: 6, type: 'split', title: '🤖 Teknoloji & AI Altyapısı', subtitle: 'Son Teknoloji AI Motoru', leftContent: [
    { title: 'Demucs', desc: 'Gelişmiş ses ayırma modeli' },
    { title: 'OpenVoice V2', desc: 'Nöral ses klonlama' },
    { title: 'AudioCraft / MusicGen', desc: 'Metinden müzik üretimi' },
    { title: 'Custom Voice', desc: 'LoRA-style model eğitimi' },
    { title: 'GPU Hızlandırma', desc: 'CUDA destekli gerçek zamanlı işlem' }
  ], rightTitle: 'Alt Yapı', rightContent: ['⚛️ React + TypeScript (Frontend)', '🐍 FastAPI + PyTorch (Backend)'] },
  { id: 7, type: 'stats', title: '🌍 Pazar Büyüklüğü', subtitle: 'Devasa ve Büyüyen Bir Pazar', stats: [
    { label: 'Küresel Müzik Yazılımı', value: '$14.2B', sub: "(2030) $8.6B'den büyüyor" },
    { label: 'AI Müzik Pazarı', value: '$12.6B', sub: "CAGR %28 ($2.9B'den)" },
    { label: 'Ses Klonlama', value: '$5.7B', sub: "$1.6B'den büyüyor" }
  ], footerInfo: '🎵 50M+ bağımsız müzik üreticisi | 📱 200M+ içerik üretici\nPlatform ekosistemi: Spotify, SoundCloud, YouTube, TikTok, Instagram' },
  { id: 8, type: 'grid', title: '👥 Hedef Kitle', subtitle: 'Kimler Kullanacak?', items: [
    { icon: '🎤', title: 'Bağımsız Sanatçılar', desc: 'Düşük bütçeyle profesyonel kalite' },
    { icon: '🎬', title: 'İçerik Üreticileri', desc: 'YouTube, TikTok, Podcast için müzik & ses' },
    { icon: '🎧', title: 'DJ & Remix Sanatçıları', desc: 'Stem ayırma ve remix üretimi' },
    { icon: '🏢', title: 'Stüdyolar & Prodüktörler', desc: 'İş akışını hızlandırma' }
  ]},
  { id: 9, type: 'table', title: '🏆 Rekabet Avantajı', subtitle: 'Neden Vsonice?', headers: ['Özellik', 'Vsonice', 'ElevenLabs', 'Suno AI', 'LALAL.AI', 'Pro Tools'], rows: [
    ['Ses Klonlama', '✅', '✅', '❌', '❌', '❌'],
    ['Ses Ayırma', '✅', '❌', '❌', '✅', '❌'],
    ['Müzik Üretimi', '✅', '❌', '✅', '❌', '❌'],
    ['DAW Studio', '✅', '❌', '❌', '❌', '✅'],
    ['Model Eğitimi', '✅', '❌', '❌', '❌', '❌'],
    ['Web Tabanlı', '✅', '✅', '✅', '✅', '❌'],
    ['Hepsi Bir Arada', '✅', '❌', '❌', '❌', '❌']
  ]},
  { id: 10, type: 'pricing', title: '💰 Gelir Modeli', subtitle: 'Katmanlı Abonelik Sistemi', tiers: [
    { name: 'Ücretsiz', price: '$0', desc: 'Aylık 5 işlem' },
    { name: 'Pro', price: '$14.99/ay', desc: 'Sınırsız işlem, yüksek kalite export' },
    { name: 'Studio', price: '$39.99/ay', desc: 'Takım erişimi, API, model eğitimi' },
    { name: 'Enterprise', price: 'Özel', desc: 'On-premise, özel model, SLA' }
  ], extra: 'Ek Gelir: API kullanım ücretleri, Voice Marketplace (ses modeli satışı)' },
  { id: 11, type: 'roadmap', title: '🗺️ Yol Haritası', items: [
    { date: 'Q1 2026', status: '✅', title: 'MVP Tamamlandı' },
    { date: 'Q2 2026', status: '🚀', title: 'Mobil uygulama (React Native)' },
    { date: 'Q3 2026', status: '🛒', title: 'AI Voice Marketplace & İşbirliği' },
    { date: 'Q4 2026', status: '🎤', title: 'Canlı performans modu & VST' },
    { date: '2027', status: '🌍', title: 'AI Mastering, Video-ses senk., Global ölçeklenme' }
  ]},
  { id: 12, type: 'closing', title: '🔥 Bize Katılın', subtitle: 'Yatırım Talebi & Kapanış', demand: '💵 Yatırım Talebi: _______', funds: [
    { percent: '%40', label: 'Ürün geliştirme' },
    { percent: '%30', label: 'Pazarlama' },
    { percent: '%20', label: 'GPU altyapısı' },
    { percent: '%10', label: 'Operasyonel giderler' }
  ], contact: { email: 'batuhan.celikkaya@hotmail.com' }, quote: '"Müziğin Geleceği Yapay Zeka ile Şekilleniyor — Vsonice"' }
];

// ─── Floating Particles ───
function Particles() {
  const particles = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      duration: 8 + Math.random() * 12,
      delay: Math.random() * 10,
      size: 2 + Math.random() * 3,
      opacity: 0.2 + Math.random() * 0.5,
    })), []);

  return (
    <div className="pitch-bg-particles">
      {particles.map(p => (
        <div
          key={p.id}
          className="pitch-particle"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Component ───
export default function PitchDeck() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideKey, setSlideKey] = useState(0);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');

  const goTo = (idx: number) => {
    setDirection(idx > currentSlide ? 'next' : 'prev');
    setCurrentSlide(idx);
    setSlideKey(k => k + 1);
  };

  const nextSlide = () => { if (currentSlide < slideData.length - 1) goTo(currentSlide + 1); };
  const prevSlide = () => { if (currentSlide > 0) goTo(currentSlide - 1); };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextSlide(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevSlide(); }
      if (e.key === 'Home') { e.preventDefault(); goTo(0); }
      if (e.key === 'End') { e.preventDefault(); goTo(slideData.length - 1); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentSlide]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };

  const slide = slideData[currentSlide];
  const animClass = direction === 'next' ? 'pitch-slide' : 'pitch-slide pitch-slide--reverse';

  return (
    <div className="pitch-root">
      {/* Animated BG */}
      <div className="pitch-bg">
        <div className="pitch-bg-orb pitch-bg-orb--1" />
        <div className="pitch-bg-orb pitch-bg-orb--2" />
        <div className="pitch-bg-orb pitch-bg-orb--3" />
        <div className="pitch-bg-grid" />
        <Particles />
      </div>

      {/* Main */}
      <main className="pitch-main">
        <div className="pitch-frame">
          {/* Slide Number */}
          <div className="pitch-slide-num">{currentSlide + 1} / {slideData.length}</div>

          {/* ---- Slide Content (re-keyed for animation) ---- */}
          <div className={animClass} key={slideKey}>

            {/* Cover */}
            {slide.type === 'cover' && (
              <div className="pitch-cover">
                <div className="pitch-cover__icon">{slide.icon}</div>
                <h1 className="pitch-cover__title">{slide.title}</h1>
                <h2 className="pitch-cover__subtitle">{slide.subtitle}</h2>
                <div className="pitch-cover__quote">{slide.quote}</div>
              </div>
            )}

            {/* Bullets */}
            {slide.type === 'bullets' && (
              <>
                <h2 className="pitch-title">{slide.title}</h2>
                <ul className="pitch-bullets">
                  {slide.items.map((item, idx) => (
                    <li key={idx} className="pitch-bullet" style={{ animationDelay: `${idx * 0.08}s` }}>
                      <span className="pitch-bullet__icon">✦</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* Grid */}
            {slide.type === 'grid' && (
              <>
                <h2 className="pitch-title">{slide.title}</h2>
                {slide.subtitle && <p className="pitch-subtitle">{slide.subtitle}</p>}
                {slide.quote && <p className="pitch-quote-bar">{slide.quote}</p>}
                <div className="pitch-grid">
                  {slide.items.map((item, idx) => (
                    <div key={idx} className="pitch-card" style={{ animationDelay: `${idx * 0.1}s` }}>
                      <span className="pitch-card__icon">{item.icon}</span>
                      <div className="pitch-card__title">{item.title}</div>
                      <div className="pitch-card__desc">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Process */}
            {slide.type === 'process' && (
              <>
                <h2 className="pitch-title">{slide.title}</h2>
                <p className="pitch-subtitle">{slide.subtitle}</p>
                <div className="pitch-process">
                  <div className="pitch-process__line" />
                  {slide.items.map((item, idx) => (
                    <div key={idx} className="pitch-step" style={{ animationDelay: `${idx * 0.15}s` }}>
                      <div className="pitch-step__circle" style={{ animationDelay: `${idx * 0.5}s` }}>{item.step}</div>
                      <div className="pitch-step__title">{item.title}</div>
                      <div className="pitch-step__desc">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Split */}
            {slide.type === 'split' && (
              <>
                <h2 className="pitch-title">{slide.title}</h2>
                <p className="pitch-subtitle">{slide.subtitle}</p>
                <div className="pitch-split">
                  <div className="pitch-split__left">
                    {slide.leftContent.map((item, idx) => (
                      <div key={idx} className="pitch-split__item" style={{ animationDelay: `${idx * 0.08}s` }}>
                        <span className="pitch-split__item-title">{item.title}</span>
                        <span className="pitch-split__item-desc">— {item.desc}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pitch-split__right">
                    <div className="pitch-split__right-title">{slide.rightTitle}</div>
                    {slide.rightContent.map((item, idx) => (
                      <div key={idx} className="pitch-split__right-item">{item}</div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Stats */}
            {slide.type === 'stats' && (
              <>
                <h2 className="pitch-title" style={{ textAlign: 'center' }}>{slide.title}</h2>
                <p className="pitch-subtitle" style={{ textAlign: 'center' }}>{slide.subtitle}</p>
                <div className="pitch-stats">
                  {slide.stats.map((stat, idx) => (
                    <div key={idx} className="pitch-stat" style={{ animationDelay: `${idx * 0.15}s` }}>
                      <div className="pitch-stat__label">{stat.label}</div>
                      <div className="pitch-stat__value">{stat.value}</div>
                      <div className="pitch-stat__sub">{stat.sub}</div>
                    </div>
                  ))}
                </div>
                <div className="pitch-stats-footer">{slide.footerInfo}</div>
              </>
            )}

            {/* Table */}
            {slide.type === 'table' && (
              <>
                <h2 className="pitch-title">{slide.title}</h2>
                <p className="pitch-subtitle">{slide.subtitle}</p>
                <div className="pitch-table-wrap">
                  <table className="pitch-table">
                    <thead>
                      <tr>
                        {slide.headers.map((h, i) => (
                          <th key={i} className={i === 1 ? 'pitch-table--highlight' : ''}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slide.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>
                              {cell === '✅' ? <span className="pitch-check">{cell}</span> :
                               cell === '❌' ? <span className="pitch-cross">{cell}</span> : cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Pricing */}
            {slide.type === 'pricing' && (
              <>
                <h2 className="pitch-title" style={{ textAlign: 'center' }}>{slide.title}</h2>
                <p className="pitch-subtitle" style={{ textAlign: 'center' }}>{slide.subtitle}</p>
                <div className="pitch-pricing">
                  {slide.tiers.map((tier, idx) => (
                    <div key={idx} className={`pitch-tier ${idx === 1 ? 'pitch-tier--popular' : ''}`} style={{ animationDelay: `${idx * 0.1}s` }}>
                      {idx === 1 && <div className="pitch-tier__badge">POPÜLER</div>}
                      <div className="pitch-tier__name">{tier.name}</div>
                      <div className="pitch-tier__price">{tier.price}</div>
                      <div className="pitch-tier__desc">{tier.desc}</div>
                    </div>
                  ))}
                </div>
                <div className="pitch-pricing-extra">{slide.extra}</div>
              </>
            )}

            {/* Roadmap */}
            {slide.type === 'roadmap' && (
              <>
                <h2 className="pitch-title" style={{ textAlign: 'center' }}>{slide.title}</h2>
                <div className="pitch-roadmap">
                  <div className="pitch-roadmap__line" />
                  {slide.items.map((item, idx) => (
                    <div key={idx} className="pitch-roadmap__item" style={{ animationDelay: `${idx * 0.1}s` }}>
                      <div className="pitch-roadmap__dot">{item.status}</div>
                      <div className="pitch-roadmap__content">
                        <div className="pitch-roadmap__date">{item.date}</div>
                        <div className="pitch-roadmap__title">{item.title}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Closing */}
            {slide.type === 'closing' && (
              <div className="pitch-closing">
                <h2 className="pitch-closing__title">{slide.title}</h2>
                <p className="pitch-closing__subtitle">{slide.subtitle}</p>
                <div className="pitch-closing__content">
                  <div className="pitch-closing__funds">
                    <div className="pitch-closing__funds-title">{slide.demand}</div>
                    <p className="pitch-closing__funds-label">Fon Kullanımı:</p>
                    {slide.funds.map((f, i) => (
                      <div key={i} className="pitch-fund-row">
                        <div className="pitch-fund-row__pct">{f.percent}</div>
                        <div className="pitch-fund-row__bar">
                          <div className="pitch-fund-row__fill" style={{ width: f.percent.replace('%', '') + '%' }} />
                        </div>
                        <div className="pitch-fund-row__label">{f.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="pitch-closing__contact">
                    <div className="pitch-contact-row">
                      <span className="pitch-contact-row__icon">�</span>
                      <span className="pitch-contact-row__text">İletişim: Batuhan Çelikkaya</span>
                    </div>
                    <div className="pitch-contact-row">
                      <span className="pitch-contact-row__icon">📧</span>
                      <span className="pitch-contact-row__text">E-posta: {slide.contact.email}</span>
                    </div>
                  </div>
                </div>
                <p className="pitch-closing__quote">{slide.quote}</p>
              </div>
            )}
          </div>

          {/* Progress Dots */}
          <div className="pitch-progress">
            {slideData.map((_, idx) => (
              <button
                key={idx}
                className={`pitch-dot ${currentSlide === idx ? 'pitch-dot--active' : 'pitch-dot--inactive'}`}
                onClick={() => goTo(idx)}
              />
            ))}
          </div>
        </div>
      </main>

      {/* Footer Controls */}
      <footer className="pitch-footer">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="pitch-footer__brand">
            <PlayCircle size={22} className="pitch-footer__brand-icon" />
            Vsonice Pitch
          </div>
          <span className="pitch-footer__info">| Slayt {currentSlide + 1} / {slideData.length}</span>
        </div>

        <div className="pitch-footer__controls">
          <button onClick={prevSlide} disabled={currentSlide === 0} className="pitch-btn pitch-btn--prev">
            <ChevronLeft size={22} />
          </button>
          <button onClick={nextSlide} disabled={currentSlide === slideData.length - 1} className="pitch-btn pitch-btn--next">
            <ChevronRight size={22} />
          </button>
          <div className="pitch-divider" />
          <button onClick={toggleFullscreen} className="pitch-btn pitch-btn--fullscreen" title="Tam Ekran">
            <Maximize size={18} />
          </button>
        </div>
      </footer>
    </div>
  );
}
