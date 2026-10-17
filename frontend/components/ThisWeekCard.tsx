import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Film, FileText, Images, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import type { WeekItem, WeekPrefill, WeekProposal, WeekResponse, WeekWriteResponse } from '../types';
import { actionsFor, buildPrefill, cardState, countsOf, headline, isSlow, isWorking, itemAction, itemLine, pollDelay, scaledNote, visibleCount } from '../utils/week';
import { setPrefill } from '../utils/prefill';

const CARD = 'mb-8 rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-4 sm:p-6';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]';
const BTN_MAIN = `inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 min-h-[44px] text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-50 ${FOCUS}`;
const BTN = `inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 min-h-[44px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50 ${FOCUS}`;
const LOAD_ERROR = 'We could not load this week. Please try again.';

const KIND_ICON = { post: FileText, carousel: Images, video: Film } as const;
const KIND_LABEL = { post: 'Post', carousel: 'Carousel', video: 'Video' } as const;

/** This week's proposal from the plan: approve it, skip it, or change single posts. Shown to customers (and a CSM pass), never to staff themselves. */
const LINK = `inline-flex items-center rounded-md px-2.5 min-h-[32px] max-sm:min-h-[44px] text-[12.5px] font-medium text-[var(--gv-text-secondary)] underline-offset-2 hover:text-[var(--gv-text-primary)] hover:underline disabled:opacity-50 ${FOCUS}`;

interface Props { language?: string | null }
const ThisWeekCard: React.FC<Props> = ({ language }) => {
  const navigate = useNavigate();
  const [res, setRes] = useState<WeekResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [prefills, setPrefills] = useState<WeekPrefill[]>([]);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const workingSince = useRef<number | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await apiService.getWeek();
      if (!alive.current) return;
      setRes(r); setError('');
    } catch {
      if (alive.current) setError(LOAD_ERROR);
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  const proposal: WeekProposal | null = (res && res.proposal) || null;
  const working = isWorking(proposal);
  useEffect(() => {
    if (!working) { workingSince.current = null; return undefined; }
    if (workingSince.current === null) workingSince.current = Date.now();
    // load() never throws (a failed poll only sets a message), so the next check is always scheduled.
    // After three minutes the card says it is taking longer and checks less often.
    const t = setTimeout(() => { load(); }, pollDelay(Date.now() - workingSince.current));
    return () => clearTimeout(t);
  }, [working, load, res, error]);

  const slow = working && workingSince.current !== null && isSlow(Date.now() - workingSince.current);

  useEffect(() => { if (editing) document.getElementById(`topic-${editing}`)?.focus(); }, [editing]);
  const cancelEdit = (id: string) => { setEditing(null); setError(''); setTimeout(() => document.getElementById(`change-${id}`)?.focus(), 0); };

  const apply = (r: WeekWriteResponse, ok: string) => {
    if (!alive.current) return false;
    if (!r || !r.success) { setError((r && r.message) || 'Something went wrong. Please try again.'); return false; }
    setError('');
    if (r.proposal) setRes((cur) => ({ ...(cur || { eligible: true }), eligible: true, reason: '', topUp: false, proposal: r.proposal }));
    if (ok) setStatus(ok);
    return true;
  };

  const approve = async (ids?: string[]) => {
    setBusy(true); setError('');
    const r = await apiService.approveWeek(ids);
    setBusy(false);
    if (apply(r, ids ? 'Making that post again…' : 'Approved. We are making your posts now.')) {
      if (Array.isArray(r.prefills)) setPrefills((cur) => [...cur.filter((p) => !r.prefills!.some((n) => n.itemId === p.itemId)), ...r.prefills!]);
      setTimeout(() => statusRef.current && statusRef.current.focus(), 0);
    }
  };
  const skipWeek = async () => {
    setBusy(true);
    const r = await apiService.skipWeek();
    setBusy(false);
    if (apply(r, 'Skipped. Nothing will be made this week.')) setTimeout(() => statusRef.current && statusRef.current.focus(), 0);
  };
  const skipItem = async (id: string) => {
    setBusy(true);
    const idx = items.findIndex((i) => i.id === id);
    const r = await apiService.changeWeekItem(id, 'skip');
    setBusy(false);
    if (apply(r, 'Removed from this week.')) {
      // Focus moves to the next row's first control, or to the status line when none are left.
      setTimeout(() => {
        const next = listRef.current?.querySelectorAll('li')[Math.max(0, idx)]?.querySelector<HTMLElement>('button, a');
        (next || statusRef.current)?.focus();
      }, 0);
    }
  };
  const swapItem = async (id: string) => {
    if (!topic.trim()) { setError('Write the topic you want instead.'); return; }
    setBusy(true);
    const r = await apiService.changeWeekItem(id, 'swap', topic.trim());
    setBusy(false);
    if (apply(r, 'Topic changed.')) { setEditing(null); setTopic(''); setTimeout(() => statusRef.current?.focus(), 0); }
  };
  const makeIt = (item: WeekItem) => {
    const p = prefills.find((x) => x.itemId === item.id);
    if (p) {
      setPrefill(p.target, p.prefill as never);
      navigate(p.route);
    } else {
      const b = buildPrefill(item, language, proposal && proposal.weekStart ? String(proposal.weekStart).slice(0, 10) : undefined);
      if (b.target === 'video') setPrefill('video', b.prefill); else setPrefill('carousel', b.prefill);
      navigate(b.target === 'video' ? '/reels' : '/campaigns');
    }
  };

  const state = cardState(res);
  if (!loaded && !res) return null;
  if (state === 'not_eligible') return error && !res ? <div className={CARD} role="alert"><p className="text-[14px] text-[var(--gv-text-secondary)]">{error}</p></div> : null;

  const items = (proposal?.items || []).filter((i) => i.status !== 'skipped');
  const counts = countsOf(proposal);
  const note = scaledNote(proposal);
  const actions = actionsFor(state);
  const live = (
    <p ref={statusRef} tabIndex={-1} aria-live="polite" className="mt-3 text-[13px] text-[var(--gv-text-secondary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gv-accent)]">{status}</p>
  );

  let top: React.ReactNode = null;
  if (state === 'no_plan') top = <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">Your plan is being built; this card appears when it is ready.</p>;
  else if (state === 'top_up') top = (
    <>
      <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">There is not enough left to make this week's posts.</p>
      <div className="mt-4"><Link to="/trial-expired" className={BTN_MAIN}>Top up to make this week's posts</Link></div>
    </>
  );
  else if (state === 'done') top = <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">Nothing left to make this week. Your next suggestions appear on Monday.</p>;
  else if (state === 'skipped') top = <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">You skipped this week. Your next plan appears here next week.</p>;
  else if (state === 'empty') top = <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">{headline(counts)}</p>;
  else top = <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">{state === 'ready' ? headline(counts) : 'Here is where this week stands.'}</p>;

  return (
    <section aria-labelledby="this-week-title" className={CARD}>
      <h2 id="this-week-title" className="text-[18px] font-semibold text-[var(--gv-text-primary)]">This week</h2>
      {top}
      {note && state !== 'top_up' && <p className="mt-3 rounded-lg bg-[var(--gv-surface-2)] px-3 py-2 text-[13px] text-[var(--gv-text-secondary)]">{note}</p>}
      {error && <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--gv-text-primary)]">{error}</p>}

      {items.length > 0 && state !== 'top_up' && state !== 'skipped' && (
        <ul ref={listRef} className="mt-4 divide-y divide-[var(--gv-border-subtle)] rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
          {items.slice(0, visibleCount(items.length, expanded)).map((item) => {
            const Icon = KIND_ICON[item.kind] || FileText;
            const line = itemLine(item);
            const canMake = item.kind !== 'post' && item.status === 'approved';
            const making = item.status === 'making' || (item.kind === 'post' && item.status === 'approved');
            const act = itemAction(item);
            return (
              <li key={item.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <Icon className="h-4 w-4 shrink-0 text-[var(--gv-text-tertiary)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="break-words text-[14px] font-medium leading-snug text-[var(--gv-text-primary)]">{item.topic}</div>
                    <div className="text-[12px] text-[var(--gv-text-tertiary)]">
                      {KIND_LABEL[item.kind]}{item.channel ? ` · ${item.channel}` : ''}{line ? ` · ${line}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1 max-[380px]:basis-full max-[380px]:pl-7">
                    {making && (slow
                      ? <span className="px-1 text-[12.5px] text-[var(--gv-text-secondary)]">This is taking longer than usual. It will finish in the background.</span>
                      : <span className="inline-flex items-center gap-2 px-1 text-[12.5px] text-[var(--gv-text-secondary)]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Making…</span>)}
                    {act === 'retry' && <button type="button" className={BTN} disabled={busy} onClick={() => approve([item.id])}>Try again</button>}
                    {act === 'top_up' && <Link to="/trial-expired" className={LINK}>Top up</Link>}
                    {item.kind === 'post' && item.status === 'made' && <Link to="/drafts" className={LINK}>Review and approve</Link>}
                    {canMake && <button type="button" className={BTN_MAIN} onClick={() => makeIt(item)}>{item.kind === 'video' ? 'Make this video' : 'Make this carousel'}</button>}
                    {actions.changeItems && editing !== item.id && (
                      <>
                        <button type="button" id={`change-${item.id}`} className={LINK} disabled={busy} aria-label={`Change ${item.topic}`} onClick={() => { setEditing(item.id); setTopic(''); setError(''); }}>Change</button>
                        <button type="button" className={LINK} disabled={busy} aria-label={`Skip ${item.topic}`} onClick={() => skipItem(item.id)}>Skip</button>
                      </>
                    )}
                  </div>
                </div>
                {editing === item.id && (
                  <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); swapItem(item.id); }}>
                    <label className="sr-only" htmlFor={`topic-${item.id}`}>New topic</label>
                    <input id={`topic-${item.id}`} value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelEdit(item.id); } }} maxLength={200} placeholder="What should it be about instead?" className={`min-h-[44px] min-w-0 flex-1 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 text-[14px] text-[var(--gv-text-primary)] ${FOCUS}`} />
                    <div className="flex gap-2">
                      <button type="submit" className={BTN_MAIN} disabled={busy}>Save</button>
                      <button type="button" className={BTN} onClick={() => cancelEdit(item.id)}>Cancel</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 5 && state !== 'top_up' && state !== 'skipped' && (
        <button type="button" className={`${LINK} mt-1`} aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>{expanded ? 'Show fewer items' : `Show all ${items.length} items`}</button>
      )}

      {actions.approve && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={BTN_MAIN} disabled={busy} onClick={() => approve()}>{busy ? 'Starting…' : 'Approve'}</button>
          <button type="button" className={BTN} disabled={busy} onClick={skipWeek}>Skip this week</button>
        </div>
      )}
      {live}
    </section>
  );
};

export default ThisWeekCard;
