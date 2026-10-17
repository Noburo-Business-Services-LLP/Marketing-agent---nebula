import React, { useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import { cancelExtraConfirmText, cancelExtraDoneText, cancelExtraMessage } from '../utils/agencyPlan';
import AgencyDialog from './AgencyDialog';

const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3.5 min-h-[40px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50';
const BTN_MAIN = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 min-h-[40px] text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-50';

type Props = {
  /** The client limit today. */
  limit: number;
  onClose: () => void;
  /** Called once the server has confirmed, so the page behind can reload its numbers. */
  onCancelled: () => void;
};

/** Confirms, in plain words, that one extra client place will end with the paid month. Shows the server's refusal if there is one. */
const CancelExtraClientDialog: React.FC<Props> = ({ limit, onClose, onCancelled }) => {
  const [phase, setPhase] = useState<'confirm' | 'working' | 'done'>('confirm');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const run = async () => {
    setPhase('working'); setError('');
    try {
      const r = await apiService.cancelExtraClient();
      if (!r?.success) throw r;
      setMessage(cancelExtraDoneText(r)); setPhase('done'); onCancelled();
    } catch (e) { setError(cancelExtraMessage(e)); setPhase('confirm'); }
  };
  const working = phase === 'working';

  if (phase === 'done') {
    return (
      <AgencyDialog title="Extra client place ending" onClose={onClose}>
        <p role="status" className="flex items-start gap-2 text-[14px] leading-relaxed text-[var(--gv-text-primary)]"><Check className="mt-0.5 h-4 w-4 shrink-0" />{message}</p>
        <div className="mt-4 flex justify-end"><button type="button" className={BTN_MAIN} onClick={onClose}>Done</button></div>
      </AgencyDialog>
    );
  }
  return (
    <AgencyDialog title="Cancel an extra client" onClose={onClose} busy={working}>
      <div className="space-y-2 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">
        {cancelExtraConfirmText(limit).map((line, i) => <p key={i}>{line}</p>)}
      </div>
      {error && <p role="alert" className="mt-3 flex items-start gap-1.5 text-[13px] leading-relaxed text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={BTN} onClick={onClose} disabled={working}>Keep it</button>
        <button type="button" className={BTN_MAIN} onClick={run} disabled={working}>
          {working ? <><Loader2 className="h-4 w-4 animate-spin" /> Cancelling</> : 'Cancel this extra client'}
        </button>
      </div>
    </AgencyDialog>
  );
};

export default CancelExtraClientDialog;
