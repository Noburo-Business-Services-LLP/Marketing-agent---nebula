import React, { useState, useEffect, useRef } from 'react';
import { CreditCard, ArrowRight, CheckCircle, Loader2, ExternalLink, Phone, Mail, MessageSquare, BarChart3, Bot, Megaphone, Users, Target, Globe, Shield } from 'lucide-react';
import { apiService } from '../services/api';

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface TrialExpiredProps {
  reason: 'time' | 'credits';
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
  const [selectedPlan, setSelectedPlan] = useState<'gravity' | 'gravity_pulsar' | null>(null);

  const handleSubscribe = async (plan: 'gravity' | 'gravity_pulsar') => {
    setLoading(true);
    setSelectedPlan(plan);
    setError('');

    try {
      const orderData = await apiService.createPaymentOrder(plan);
      if (!orderData.success) throw new Error(orderData.message || 'Failed to create order');

      const options = {
        key: orderData.key,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'Nebulaa',
        description: orderData.plan?.description || 'Subscription',
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
        modal: { ondismiss: () => { setLoading(false); setSelectedPlan(null); } }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response: any) => {
        setLoading(false);
        setSelectedPlan(null);
        setError(response.error?.description || 'Payment failed. Please try again.');
      });
      rzp.open();
    } catch (err: any) {
      setLoading(false);
      setSelectedPlan(null);
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
              <p className="text-[#ededed]/30 text-xs mt-4">gravity.nebulaa.ai — 1,000 credits/month + daily bonus</p>
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
  const gravityFeatures = [
    { icon: <Bot className="w-4 h-4" />, text: '1,000 AI credits / month (auto-resets)' },
    { icon: <Target className="w-4 h-4" />, text: '+10 daily login bonus credits' },
    { icon: <Globe className="w-4 h-4" />, text: 'All demo data migrated instantly' },
    { icon: <Megaphone className="w-4 h-4" />, text: 'AI campaign & content generation' },
    { icon: <Globe className="w-4 h-4" />, text: 'Multi-platform social posting' },
    { icon: <Users className="w-4 h-4" />, text: 'Competitor intelligence & tracking' },
    { icon: <BarChart3 className="w-4 h-4" />, text: 'Analytics & performance insights' },
  ];

  const pulsarFeatures = [
    { icon: <Phone className="w-4 h-4" />, text: 'Automated lead calling with AI voice' },
    { icon: <MessageSquare className="w-4 h-4" />, text: 'Cold WhatsApp & SMS outreach' },
    { icon: <Mail className="w-4 h-4" />, text: 'Automated cold email campaigns' },
    { icon: <BarChart3 className="w-4 h-4" />, text: 'Call summaries & lead status tracking' },
    { icon: <Users className="w-4 h-4" />, text: 'Manage all your leads effortlessly' },
  ];

  const FeatureRow: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
    <div className="flex items-center gap-3 py-1.5">
      <div className="text-[#ffcc29]/80 flex-shrink-0">{icon}</div>
      <span className="text-[#ededed]/65 text-[13px]">{text}</span>
    </div>
  );

  return (
    <SpaceBg>
      <div className="max-w-6xl w-full">
        {/* ── Header ── */}
        <div className="text-center mb-12">
          <img src="/assets/nebulaa-gold.png" alt="Nebulaa" className="w-28 h-28 mx-auto mb-6 drop-shadow-[0_0_25px_rgba(255,204,41,0.3)]" />

          <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-4 tracking-tight">
            Trial Credits Exhausted
          </h1>
          <p className="text-[#ededed]/40 text-base md:text-lg max-w-lg mx-auto leading-relaxed">
            {reason === 'time'
              ? `You explored Nebulaa Gravity for ${daysUsed} days. Choose a plan to keep going.`
              : 'You\'ve used all 100 trial credits. Choose a plan to get 1,000 monthly credits and keep growing.'}
          </p>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8">
            <GlassCard>
              <div className="px-5 py-3 text-red-400 text-sm text-center">{error}</div>
            </GlassCard>
          </div>
        )}

        {/* ── Plan Cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-7 mb-10">

          {/* ▸ Gravity */}
          <GlassCard className="hover:scale-[1.01] hover:shadow-lg hover:shadow-white/[0.02]">
            <div className="p-7 md:p-8 flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center gap-3.5 mb-5">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#ffcc29]/15 to-[#ffcc29]/5 flex items-center justify-center ring-1 ring-[#ffcc29]/10 overflow-hidden">
                  <img src="/assets/gravity-logo.png" alt="" className="w-7 h-7 object-contain" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-white">Gravity</h3>
                  <p className="text-[11px] text-[#ededed]/35 tracking-wide">AI Marketing Agent</p>
                </div>
              </div>

              {/* Price */}
              <div className="mb-6 pb-5 border-b border-white/[0.06]">
                <span className="text-[42px] font-extrabold text-white leading-none">₹4,999</span>
                <span className="text-[#ededed]/30 text-sm ml-1.5">/month</span>
              </div>

              {/* Features */}
              <div className="flex-1 mb-7">
                {gravityFeatures.map((f, i) => <FeatureRow key={i} {...f} />)}
              </div>

              {/* CTA */}
              <button
                onClick={() => handleSubscribe('gravity')}
                disabled={loading}
                className="w-full py-4 rounded-2xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2
                  bg-white/[0.04] hover:bg-white/[0.08] text-[#ededed]/90 border border-white/[0.08] hover:border-white/[0.15]
                  disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_3px_rgba(0,0,0,0.3)]
                  hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_12px_rgba(0,0,0,0.4)]"
              >
                {loading && selectedPlan === 'gravity' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><CreditCard className="w-4 h-4" /> Choose Gravity <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </GlassCard>

          {/* ▸ Gravity + Pulsar */}
          <GlassCard highlighted className="hover:scale-[1.01]">
            <div className="p-7 md:p-8 flex flex-col h-full relative">
              {/* Badge */}
              <div className="absolute -top-px left-1/2 -translate-x-1/2 -translate-y-1/2">
                <span className="inline-block bg-gradient-to-r from-[#ffcc29] via-[#ffd84d] to-[#f5a623] text-[#070A12] text-[10px] font-extrabold px-5 py-1.5 rounded-full uppercase tracking-[0.12em] shadow-lg shadow-[#ffcc29]/25">
                  Best Value
                </span>
              </div>

              {/* Header */}
              <div className="flex items-center gap-3.5 mb-5 mt-1">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#ffcc29]/20 to-[#ffcc29]/5 flex items-center justify-center ring-1 ring-[#ffcc29]/20 overflow-hidden">
                  <img src="/assets/gravity-logo.png" alt="" className="w-7 h-7 object-contain" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-white">Gravity + Pulsar</h3>
                  <p className="text-[11px] text-[#ededed]/35 tracking-wide">Marketing + Outreach Agents</p>
                </div>
              </div>

              {/* Price */}
              <div className="mb-6 pb-5 border-b border-[#ffcc29]/[0.08]">
                <div className="flex items-baseline gap-2.5 mb-1">
                  <span className="text-[#ededed]/30 text-lg line-through">₹10,000</span>
                  <span className="bg-green-500/15 text-green-400 text-[11px] font-bold px-2 py-0.5 rounded-md">20% OFF</span>
                </div>
                <span className="text-[42px] font-extrabold text-white leading-none">₹7,999</span>
                <span className="text-[#ededed]/30 text-sm ml-1.5">/month</span>
              </div>

              {/* Features — two columns */}
              <div className="grid grid-cols-2 gap-5 flex-1 mb-7">
                {/* Gravity column */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-[#ffcc29]/20 to-transparent" />
                    <span className="text-[10px] font-bold text-[#ffcc29]/50 uppercase tracking-[0.15em] whitespace-nowrap">Gravity — Marketing</span>
                    <div className="h-px flex-1 bg-gradient-to-l from-[#ffcc29]/20 to-transparent" />
                  </div>
                  {gravityFeatures.map((f, i) => <FeatureRow key={i} {...f} />)}
                </div>
                {/* Pulsar column */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-[#ffcc29]/20 to-transparent" />
                    <span className="text-[10px] font-bold text-[#ffcc29]/50 uppercase tracking-[0.15em] whitespace-nowrap">Pulsar — Outreach</span>
                    <div className="h-px flex-1 bg-gradient-to-l from-[#ffcc29]/20 to-transparent" />
                  </div>
                  {pulsarFeatures.map((f, i) => <FeatureRow key={i} {...f} />)}
                </div>
              </div>

              {/* CTA */}
              <button
                onClick={() => handleSubscribe('gravity_pulsar')}
                disabled={loading}
                className="w-full py-4 rounded-2xl font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2
                  bg-gradient-to-b from-[#ffcc29] to-[#e6b825] hover:from-[#ffd54f] hover:to-[#ffcc29] text-[#070A12]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_rgba(255,204,41,0.3),0_0_30px_rgba(255,204,41,0.08)]
                  hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_16px_rgba(255,204,41,0.4),0_0_50px_rgba(255,204,41,0.12)]"
              >
                {loading && selectedPlan === 'gravity_pulsar' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><CreditCard className="w-4 h-4" /> Choose Gravity + Pulsar <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </GlassCard>
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
