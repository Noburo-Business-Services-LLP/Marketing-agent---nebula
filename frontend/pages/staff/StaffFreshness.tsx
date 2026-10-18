import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SLOW_AFTER_MS, SLOW_NOTICE, lastUpdatedText } from '../../utils/staffFreshness';
import type { Freshness } from '../../utils/staffFreshness';

/** True once `loading` has been true for the slow-notice time. */
export function useSlowNotice(loading: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) { setSlow(false); return undefined; }
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  return slow;
}

/** Plain note under a spinner, shown only after the page has been loading for a while. */
export const SlowNotice: React.FC<{ show: boolean }> = ({ show }) => (
  show ? <p role="status" className="mt-3 text-center text-sm text-[var(--gv-text-secondary)]">{SLOW_NOTICE}</p> : null
);

/** "Last updated 2:14 pm" with a Refresh button. The line shows only when the numbers came from the stored copy. */
export const LastUpdated: React.FC<{ freshness: Freshness; onRefresh: () => void; busy?: boolean }> = ({ freshness, onRefresh, busy }) => {
  const text = lastUpdatedText(freshness);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {text && <p className="text-xs text-[var(--gv-text-tertiary)]" role="status">{text}</p>}
      <button type="button" onClick={onRefresh} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
      </button>
    </div>
  );
};
