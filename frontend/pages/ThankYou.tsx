import React, { useEffect, useState } from 'react';
import { CheckCircle, Mail, Sparkles } from 'lucide-react';
import { SpaceBg, GlassCard } from '../components/StarfieldBg';

interface PaymentResult {
  name: string;
  email: string;
  tierName: string;
  amount: number;
  per: string;
  paymentId: string;
}

const ThankYou: React.FC = () => {
  const [result, setResult] = useState<PaymentResult | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('paymentResult');
    if (raw) setResult(JSON.parse(raw));
  }, []);

  return (
    <SpaceBg>
      <div className="max-w-lg w-full">
        <GlassCard highlighted>
          <div className="p-8 md:p-10 text-center">
            <div className="mx-auto w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-green-500/20">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-[#ededed] mb-3">
              Payment Successful
            </h1>
            <p className="text-[#ededed]/55 text-base mb-8">
              {result?.name ? `Thank you, ${result.name.split(' ')[0]}! ` : 'Thank you! '}
              Your subscription is active.
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
                    Subscription details
                  </p>
                </div>
                <Row label="Plan" value={result.tierName} />
                <Row
                  label="Amount paid"
                  value={`₹${result.amount.toLocaleString('en-IN')} ${result.per}`}
                />
                <Row label="Email" value={result.email} />
                <Row
                  label="Payment ID"
                  value={result.paymentId}
                  mono
                />
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

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="flex justify-between items-start py-1.5 text-sm">
    <span className="text-[#ededed]/50">{label}</span>
    <span
      className={`text-[#ededed] font-medium text-right ml-3 break-all ${
        mono ? 'font-mono text-xs' : ''
      }`}
    >
      {value}
    </span>
  </div>
);

export default ThankYou;
