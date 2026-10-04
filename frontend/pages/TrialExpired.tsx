import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, CheckCircle, Loader2, Shield, Check } from 'lucide-react';
import { apiService, PlansResponse } from '../services/api';
import { formatInr, formatPaise, tierLabel } from '../utils/plans';

declare global {
  interface Window {
    Razorpay: any;
  }
}

// The plans page. It is also the screen shown when an account has no Quarks left.
// (The file keeps its old name so that the /trial-expired route does not change.)
interface TrialExpiredProps {
  reason?: 'time' | 'credits' | 'migrated';
  daysUsed?: number;
  creditsUsed?: number;
  onLogout: () => void;
}

const PRIMARY_BTN = 'w-full py-3 rounded-2xl font-bold text-[14px] text-[#070A12] bg-[#ffcc29] hover:bg-[#e6b825] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';
const SECONDARY_BTN = 'w-full py-3 rounded-2xl font-semibold text-[14px] text-white bg-white/10 hover:bg-white/15 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';

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
        ? 'bg-gradient-to-b from-[#0f1520] via-[#0a0e18] to-[#060910]'
        : 'bg-gradient-to-b from-[#0d1219] via-[#080c14] to-[#060910]'
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
  const navigate = useNavigate();
  const [catalogue, setCatalogue] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tier, setTier] = useState<string>('free');
  const [held, setHeld] = useState<string[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadAccount = async () => {
    try {
      const b = await apiService.getBillingData();
      if (b?.plan?.tier) setTier(b.plan.tier);
      setHeld(Array.isArray(b?.plan?.addons) ? b.plan.addons : []);
      if (typeof b?.credits?.balance === 'number') setBalance(b.credits.balance);
    } catch { /* the catalogue is still useful without the account details */ }
  };

  useEffect(() => {
    apiService.getPlans()
      .then((res) => setCatalogue(res))
      .catch((e: any) => setLoadError(e?.message || 'The plans could not be loaded. Please try again.'))
      .finally(() => setLoading(false));
    loadAccount();
  }, []);

  const ownsAddon = (id: string) => held.includes(id) || held.includes('bundle');
  const onPaidPlan = tier === 'starter' || tier === 'professional';

  // One checkout runner for the three purchases. `afterPay` verifies the payment on the server.
  const checkout = async (key: string, create: () => Promise<any>, build: (d: any) => any, verify: (r: any) => Promise<any>) => {
    setBusy(key); setError(''); setNotice('');
    try {
      const data = await create();
      if (!data?.success) throw new Error(data?.message || 'The payment could not be started. Please try again.');
      const rzp = new window.Razorpay({
        ...build(data),
        name: 'Nebulaa',
        prefill: data.prefill,
        theme: { color: '#ffcc29', backdrop_color: 'rgba(7, 10, 18, 0.9)' },
        handler: async (response: any) => {
          try {
            const result = await verify(response);
            if (!result?.success) throw new Error(result?.message || 'The payment could not be confirmed.');
            setNotice(result.message || 'Your payment is confirmed.');
            if (typeof result.balance === 'number') {
              window.dispatchEvent(new CustomEvent('credits-updated', { detail: { creditsRemaining: result.balance } }));
            }
            await loadAccount();
          } catch (err: any) {
            setError(err?.message || 'The payment was received but could not be confirmed. Please contact support.');
          } finally { setBusy(null); }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.on('payment.failed', (r: any) => { setBusy(null); setError(r?.error?.description || 'The payment failed. Please try again.'); });
      rzp.open();
    } catch (err: any) {
      setBusy(null);
      setError(err?.message || 'The payment could not be started. Please try again.');
    }
  };

  const buyPlan = (id: 'starter' | 'professional', name: string, charge: number) =>
    checkout(`plan:${id}`, () => apiService.createSubscription(id),
      (d) => ({ key: d.key, subscription_id: d.subscription_id, description: `${name}, monthly, ${formatPaise(charge)} including GST` }),
      (r) => apiService.verifySubscription({ razorpay_payment_id: r.razorpay_payment_id, razorpay_subscription_id: r.razorpay_subscription_id, razorpay_signature: r.razorpay_signature }));

  const buyAddon = (id: 'publish' | 'competitors' | 'inbox' | 'bundle', label: string, charge: number) =>
    checkout(`addon:${id}`, () => apiService.createAddonSubscription(id),
      (d) => ({ key: d.key, subscription_id: d.subscription_id, description: `${label}, monthly, ${formatPaise(charge)} including GST` }),
      (r) => apiService.verifySubscription({ razorpay_payment_id: r.razorpay_payment_id, razorpay_subscription_id: r.razorpay_subscription_id, razorpay_signature: r.razorpay_signature }));

  const buyTopup = (inr: number) =>
    checkout(`topup:${inr}`, () => apiService.createPaymentOrder(inr),
      (d) => ({ key: d.key, order_id: d.order.id, amount: d.order.amount, currency: d.order.currency, description: d.description }),
      (r) => apiService.verifyPayment({ razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature }));

  if (loading) {
    return <SpaceBg><Loader2 className="w-10 h-10 animate-spin text-[#ffcc29]" /></SpaceBg>;
  }
  if (loadError || !catalogue) {
    return (
      <SpaceBg>
        <div className="max-w-md w-full">
          <GlassCard><div className="p-8 text-center text-red-300">{loadError || 'The plans could not be loaded. Please try again.'}</div></GlassCard>
        </div>
      </SpaceBg>
    );
  }

  const h2 = 'text-xl md:text-2xl font-bold text-white mb-4';
  const muted = 'text-[#ededed]/75';

  return (
    <SpaceBg>
      <div className="max-w-6xl w-full">
        <div className="text-center mb-10 rounded-3xl bg-[#070a12] px-6 py-6">
          <img src="/assets/nebulaa-gold.png" alt="Nebulaa" className="w-16 h-16 mx-auto mb-4" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-3 tracking-tight">
            {reason === 'credits' ? 'You have used all of your Quarks' : 'Plans and Quarks'}
          </h1>
          <p className={`${muted} text-base max-w-2xl mx-auto`}>
            {reason === 'credits'
              ? 'Please upgrade your plan, or buy an add-on pack or Quarks, to continue.'
              : 'Choose a monthly plan, add the features you need, or buy extra Quarks at any time. Prices are shown before GST; 18 percent GST is added at checkout.'}
          </p>
          <p className={`${muted} text-sm mt-3`}>
            Current plan: <span className="text-white font-semibold">{tierLabel(tier)}</span>
            {balance !== null && <> · <span className="text-white font-semibold">{balance.toLocaleString('en-IN')}</span> Quarks remaining</>}
          </p>
        </div>

        {notice && <div className="mb-6 max-w-xl mx-auto rounded-2xl bg-green-500/10 border border-green-500/30 px-5 py-3 text-green-300 text-sm text-center flex items-center justify-center gap-2"><CheckCircle className="w-4 h-4" />{notice}</div>}
        {error && <div className="mb-6 max-w-xl mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 px-5 py-3 text-red-300 text-sm text-center">{error}</div>}

        <h2 className={h2}>Monthly plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {catalogue.plans.map((plan) => {
            const current = tier === plan.id;
            return (
              <GlassCard key={plan.id} highlighted={plan.id === 'professional'}>
                <div className="p-7 flex flex-col h-full">
                  <h3 className="text-2xl font-bold text-white mb-1">{plan.name}</h3>
                  <p className={`${muted} text-sm mb-5`}>{plan.description}</p>
                  <p className="text-4xl font-extrabold text-white">{formatInr(plan.inr)}<span className={`${muted} text-base font-normal`}> a month plus GST</span></p>
                  <p className={`${muted} text-xs mt-1 mb-5`}>{formatPaise(plan.chargePaise)} including 18 percent GST. Renews monthly and can be cancelled at any time.</p>
                  <ul className="space-y-2.5 mb-7 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[13px]">
                        <Check className="w-4 h-4 text-[#ffcc29]/80 flex-shrink-0 mt-0.5" /><span className="text-[#ededed]/85">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button className={PRIMARY_BTN} disabled={!!busy || current || (onPaidPlan && !current)} onClick={() => buyPlan(plan.id, plan.name, plan.chargePaise)}>
                    {busy === `plan:${plan.id}` ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing</> : current ? 'Your current plan' : <><CreditCard className="w-4 h-4" /> Choose {plan.name}</>}
                  </button>
                  {onPaidPlan && !current && <p className={`${muted} text-xs mt-2 text-center`}>You already have an active plan.</p>}
                </div>
              </GlassCard>
            );
          })}
        </div>

        <h2 className={h2}>Add-ons</h2>
        <p className={`${muted} text-sm -mt-2 mb-4`}>Add-ons are available with the Starter and Professional plans and renew monthly. Prices are before GST.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
          {catalogue.addons.map((a) => {
            const owned = ownsAddon(a.id);
            const missing = a.requires.find((r) => !ownsAddon(r));
            const blocked = !onPaidPlan || !!missing;
            const why = !onPaidPlan ? 'Choose a plan first.' : missing ? `Needs ${catalogue.addons.find((x) => x.id === missing)?.label || 'another add-on'}.` : '';
            return (
              <GlassCard key={a.id}>
                <div className="p-6 flex flex-col h-full">
                  <h3 className="text-lg font-bold text-white mb-1">{a.label}</h3>
                  <p className="text-2xl font-extrabold text-white">{formatInr(a.inr)}<span className={`${muted} text-sm font-normal`}> a month plus GST</span></p>
                  <p className={`${muted} text-xs mt-1 mb-4 flex-1`}>{formatPaise(a.chargePaise)} including GST.{why ? ` ${why}` : ''}</p>
                  <button className={SECONDARY_BTN} disabled={!!busy || owned || blocked} onClick={() => buyAddon(a.id, a.label, a.chargePaise)}>
                    {busy === `addon:${a.id}` ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing</> : owned ? 'Active' : 'Add to my plan'}
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>

        <h2 className={h2}>Extra Quarks</h2>
        <p className={`${muted} text-sm -mt-2 mb-4`}>Extra Quarks do not expire. Prices are before GST.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
          {catalogue.topups.map((t) => (
            <GlassCard key={t.inr}>
              <div className="p-6 flex flex-col h-full">
                <p className="text-2xl font-extrabold text-white">{t.quarks.toLocaleString('en-IN')} Quarks</p>
                <p className={`${muted} text-sm mt-1 mb-4 flex-1`}>{formatInr(t.inr)} plus GST ({formatPaise(t.chargePaise)} including GST)</p>
                <button className={SECONDARY_BTN} disabled={!!busy} onClick={() => buyTopup(t.inr)}>
                  {busy === `topup:${t.inr}` ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing</> : `Buy ${t.quarks.toLocaleString('en-IN')} Quarks`}
                </button>
              </div>
            </GlassCard>
          ))}
        </div>

        <div className="text-center mt-10 space-y-3 rounded-3xl bg-[#070a12] px-6 py-5">
          <div className={`flex items-center justify-center gap-2 ${muted} text-xs`}>
            <Shield className="w-3.5 h-3.5" />
            <span>Secured by Razorpay. UPI, cards and net banking are accepted.</span>
          </div>
          {reason !== 'credits' && (
            <button onClick={() => navigate('/dashboard')} className="block mx-auto text-[#ededed]/75 hover:text-[#ededed] text-sm underline">Back to Nebulaa</button>
          )}
          <button onClick={onLogout} className="text-[#ededed]/75 hover:text-[#ededed] text-sm transition-colors underline">Log out</button>
        </div>
      </div>
    </SpaceBg>
  );
};

export default TrialExpired;
