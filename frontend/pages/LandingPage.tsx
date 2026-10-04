import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Check,
  PenLine,
  ImageIcon,
  Clapperboard,
  CalendarDays,
  MessageCircle,
  Radar,
  Mail,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';
import { SHOWCASE_SLIDES } from '../components/onboarding/showcaseData';

/**
 * The public page for the Nebulaa app. Everything here leads to one action:
 * sign up and start with 100 free Quarks. It always shows the light, warm look,
 * whatever theme the signed-in app uses.
 */

const INK = '#14203A';
const INK2 = '#33405C';
const MUTED = '#6D6250';
const GROUND = '#FBF5EA';
const SURFACE = '#FFFDF8';
const SURFACE2 = '#F3E8D4';
const RULE = '#E5D8BF';
const CORAL = '#EE6330';
const CORAL_TEXT = '#C4471A';
const SUN = '#FFCB2E';
const GOLD = '#F5A623';

const display: React.CSSProperties = {
  fontFamily: "'Archivo', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  textTransform: 'uppercase',
  fontWeight: 800,
  letterSpacing: '-0.01em',
  lineHeight: 1.02,
};
const script: React.CSSProperties = {
  fontFamily: "'Kaushan Script', 'Brush Script MT', cursive",
  textTransform: 'none',
  fontWeight: 400,
  letterSpacing: 0,
  color: '#D07A00',
};
const body: React.CSSProperties = {
  fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif",
};

/** A headline word with the yellow highlighter swash behind it. */
const Swash: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      backgroundImage: `linear-gradient(transparent 62%, ${SUN} 62%, ${SUN} 94%, transparent 94%)`,
      padding: '0 0.08em',
    }}
  >
    {children}
  </span>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ ...body, color: CORAL_TEXT, letterSpacing: '0.16em' }} className="text-[12px] font-bold uppercase mb-4">
    {children}
  </p>
);

/** Posts shown in the hero and in the "made with Nebulaa" grid. */
const pick = (label: string, n = 0) => SHOWCASE_SLIDES.filter(s => s.label === label)[n];
const HERO_POSTS = [pick('Hotels & stays', 0), pick('Jewellery & retail'), pick('Food & FMCG', 0)].filter(Boolean);
const GRID_POSTS = [
  pick('Textiles & apparel', 0),
  pick('Real estate', 0),
  pick('Automobiles', 0),
  pick('Hotels & stays', 2),
  pick('Financial services', 0),
  pick('Furniture & appliances', 0),
  pick('Food & FMCG', 1),
  pick('Industrial & B2B', 0),
].filter(Boolean);

const PAINS = [
  { title: 'You do not know what to write.', text: 'Every post needs an idea, a caption and the right words.' },
  { title: 'Good photos and videos cost money.', text: 'A designer or an agency for every offer and festival adds up fast.' },
  { title: 'Customers wait while you work.', text: 'Messages come in when you are busy with the shop or the guests.' },
];

const TOOLS = [
  { icon: PenLine, tint: '#FFE3D0', title: 'Captions', text: 'Written in English, Tamil, Hindi, Telugu and more. You choose the language.' },
  { icon: ImageIcon, tint: '#DCEBFA', title: 'Images and posters', text: 'For offers, festivals and new products. Your name, colours and style on every one.' },
  { icon: Clapperboard, tint: '#ECE6FB', title: 'Reels and videos', text: 'Short videos for Instagram and Facebook, made from a one-line idea.' },
  { icon: CalendarDays, tint: '#DDF2E6', title: 'A plan for the whole month', text: 'Every post on a calendar, built around your festivals and offers.' },
  { icon: MessageCircle, tint: '#DDF2E6', title: 'Replies to customers (add-on)', text: 'Reply drafts for WhatsApp, email and SMS enquiries, ready in minutes. Available as an add-on.' },
  { icon: Radar, tint: '#FFE3D0', title: 'What others are posting (add-on)', text: 'See what businesses like yours post, and what works for them. Available as an add-on.' },
];

const STEPS = [
  { title: 'Sign up', text: 'It takes one minute.' },
  { title: 'Answer a few simple questions', text: 'Add your website if you have one and Nebulaa fills in most of it. Pick your language.' },
  { title: 'Approve your month', text: 'Check each post on your phone, change what you like, and post.' },
];

const PLANS = [
  {
    name: 'Starter',
    price: 999,
    note: 'For one person getting started',
    features: ['2,100 Quarks a month', '30 image posts and 1 Hero video a month', '1 team member'],
  },
  {
    name: 'Professional',
    price: 1999,
    note: 'For more posts and more people',
    popular: true,
    features: ['3,500 Quarks a month', 'Everything in Starter', '2 Hero videos a month', 'Extra captions', 'Up to 5 team members'],
  },
];

const FAQS = [
  { q: 'Do I need design or writing skills?', a: 'No. Nebulaa writes the captions and makes the images and videos. You only check them and press approve.' },
  { q: 'Which languages does it write in?', a: 'English, Tamil, Hindi, Telugu, Kannada, Malayalam and more. You choose when you sign up and can change it any time.' },
  { q: 'Do I need a website?', a: 'No. If you have one, add it and Nebulaa fills in most of your details. If you do not, answer a few simple questions.' },
  { q: 'Where do my posts go?', a: 'You connect your Instagram, Facebook and other pages with the Publish and schedule add-on. A post goes out only after you approve it.' },
  { q: 'What are Quarks?', a: 'Quarks are what the app uses each time it makes something for you. An image post uses 20, a caption uses 1 and a Hero video uses 729. Running low? Add more any time from inside the app.' },
  { q: 'What happens when my 100 free Quarks are used?', a: 'Your 100 Quarks stay with you until you use them. The plans are optional, and nothing is charged unless you choose one.' },
];

const CtaButton: React.FC<{ onClick: () => void; children: React.ReactNode; className?: string }> = ({ onClick, children, className = '' }) => (
  <button
    onClick={onClick}
    className={`group inline-flex items-center justify-center gap-2 rounded-full font-bold transition-transform hover:scale-[1.03] active:scale-[0.98] ${className}`}
    style={{ background: GOLD, color: INK, boxShadow: '0 8px 22px rgba(245,166,35,0.38)' }}
  >
    {children}
    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
  </button>
);

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showContact, setShowContact] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
      setPastHero(window.scrollY > 520);
    };
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const signUp = () => navigate('/login?mode=signup');
  const signIn = () => navigate('/login');

  return (
    <div className="min-h-screen overflow-x-hidden antialiased pb-20 md:pb-0" style={{ ...body, background: GROUND, color: INK }}>
      <style>{`
        @keyframes nb-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
        .nb-float { animation: nb-float 5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .nb-float { animation: none; } }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
        details[open] .nb-chev { transform: rotate(180deg); }
      `}</style>

      {/* Navigation */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={scrolled || menuOpen ? { background: 'rgba(251,245,234,0.94)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${RULE}` } : undefined}
      >
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="flex items-center justify-between h-[72px]">
            <a href="/" className="flex items-center" aria-label="Nebulaa">
              <img src="/assets/logo-nebulaa.png" alt="Nebulaa" className="h-[46px] w-auto" />
            </a>

            <div className="hidden md:flex items-center gap-9 text-[14.5px] font-medium" style={{ color: INK2 }}>
              <a href="#what-it-makes" className="hover:opacity-70">What it makes</a>
              <a href="#how-it-works" className="hover:opacity-70">How it works</a>
              <a href="#pricing" className="hover:opacity-70">Pricing</a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <button onClick={signIn} className="px-4 py-2.5 text-[14px] font-semibold hover:opacity-70">Sign in</button>
              <button
                onClick={signUp}
                className="px-5 py-2.5 text-[14px] font-bold rounded-full transition-transform hover:scale-[1.03]"
                style={{ background: GOLD, color: INK, boxShadow: '0 6px 18px rgba(245,166,35,0.35)' }}
              >
                Start free
              </button>
            </div>

            <button className="md:hidden p-2" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
              {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {menuOpen && (
            <div className="md:hidden pb-5 flex flex-col gap-1 text-[16px] font-medium">
              {[['What it makes', '#what-it-makes'], ['How it works', '#how-it-works'], ['Pricing', '#pricing']].map(([label, href]) => (
                <a key={href} href={href} onClick={() => setMenuOpen(false)} className="py-2.5">{label}</a>
              ))}
              <div className="flex gap-3 pt-2">
                <button onClick={signIn} className="flex-1 py-3 rounded-full border-[1.5px] font-semibold" style={{ borderColor: INK }}>Sign in</button>
                <button onClick={signUp} className="flex-1 py-3 rounded-full font-bold" style={{ background: GOLD, color: INK }}>Start free</button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative isolate pt-[112px] pb-14 md:pt-[140px] md:pb-24 overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60% 80% at 92% 8%, rgba(255,203,46,0.55) 0%, rgba(255,203,46,0) 62%), radial-gradient(55% 70% at 100% 100%, rgba(238,99,48,0.26) 0%, rgba(238,99,48,0) 66%), linear-gradient(180deg, #FBF5EA 0%, #FFEBD6 100%)',
          }}
        />
        <div className="max-w-6xl mx-auto px-5 md:px-6 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
          <div>
            <p style={{ color: CORAL_TEXT, letterSpacing: '0.16em' }} className="text-[12px] font-bold uppercase mb-5">
              For shops, hotels, restaurants and small businesses
            </p>
            <h1 style={display} className="text-[44px] sm:text-[62px] lg:text-[76px] mb-6">
              Your month of posts
              <br />
              <span style={script} className="text-[1.12em] leading-none">ready in minutes.</span>
            </h1>
            <p className="text-[17px] sm:text-[19px] leading-[1.6] mb-8 max-w-[520px]" style={{ color: INK2 }}>
              Tell Nebulaa about your business once. It writes the captions, makes the images and videos, and plans every post. You check them and post.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <CtaButton onClick={signUp} className="px-8 py-4 text-[15.5px]">Start with 100 free Quarks</CtaButton>
              <a
                href="#how-it-works"
                className="inline-flex items-center px-7 py-[14px] rounded-full text-[15px] font-bold transition-transform hover:scale-[1.03]"
                style={{ border: `1.5px solid ${INK}` }}
              >
                See how it works
              </a>
            </div>
            <p className="text-[13.5px] mb-6" style={{ color: MUTED }}>Set up in 3 minutes.</p>
            <p className="max-w-[460px] border-l-2 pl-3 text-[13.5px] leading-[1.5]" style={{ borderColor: 'rgba(238,99,48,0.5)', color: INK2 }}>
              Built on real experience with 2,000+ MSMEs and startups.
            </p>
          </div>

          {/* Posts made by the app */}
          <div className="relative mx-auto w-full max-w-[470px] h-[300px] sm:h-[400px] lg:h-[470px]" aria-hidden="true">
            {HERO_POSTS[1] && (
              <img src={HERO_POSTS[1].src} alt="" className="absolute left-0 top-[8%] w-[48%] rounded-[18px] shadow-[0_18px_40px_rgba(20,32,58,0.22)] border-4 border-white -rotate-6" />
            )}
            {HERO_POSTS[2] && (
              <img src={HERO_POSTS[2].src} alt="" className="absolute right-0 top-0 w-[46%] rounded-[18px] shadow-[0_18px_40px_rgba(20,32,58,0.22)] border-4 border-white rotate-6" />
            )}
            {HERO_POSTS[0] && (
              <img src={HERO_POSTS[0].src} alt="Sample post made with Nebulaa" className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[60%] rounded-[22px] shadow-[0_24px_54px_rgba(20,32,58,0.3)] border-[5px] border-white" />
            )}
            <span className="nb-float absolute left-[2%] bottom-[22%] inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-bold shadow-lg" style={{ color: INK }}>
              <Check className="w-3.5 h-3.5" style={{ color: '#1FA855' }} strokeWidth={3} /> Caption written
            </span>
            <span className="nb-float absolute right-[0%] bottom-[34%] inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-bold shadow-lg" style={{ color: INK, animationDelay: '1.2s' }}>
              <Check className="w-3.5 h-3.5" style={{ color: '#1FA855' }} strokeWidth={3} /> Image made
            </span>
          </div>
        </div>
      </section>

      {/* Proof: posts made with the app */}
      <section className="py-[64px] md:py-[88px]">
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[640px] mb-9">
            <Label>Made with Nebulaa</Label>
            <h2 style={display} className="text-[32px] md:text-[48px]">
              Posts for <Swash>every kind of business.</Swash>
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
            {GRID_POSTS.map(s => (
              <figure key={s.src} className="m-0">
                <img src={s.src} alt={`A ${s.label.toLowerCase()} post made with Nebulaa`} loading="lazy" className="w-full aspect-square object-cover rounded-[18px]" style={{ border: `1px solid ${RULE}`, boxShadow: '0 12px 28px rgba(20,32,58,0.1)' }} />
                <figcaption className="mt-2.5 text-[13px] font-semibold" style={{ color: INK2 }}>{s.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* The problem */}
      <section className="py-[64px] md:py-[88px]" style={{ background: SURFACE2 }}>
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[720px] mb-10">
            <Label>Sound familiar?</Label>
            <h2 style={display} className="text-[32px] md:text-[48px]">
              Posting every day takes <Swash>more time than you have.</Swash>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5 mb-8">
            {PAINS.map(p => (
              <div key={p.title} className="rounded-[22px] p-6" style={{ background: SURFACE, border: `1px solid ${RULE}` }}>
                <h3 className="text-[18px] font-bold leading-tight mb-2">{p.title}</h3>
                <p className="text-[15px] leading-[1.6]" style={{ color: INK2 }}>{p.text}</p>
              </div>
            ))}
          </div>
          <p className="text-[18px] md:text-[20px] font-semibold max-w-[640px]">Nebulaa makes the first version of all of it. You check it and post.</p>
        </div>
      </section>

      {/* What it makes */}
      <section id="what-it-makes" className="py-[72px] md:py-[96px]">
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[720px] mb-11">
            <Label>What it makes</Label>
            <h2 style={display} className="text-[32px] md:text-[48px]">
              Everything for your posts, <Swash>in one app.</Swash>
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {TOOLS.map(({ icon: Icon, tint, title, text }) => (
              <div key={title} className="rounded-[24px] p-7" style={{ background: SURFACE, border: `1px solid ${RULE}`, boxShadow: '0 14px 34px rgba(20,32,58,0.07)' }}>
                <span className="w-12 h-12 rounded-full flex items-center justify-center mb-5" style={{ background: tint }}>
                  <Icon className="w-5 h-5" style={{ color: INK }} />
                </span>
                <h3 className="text-[19px] font-bold leading-tight mb-2">{title}</h3>
                <p className="text-[15px] leading-[1.6]" style={{ color: INK2 }}>{text}</p>
              </div>
            ))}
          </div>
          <div className="mt-10"><CtaButton onClick={signUp} className="px-8 py-4 text-[15.5px]">Get started</CtaButton></div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-[72px] md:py-[96px]" style={{ background: SURFACE2 }}>
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[720px] mb-11">
            <Label>How it works</Label>
            <h2 style={display} className="text-[32px] md:text-[48px]">
              Start in <Swash>three steps.</Swash>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex gap-4">
                <span className="flex-shrink-0 w-10 h-10 rounded-full text-[16px] font-extrabold flex items-center justify-center" style={{ background: INK, color: GROUND }}>
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[19px] font-bold leading-tight mb-1.5">{s.title}</h3>
                  <p className="text-[15px] leading-[1.6]" style={{ color: INK2 }}>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10"><CtaButton onClick={signUp} className="px-8 py-4 text-[15.5px]">Start with 100 free Quarks</CtaButton></div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-[72px] md:py-[96px]">
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[720px] mb-11">
            <Label>Pricing</Label>
            <h2 style={display} className="text-[32px] md:text-[48px] mb-5">
              Two plans. <Swash>Start from ₹999.</Swash>
            </h2>
            <p className="text-[16.5px] leading-[1.6]" style={{ color: INK2 }}>
              Prices are per month plus GST. Both plans do the same things. The bigger plan gives you more Quarks each month. Publishing, competitor insights and replies are add-ons.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-[860px]">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                className="rounded-[26px] p-8 flex flex-col"
                style={{ background: SURFACE, border: plan.popular ? `2px solid ${GOLD}` : `1px solid ${RULE}`, boxShadow: '0 14px 34px rgba(20,32,58,0.08)' }}
              >
                <p style={{ color: CORAL_TEXT, letterSpacing: '0.14em' }} className="text-[12px] font-bold uppercase mb-3">
                  {plan.name}{plan.popular ? ' · Most popular' : ''}
                </p>
                <p className="mb-1">
                  <span style={display} className="text-[48px]">₹{plan.price.toLocaleString('en-IN')}</span>
                  <span className="text-[14px] ml-1" style={{ color: MUTED }}>/month + GST</span>
                </p>
                <p className="text-[14px] mb-6" style={{ color: MUTED }}>{plan.note}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-3 text-[14.5px]" style={{ color: INK2 }}>
                      <CheckCircle2 className="w-4 h-4 mt-[3px] shrink-0" style={{ color: '#9A5B00' }} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={signUp}
                  className="w-full py-3.5 rounded-full text-[15px] font-bold transition-transform hover:scale-[1.02]"
                  style={plan.popular ? { background: GOLD, color: INK, boxShadow: '0 6px 18px rgba(245,166,35,0.35)' } : { border: `1.5px solid ${INK}`, color: INK }}
                >
                  Get started with {plan.name}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Questions */}
      <section className="pb-[72px] md:pb-[96px]">
        <div className="max-w-3xl mx-auto px-5 md:px-6">
          <div className="mb-8">
            <Label>Questions</Label>
            <h2 style={display} className="text-[32px] md:text-[44px]">Common <Swash>questions.</Swash></h2>
          </div>
          <div className="divide-y" style={{ borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}`, borderColor: RULE }}>
            {FAQS.map(f => (
              <details key={f.q} className="group py-4">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-[16.5px] font-bold">
                  {f.q}
                  <ChevronDown className="nb-chev w-5 h-5 flex-shrink-0 transition-transform" />
                </summary>
                <p className="mt-3 text-[15px] leading-[1.65] max-w-[620px]" style={{ color: INK2 }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="px-5 md:px-6 pb-16 md:pb-24">
        <div
          className="max-w-6xl mx-auto rounded-[32px] md:rounded-[40px] px-7 md:px-14 py-14 md:py-20"
          style={{
            border: `1px solid ${RULE}`,
            background:
              'radial-gradient(60% 90% at 95% 0%, rgba(255,203,46,0.6) 0%, rgba(255,203,46,0) 62%), radial-gradient(60% 80% at 100% 100%, rgba(238,99,48,0.3) 0%, rgba(238,99,48,0) 66%), linear-gradient(160deg, #FFF3E0 0%, #FFE2C4 100%)',
          }}
        >
          <h2 style={display} className="text-[36px] md:text-[60px] mb-5 max-w-[760px]">
            Your first month of posts is
            <br />
            <span style={script} className="text-[1.15em] leading-none">3 minutes away.</span>
          </h2>
          <p className="text-[17px] md:text-[18px] leading-[1.6] max-w-[500px] mb-8" style={{ color: INK2 }}>
            Sign up, answer a few questions and see your posts. Start with 100 free Quarks to explore.
          </p>
          <CtaButton onClick={signUp} className="px-9 py-4 text-[16px]">Start with 100 free Quarks</CtaButton>
          <p className="mt-5 text-[14px]" style={{ color: INK2 }}>
            Already have an account?{' '}
            <button onClick={signIn} className="font-bold underline underline-offset-2">Sign in</button>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10" style={{ borderTop: `1px solid ${RULE}` }}>
        <div className="max-w-6xl mx-auto px-5 md:px-6 flex flex-col md:flex-row items-center justify-between gap-5">
          <img src="/assets/logo-nebulaa.png" alt="Nebulaa" className="h-[40px] w-auto" />
          <div className="flex items-center gap-8 text-[14px]" style={{ color: INK2 }}>
            <a href="/#/privacy-policy" className="hover:opacity-70">Privacy</a>
            <a href="/#/terms" className="hover:opacity-70">Terms</a>
            <button onClick={() => setShowContact(true)} className="hover:opacity-70">Contact</button>
          </div>
          <p className="text-[13px]" style={{ color: MUTED }}>© {new Date().getFullYear()} Nebulaa. All rights reserved.</p>
        </div>
      </footer>

      {/* Sign-up bar for phones */}
      <div
        className={`md:hidden fixed bottom-0 inset-x-0 z-40 px-4 pt-3 transition-transform duration-300 ${pastHero ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ background: 'linear-gradient(to top, #FBF5EA 60%, rgba(251,245,234,0))', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={signUp}
          className="w-full flex items-center justify-center gap-2 rounded-full py-3.5 text-[15.5px] font-bold"
          style={{ background: GOLD, color: INK, boxShadow: '0 8px 22px rgba(245,166,35,0.45)' }}
        >
          Start with 100 free Quarks <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Contact */}
      {showContact && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(20,32,58,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setShowContact(false)}>
          <div className="rounded-2xl p-8 shadow-2xl max-w-sm mx-4 text-center" style={{ background: SURFACE }} onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#FFE3D0' }}>
              <Mail className="w-6 h-6" style={{ color: CORAL }} />
            </div>
            <h3 className="text-xl font-bold mb-2">Contact us</h3>
            <p className="text-sm mb-4" style={{ color: MUTED }}>Write to us any time.</p>
            <a href="mailto:support@nebulaa.ai" className="font-bold text-lg hover:opacity-70" style={{ color: INK }}>
              support@nebulaa.ai
            </a>
            <button onClick={() => setShowContact(false)} className="mt-6 block w-full py-2.5 rounded-full font-semibold" style={{ background: INK, color: GROUND }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
