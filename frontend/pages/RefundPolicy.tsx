import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { LEGAL_ENTITY, LEGAL_BRAND, SUPPORT_EMAIL } from '../constants/legal';

const RefundPolicy: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const text = isDark ? 'text-[#ededed]' : 'text-gray-900';
  const textSec = isDark ? 'text-[#ededed]/70' : 'text-gray-600';
  const bg = isDark ? 'bg-[#070A12]' : 'bg-gray-50';
  const card = isDark ? 'bg-[#161b22]' : 'bg-white';
  const infoBox = isDark ? 'bg-[#070A12]' : 'bg-gray-50';
  const link = 'text-[var(--gv-accent-text)] hover:underline';
  const h2 = `text-xl font-bold mb-4 ${text}`;

  return (
    <div className={`min-h-screen ${bg}`}>
      <div className={`sticky top-0 z-10 backdrop-blur-md ${isDark ? 'bg-[#070A12]/80 border-b border-white/10' : 'bg-gray-50/80 border-b border-gray-200'}`}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} aria-label="Back" className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-[#ededed]' : 'hover:bg-gray-200 text-gray-900'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className={`text-lg font-semibold ${text}`}>Refund and Cancellation Policy</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className={`rounded-2xl p-8 md:p-12 ${card} shadow-lg`}>
          <div className="mb-10">
            <h1 className={`text-4xl font-bold mb-1 ${text}`}>NEBULAA</h1>
            <h2 className="text-2xl font-bold text-[var(--gv-accent-text)] mb-2">Refund and Cancellation Policy</h2>
            <p className={`text-sm italic ${textSec}`}>Effective Date: 16 October 2026 | Version 1.0</p>
            <p className={`text-sm italic ${textSec}`}>Governing Entity: {LEGAL_ENTITY}, India</p>
          </div>

          <div className={`space-y-8 leading-relaxed ${textSec}`}>
            <div className={`border-l-4 border-[#ffcc29] pl-4 italic ${textSec}`}>
              In short: you can cancel any time and keep using your plan until the month you paid for ends. Quarks for anything that fails come back automatically. Quarks you have used are not refunded. If we charge you by mistake, we refund it.
            </div>

            <section>
              <h2 className={h2}>1. Cancelling your plan</h2>
              <p className="mb-3">1.1 You can cancel your monthly plan yourself at any time. Open {LEGAL_BRAND}, go to Settings, then Billing, and choose Cancel plan. You do not need to write to us.</p>
              <p className="mb-3">1.2 Cancelling stops future charges. Your plan, and the Quarks that came with it, stay available until the end of the month you have already paid for. After that the plan ends and is not charged again.</p>
              <p className="mb-3">1.3 We email you three days before each monthly charge, with the date and the amount, so you can cancel before it happens.</p>
              <p>1.4 You can choose a plan again whenever you like. A new payment starts a new month.</p>
            </section>

            <section>
              <h2 className={h2}>2. Quarks and what happens to them</h2>
              <p className="mb-3">2.1 The Quarks in your plan are for the month in which they are given and end when that month ends. A new allowance is given when your plan renews.</p>
              <p className="mb-3">2.2 Quarks you buy as a top-up stay valid for 60 days from the date of your most recent top-up. They can be used while a plan is active. If your plan ends, they are held until their 60 days are over, and become usable again if you choose a plan again within that time.</p>
              <p>2.3 Quarks that have been used, and Quarks that have expired, are not refunded and cannot be exchanged for money.</p>
            </section>

            <section>
              <h2 className={h2}>3. When a post, picture or video fails</h2>
              <p className="mb-3">3.1 If something you ask for cannot be made, for any reason on our side or with our AI providers, the Quarks it would have used are returned to your account automatically. You do not need to ask.</p>
              <p className="mb-3">3.2 You can make it again straight away.</p>
            </section>

            <section>
              <h2 className={h2}>4. Our first-use promise</h2>
              <p className="mb-3">4.1 If the first thing you make after you start a plan is unusable because of a technical fault, such as a broken or unreadable result, write to us at <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>{SUPPORT_EMAIL}</a> within 7 days.</p>
              <p>4.2 We will either make it again for you or return the Quarks it used, whichever you prefer.</p>
            </section>

            <section>
              <h2 className={h2}>5. When we refund money</h2>
              <p className="mb-3">5.1 We refund a payment in full if:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>you were charged more than once for the same thing;</li>
                <li>you were charged an amount that is not the price you were shown, because of an error on our side; or</li>
                <li>the service was unavailable for more than 72 hours in a row in the first 7 days of a new plan, because of our failure, and you tell us within that time.</li>
              </ul>
              <p className="mb-3">5.2 Ask for a refund by writing to <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>{SUPPORT_EMAIL}</a> within 7 days of the charge. Use the email address of your account and tell us the date and amount, or the payment number on your invoice.</p>
              <p className="mb-3">5.3 When a refund is approved, we process it within 10 business days to the card, bank account or UPI you paid with. Your bank may take a few more days to show it.</p>
              <p>5.4 A refund of a payment includes the GST charged on it. We issue a matching credit note.</p>
            </section>

            <section>
              <h2 className={h2}>6. What we do not refund</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Quarks that were used, or that expired;</li>
                <li>a month that has already started, if you cancel part way through (you keep using it to the end instead);</li>
                <li>a result that was made as asked but is not to your taste. You can change it or make another with the Quarks you have; and</li>
                <li>charges for something that was delivered as described.</li>
              </ul>
            </section>

            <section>
              <h2 className={h2}>7. If we stop the service</h2>
              <p>If we ever stop offering {LEGAL_BRAND}, we will give at least 30 days' notice and refund the unused part of any month you have paid for.</p>
            </section>

            <section>
              <h2 className={h2}>8. Questions and complaints</h2>
              <div className={`rounded-lg p-5 space-y-1 ${infoBox}`}>
                <p><strong className={text}>{LEGAL_ENTITY}</strong></p>
                <p>Operating Platform: {LEGAL_BRAND} (nebulaa.ai)</p>
                <p>Support and refunds: <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>{SUPPORT_EMAIL}</a></p>
                <p>Complaints: the Grievance Officer named in our <a href="/#/privacy-policy" className={link}>Privacy Policy</a></p>
              </div>
              <p className="mt-4">This policy sits alongside our <a href="/#/terms" className={link}>Terms and Conditions</a> and <a href="/#/privacy-policy" className={link}>Privacy Policy</a>. If anything in them differs, this page applies to refunds and cancellation.</p>
              <p className={`mt-4 text-sm italic ${textSec}`}>Last Updated: 16 October 2026 | Document Version: 1.0</p>
            </section>
          </div>
        </div>

        <div className="text-center mt-10 pb-10">
          <p className={`text-sm ${isDark ? 'text-[#ededed]/50' : 'text-[var(--gv-text-tertiary)]'}`}>&copy; {new Date().getFullYear()} {LEGAL_ENTITY}. All rights reserved.</p>
          <div className={`mt-3 flex items-center justify-center gap-4 text-sm ${isDark ? 'text-[#ededed]/50' : 'text-[var(--gv-text-tertiary)]'}`}>
            <a href="/#/terms" className="hover:text-[var(--gv-accent-text)] transition-colors">Terms & Conditions</a>
            <span>|</span>
            <a href="/#/privacy-policy" className="hover:text-[var(--gv-accent-text)] transition-colors">Privacy Policy</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RefundPolicy;
