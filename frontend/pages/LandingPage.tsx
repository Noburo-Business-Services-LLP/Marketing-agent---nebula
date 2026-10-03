import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  CalendarCheck,
  Users,
  MessageCircle,
  Mail,
  Menu,
  X,
} from 'lucide-react';

/**
 * The public page for the Nebulaa app. It matches nebulaa.ai: a warm light
 * page, plain words, and the same two plans. It always shows the light look,
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
const WA = '#1FA855';

const WHATSAPP_NUMBER = '919384801049';
const waLink = (message = "Hi, I'd like to know more about Nebulaa.") =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

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
  <p
    style={{ ...body, color: CORAL_TEXT, letterSpacing: '0.16em' }}
    className="text-[12px] font-bold uppercase mb-4"
  >
    {children}
  </p>
);

const PLANS = [
  {
    name: 'Starter',
    price: 999,
    note: 'For one person getting started',
    features: [
      '60 credits a month',
      'A full month of posts, planned and posted',
      'New customers found for you',
      'WhatsApp, email and SMS enquiries answered',
      '1 team member',
    ],
  },
  {
    name: 'Professional',
    price: 1999,
    note: 'Most popular',
    popular: true,
    features: [
      '200 credits a month',
      'Everything in Starter',
      'More customers found each month',
      'Voice calls to your best leads',
      'Up to 5 team members',
    ],
  },
];

const THINGS = [
  {
    icon: CalendarCheck,
    tint: '#FFE3D0',
    title: 'Regular posts on your page',
    text: 'Posts, photos and offers go out all month. You do not have to remember.',
  },
  {
    icon: Users,
    tint: '#DCEBFA',
    title: 'New customers find you',
    text: 'We find people nearby who may buy from you, and contact them for you.',
  },
  {
    icon: MessageCircle,
    tint: '#DDF2E6',
    title: 'Quick replies to every message',
    text: 'WhatsApp, email and SMS messages get a reply in minutes, at any hour.',
  },
];

const STEPS = [
  { title: 'Sign up', text: 'Create your account and tell us about your business.' },
  { title: 'We make a month of posts', text: 'Photos, posts and reels for your customers. You approve them on your phone.' },
  { title: 'Customers message you', text: 'New enquiries reach you with a reply already sent.' },
];

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showContact, setShowContact] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const signUp = () => navigate('/login?mode=signup');
  const signIn = () => navigate('/login');

  return (
    <div className="min-h-screen overflow-x-hidden antialiased" style={{ ...body, background: GROUND, color: INK }}>
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
              <a href="#what-you-get" className="hover:opacity-70">What you get</a>
              <a href="#how-it-works" className="hover:opacity-70">How it works</a>
              <a href="#pricing" className="hover:opacity-70">Pricing</a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <button onClick={signIn} className="px-4 py-2.5 text-[14px] font-semibold hover:opacity-70" style={{ color: INK }}>
                Sign in
              </button>
              <button
                onClick={signUp}
                className="px-5 py-2.5 text-[14px] font-bold rounded-full transition-transform hover:scale-[1.03]"
                style={{ background: '#F5A623', color: INK, boxShadow: '0 6px 18px rgba(245,166,35,0.35)' }}
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
              {[['What you get', '#what-you-get'], ['How it works', '#how-it-works'], ['Pricing', '#pricing']].map(([label, href]) => (
                <a key={href} href={href} onClick={() => setMenuOpen(false)} className="py-2.5">{label}</a>
              ))}
              <div className="flex gap-3 pt-2">
                <button onClick={signIn} className="flex-1 py-3 rounded-full border-[1.5px] font-semibold" style={{ borderColor: INK }}>Sign in</button>
                <button onClick={signUp} className="flex-1 py-3 rounded-full font-bold" style={{ background: '#F5A623', color: INK }}>Start free</button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative isolate pt-[120px] pb-16 md:pt-[150px] md:pb-24 overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60% 80% at 92% 8%, rgba(255,203,46,0.55) 0%, rgba(255,203,46,0) 62%), radial-gradient(55% 70% at 100% 100%, rgba(238,99,48,0.26) 0%, rgba(238,99,48,0) 66%), linear-gradient(180deg, #FBF5EA 0%, #FFEBD6 100%)',
          }}
        />
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[760px]">
            <p style={{ color: CORAL_TEXT, letterSpacing: '0.16em' }} className="text-[12px] font-bold uppercase mb-5">
              For hotels, shops, showrooms and small businesses
            </p>
            <h1 style={display} className="text-[46px] sm:text-[66px] lg:text-[88px] mb-6">
              We do your marketing.
              <br />
              <span style={script} className="text-[1.12em] leading-none">You get customers.</span>
            </h1>
            <p className="text-[17px] sm:text-[20px] leading-[1.55] mb-8 max-w-[560px]" style={{ color: INK2 }}>
              We post on your Instagram and Facebook, find new customers for you, and reply to every WhatsApp message within minutes.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <button
                onClick={signUp}
                className="group inline-flex items-center gap-2 px-8 py-4 rounded-full text-[15px] font-bold transition-transform hover:scale-[1.03]"
                style={{ background: '#F5A623', color: INK, boxShadow: '0 6px 18px rgba(245,166,35,0.35)' }}
              >
                Start free for 7 days
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
              <a
                href={waLink()}
                className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full text-[15px] font-bold text-white transition-transform hover:scale-[1.03]"
                style={{ background: WA, boxShadow: '0 6px 18px rgba(31,168,85,0.32)' }}
              >
                WhatsApp us
              </a>
            </div>
            <p className="text-[13.5px]" style={{ color: MUTED }}>From ₹999 a month · No card to start · Set up in a day</p>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section id="what-you-get" className="py-[72px] md:py-[96px]">
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[720px] mb-11">
            <Label>What you get</Label>
            <h2 style={display} className="text-[34px] md:text-[52px]">
              What we do <Swash>for you every month.</Swash>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {THINGS.map(({ icon: Icon, tint, title, text }) => (
              <div key={title} className="rounded-[24px] p-7" style={{ background: SURFACE, border: `1px solid ${RULE}`, boxShadow: '0 14px 34px rgba(20,32,58,0.08)' }}>
                <span className="w-12 h-12 rounded-full flex items-center justify-center mb-5" style={{ background: tint }}>
                  <Icon className="w-5 h-5" style={{ color: INK }} />
                </span>
                <h3 className="text-[20px] font-bold leading-tight mb-2">{title}</h3>
                <p className="text-[15px] leading-[1.6]" style={{ color: INK2 }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-[72px] md:py-[96px]" style={{ background: SURFACE2 }}>
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[720px] mb-11">
            <Label>How it works</Label>
            <h2 style={display} className="text-[34px] md:text-[52px]">
              How it works <Swash>in three steps.</Swash>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex gap-4">
                <span className="flex-shrink-0 w-9 h-9 rounded-full text-[15px] font-extrabold flex items-center justify-center" style={{ background: INK, color: GROUND }}>
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[19px] font-bold leading-tight mb-1.5">{s.title}</h3>
                  <p className="text-[15px] leading-[1.6]" style={{ color: INK2 }}>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-[72px] md:py-[96px]">
        <div className="max-w-6xl mx-auto px-5 md:px-6">
          <div className="max-w-[720px] mb-11">
            <Label>Pricing</Label>
            <h2 style={display} className="text-[34px] md:text-[52px] mb-5">
              Two plans. <Swash>Start from ₹999.</Swash>
            </h2>
            <p className="text-[16.5px] leading-[1.6]" style={{ color: INK2 }}>
              Both plans do everything: posts, new customers and WhatsApp replies. The bigger plan just gives you more each month.
              Running low on credits? Top up any time from inside the app.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-[860px]">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                className="rounded-[26px] p-8 flex flex-col"
                style={{
                  background: SURFACE,
                  border: plan.popular ? `2px solid #F5A623` : `1px solid ${RULE}`,
                  boxShadow: '0 14px 34px rgba(20,32,58,0.08)',
                }}
              >
                <p style={{ color: CORAL_TEXT, letterSpacing: '0.14em' }} className="text-[12px] font-bold uppercase mb-3">
                  {plan.name}{plan.popular ? ' · Most popular' : ''}
                </p>
                <p className="mb-1">
                  <span style={display} className="text-[48px]">₹{plan.price.toLocaleString('en-IN')}</span>
                  <span className="text-[14px] ml-1" style={{ color: MUTED }}>/month</span>
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
                  style={plan.popular ? { background: '#F5A623', color: INK, boxShadow: '0 6px 18px rgba(245,166,35,0.35)' } : { border: `1.5px solid ${INK}`, color: INK }}
                >
                  Start with {plan.name}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[13.5px] mt-6" style={{ color: MUTED }}>7-day free trial · No card to start</p>
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
          <h2 style={display} className="text-[38px] md:text-[64px] mb-5">
            Try it free
            <br />
            <span style={script} className="text-[1.15em] leading-none">for 7 days.</span>
          </h2>
          <p className="text-[17px] md:text-[18px] leading-[1.6] max-w-[500px] mb-8" style={{ color: INK2 }}>
            Sign up, connect your page and see your first month of posts. No card needed.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={signUp}
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-full text-[15px] font-bold transition-transform hover:scale-[1.03]"
              style={{ background: '#F5A623', color: INK, boxShadow: '0 6px 18px rgba(245,166,35,0.35)' }}
            >
              Start free
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
            <a
              href={waLink()}
              className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full text-[15px] font-bold text-white transition-transform hover:scale-[1.03]"
              style={{ background: WA, boxShadow: '0 6px 18px rgba(31,168,85,0.32)' }}
            >
              WhatsApp us
            </a>
          </div>
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

      {/* Contact */}
      {showContact && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(20,32,58,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setShowContact(false)}>
          <div className="rounded-2xl p-8 shadow-2xl max-w-sm mx-4 text-center" style={{ background: SURFACE }} onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#FFE3D0' }}>
              <Mail className="w-6 h-6" style={{ color: CORAL }} />
            </div>
            <h3 className="text-xl font-bold mb-2">Contact us</h3>
            <p className="text-sm mb-4" style={{ color: MUTED }}>Write to us any time, or message us on WhatsApp.</p>
            <a href="mailto:support@nebulaa.ai" className="font-bold text-lg hover:opacity-70 block mb-2" style={{ color: INK }}>
              support@nebulaa.ai
            </a>
            <a href={waLink()} className="font-semibold text-[15px] hover:opacity-70" style={{ color: WA }}>
              WhatsApp +91 93848 01049
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
