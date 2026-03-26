import React, { useState, useEffect, useRef } from 'react';
import { CreditCard, ArrowRight, CheckCircle, Loader2, ExternalLink, BarChart3, Bot, Megaphone, Users, Target, Globe, Shield } from 'lucide-react';
import { apiService } from '../services/api';

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface TrialExpiredProps {
  reason: 'time' | 'credits' | 'migrated';
  daysUsed?: number;
  creditsUsed?: number;
  onLogout: () => void;
}

/* ───── Starfield Canvas ───── */
const StarfieldCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    // Generate stars
    const stars = Array.from({ length: 220 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.3,
      speed: Math.random() * 0.15 + 0.02,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
    }));

    // Shooting stars
    const shootingStars: { x: number; y: number; len: number; speed: number; opacity: number; angle: number }[] = [];
    const maybeSpawn = () => {
      if (Math.random() < 0.003 && shootingStars.length < 2) {
        shootingStars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height * 0.4,
          len: Math.random() * 80 + 40,
          speed: Math.random() * 6 + 4,
          opacity: 1,
          angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3,
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Stars
      for (const s of stars) {
        s.twinkle += s.twinkleSpeed;
        const alpha = 0.4 + Math.sin(s.twinkle) * 0.35;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 245, 225, ${alpha})`;
        ctx.fill();
        s.y += s.speed;
        if (s.y > canvas.height + 2) { s.y = -2; s.x = Math.random() * canvas.width; }
      }

      // Shooting stars
      maybeSpawn();
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const ss = shootingStars[i];
        const dx = Math.cos(ss.angle) * ss.len;
        const dy = Math.sin(ss.angle) * ss.len;
        const grad = ctx.createLinearGradient(ss.x, ss.y, ss.x - dx, ss.y - dy);
        grad.addColorStop(0, `rgba(255, 204, 41, ${ss.opacity})`);
        grad.addColorStop(1, 'rgba(255, 204, 41, 0)');
        ctx.beginPath();
        ctx.moveTo(ss.x, ss.y);
        ctx.lineTo(ss.x - dx, ss.y - dy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ss.x += Math.cos(ss.angle) * ss.speed;
        ss.y += Math.sin(ss.angle) * ss.speed;
        ss.opacity -= 0.008;
        if (ss.opacity <= 0) shootingStars.splice(i, 1);
      }

      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
};

/* ───── Glass Card ───── */
const GlassCard: React.FC<{ children: React.ReactNode; highlighted?: boolean; className?: string }> = ({ children, highlighted, className = '' }) => (
  <div className={`
    relative rounded-3xl p-[1px] transition-all duration-500
    ${highlighted
      ? 'bg-gradient-to-b from-[#ffcc29]/50 via-[#ffcc29]/15 to-transparent shadow-2xl shadow-[#ffcc29]/10'
      : 'bg-gradient-to-b from-white/10 via-white/5 to-transparent'
    }
    ${className}
  `}>
    <div className={`
      rounded-3xl h-full
      ${highlighted
        ? 'bg-gradient-to-b from-[#0f1520]/90 via-[#0a0e18]/95 to-[#060910]/95'
        : 'bg-gradient-to-b from-[#0d1219]/85 via-[#080c14]/90 to-[#060910]/90'
      }
      backdrop-blur-xl
    `}>
      {children}
    </div>
  </div>
);

const TrialExpired: React.FC<TrialExpiredProps> = ({ reason, daysUsed = 7, onLogout }) => {
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const price = 7500;
  const credits = 1000;

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');

    try {
      const orderData = await apiService.createPaymentOrder(price);
      if (!orderData.success) throw new Error(orderData.message || 'Failed to create order');

      const options = {
        key: orderData.key,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'Nebulaa',
        description: `${credits} Credits — ₹${price.toLocaleString('en-IN')}`,
        order_id: orderData.order.id,
        prefill: orderData.prefill,
        theme: { color: '#ffcc29', backdrop_color: 'rgba(7, 10, 18, 0.9)' },
        handler: async (response: any) => {
          setLoading(false);
          setMigrating(true);
          try {
            const verifyResult = await apiService.verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });
            if (verifyResult.success) { setSuccess(true); setMigrating(false); }
            else throw new Error(verifyResult.message || 'Verification failed');
          } catch (err: any) {
            setMigrating(false);
            setError(err.message || 'Payment verified but migration failed. Contact support.');
          }
        },
        modal: { ondismiss: () => { setLoading(false); } }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response: any) => {
        setLoading(false);
        setError(response.error?.description || 'Payment failed. Please try again.');
      });
      rzp.open();
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Something went wrong');
    }
  };

  /* ─── Shared background wrapper ─── */
  const SpaceBg: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 0%, #0d1525 0%, #070a12 50%, #030507 100%)' }}>
      <StarfieldCanvas />
      {/* Nebula clouds */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] rounded-full opacity-[0.06]" style={{ background: 'radial-gradient(circle, #5b3cc4, transparent 70%)' }} />
        <div className="absolute top-[10%] right-[5%] w-[500px] h-[500px] rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #ffcc29, transparent 70%)' }} />
        <div className="absolute bottom-[5%] left-[10%] w-[700px] h-[500px] rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #1e6091, transparent 65%)' }} />
        <div className="absolute bottom-[-15%] right-[20%] w-[550px] h-[550px] rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #8b3a62, transparent 70%)' }} />
      </div>
      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(3,5,7,0.7) 100%)' }} />
      <div className="relative z-10 flex items-center justify-center min-h-screen p-4 md:p-6">
        {children}
      </div>
    </div>
  );

  // ─── Already migrated state ───
  if (reason === 'migrated') {
    return (
      <SpaceBg>
        <div className="max-w-lg w-full">
          <GlassCard highlighted>
            <div className="p-8 md:p-10 text-center">
              <div className="mx-auto w-20 h-20 bg-[#ffcc29]/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-[#ffcc29]/20">
                <CheckCircle className="w-10 h-10 text-[#ffcc29]" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">Account Activated!</h1>
              <p className="text-[#ededed]/55 text-base mb-8">
                Your data has been migrated to production. Log in on the production app with the same credentials.
              </p>
              <a href="https://gravity.nebulaa.ai" target="_blank" rel="noopener noreferrer"
                className="w-full py-4 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] font-bold text-lg rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#ffcc29]/20">
                Go to Gravity Production <ExternalLink className="w-5 h-5" />
              </a>
              <p className="text-[#ededed]/30 text-xs mt-4">gravity.nebulaa.ai — your credits are ready</p>
              <button onClick={onLogout} className="text-[#ededed]/25 hover:text-[#ededed]/50 text-sm transition-colors underline mt-6">
                Log out
              </button>
            </div>
          </GlassCard>
        </div>
      </SpaceBg>
    );
  }

  // ─── Success state ───
  if (success) {
    return (
      <SpaceBg>
        <div className="max-w-lg w-full">
          <GlassCard highlighted>
            <div className="p-8 md:p-10 text-center">
              <div className="mx-auto w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-green-500/20">
                <CheckCircle className="w-10 h-10 text-green-400" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">You're All Set! 🎉</h1>
              <p className="text-[#ededed]/55 text-base mb-8">
                Payment received & data migrated to production. Log in with the same email & password.
              </p>
              <a href="https://gravity.nebulaa.ai" target="_blank" rel="noopener noreferrer"
                className="w-full py-4 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] font-bold text-lg rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#ffcc29]/20">
                Go to Gravity Production <ExternalLink className="w-5 h-5" />
              </a>
              <p className="text-[#ededed]/30 text-xs mt-4">gravity.nebulaa.ai — your credits are ready</p>
            </div>
          </GlassCard>
        </div>
      </SpaceBg>
    );
  }

  // ─── Migrating state ───
  if (migrating) {
    return (
      <SpaceBg>
        <div className="max-w-lg w-full">
          <GlassCard>
            <div className="p-8 md:p-10 text-center">
              <Loader2 className="w-12 h-12 text-[#ffcc29] animate-spin mx-auto mb-6" />
              <h2 className="text-xl font-bold text-[#ededed] mb-2">Migrating Your Data...</h2>
              <p className="text-[#ededed]/45 text-sm">
                Transferring campaigns, analytics, brand assets and everything else. This takes a few seconds.
              </p>
            </div>
          </GlassCard>
        </div>
      </SpaceBg>
    );
  }

  // ─── Feature lists ───
  const features = [
    { icon: <Bot className="w-4 h-4" />, text: '1,000 credits loaded instantly on production' },
    { icon: <Target className="w-4 h-4" />, text: '+10 daily login bonus credits' },
    { icon: <Globe className="w-4 h-4" />, text: 'All your demo data migrated' },
    { icon: <Megaphone className="w-4 h-4" />, text: 'Campaign & content generation' },
    { icon: <Globe className="w-4 h-4" />, text: 'Multi-platform social posting' },
    { icon: <Users className="w-4 h-4" />, text: 'Competitor intelligence & tracking' },
    { icon: <BarChart3 className="w-4 h-4" />, text: 'Analytics & performance insights' },
  ];

  const FeatureRow: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
    <div className="flex items-center gap-3 py-1.5">
      <div className="text-[#ffcc29]/80 flex-shrink-0">{icon}</div>
      <span className="text-[#ededed]/65 text-[13px]">{text}</span>
    </div>
  );

  return (
    <SpaceBg>
      <div className="max-w-2xl w-full">
        {/* ── Header ── */}
        <div className="text-center mb-12">
          <img src="/assets/nebulaa-gold.png" alt="Nebulaa" className="w-28 h-28 mx-auto mb-6 drop-shadow-[0_0_25px_rgba(255,204,41,0.3)]" />

          <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-4 tracking-tight">
            {reason === 'time' ? 'Your Free Trial Has Ended' : 'Trial Credits Exhausted'}
          </h1>
          <p className="text-[#ededed]/40 text-base md:text-lg max-w-lg mx-auto leading-relaxed">
            {reason === 'time'
              ? `You explored Nebulaa Gravity for ${daysUsed} days. Buy credits to keep going.`
              : 'You\'ve used all 100 trial credits. Buy credits to continue with all your data intact.'}
          </p>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-8">
            <GlassCard>
              <div className="px-5 py-3 text-red-400 text-sm text-center">{error}</div>
            </GlassCard>
          </div>
        )}

        {/* ── Skeuomorphic Credit Card ── */}
        <div className="mb-10 relative group">
          {/* Outer glow */}
          <div className="absolute -inset-1 rounded-[28px] bg-gradient-to-b from-[#ffcc29]/20 via-[#ffcc29]/5 to-transparent blur-sm opacity-60 group-hover:opacity-80 transition-opacity duration-500" />

          {/* Card body */}
          <div className="relative rounded-3xl overflow-hidden"
            style={{
              background: 'linear-gradient(145deg, #1a1f2e 0%, #12161f 40%, #0c1018 100%)',
              boxShadow: `
                inset 0 1px 0 rgba(255,255,255,0.07),
                inset 0 -1px 0 rgba(0,0,0,0.4),
                0 20px 60px rgba(0,0,0,0.5),
                0 8px 24px rgba(0,0,0,0.3),
                0 0 0 1px rgba(255,255,255,0.04)
              `,
            }}
          >
            {/* Top highlight edge */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#ffcc29]/25 to-transparent" />

            <div className="p-8 md:p-10">
              {/* Card header with embossed feel */}
              <div className="flex items-center gap-3.5 mb-10">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden"
                  style={{
                    background: 'linear-gradient(145deg, #1e2433 0%, #141821 100%)',
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3), inset 0 -1px 2px rgba(255,255,255,0.05), 0 1px 3px rgba(0,0,0,0.2)',
                  }}
                >
                  <img src="/assets/gravity-logo.png" alt="" className="w-7 h-7 object-contain" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-white tracking-wide" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>Nebulaa Gravity</h3>
                  <p className="text-[11px] text-[#ededed]/35 tracking-wider uppercase">Starter Pack</p>
                </div>
              </div>

              {/* Price display — embossed */}
              <div className="text-center mb-10">
                <div className="text-[64px] font-extrabold leading-none tracking-tight"
                  style={{
                    background: 'linear-gradient(180deg, #ffffff 0%, #d4d4d4 50%, #a0a0a0 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                  }}
                >
                  ₹7,500
                </div>

                {/* Credits badge — raised pill */}
                <div className="mt-4 inline-flex items-center gap-2 px-6 py-2.5 rounded-full"
                  style={{
                    background: 'linear-gradient(145deg, #1e2433 0%, #161a24 100%)',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3), inset 0 -1px 1px rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,204,41,0.1)',
                  }}
                >
                  <span className="text-[#ffcc29] font-bold text-xl" style={{ textShadow: '0 0 12px rgba(255,204,41,0.3)' }}>1,000</span>
                  <span className="text-[#ededed]/40 text-sm font-medium">credits</span>
                </div>
                <p className="text-[#ededed]/25 text-xs mt-3 tracking-wide">Free replenish for first 50 users</p>
              </div>

              {/* Engraved divider */}
              <div className="relative mb-8">
                <div className="h-[1px] bg-black/40" />
                <div className="h-[1px] bg-white/[0.04] mt-[1px]" />
              </div>

              {/* Features — recessed panel */}
              <div className="rounded-2xl p-5 mb-8"
                style={{
                  background: 'linear-gradient(180deg, #0a0d14 0%, #0e1219 100%)',
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4), inset 0 -1px 2px rgba(255,255,255,0.03), 0 1px 0 rgba(255,255,255,0.03)',
                }}
              >
                <p className="text-[10px] font-bold text-[#ededed]/25 uppercase tracking-[0.18em] mb-3">What you get</p>
                <div className="grid grid-cols-2 gap-x-6">
                  {features.map((f, i) => <FeatureRow key={i} {...f} />)}
                </div>
              </div>

              {/* CTA Button — raised, tactile */}
              <button
                onClick={handleSubscribe}
                disabled={loading}
                className="w-full py-4 rounded-2xl font-bold text-[15px] transition-all duration-300 flex items-center justify-center gap-2.5
                  text-[#070A12] disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-[1px]"
                style={{
                  background: 'linear-gradient(180deg, #ffd54f 0%, #ffcc29 40%, #e6b825 100%)',
                  boxShadow: loading ? 'none' : `
                    inset 0 1px 0 rgba(255,255,255,0.35),
                    inset 0 -2px 0 rgba(0,0,0,0.15),
                    0 4px 12px rgba(255,204,41,0.35),
                    0 1px 3px rgba(0,0,0,0.3),
                    0 0 40px rgba(255,204,41,0.08)
                  `,
                }}
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><CreditCard className="w-4 h-4" /> Pay ₹7,500 & Activate <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>

            {/* Bottom edge shadow */}
            <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-black/50" />
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-[#ededed]/25 text-xs">
            <Shield className="w-3.5 h-3.5" />
            <span>Secured by Razorpay · UPI, Cards, Net Banking accepted</span>
          </div>
          <button onClick={onLogout} className="text-[#ededed]/25 hover:text-[#ededed]/50 text-sm transition-colors underline">
            Log out
          </button>
        </div>
      </div>
    </SpaceBg>
  );
};

export default TrialExpired;
