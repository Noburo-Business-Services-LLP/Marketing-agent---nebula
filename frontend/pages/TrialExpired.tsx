import React, { useState, useEffect, useRef } from 'react';
import { CreditCard, ArrowRight, CheckCircle, Loader2, ExternalLink, Shield, Sparkles, Check } from 'lucide-react';
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

type Cycle = 'monthly' | 'quarterly' | 'annual';
type Tier = 'pro' | 'growth' | 'scale';

interface PlanCycleInfo {
  planId: string;
  amount: number;
  label: string;
  per: string;
}

interface PlanInfo {
  name: string;
  description: string;
  features: string[];
  cycles: { monthly: PlanCycleInfo; quarterly: PlanCycleInfo; annual: PlanCycleInfo };
}

const TIER_ORDER: Tier[] = ['pro', 'growth', 'scale'];

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

    const stars = Array.from({ length: 220 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.3,
      speed: Math.random() * 0.15 + 0.02,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
    }));

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

const SpaceBg: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen relative overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 0%, #0d1525 0%, #070a12 50%, #030507 100%)' }}>
    <StarfieldCanvas />
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] rounded-full opacity-[0.06]" style={{ background: 'radial-gradient(circle, #5b3cc4, transparent 70%)' }} />
      <div className="absolute top-[10%] right-[5%] w-[500px] h-[500px] rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #ffcc29, transparent 70%)' }} />
      <div className="absolute bottom-[5%] left-[10%] w-[700px] h-[500px] rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #1e6091, transparent 65%)' }} />
      <div className="absolute bottom-[-15%] right-[20%] w-[550px] h-[550px] rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #8b3a62, transparent 70%)' }} />
    </div>
    <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(3,5,7,0.7) 100%)' }} />
    <div className="relative z-10 flex items-start justify-center min-h-screen p-4 md:p-8 py-12">
      {children}
    </div>
  </div>
);

const TrialExpired: React.FC<TrialExpiredProps> = ({ reason, onLogout }) => {
  const [plans, setPlans] = useState<Record<Tier, PlanInfo> | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState('');

  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [paying, setPaying] = useState<Tier | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiService
      .getPlans()
      .then((res: any) => setPlans(res.plans))
      .catch((e: any) => setPlansError(e.message || 'Failed to load plans'))
      .finally(() => setPlansLoading(false));
  }, []);

  const handleSubscribe = async (tier: Tier) => {
    if (!plans) return;
    setPaying(tier);
    setError('');

    try {
      const info = plans[tier].cycles[cycle];
      const subData = await apiService.createSubscription(info.planId);
      if (!subData.success) throw new Error(subData.message || 'Failed to create subscription');

      const options = {
        key: subData.key,
        subscription_id: subData.subscription_id,
        name: 'Nebulaa Gravity',
        description: `${plans[tier].name} ${info.per} — ₹${info.amount.toLocaleString('en-IN')}`,
        prefill: subData.prefill,
        theme: { color: '#ffcc29', backdrop_color: 'rgba(7, 10, 18, 0.9)' },
        handler: async (response: any) => {
          setPaying(null);
          setMigrating(true);
          try {
            const verifyResult = await apiService.verifySubscription({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature: response.razorpay_signature
            });
            if (verifyResult.success) { setSuccess(true); setMigrating(false); }
            else throw new Error(verifyResult.message || 'Verification failed');
          } catch (err: any) {
            setMigrating(false);
            setError(err.message || 'Payment verified but migration failed. Contact support.');
          }
        },
        modal: { ondismiss: () => setPaying(null) }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response: any) => {
        setPaying(null);
        setError(response.error?.description || 'Payment failed. Please try again.');
      });
      rzp.open();
    } catch (err: any) {
      setPaying(null);
      setError(err.message || 'Something went wrong');
    }
  };

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
              <p className="text-[#ededed]/30 text-xs mt-4">gravity.nebulaa.ai</p>
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
              <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">You're All Set!</h1>
              <p className="text-[#ededed]/55 text-base mb-8">
                Payment received & data migrated to production. Log in with the same email & password.
              </p>
              <a href="https://gravity.nebulaa.ai" target="_blank" rel="noopener noreferrer"
                className="w-full py-4 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] font-bold text-lg rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#ffcc29]/20">
                Go to Gravity Production <ExternalLink className="w-5 h-5" />
              </a>
              <p className="text-[#ededed]/30 text-xs mt-4">gravity.nebulaa.ai</p>
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

  // ─── Plans loading / error ───
  if (plansLoading) {
    return (
      <SpaceBg>
        <Loader2 className="w-10 h-10 animate-spin text-[#ffcc29]" />
      </SpaceBg>
    );
  }

  if (plansError || !plans) {
    return (
      <SpaceBg>
        <div className="max-w-md w-full">
          <GlassCard>
            <div className="p-8 text-center text-red-400">{plansError || 'Failed to load plans'}</div>
          </GlassCard>
        </div>
      </SpaceBg>
    );
  }

  const cycleLabel: Record<Cycle, string> = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    annual: 'Annual',
  };

  return (
    <SpaceBg>
      <div className="max-w-6xl w-full">
        {/* ── Header ── */}
        <div className="text-center mb-10">
          <img src="/assets/nebulaa-gold.png" alt="Nebulaa" className="w-20 h-20 mx-auto mb-5 drop-shadow-[0_0_25px_rgba(255,204,41,0.3)]" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-3 tracking-tight">
            {reason === 'time' ? 'Your Free Trial Has Ended' : 'Pick the plan that fits your brand'}
          </h1>
          <p className="text-[#ededed]/45 text-base md:text-lg max-w-2xl mx-auto">
            All plans include AI campaign generation, multi-platform posting and analytics. Cancel anytime.
          </p>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-6 max-w-md mx-auto">
            <GlassCard>
              <div className="px-5 py-3 text-red-400 text-sm text-center">{error}</div>
            </GlassCard>
          </div>
        )}

        {/* ── Cycle toggle ── */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex rounded-2xl p-1.5" style={{ background: 'linear-gradient(180deg, #0a0d14 0%, #0e1219 100%)', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)' }}>
            {(Object.keys(cycleLabel) as Cycle[]).map((c) => (
              <button key={c} onClick={() => setCycle(c)}
                className={`px-5 md:px-7 py-2.5 rounded-xl text-sm font-semibold transition-all ${cycle === c ? 'bg-[#ffcc29] text-[#070A12] shadow-lg shadow-[#ffcc29]/20' : 'text-[#ededed]/55 hover:text-white'}`}>
                {cycleLabel[c]}
                {c === 'annual' && <span className="ml-2 text-[10px] font-bold text-emerald-400">SAVE</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tier cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-7">
          {TIER_ORDER.map((tier) => {
            const plan = plans[tier];
            const info = plan.cycles[cycle];
            const highlighted = tier === 'growth';
            const isPaying = paying === tier;
            return (
              <GlassCard key={tier} highlighted={highlighted}>
                <div className="p-7 md:p-8 flex flex-col h-full relative">
                  {highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <div className="px-3 py-1 rounded-full bg-[#ffcc29] text-[#070A12] text-[11px] font-bold tracking-wide flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> MOST POPULAR
                      </div>
                    </div>
                  )}

                  <div className="mb-5">
                    <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                    <p className="text-[#ededed]/45 text-sm leading-relaxed">{plan.description}</p>
                  </div>

                  <div className="mb-6">
                    <div className="text-[44px] font-extrabold leading-none tracking-tight"
                      style={{
                        background: 'linear-gradient(180deg, #ffffff 0%, #d4d4d4 50%, #a0a0a0 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                      }}>
                      ₹{info.amount.toLocaleString('en-IN')}
                    </div>
                    <p className="text-[#ededed]/35 text-xs mt-2 tracking-wide">{info.per} · Auto-renews · Cancel anytime</p>
                  </div>

                  <ul className="space-y-2.5 mb-7 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[13px]">
                        <Check className="w-4 h-4 text-[#ffcc29]/80 flex-shrink-0 mt-0.5" />
                        <span className="text-[#ededed]/70">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handleSubscribe(tier)}
                    disabled={!!paying}
                    className={`w-full py-3.5 rounded-2xl font-bold text-[14px] transition-all flex items-center justify-center gap-2 active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed ${highlighted ? 'text-[#070A12]' : 'text-white'}`}
                    style={highlighted ? {
                      background: 'linear-gradient(180deg, #ffd54f 0%, #ffcc29 40%, #e6b825 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.15), 0 4px 12px rgba(255,204,41,0.35)',
                    } : {
                      background: 'linear-gradient(180deg, #1e2433 0%, #161a24 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)',
                    }}>
                    {isPaying ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : (
                      <><CreditCard className="w-4 h-4" /> Choose {plan.name} <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="text-center mt-10 space-y-3">
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
