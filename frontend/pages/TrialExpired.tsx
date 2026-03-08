import React, { useState } from 'react';
import { CreditCard, ArrowRight, CheckCircle, Loader2, ExternalLink, Check, Phone, Mail, MessageSquare, BarChart3, Bot, Megaphone, Users, Target, Globe, Shield } from 'lucide-react';
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
      if (!orderData.success) {
        throw new Error(orderData.message || 'Failed to create order');
      }

      const options = {
        key: orderData.key,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'Nebulaa',
        description: orderData.plan?.description || 'Subscription',
        order_id: orderData.order.id,
        prefill: orderData.prefill,
        theme: {
          color: '#ffcc29',
          backdrop_color: 'rgba(7, 10, 18, 0.85)'
        },
        handler: async (response: any) => {
          setLoading(false);
          setMigrating(true);
          try {
            const verifyResult = await apiService.verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });

            if (verifyResult.success) {
              setSuccess(true);
              setMigrating(false);
            } else {
              throw new Error(verifyResult.message || 'Verification failed');
            }
          } catch (err: any) {
            setMigrating(false);
            setError(err.message || 'Payment verified but migration failed. Contact support.');
          }
        },
        modal: {
          ondismiss: () => {
            setLoading(false);
            setSelectedPlan(null);
          }
        }
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

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-[#070A12] flex items-center justify-center p-4">
        <div className="max-w-lg w-full relative">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#ffcc29]/8 rounded-full blur-[128px]" />
          </div>
          <div className="relative bg-[#0d1117] border border-[#ffcc29]/30 rounded-2xl p-8 md:p-10 text-center">
            <div className="mx-auto w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">You're All Set! 🎉</h1>
            <p className="text-[#ededed]/60 text-base mb-8">
              Payment received and all your data has been migrated to your production account.
              Log in at your new URL with the same email and password.
            </p>
            <a
              href="https://gravity.nebulaa.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-4 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] font-bold text-lg rounded-xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-[#ffcc29]/20"
            >
              Go to Gravity Production
              <ExternalLink className="w-5 h-5" />
            </a>
            <p className="text-[#ededed]/40 text-xs mt-4">gravity.nebulaa.ai — 1,000 credits/month + daily bonus</p>
          </div>
        </div>
      </div>
    );
  }

  // Migrating state
  if (migrating) {
    return (
      <div className="min-h-screen bg-[#070A12] flex items-center justify-center p-4">
        <div className="max-w-lg w-full relative">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#ffcc29]/5 rounded-full blur-[128px]" />
          </div>
          <div className="relative bg-[#0d1117] border border-slate-700/50 rounded-2xl p-8 md:p-10 text-center">
            <Loader2 className="w-12 h-12 text-[#ffcc29] animate-spin mx-auto mb-6" />
            <h2 className="text-xl font-bold text-[#ededed] mb-2">Migrating Your Data...</h2>
            <p className="text-[#ededed]/50 text-sm">
              Transferring campaigns, analytics, brand assets and everything else to your production account. This takes a few seconds.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const gravityFeatures = [
    { icon: <Bot className="w-4 h-4" />, text: '1,000 AI credits/month (auto-resets)' },
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
    { icon: <Users className="w-4 h-4" />, text: 'Manage 1,000–2,000+ leads effortlessly' },
  ];

  return (
    <div className="min-h-screen bg-[#070A12] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-[#ffcc29]/[0.03] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[#ffcc29]/[0.02] rounded-full blur-[100px]" />
      </div>

      <div className="max-w-4xl w-full relative z-10">
        {/* Header */}
        <div className="text-center mb-10">
          <img src="/assets/logo.png" alt="Nebulaa" className="w-14 h-14 mx-auto mb-5 rounded-xl" />

          <h1 className="text-3xl md:text-4xl font-bold text-[#ededed] mb-3">
            {reason === 'time' ? 'Your Free Trial Has Ended' : 'Trial Credits Exhausted'}
          </h1>

          <p className="text-[#ededed]/50 text-base max-w-md mx-auto">
            {reason === 'time'
              ? `You've explored Nebulaa Gravity for ${daysUsed} days. Choose a plan to continue with all your data intact.`
              : `You've used all 100 trial credits. Choose a plan to get 1,000 monthly credits and keep growing.`}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm text-center max-w-2xl mx-auto">
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

          {/* Gravity Plan */}
          <div className="relative bg-[#0d1117]/80 backdrop-blur-sm rounded-2xl p-7 text-left border border-slate-700/50 hover:border-slate-600/60 transition-all duration-300 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#ffcc29]/10 rounded-xl flex items-center justify-center">
                <img src="/assets/logo.png" alt="" className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#ededed]">Gravity</h3>
                <p className="text-[#ededed]/40 text-xs">AI Marketing Agent</p>
              </div>
            </div>

            <div className="mb-6">
              <span className="text-4xl font-extrabold text-[#ededed]">₹5,000</span>
              <span className="text-[#ededed]/40 text-sm ml-1">/month</span>
            </div>

            <div className="space-y-3 flex-1 mb-7">
              {gravityFeatures.map((f, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="text-[#ffcc29] flex-shrink-0 mt-0.5">{f.icon}</div>
                  <span className="text-[#ededed]/70 text-sm">{f.text}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => handleSubscribe('gravity')}
              disabled={loading}
              className="w-full py-3.5 font-bold text-sm rounded-xl transition-all duration-300 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-[#ededed] border border-slate-600/50 hover:border-slate-500/60 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading && selectedPlan === 'gravity' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
              ) : (
                <><CreditCard className="w-4 h-4" /> Choose Gravity <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>

          {/* Gravity + Pulsar Plan */}
          <div className="relative bg-[#0d1117]/80 backdrop-blur-sm rounded-2xl p-7 text-left border-2 border-[#ffcc29]/30 hover:border-[#ffcc29]/50 transition-all duration-300 shadow-xl shadow-[#ffcc29]/[0.04] flex flex-col">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className="bg-gradient-to-r from-[#ffcc29] to-[#f5a623] text-[#070A12] text-[11px] font-bold px-4 py-1.5 rounded-full uppercase tracking-wider shadow-lg shadow-[#ffcc29]/20">
                Best Value
              </span>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#ffcc29]/15 rounded-xl flex items-center justify-center">
                <img src="/assets/logo.png" alt="" className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#ededed]">Gravity + Pulsar</h3>
                <p className="text-[#ededed]/40 text-xs">Marketing + Outreach Agents</p>
              </div>
            </div>

            <div className="mb-6">
              <span className="text-4xl font-extrabold text-[#ededed]">₹10,000</span>
              <span className="text-[#ededed]/40 text-sm ml-1">/month</span>
            </div>

            {/* Gravity section */}
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-[#ffcc29]/70 uppercase tracking-widest mb-2.5">Gravity — Marketing</p>
              <div className="space-y-2.5">
                {gravityFeatures.map((f, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="text-[#ffcc29] flex-shrink-0 mt-0.5">{f.icon}</div>
                    <span className="text-[#ededed]/70 text-sm">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-slate-700/50 my-4" />

            {/* Pulsar section */}
            <div className="flex-1 mb-7">
              <p className="text-[10px] font-semibold text-[#ffcc29]/70 uppercase tracking-widest mb-2.5">Pulsar — Outreach Automation</p>
              <div className="space-y-2.5">
                {pulsarFeatures.map((f, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="text-[#ffcc29] flex-shrink-0 mt-0.5">{f.icon}</div>
                    <span className="text-[#ededed]/70 text-sm">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => handleSubscribe('gravity_pulsar')}
              disabled={loading}
              className="w-full py-3.5 font-bold text-sm rounded-xl transition-all duration-300 flex items-center justify-center gap-2 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] shadow-lg shadow-[#ffcc29]/20 hover:shadow-[#ffcc29]/30 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading && selectedPlan === 'gravity_pulsar' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
              ) : (
                <><CreditCard className="w-4 h-4" /> Choose Gravity + Pulsar <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-[#ededed]/30 text-xs">
            <Shield className="w-3.5 h-3.5" />
            <span>Secured by Razorpay • UPI, Cards, Net Banking accepted</span>
          </div>
          <button
            onClick={onLogout}
            className="text-[#ededed]/30 hover:text-[#ededed]/60 text-sm transition-colors underline"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrialExpired;
