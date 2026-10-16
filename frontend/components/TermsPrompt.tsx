import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import { LEGAL_PAGES } from '../constants/legal';

/** One-time prompt for existing customers to agree to the updated Terms and Privacy Policy. Nothing works behind it until they do. */
const TermsPrompt: React.FC<{ onAccepted: () => void; onLogout: () => void }> = ({ onAccepted, onLogout }) => {
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    const r = await apiService.acceptCurrentTerms();
    setBusy(false);
    if (r.success) onAccepted(); else setError(r.message || 'We could not save that. Please try again.');
  };
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="w-full max-w-md rounded-2xl border border-[var(--gv-border-default)] p-6 shadow-2xl" style={{ background: '#fffdf8' }}>
        <h2 id="terms-title" className="font-serif-display text-[24px] leading-tight text-[var(--gv-text-primary)]">We have updated our Terms</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">Please read and agree to the updated Terms and Privacy Policy to keep using Nebulaa. It covers how plans renew, refunds, and how you can download or delete your data.</p>
        <label className="mt-4 flex items-start gap-2.5 text-[13px] text-[var(--gv-text-primary)]">
          <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--gv-accent)]" />
          <span>I agree to the {LEGAL_PAGES.filter((p) => /terms|privacy/i.test(p.label)).map((p, i) => <React.Fragment key={p.href}>{i > 0 && ' and '}<a href={p.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{p.label}</a></React.Fragment>)}.</span>
        </label>
        {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onLogout} className="rounded-lg border border-[var(--gv-border-default)] px-4 py-2.5 text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]">Sign out</button>
          <button type="button" onClick={go} disabled={!ticked || busy} className="inline-flex items-center gap-2 rounded-lg bg-[var(--gv-accent)] px-5 py-2.5 text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Agree and continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default TermsPrompt;
