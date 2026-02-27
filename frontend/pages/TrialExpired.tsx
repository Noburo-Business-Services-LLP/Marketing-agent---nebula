import React, { useState } from 'react';
import { Clock, Sparkles, CreditCard, ArrowRight, Zap, CheckCircle, Loader2, ExternalLink } from 'lucide-react';
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

const TrialExpired: React.FC<TrialExpiredProps> = ({ reason, daysUsed = 7, creditsUsed = 100, onLogout }) => {
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');

    try {
      // Step 1: Create Razorpay order
      const orderData = await apiService.createPaymentOrder();
      if (!orderData.success) {
        throw new Error(orderData.message || 'Failed to create order');
      }

      // Step 2: Open Razorpay checkout
      const options = {
        key: orderData.key,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'Nebulaa Gravity',
        description: 'Pro Plan — ₹10,000/month',
        order_id: orderData.order.id,
        prefill: orderData.prefill,
        theme: {
          color: '#ffcc29',
          backdrop_color: 'rgba(7, 10, 18, 0.85)'
        },
        handler: async (response: any) => {
          // Payment successful — verify & migrate
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
          }
        }
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

  // Success state — show prod URL
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

            <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">
              You're All Set! 🎉
            </h1>

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

            <p className="text-[#ededed]/40 text-xs mt-4">
              gravity.nebulaa.ai — 1,000 credits/month + daily bonus
            </p>
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

  return (
    <div className="min-h-screen bg-[#070A12] flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Glowing background effect */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#ffcc29]/5 rounded-full blur-[128px]" />
        </div>

        <div className="relative bg-[#0d1117] border border-slate-700/50 rounded-2xl p-8 md:p-10 text-center">
          {/* Icon */}
          <div className="mx-auto w-20 h-20 bg-[#ffcc29]/10 rounded-full flex items-center justify-center mb-6">
            {reason === 'time' ? (
              <Clock className="w-10 h-10 text-[#ffcc29]" />
            ) : (
              <Zap className="w-10 h-10 text-[#ffcc29]" />
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">
            {reason === 'time' 
              ? 'Your Free Trial Has Ended' 
              : 'Trial Credits Exhausted'}
          </h1>

          {/* Subtitle */}
          <p className="text-[#ededed]/60 text-base mb-8">
            {reason === 'time'
              ? `You've explored Nebulaa Gravity for ${daysUsed} days. Subscribe to continue with all your data intact.`
              : `You've used all ${creditsUsed} trial credits. Subscribe to get 1,000 monthly credits and keep growing.`}
          </p>

          {/* What you get */}
          <div className="bg-[#070A12] rounded-xl p-6 mb-8 text-left">
            <h3 className="text-sm font-semibold text-[#ffcc29] uppercase tracking-wider mb-4">
              What you unlock
            </h3>
            <div className="space-y-3">
              {[
                '1,000 AI credits per month (auto-resets)',
                '+10 daily login bonus credits',
                'All your demo data migrated instantly',
                'Full AI campaign & content generation',
                'Multi-platform social posting',
                'Competitor intelligence & tracking'
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-[#ffcc29] flex-shrink-0" />
                  <span className="text-[#ededed]/80 text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Price tag */}
          <div className="mb-6">
            <span className="text-4xl font-bold text-[#ededed]">₹10,000</span>
            <span className="text-[#ededed]/50 text-sm ml-1">/month</span>
          </div>

          {/* CTA Button */}
          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full py-4 bg-[#ffcc29] hover:bg-[#e6b825] disabled:opacity-60 disabled:cursor-not-allowed text-[#070A12] font-bold text-lg rounded-xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-[#ffcc29]/20 hover:shadow-[#ffcc29]/30"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Opening Payment...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                Pay & Activate Production
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>

          {/* Secure badge */}
          <p className="text-[#ededed]/40 text-xs mt-4">
            🔒 Secured by Razorpay • UPI, Cards, Net Banking accepted
          </p>

          {/* Logout link */}
          <button
            onClick={onLogout}
            className="mt-6 text-[#ededed]/40 hover:text-[#ededed]/70 text-sm transition-colors underline"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrialExpired;
