import React, { useState } from 'react';
import { Loader2, RotateCcw, LogOut } from 'lucide-react';
import { apiService } from '../services/api';
import { clientBrandsErasedText, daysUntil, longDate } from '../utils/accountDeletion';
import type { User } from '../types';

/** Shown instead of the app while an account waits to be deleted. The only choices are to restore it or sign out. */
const DeletionPending: React.FC<{ user: User; onRestored: (u: User) => void; onLogout: () => void }> = ({ user, onRestored, onLogout }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const left = daysUntil(user.deletion?.purgeAfter);
  const restore = async () => {
    setBusy(true); setError('');
    const r = await apiService.restoreAccount();
    if (!r.success) { setBusy(false); setError(r.message || 'We could not restore the account. Please try again.'); return; }
    const me = await apiService.getCurrentUser();
    setBusy(false);
    if (me.user) onRestored(me.user); else setError('Your account is restored. Please sign in again.');
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--gv-bg)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] p-7 shadow-xl">
        <h1 className="font-serif-display text-[26px] leading-tight text-[var(--gv-text-primary)]">Your account is set to be deleted</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">
          Everything will be erased on {longDate(user.deletion?.purgeAfter) || 'the date shown in your email'}{left > 0 ? `, in ${left} ${left === 1 ? 'day' : 'days'}` : ''}. {clientBrandsErasedText(user.agency?.clientCount)} Your plan has already stopped. If you restore the account now, your posts, videos and settings come back as they were. Scheduled posts return to your calendar. A plan has to be started again.
        </p>
        {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={restore} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[var(--gv-accent)] px-5 py-2.5 text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Restore my account
          </button>
          <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg border border-[var(--gv-border-default)] px-4 py-2.5 text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      </div>
    </div>
  );
};

export default DeletionPending;
