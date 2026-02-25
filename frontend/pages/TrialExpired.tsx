import React from 'react';
import { Clock, Sparkles, CreditCard, ArrowRight, Zap } from 'lucide-react';

interface TrialExpiredProps {
  reason: 'time' | 'credits';
  daysUsed?: number;
  creditsUsed?: number;
  onLogout: () => void;
}

const TrialExpired: React.FC<TrialExpiredProps> = ({ reason, daysUsed = 7, creditsUsed = 100, onLogout }) => {
  const handleSubscribe = () => {
    // TODO: Replace with Razorpay checkout when ready
    window.open('https://nebulaa.ai/pricing', '_blank');
  };

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
              ? `You've explored Nebulaa Gravity for ${daysUsed} days. Subscribe to unlock unlimited marketing power.`
              : `You've used all ${creditsUsed} trial credits. Subscribe to get 1,500 monthly credits and keep growing.`}
          </p>

          {/* What you get */}
          <div className="bg-[#070A12] rounded-xl p-6 mb-8 text-left">
            <h3 className="text-sm font-semibold text-[#ffcc29] uppercase tracking-wider mb-4">
              What you unlock with a subscription
            </h3>
            <div className="space-y-3">
              {[
                '1,500 credits per month',
                '+10 daily login bonus credits',
                'Unlimited AI campaign generation',
                'Full competitor analysis',
                'Multi-platform social posting',
                'Priority support'
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-[#ffcc29] flex-shrink-0" />
                  <span className="text-[#ededed]/80 text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTA Button */}
          <button
            onClick={handleSubscribe}
            className="w-full py-4 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] font-bold text-lg rounded-xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-[#ffcc29]/20 hover:shadow-[#ffcc29]/30"
          >
            <CreditCard className="w-5 h-5" />
            Subscribe to Nebulaa Gravity
            <ArrowRight className="w-5 h-5" />
          </button>

          {/* Pricing hint */}
          <p className="text-[#ededed]/40 text-xs mt-4">
            Plans start at ₹2,999/month. Cancel anytime.
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
