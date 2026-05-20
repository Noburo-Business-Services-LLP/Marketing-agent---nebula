import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Shield, ArrowRight, Sparkles } from 'lucide-react';
import { apiService, PlanInfo } from '../services/api';
import { SpaceBg, GlassCard } from '../components/StarfieldBg';

type Cycle = 'monthly' | 'quarterly' | 'annual';
type Tier = 'pro' | 'growth' | 'scale';

const TIER_ORDER: Tier[] = ['pro', 'growth', 'scale'];

const Plans: React.FC = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Record<Tier, PlanInfo> | null>(null);
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiService
      .getPlans()
      .then((res) => setPlans(res.plans))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (tier: Tier) => {
    if (!plans) return;
    const info = plans[tier].cycles[cycle];
    sessionStorage.setItem(
      'selectedPlan',
      JSON.stringify({
        tier,
        cycle,
        planId: info.planId,
        amount: info.amount,
        tierName: plans[tier].name,
        per: info.per,
      }),
    );
    navigate('/checkout');
  };

  if (loading) {
    return (
      <SpaceBg>
        <Loader2 className="w-10 h-10 animate-spin text-[#ffcc29]" />
      </SpaceBg>
    );
  }

  if (error || !plans) {
    return (
      <SpaceBg>
        <div className="max-w-md w-full">
          <GlassCard>
            <div className="p-8 text-center">
              <p className="text-red-400">{error || 'Failed to load plans'}</p>
            </div>
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
        <div className="text-center mb-10">
          <img
            src="/assets/nebulaa-gold.png"
            alt="Nebulaa"
            className="w-20 h-20 mx-auto mb-5 drop-shadow-[0_0_25px_rgba(255,204,41,0.3)]"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-3 tracking-tight">
            Pick the plan that fits your brand
          </h1>
          <p className="text-[#ededed]/50 text-base md:text-lg max-w-2xl mx-auto">
            All plans include AI campaign generation, multi-platform posting and analytics.
            Cancel anytime.
          </p>
        </div>

        <div className="flex justify-center mb-10">
          <div
            className="inline-flex rounded-2xl p-1.5"
            style={{
              background: 'linear-gradient(180deg, #0a0d14 0%, #0e1219 100%)',
              boxShadow:
                'inset 0 2px 6px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            {(Object.keys(cycleLabel) as Cycle[]).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`px-5 md:px-7 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  cycle === c
                    ? 'bg-[#ffcc29] text-[#070A12] shadow-lg shadow-[#ffcc29]/20'
                    : 'text-[#ededed]/55 hover:text-white'
                }`}
              >
                {cycleLabel[c]}
                {c === 'annual' && (
                  <span className="ml-2 text-[10px] font-bold text-emerald-400">
                    SAVE
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-7">
          {TIER_ORDER.map((tier) => {
            const plan = plans[tier];
            const info = plan.cycles[cycle];
            const highlighted = tier === 'growth';
            return (
              <GlassCard key={tier} highlighted={highlighted}>
                <div className="p-7 md:p-8 flex flex-col h-full">
                  {highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <div className="px-3 py-1 rounded-full bg-[#ffcc29] text-[#070A12] text-[11px] font-bold tracking-wide flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> MOST POPULAR
                      </div>
                    </div>
                  )}

                  <div className="mb-5">
                    <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                    <p className="text-[#ededed]/45 text-sm leading-relaxed">
                      {plan.description}
                    </p>
                  </div>

                  <div className="mb-6">
                    <div
                      className="text-[44px] font-extrabold leading-none tracking-tight"
                      style={{
                        background:
                          'linear-gradient(180deg, #ffffff 0%, #d4d4d4 50%, #a0a0a0 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                      }}
                    >
                      ₹{info.amount.toLocaleString('en-IN')}
                    </div>
                    <p className="text-[#ededed]/35 text-xs mt-2 tracking-wide">
                      {info.per} · Auto-renews · Cancel anytime
                    </p>
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
                    onClick={() => handleSelect(tier)}
                    className={`w-full py-3.5 rounded-2xl font-bold text-[14px] transition-all flex items-center justify-center gap-2 active:translate-y-[1px] ${
                      highlighted ? 'text-[#070A12]' : 'text-white'
                    }`}
                    style={
                      highlighted
                        ? {
                            background:
                              'linear-gradient(180deg, #ffd54f 0%, #ffcc29 40%, #e6b825 100%)',
                            boxShadow:
                              'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.15), 0 4px 12px rgba(255,204,41,0.35)',
                          }
                        : {
                            background:
                              'linear-gradient(180deg, #1e2433 0%, #161a24 100%)',
                            boxShadow:
                              'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)',
                          }
                    }
                  >
                    Choose {plan.name} <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>

        <div className="text-center mt-10 flex items-center justify-center gap-2 text-[#ededed]/25 text-xs">
          <Shield className="w-3.5 h-3.5" />
          <span>Secured by Razorpay · UPI, Cards, Net Banking, Wallets accepted</span>
        </div>
      </div>
    </SpaceBg>
  );
};

export default Plans;
