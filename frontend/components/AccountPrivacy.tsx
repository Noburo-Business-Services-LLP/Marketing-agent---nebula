import React, { useEffect, useState } from 'react';
import { Download, Trash2, Loader2, AlertCircle, Check } from 'lucide-react';
import { apiService } from '../services/api';
import { canConfirmDeletion } from '../utils/accountDeletion';

const input = 'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] outline-none focus:border-[var(--gv-accent)]';
const card = 'rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] p-5';

/** Settings, Security: download everything held about the account, or ask for the account to be deleted. */
const AccountPrivacy: React.FC<{ onDeletionRequested: (purgeAfter: string) => void }> = ({ onDeletionRequested }) => {
  const [status, setStatus] = useState<{ canDelete: boolean; reason: string; graceDays: number } | null>(null);
  const [exportPw, setExportPw] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { apiService.getAccountStatus().then((r) => { if (r?.success) setStatus(r); }).catch(() => undefined); }, []);

  const download = async () => {
    setExporting(true); setExportMsg(null);
    const r = await apiService.downloadMyData(exportPw);
    setExporting(false);
    setExportMsg(r.success ? { ok: true, text: 'Your data was downloaded as a file.' } : { ok: false, text: r.message || 'We could not prepare your data.' });
    if (r.success) setExportPw('');
  };

  const remove = async () => {
    setBusy(true); setError('');
    const r = await apiService.requestAccountDeletion(pw, typed.trim());
    setBusy(false);
    if (r.success && r.purgeAfter) onDeletionRequested(r.purgeAfter);
    else setError(r.message || 'We could not start the deletion. Nothing was changed.');
  };

  const days = status?.graceDays ?? 14;

  return (
    <div className="mt-10 space-y-5">
      <div className={card}>
        <h3 className="flex items-center gap-2 text-[16px] font-semibold text-[var(--gv-text-primary)]"><Download className="h-4 w-4 text-[var(--gv-accent)]" /> Download my data</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">One file with your profile, posts, videos, brand details, messages and payments. You can download it once a day. Enter your password to confirm it is you.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="password" autoComplete="current-password" value={exportPw} onChange={(e) => setExportPw(e.target.value)} placeholder="Your password" className={`${input} max-w-xs`} aria-label="Password to download your data" />
          <button type="button" onClick={download} disabled={exporting || !exportPw} className="inline-flex items-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 py-2.5 text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-50">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download
          </button>
        </div>
        {exportMsg && <p className={`mt-2 flex items-center gap-1.5 text-[13px] ${exportMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{exportMsg.ok ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{exportMsg.text}</p>}
      </div>

      <div className={`${card} border-red-300/60`}>
        <h3 className="flex items-center gap-2 text-[16px] font-semibold text-[var(--gv-text-primary)]"><Trash2 className="h-4 w-4 text-red-600" /> Delete my account</h3>
        {status && !status.canDelete ? (
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">{status.reason}</p>
        ) : !open ? (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">Deleting removes your posts, videos, brand details, messages and connected accounts for good. Your plan stops straight away. You have {days} days to change your mind before anything is erased. Invoices and payment records are kept for the years the law requires.</p>
            <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-lg border border-red-400 px-4 py-2.5 text-[13px] font-semibold text-red-600 hover:bg-red-50">Delete my account</button>
          </>
        ) : (
          <div className="mt-2">
            <p className="text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">Download your data above first if you want a copy. Then enter your password and type DELETE. Your plan stops now, and everything is erased after {days} days unless you restore the account.</p>
            <div className="mt-3 grid gap-2 sm:max-w-sm">
              <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password" className={input} aria-label="Password to delete your account" />
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type DELETE" className={input} aria-label="Type DELETE to confirm" />
            </div>
            {error && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-red-600"><AlertCircle className="h-4 w-4" />{error}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => { setOpen(false); setPw(''); setTyped(''); setError(''); }} className="rounded-lg border border-[var(--gv-border-default)] px-4 py-2.5 text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]">Keep my account</button>
              <button type="button" onClick={remove} disabled={busy || !canConfirmDeletion(pw, typed)} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete my account
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountPrivacy;
