import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CreditCard, Shield } from 'lucide-react';
import { apiService } from '../services/api';
import { SpaceBg, GlassCard } from '../components/StarfieldBg';

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface SelectedPlan {
  tier: string;
  cycle: string;
  planId: string;
  amount: number;
  tierName: string;
  per: string;
}

const Checkout: React.FC = () => {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<SelectedPlan | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [shopName, setShopName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const raw = sessionStorage.getItem('selectedPlan');
    if (!raw) {
      navigate('/');
      return;
    }
    setPlan(JSON.parse(raw));
  }, [navigate]);

  const validate = () => {
    if (!name.trim()) return 'Please enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email';
    if (!/^[0-9+\-\s]{7,15}$/.test(mobileNumber.trim())) return 'Please enter a valid mobile number';
    if (!shopName.trim()) return 'Please enter your shop / business name';
    return '';
  };

  const handlePay = async () => {
    if (!plan) return;
    const validationErr = validate();
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const sub = await apiService.createSubscription({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        mobileNumber: mobileNumber.trim(),
        shopName: shopName.trim(),
        planId: plan.planId,
      });

      if (!sub.success) throw new Error(sub.message || 'Failed to create subscription');

      const options = {
        key: sub.key,
        subscription_id: sub.subscription_id,
        name: 'Nebulaa Gravity',
        description: `${plan.tierName} — 7-day free trial, then ₹${plan.amount.toLocaleString('en-IN')} ${plan.per}`,
        prefill: sub.prefill,
        theme: { color: '#ffcc29', backdrop_color: 'rgba(7, 10, 18, 0.9)' },
        handler: async (response: any) => {
          try {
            const verify = await apiService.verifySubscription({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature: response.razorpay_signature,
            });
            if (!verify.success) throw new Error(verify.message || 'Verification failed');
            sessionStorage.setItem(
              'paymentResult',
              JSON.stringify({
                name,
                email,
                tierName: plan.tierName,
                amount: plan.amount,
                per: plan.per,
                paymentId: response.razorpay_payment_id,
                trialDays: sub.trialDays ?? 7,
                trialEndsAt: sub.trialEndsAt ?? null,
              }),
            );
            sessionStorage.removeItem('selectedPlan');
            navigate('/success');
          } catch (err: any) {
            setSubmitting(false);
            setError(err.message || 'Payment verification failed. Contact support.');
          }
        },
        modal: { ondismiss: () => setSubmitting(false) },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        setSubmitting(false);
        setError(resp.error?.description || 'Payment failed. Please try again.');
      });
      rzp.open();
    } catch (err: any) {
      setSubmitting(false);
      setError(err.message || 'Something went wrong');
    }
  };

  if (!plan) return null;

  return (
    <SpaceBg>
      <div className="max-w-3xl w-full">
        <button
          onClick={() => navigate('/')}
          className="mb-6 inline-flex items-center gap-2 text-[#ededed]/50 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to plans
        </button>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div className="md:col-span-3">
            <GlassCard>
              <div className="p-7 md:p-8">
                <h2 className="text-xl md:text-2xl font-bold text-white mb-1">
                  Your details
                </h2>
                <p className="text-[#ededed]/40 text-sm mb-6">
                  We'll send your invoice and account access here.
                </p>

                <div className="space-y-4">
                  <Field
                    label="Full name"
                    value={name}
                    onChange={setName}
                    placeholder="Aarav Sharma"
                  />
                  <Field
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="you@business.com"
                  />
                  <Field
                    label="Mobile number"
                    value={mobileNumber}
                    onChange={setMobileNumber}
                    placeholder="+91 98765 43210"
                  />
                  <Field
                    label="Shop / Business name"
                    value={shopName}
                    onChange={setShopName}
                    placeholder="Nebulaa Co."
                  />
                </div>

                {error && (
                  <div className="mt-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <button
                  onClick={handlePay}
                  disabled={submitting}
                  className="w-full mt-6 py-4 rounded-2xl font-bold text-[15px] transition-all duration-300 flex items-center justify-center gap-2.5 text-[#070A12] disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-[1px]"
                  style={{
                    background:
                      'linear-gradient(180deg, #ffd54f 0%, #ffcc29 40%, #e6b825 100%)',
                    boxShadow: submitting
                      ? 'none'
                      : 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.15), 0 4px 12px rgba(255,204,41,0.35), 0 1px 3px rgba(0,0,0,0.3)',
                  }}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" /> Start 7-day free trial
                    </>
                  )}
                </button>
                <p className="mt-3 text-center text-[#ededed]/35 text-[11px]">
                  No charge today. You'll be billed ₹{plan.amount.toLocaleString('en-IN')} on day 8 unless you cancel.
                </p>

                <div className="mt-4 flex items-center justify-center gap-2 text-[#ededed]/25 text-xs">
                  <Shield className="w-3.5 h-3.5" />
                  <span>256-bit secured · Powered by Razorpay</span>
                </div>
              </div>
            </GlassCard>
          </div>

          <div className="md:col-span-2">
            <GlassCard highlighted>
              <div className="p-7 md:p-8">
                <p className="text-[10px] font-bold text-[#ededed]/35 uppercase tracking-[0.18em] mb-3">
                  Order summary
                </p>

                <h3 className="text-xl font-bold text-white mb-1">{plan.tierName}</h3>
                <p className="text-[#ededed]/45 text-xs mb-6 capitalize">
                  {plan.cycle} billing
                </p>

                <div className="rounded-2xl p-5 mb-5"
                  style={{
                    background: 'linear-gradient(180deg, #0a0d14 0%, #0e1219 100%)',
                    boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4)',
                  }}
                >
                  <div className="flex justify-between text-[#ededed]/55 text-sm mb-2">
                    <span>Subtotal</span>
                    <span>₹{plan.amount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-emerald-400 text-sm mb-2">
                    <span>7-day free trial</span>
                    <span>−₹{plan.amount.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-[#ededed]/55 text-sm">
                    <span>Taxes</span>
                    <span>Included</span>
                  </div>
                  <div className="h-px bg-white/[0.04] my-4" />
                  <div className="flex justify-between items-baseline">
                    <span className="text-white font-semibold">Due today</span>
                    <span
                      className="text-2xl font-extrabold"
                      style={{
                        background:
                          'linear-gradient(180deg, #34d399 0%, #10b981 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                      }}
                    >
                      ₹0
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline mt-2">
                    <span className="text-white/45 text-xs">After trial</span>
                    <span className="text-white/65 text-sm font-semibold">
                      ₹{plan.amount.toLocaleString('en-IN')} {plan.per}
                    </span>
                  </div>
                </div>

                <p className="text-[#ededed]/25 text-[11px] leading-relaxed">
                  Free for 7 days. After that, auto-renews at ₹{plan.amount.toLocaleString('en-IN')} {plan.per}.
                  Cancel anytime before day 7 and you won't be charged.
                </p>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </SpaceBg>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}> = ({ label, value, onChange, placeholder, type = 'text' }) => (
  <div>
    <label className="block text-[11px] font-semibold text-[#ededed]/45 uppercase tracking-wider mb-2">
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-[#ffcc29]/40 transition-colors"
      style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}
    />
  </div>
);

export default Checkout;
