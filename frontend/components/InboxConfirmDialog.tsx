import React from 'react';
import { Loader2 } from 'lucide-react';
import AgencyDialog from './AgencyDialog';
import { BTN, BTN_MAIN, MUTED } from './inboxStyles';
import { autoConfirmText, autoConfirmTitle } from '../utils/inbox';

/** The question asked before automatic replies are turned on. Nothing is sent to the server until the owner says yes. */
const InboxConfirmDialog: React.FC<{ where: string; busy?: boolean; onCancel: () => void; onConfirm: () => void }> = ({ where, busy, onCancel, onConfirm }) => (
  <AgencyDialog title={autoConfirmTitle} onClose={onCancel} busy={busy}>
    <p className={`text-[14px] leading-relaxed ${MUTED}`}>{autoConfirmText(where)}</p>
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <button type="button" className={BTN} onClick={onCancel} disabled={busy}>Not now</button>
      <button type="button" className={BTN_MAIN} onClick={onConfirm} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        Turn on automatic replies
      </button>
    </div>
  </AgencyDialog>
);

export default InboxConfirmDialog;
