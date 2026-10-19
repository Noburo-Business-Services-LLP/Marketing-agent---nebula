import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { inboxAPI, InboxPendingApproval } from '../services/api';
import {
  GONE_LINE, PENDING_EMPTY, PENDING_HELP, PENDING_TITLE, approveBody, canApprove, failureFromError, pendingAuthor, pendingBadge,
  pendingWhere, notSentLine, timeAgo,
} from '../utils/inbox';
import { customerMessage } from '../utils/errors';
import { approvalReason } from '../utils/inboxView';
import { InboxAvatar } from './inbox/InboxOverview';
import './inbox/inbox.css';

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

  // Nothing waiting and nothing to report: the tile above already says so, so the card stays out of the way.
  if (loaded && !loadError && items.length === 0 && !sentNote) return null;

  return (
    <section aria-labelledby="pending-title" className="nb-ix-card nb-ix-approvals">
      <div className="nb-ix-section-head">
        <h2 id="pending-title">
          {PENDING_TITLE}
          <span className="nb-ix-count" data-zero={items.length ? 'false' : 'true'} aria-label={`${items.length} waiting`}>{pendingBadge(items.length)}</span>
        </h2>
      </div>

      {sentNote && <p role="status" className="nb-ix-muted inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{sentNote}</p>}

      {!loaded && <div role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" aria-hidden="true" /></div>}

      {loaded && loadError && (
        <div>
          <p role="alert" className="nb-ix-alert"><AlertCircle aria-hidden="true" />{loadError}</p>
          <button type="button" className="nb-ix-btn2 mt-2" onClick={load}>Try again</button>
        </div>
      )}

      {loaded && !loadError && items.length === 0 && <p>{PENDING_EMPTY}</p>}

      {loaded && items.length > 0 && (
        <>
          <p>{PENDING_HELP}</p>
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => {
              const working = busy[item.id];
              const value = edits[item.id] ?? item.draft_text ?? '';
              const why = approvalReason(item.reason);
              return (
                <li key={item.id} className="nb-ix-approval">
                  <div className="nb-ix-approval-who">
                    <InboxAvatar name={pendingAuthor(item)} platform={item.platform || item.conversation?.platform} />
                    <div>
                      <p className="nb-ix-approval-name">{pendingAuthor(item)}</p>
                      <p className="nb-ix-approval-where">{pendingWhere(item)}{item.created_at ? `, ${timeAgo(item.created_at)} ago` : ''}</p>
                      {item.original_message && <p className="nb-ix-quote">{item.original_message}</p>}
                      {why && <p className="nb-ix-reason">Why it waits: {why}</p>}
                    </div>
                  </div>
                  <div className="nb-ix-approval-draft">
                    <label htmlFor={`pending-${item.id}`}>Suggested reply (you can change it)</label>
                    <textarea
                      id={`pending-${item.id}`}
                      value={value}
                      onChange={(e) => setEdits((cur) => ({ ...cur, [item.id]: e.target.value }))}
                      rows={3}
                      disabled={Boolean(working)}
                      className="nb-ix-field"
                    />
                    {failures[item.id] && (
                      <p role="alert" className="nb-ix-alert"><AlertCircle aria-hidden="true" />{failures[item.id]}</p>
                    )}
                    <div className="nb-ix-row-actions">
                      <button type="button" className="nb-ix-btn" onClick={() => approve(item)} disabled={Boolean(working) || !canApprove(edits[item.id], item.draft_text)}>
                        {working === 'send' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                        Approve and send
                      </button>
                      <button type="button" className="nb-ix-btn2" onClick={() => discard(item)} disabled={Boolean(working)}>
                        {working === 'discard' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                        Discard
                      </button>
                    </div>
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
