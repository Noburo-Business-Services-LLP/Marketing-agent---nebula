import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { inboxAPI, InboxPendingApproval } from '../services/api';
import {
  GONE_LINE, PENDING_EMPTY, PENDING_HELP, PENDING_TITLE, approveBody, canApprove, failureFromError, pendingAuthor, pendingBadge,
  pendingWhere, notSentLine, timeAgo,
} from '../utils/inbox';
import { BTN, BTN_MAIN, CARD, ERROR_TEXT, FIELD, MUTED, TEXT } from './inboxStyles';
import { customerMessage } from '../utils/errors';

/**
 * The replies Nebulaa drafted and is holding for the owner. Each one can be edited, sent or discarded.
 * A failed send stays on the card with its reason; the card leaves the list only when the server says it was sent.
 */
const PendingApprovals: React.FC<{ onChanged?: (count: number) => void }> = ({ onChanged }) => {
  const [items, setItems] = useState<InboxPendingApproval[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, 'send' | 'discard' | undefined>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [sentNote, setSentNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await inboxAPI.getPending();
      setItems(res.pending || []);
      setLoadError('');
      onChanged?.(res.pendingCount ?? (res.pending || []).length);
    } catch (e: any) {
      setLoadError(customerMessage(e, 'We could not load the replies waiting for you. Please try again.'));
    } finally {
      setLoaded(true);
    }
  }, [onChanged]);

  useEffect(() => { load(); }, [load]);

  const remove = (id: string) => {
    setItems((cur) => {
      const next = cur.filter((i) => i.id !== id);
      onChanged?.(next.length);
      return next;
    });
  };

  const approve = async (item: InboxPendingApproval) => {
    setBusy((b) => ({ ...b, [item.id]: 'send' }));
    setFailures((f) => { const { [item.id]: _gone, ...rest } = f; return rest; });
    setSentNote('');
    try {
      const body = approveBody(item.draft_text, edits[item.id]);
      const res = await inboxAPI.approvePending(item.id, body.text);
      if (res && res.success === true && res.message?.status !== 'failed') {
        remove(item.id);
        setSentNote(`Your reply to ${pendingAuthor(item)} was sent.`);
      } else {
        setFailures((f) => ({ ...f, [item.id]: notSentLine(res?.message?.error_message) }));
      }
    } catch (e: any) {
      if (e && e.status === 404) {
        setFailures((f) => ({ ...f, [item.id]: GONE_LINE }));
        load();
      } else {
        setFailures((f) => ({ ...f, [item.id]: notSentLine(failureFromError(e).reason) }));
      }
    } finally {
      setBusy((b) => ({ ...b, [item.id]: undefined }));
    }
  };

  const discard = async (item: InboxPendingApproval) => {
    setBusy((b) => ({ ...b, [item.id]: 'discard' }));
    try {
      await inboxAPI.discardPending(item.id);
      remove(item.id);
    } catch (e: any) {
      if (e && e.status === 404) { remove(item.id); }
      else setFailures((f) => ({ ...f, [item.id]: 'We could not discard this reply. Please try again.' }));
    } finally {
      setBusy((b) => ({ ...b, [item.id]: undefined }));
    }
  };

  return (
    <section aria-labelledby="pending-title" className={`${CARD} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="pending-title" className={`text-[18px] font-semibold ${TEXT}`}>{PENDING_TITLE}</h2>
        <span
          aria-label={`${items.length} waiting`}
          className={`inline-flex min-w-[24px] items-center justify-center rounded-full px-2 py-0.5 text-[12px] font-bold ${items.length ? 'bg-[var(--gv-accent)] text-[var(--gv-accent-ink)]' : 'bg-[var(--gv-surface-2)] text-[var(--gv-text-secondary)]'}`}
        >
          {pendingBadge(items.length)}
        </span>
      </div>

      {sentNote && <p role="status" className={`mt-2 flex items-center gap-1.5 text-[13px] ${TEXT}`}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{sentNote}</p>}

      {!loaded && <div className="py-4" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" aria-hidden="true" /></div>}

      {loaded && loadError && (
        <div className="mt-2">
          <p role="alert" className={`text-[14px] ${ERROR_TEXT}`}>{loadError}</p>
          <button type="button" className={`${BTN} mt-2`} onClick={load}>Try again</button>
        </div>
      )}

      {loaded && !loadError && items.length === 0 && <p className={`mt-1 text-[14px] ${MUTED}`}>{PENDING_EMPTY}</p>}

      {loaded && items.length > 0 && (
        <>
          <p className={`mt-1 text-[14px] leading-relaxed ${MUTED}`}>{PENDING_HELP}</p>
          <ul className="mt-3 space-y-3">
            {items.map((item) => {
              const working = busy[item.id];
              const value = edits[item.id] ?? item.draft_text ?? '';
              return (
                <li key={item.id} className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-3 sm:p-4">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className={`text-[14px] font-semibold ${TEXT}`}>{pendingAuthor(item)}</p>
                    <p className={`text-[12px] ${MUTED}`}>{pendingWhere(item)}{item.created_at ? `, ${timeAgo(item.created_at)} ago` : ''}</p>
                  </div>
                  {item.original_message && <p className={`mt-1 whitespace-pre-wrap text-[14px] leading-relaxed ${TEXT}`}>{item.original_message}</p>}
                  {item.reason && <p className={`mt-1 text-[12px] ${MUTED}`}>Why it is waiting: {item.reason}</p>}
                  <label className={`mt-3 block text-[12px] font-semibold ${MUTED}`} htmlFor={`pending-${item.id}`}>Suggested reply (you can change it)</label>
                  <textarea
                    id={`pending-${item.id}`}
                    value={value}
                    onChange={(e) => setEdits((cur) => ({ ...cur, [item.id]: e.target.value }))}
                    rows={3}
                    disabled={Boolean(working)}
                    className={`${FIELD} mt-1 resize-y`}
                  />
                  {failures[item.id] && (
                    <p role="alert" className={`mt-2 flex items-start gap-1.5 text-[13px] leading-relaxed ${ERROR_TEXT}`}>
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{failures[item.id]}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={BTN_MAIN} onClick={() => approve(item)} disabled={Boolean(working) || !canApprove(edits[item.id], item.draft_text)}>
                      {working === 'send' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                      Approve and send
                    </button>
                    <button type="button" className={BTN} onClick={() => discard(item)} disabled={Boolean(working)}>
                      {working === 'discard' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                      Discard
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
};

export default PendingApprovals;
