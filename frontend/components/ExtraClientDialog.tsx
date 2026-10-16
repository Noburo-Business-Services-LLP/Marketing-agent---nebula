import React, { useCallback, useState } from 'react';
import { AlertCircle, Check, Loader2, Plus } from 'lucide-react';
import { apiService } from '../services/api';
import { slotConfirmText } from '../utils/agencyPlan';
import { startSlotPurchase } from '../utils/slotPurchase';
import AgencyDialog from './AgencyDialog';

const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3.5 min-h-[40px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50';
const BTN_MAIN = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 min-h-[40px] text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-50';

type Props = {
  slot: { inr?: number; gstPaise?: number; chargePaise?: number } | undefined;
  agency: { includedClients: number; maxClients: number; slotInr?: number } | undefined;
  /** The client limit today. */
  limit: number;
  onClose: () => void;
  /** Called once the server has confirmed the extra client, so the page behind can reload its numbers. */
  onAdded: (newLimit: number | null) => void;
};

/** Confirms the price, runs the payment window, and reports the result in plain words. */
const ExtraClientDialog: React.FC<Props> = ({ slot, agency, limit, onClose, onAdded }) => {
  const [phase, setPhase] = useState<'confirm' | 'paying' | 'done'>('confirm');
  const [error, setError] = useState('');
  const [paymentTaken, setPaymentTaken] = useState(false);
  const [message, setMessage] = useState('');

  const pay = useCallback(async () => {
    setPhase('paying'); setError('');
    await startSlotPurchase(apiService, {
      description: `Extra client, monthly${slot?.inr ? `, ₹${slot.inr.toLocaleString('en-IN')} plus GST` : ''}`,
      onConfirmed: (m, newLimit) => { setMessage(m); setPhase('done'); onAdded(newLimit); },
      onProblem: (m, taken) => { setError(m); setPaymentTaken(taken); setPhase('confirm'); },
      onClosed: () => setPhase('confirm'),
    });
  }, [slot, onAdded]);

  const paying = phase === 'paying';
  const close = useCallback(() => { if (!paying) onClose(); }, [paying, onClose]);

  if (phase === 'done') {
    return (
      <AgencyDialog title="Extra client added" onClose={close}>
        <p role="status" className="flex items-start gap-2 text-[14px] leading-relaxed text-[var(--gv-text-primary)]"><Check className="mt-0.5 h-4 w-4 shrink-0" />{message}</p>
        <div className="mt-4 flex justify-end"><button type="button" className={BTN_MAIN} onClick={onClose}>Done</button></div>
      </AgencyDialog>
    );
  }

  return (
    <AgencyDialog title="Add an extra client" onClose={close}>
      <div className="space-y-2 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">
        {slotConfirmText(slot, agency, limit).map((line, i) => <p key={i}>{line}</p>)}
      </div>
      {error && <p role="alert" className="mt-3 flex items-start gap-1.5 text-[13px] leading-relaxed text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={BTN} onClick={close} disabled={paying}>{paymentTaken ? 'Close' : 'Cancel'}</button>
        {!paymentTaken && (
          <button type="button" className={BTN_MAIN} onClick={pay} disabled={paying}>
            {paying ? <><Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment</> : <><Plus className="h-4 w-4" /> Continue to payment</>}
          </button>
        )}
      </div>
    </AgencyDialog>
  );
};

export default ExtraClientDialog;
