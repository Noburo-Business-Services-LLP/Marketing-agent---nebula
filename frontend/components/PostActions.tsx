import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Archive, ArchiveRestore, CalendarClock, CalendarX2, Check, Download, Loader2, Lock, MoreHorizontal, Pencil, RotateCcw, Send, Trash2, Undo2, X,
} from 'lucide-react';
import { draftsAPI } from '../services/api';
import { useConfirm } from '../context/ConfirmContext';
import { downloadAll, downloadImage } from '../utils/download';
import { upgradeInfoOf } from '../utils/plans';
import {
  DONE_WORDS, PostAction, PostActionContext, PostActionKey, REASONS, picturesOf, postActionsFor,
} from '../utils/postActions';
import { usePostAccess } from '../hooks/usePostAccess';
import './postActions.css';

/**
 * The same post buttons, in the same order, on every screen (rules in utils/postActions.ts).
 *   variant "row"     every action as a button, the Archive, Delete, Unschedule and Unapprove in "More"
 *                     (a phone keeps the main button and two more, the rest move into "More")
 *   variant "compact" the main button and "More" (tiles and grid cards)
 * Every action calls the real route through services/api.ts, says what happened in plain words and calls onChanged so
 * the screen can refresh. Locked actions stay in their place; pressing one says why and what to do.
 */
export interface PostActionsChange {
  key: PostActionKey;
  message: string;
  /** the post left the list this screen shows (approved, archived, binned, posted, restored) */
  moved: boolean;
  draft?: any;
}

export interface PostActionsProps {
  draft: any;
  variant?: 'row' | 'compact';
  /** overrides of the account context (plan, connected account, prices); loaded automatically otherwise */
  context?: PostActionContext;
  /** the Quark price of Make again for this post */
  makeAgainQuarks?: number | null;
  /** opens this screen's editor; without it, Edit is left out */
  onEdit?: () => void;
  /** runs before Approve, Schedule and Post now (the post sheet saves its edits here) */
  prepare?: () => Promise<void>;
  /** the prompt Make again uses (the post sheet's editable prompt) */
  makeAgainPrompt?: string;
  /** the platforms Post now uses, when the screen lets the customer change them */
  platforms?: string[];
  /** actions this screen shows elsewhere */
  exclude?: PostActionKey[];
  /** calendar posts: Archive also marks the calendar day as rejected */
  archiveVia?: 'archive' | 'reject';
  onChanged?: (change: PostActionsChange) => void;
  /** hand the messages to the screen instead of showing them under the buttons */
  onMessage?: (text: string, tone: 'ok' | 'error', to?: { label: string; path: string }) => void;
  className?: string;
  /** names the post for screen readers ("Approve Weekend croissant drop") */
  label?: string;
}

const ICONS: Record<PostActionKey, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  approve: Check, schedule: CalendarClock, postNow: Send, download: Download, edit: Pencil, makeAgain: RotateCcw,
  unschedule: CalendarX2, unapprove: Undo2, archive: Archive, delete: Trash2, restore: ArchiveRestore,
};

const MOVES: PostActionKey[] = ['approve', 'postNow', 'unapprove', 'archive', 'delete', 'restore', 'schedule', 'unschedule'];

function useNarrow(): boolean {
  const q = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener ? m.addEventListener('change', on) : m.addListener(on);
    return () => { m.removeEventListener ? m.removeEventListener('change', on) : m.removeListener(on); };
  }, []);
  return narrow;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localParts = (d: Date) => ({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` });

const PostActions: React.FC<PostActionsProps> = ({
  draft, variant = 'row', context, makeAgainQuarks, onEdit, prepare, makeAgainPrompt, platforms, exclude = [],
  archiveVia = 'archive', onChanged, onMessage, className = '', label,
}) => {
  const access = usePostAccess();
  const confirm = useConfirm();
  const narrow = useNarrow();
  const [busy, setBusy] = useState<PostActionKey | ''>('');
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error'; to?: { label: string; path: string } } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const subject = { ...draft, ...(platforms ? { platforms } : {}) };
  const ctx: PostActionContext = {
    publish: access.publish, hasAccount: access.hasAccount, makeAgainQuarks, canEdit: Boolean(onEdit), ...(context || {}),
  };
  const actions = postActionsFor(subject, ctx).filter((a) => !exclude.includes(a.key));
  const id = String(draft?._id || draft?.id || '');
  const name = label || String(draft?.title || '').trim() || 'this post';

  const say = useCallback((text: string, tone: 'ok' | 'error', to?: { label: string; path: string }) => {
    if (onMessage) onMessage(text, tone, to);
    else setNote(text ? { text, tone, to } : null);
  }, [onMessage]);

  const explainLock = (a: PostAction) => {
    if (a.reason === REASONS.addon) say('Scheduling and posting need the Publish add-on.', 'error', { label: 'See plans', path: '/trial-expired' });
    else if (a.reason === REASONS.paidPlan) say('Scheduling and posting are part of the paid plans.', 'error', { label: 'See plans', path: '/trial-expired' });
    else if (a.reason === REASONS.account) say('Connect an account first, so Nebulaa can post for you.', 'error', { label: 'Connect accounts', path: '/connect-socials' });
    else say(`${a.reason}.`, 'error');
  };

  const finish = (key: PostActionKey, res: any) => {
    const message = (res && typeof res.message === 'string' && res.message) || DONE_WORDS[key];
    say(message, 'ok');
    onChanged?.({ key, message, moved: MOVES.includes(key), draft: res?.draft });
  };

  const fail = (e: any) => {
    const up = upgradeInfoOf(e);
    if (up) say(up.message, 'error', { label: 'See plans', path: '/trial-expired' });
    else say(e?.message || 'Something went wrong. Please try again.', 'error');
  };

  const run = async (a: PostAction) => {
    setMenuOpen(false);
    if (busy) return;
    if (a.disabled) { explainLock(a); return; }
    if (a.key === 'edit') { onEdit?.(); return; }
    if (a.key === 'schedule') { setNote(null); setScheduling(true); return; }
    if (a.key === 'download') {
      const pics = picturesOf(draft);
      const video = String(draft?.creative?.videoUrl || '');
      try {
        if (pics.length > 1) await downloadAll(pics, name);
        else if (pics[0]) await downloadImage(pics[0], name);
        else if (video) window.open(video, '_blank', 'noopener');
      } catch { say('The download did not start. Please try again.', 'error'); }
      return;
    }
    if (a.confirm) {
      const ok = await confirm(a.confirm.message, { title: a.confirm.title, confirmLabel: a.confirm.confirmLabel, danger: a.confirm.danger });
      if (!ok) return;
    }
    setBusy(a.key); setNote(null);
    try {
      if (prepare && (a.key === 'approve' || a.key === 'postNow')) await prepare();
      let res: any;
      switch (a.key) {
        case 'approve': res = await draftsAPI.approveDraft(id); break;
        case 'postNow': res = await draftsAPI.publishDraft(id, subject.platforms || []); res = { ...res, message: res?.message || DONE_WORDS.postNow }; break;
        case 'makeAgain': res = await draftsAPI.retryImageGeneration(id, makeAgainPrompt && makeAgainPrompt.trim() ? makeAgainPrompt.trim() : undefined); res = { ...res, message: DONE_WORDS.makeAgain }; break;
        case 'unschedule': res = await draftsAPI.unscheduleDraft(id); break;
        case 'unapprove': res = await draftsAPI.unapproveDraft(id); break;
        case 'archive': res = archiveVia === 'reject' ? { ...(await draftsAPI.rejectDraft(id)), message: DONE_WORDS.archive } : await draftsAPI.archiveDraft(id); break;
        case 'delete': res = await draftsAPI.deleteDraft(id); break;
        case 'restore': res = await draftsAPI.restoreDraft(id); break;
        default: return;
      }
      if (res && res.success === false) throw Object.assign(new Error(res.message || 'Something went wrong. Please try again.'), { data: res });
      finish(a.key, res);
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy('');
    }
  };

  const schedule = async (whenIso: string) => {
    setBusy('schedule');
    try {
      if (prepare) await prepare();
      const res: any = await draftsAPI.scheduleDraft(id, whenIso);
      setScheduling(false);
      const when = new Date(whenIso);
      finish('schedule', { ...res, message: `Scheduled for ${when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` });
    } catch (e: any) {
      setScheduling(false);
      fail(e);
    } finally {
      setBusy('');
    }
  };

  if (!actions.length) return null;

  // Which actions are buttons and which sit in "More".
  const main = actions.find((a) => a.primary);
  let buttons: PostAction[];
  if (variant === 'compact') buttons = main ? [main] : [];
  else {
    buttons = actions.filter((a) => !a.menu);
    if (narrow) {
      const rest = buttons.filter((a) => a !== main);
      buttons = [...(main ? [main] : []), ...rest.slice(0, 2)].sort((x, y) => actions.indexOf(x) - actions.indexOf(y));
    }
  }
  const inMenu = actions.filter((a) => !buttons.includes(a));

  return (
    <div className={`nb-pa ${className}`} data-variant={variant} data-testid="post-actions">
      <div className="nb-pa-row" role="group" aria-label={`Actions for ${name}`}>
        {buttons.map((a) => (
          <ActionButton key={a.key} action={a} busy={busy === a.key} anyBusy={Boolean(busy)} onRun={() => run(a)} name={name} compact={variant === 'compact'} />
        ))}
        {inMenu.length > 0 && (
          <MoreMenu items={inMenu} open={menuOpen} setOpen={setMenuOpen} onRun={run} busy={busy} name={name} />
        )}
      </div>
      {!onMessage && <PostNotice notice={note} onClose={() => setNote(null)} />}
      {scheduling && (
        <ScheduleDialog
          name={name}
          initial={draft?.scheduledDate || draft?.plannedDate || ''}
          busy={busy === 'schedule'}
          onCancel={() => setScheduling(false)}
          onConfirm={schedule}
        />
      )}
    </div>
  );
};

const ActionButton: React.FC<{ action: PostAction; busy: boolean; anyBusy: boolean; onRun: () => void; name: string; compact: boolean }> = ({ action: a, busy, anyBusy, onRun, name, compact }) => {
  const Icon = ICONS[a.key];
  return (
    <button
      type="button"
      className="nb-pa-btn"
      data-primary={a.primary ? 'true' : undefined}
      data-locked={a.disabled ? 'true' : undefined}
      data-action={a.key}
      aria-disabled={a.disabled || undefined}
      disabled={anyBusy && !busy}
      title={a.disabled ? a.reason : a.hint}
      onClick={onRun}
      aria-label={`${a.label} ${name}${a.disabled ? `. ${a.reason}` : ''}`}
    >
      {busy ? <Loader2 className="nb-pa-ico animate-spin" aria-hidden="true" /> : a.disabled ? <Lock className="nb-pa-ico" aria-hidden="true" /> : <Icon className="nb-pa-ico" aria-hidden="true" />}
      <span className="nb-pa-word">{a.label}</span>
      {a.quarks ? <span className="nb-pa-price">{a.quarks.toLocaleString('en-IN')} Quarks</span> : null}
      {a.disabled && !compact && <span className="nb-pa-why">{a.reason}</span>}
    </button>
  );
};

/** One entry of the "More" menu: a post action, or an action of another kind of item (components/ItemActions.tsx). */
export interface MenuEntry {
  key: string; label: string; hint: string; reason: string; disabled: boolean; quarks?: number;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>; danger?: boolean;
}

/** "More": a real menu button with arrow keys, Escape and focus return. Drawn fixed, so tiles never clip it. */
export const MoreMenu: React.FC<{ items: MenuEntry[]; open: boolean; setOpen: (v: boolean) => void; onRun: (a: any) => void; busy: string; name: string }> = ({ items, open, setOpen, onRun, busy, name }) => {
  const btn = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuId = useId();

  // Place the menu under the button, or above it when there is no room below; measured after it is drawn.
  useLayoutEffect(() => {
    if (!open || !btn.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect();
    const w = 248;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    setPos({ top: r.bottom + 6, left });
  }, [open, items.length]);
  useLayoutEffect(() => {
    if (!open || !pos || !btn.current || !menu.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = menu.current.getBoundingClientRect().height;
    const roomBelow = window.innerHeight - r.bottom - 8;
    if (h > roomBelow && pos.top === r.bottom + 6) {
      const top = Math.max(8, r.top - h - 6);
      if (top !== pos.top) setPos({ top, left: pos.left });
    }
  }, [open, pos]);

  // Focus the first item once the menu is drawn.
  const drawn = Boolean(open && pos);
  useEffect(() => {
    if (drawn) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [drawn]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const shut = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', shut); window.removeEventListener('scroll', shut, true); };
  }, [open, setOpen]);

  const onKey = (e: React.KeyboardEvent) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="nb-pa-btn"
        data-more="true"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More actions for ${name}`}
        title="More actions"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); }
          if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
        }}
      >
        <MoreHorizontal className="nb-pa-ico" aria-hidden="true" />
        <span className="nb-pa-word">More</span>
      </button>
      {open && pos && createPortal(
        <div ref={menu} id={menuId} role="menu" aria-label={`More actions for ${name}`} className="nb-pa-menu" style={{ top: pos.top, left: pos.left }} onKeyDown={onKey}>
          {items.map((a) => {
            const Icon = a.icon || ICONS[a.key as PostActionKey] || MoreHorizontal;
            return (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                className="nb-pa-item"
                data-action={a.key}
                data-danger={a.key === 'delete' || a.danger ? 'true' : undefined}
                data-locked={a.disabled ? 'true' : undefined}
                aria-disabled={a.disabled || undefined}
                onClick={() => { onRun(a); btn.current?.focus(); }}
              >
                {busy === a.key ? <Loader2 className="nb-pa-ico animate-spin" aria-hidden="true" /> : a.disabled ? <Lock className="nb-pa-ico" aria-hidden="true" /> : <Icon className="nb-pa-ico" aria-hidden="true" />}
                <span className="nb-pa-item-text">
                  <span className="nb-pa-item-word">{a.label}{a.quarks ? <span className="nb-pa-price">{a.quarks.toLocaleString('en-IN')} Quarks</span> : null}</span>
                  <span className="nb-pa-item-hint">{a.disabled ? a.reason : a.hint}</span>
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
};

/** Pick a date and time. Opens with the planned or current time, or tomorrow at 10:00. */
const ScheduleDialog: React.FC<{ name: string; initial: string; busy: boolean; onCancel: () => void; onConfirm: (iso: string) => void }> = ({ name, initial, busy, onCancel, onConfirm }) => {
  const start = (() => {
    const d = initial ? new Date(initial) : null;
    if (d && !Number.isNaN(d.getTime()) && d.getTime() > Date.now() + 5 * 60 * 1000) return localParts(d);
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0);
    return localParts(t);
  })();
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [err, setErr] = useState('');
  const first = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  useEffect(() => { first.current?.focus(); }, []);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const when = new Date(`${date}T${time}:00`);
    if (!date || !time || Number.isNaN(when.getTime())) { setErr('Please choose a date and a time.'); return; }
    if (when.getTime() < Date.now() + 60 * 1000) { setErr('Please choose a time later than now.'); return; }
    onConfirm(when.toISOString());
  };
  return createPortal(
    <div className="nb-pa-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <form className="nb-pa-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onCancel(); }}>
        <h2 id={titleId} className="nb-pa-dialog-title">When should it go out?</h2>
        <p className="nb-pa-dialog-sub">{name}</p>
        <div className="nb-pa-dialog-fields">
          <label><span>Date</span><input ref={first} type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} required /></label>
          <label><span>Time</span><input type="time" value={time} onChange={(e) => { setTime(e.target.value); setErr(''); }} required /></label>
        </div>
        {err && <p className="nb-pa-dialog-err" role="alert">{err}</p>}
        <div className="nb-pa-dialog-actions">
          <button type="button" className="nb-pa-btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="nb-pa-btn" data-primary="true" disabled={busy}>
            {busy ? <Loader2 className="nb-pa-ico animate-spin" aria-hidden="true" /> : <CalendarClock className="nb-pa-ico" aria-hidden="true" />}
            <span className="nb-pa-word">Schedule</span>
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

export interface PostNoticeValue { text: string; tone: 'ok' | 'error'; to?: { label: string; path: string } }

/** The message line a screen shows when it collects the messages of many PostActions (onMessage). */
export const PostNotice: React.FC<{ notice: PostNoticeValue | null; onClose: () => void; className?: string }> = ({ notice, onClose, className = '' }) => {
  const navigate = useNavigate();
  if (!notice || !notice.text) return null;
  return (
    <p className={`nb-pa-note ${className}`} data-tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      {notice.to && <button type="button" className="nb-pa-note-link" onClick={() => navigate(notice.to!.path)}>{notice.to.label}</button>}
      <button type="button" className="nb-pa-note-close" aria-label="Close message" onClick={onClose}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
    </p>
  );
};

export default PostActions;
