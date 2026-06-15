import React, { useEffect, useState } from 'react';
import { CheckCircle, Mail, Sparkles, Calendar } from 'lucide-react';
import { SpaceBg, GlassCard } from '../components/StarfieldBg';

interface PaymentResult {
  name: string;
  email: string;
  tierName: string;
  amount: number;
  per: string;
  paymentId: string;
  trialDays?: number;
  trialEndsAt?: string | null;
}

const ThankYou: React.FC = () => {
  const [result, setResult] = useState<PaymentResult | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('paymentResult');
    if (raw) setResult(JSON.parse(raw));
  }, []);

  const trialDays = result?.trialDays ?? 7;
  const trialEndDate = result?.trialEndsAt
    ? new Date(result.trialEndsAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <SpaceBg>
      <div className="max-w-lg w-full">
        <GlassCard highlighted>
          <div className="p-8 md:p-10 text-center">
            <div className="mx-auto w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-emerald-500/20">
              <CheckCircle className="w-10 h-10 text-emerald-400" />
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">
              Your {trialDays}-day free trial has started
            </h1>
            <p className="text-[#ededed]/55 text-base mb-8">
              {result?.name ? `Welcome, ${result.name.split(' ')[0]}! ` : 'Welcome! '}
              No charge today. You'll only be billed if you keep the subscription past the trial.
            </p>

            {result && (
              <div
                className="rounded-2xl p-5 mb-7 text-left"
                style={{
                  background: 'linear-gradient(180deg, #0a0d14 0%, #0e1219 100%)',
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4)',
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-[#ffcc29]" />
                  <p className="text-[10px] font-bold text-[#ededed]/45 uppercase tracking-[0.18em]">
                    Trial details
                  </p>
                </div>
                <Row label="Plan" value={result.tierName} />
                <Row label="Due today" value="₹0" highlight />
                <Row
                  label="First charge"
                  value={`₹${result.amount.toLocaleString('en-IN')} ${result.per}`}
                />
                {trialEndDate && (
                  <Row label="First charge date" value={trialEndDate} />
                )}
                <Row label="Email" value={result.email} />
                <Row label="Subscription ID" value={result.paymentId} mono />
              </div>
            )}

            {trialEndDate && (
              <div className="flex items-center justify-center gap-2 text-amber-400/80 text-xs mb-4 px-4 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  Cancel before {trialEndDate} to avoid being charged
                </span>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-[#ededed]/45 text-sm mb-2">
              <Mail className="w-4 h-4" />
              <span>A confirmation email is on the way</span>
            </div>
            <p className="text-[#ededed]/30 text-xs">
              Our team will reach out within 24 hours to help you get started.
            </p>
          </div>
        </GlassCard>

        <p className="text-center text-[#ededed]/25 text-xs mt-6">
          Need help? Email us at <span className="text-[#ededed]/45">support@nebulaa.ai</span>
        </p>
      </div>
    </SpaceBg>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean; highlight?: boolean }> = ({
  label,
  value,
  mono,
  highlight,
}) => (
  <div className="flex justify-between items-start py-1.5 text-sm">
    <span className="text-[#ededed]/50">{label}</span>
    <span
      className={`font-medium text-right ml-3 break-all ${
        mono ? 'font-mono text-xs text-[#ededed]' : highlight ? 'text-emerald-400 font-bold' : 'text-[#ededed]'
      }`}
    >
      {value}
    </span>
  </div>
);

export default ThankYou;
