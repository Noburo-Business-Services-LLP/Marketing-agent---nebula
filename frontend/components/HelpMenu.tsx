import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { apiService } from '../services/api';
import { SUPPORT_EMAIL } from '../constants/legal';
import { cardModel } from '../utils/setup';

export const TOUR_REPLAY_EVENT = 'nebulaa-tour-replay';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]';
const ITEM = `flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-[13.5px] font-medium text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] ${FOCUS}`;

/** The "?" button: replay the tour, jump to the setup steps, or write to support. Opens with a click or Enter, closes with Escape or a click outside. */
const HelpMenu: React.FC<{ canReplay?: boolean; canSetup?: boolean; className?: string }> = ({ canReplay = true, canSetup = true, className = '' }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [setupShown, setSetupShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // "Your setup steps" only appears while the Setup card does: the account is a customer's own and some step is left.
  useEffect(() => {
    if (!open || !canSetup) { if (!canSetup) setSetupShown(false); return undefined; }
    let live = true;
    apiService.getSetup().then((r) => { if (live) setSetupShown(cardModel(r).show); }).catch(() => { if (live) setSetupShown(false); });
    return () => { live = false; };
  }, [open, canSetup]);

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Tab') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);

  const replay = () => {
    setOpen(false);
    button.current?.focus(); // the tour hands focus back to the button that was focused when it opened
    apiService.saveTour('replay');
    window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT));
  };
  const setupSteps = () => {
    setOpen(false);
    navigate('/dashboard');
    const started = Date.now();
    const look = () => {
      const el = document.querySelector<HTMLElement>('[data-tour="setup"]');
      if (el) { el.scrollIntoView({ block: 'start' }); return; }
      if (Date.now() - started < 1500) timer.current = setTimeout(look, 100);
    };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(look, 100);
  };

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        data-tour="help"
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-11 w-11 items-center justify-center rounded-lg text-[var(--gv-text-tertiary)] transition-colors hover:bg-[var(--gv-surface-2)] hover:text-[var(--gv-text-primary)] md:h-9 md:w-9 ${FOCUS}`}
      >
        <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Help" className="absolute right-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-1.5 shadow-2xl">
          {canReplay && <button type="button" role="menuitem" onClick={replay} className={ITEM}>Replay the tour</button>}
          {canSetup && setupShown && <button type="button" role="menuitem" onClick={setupSteps} className={ITEM}>Your setup steps</button>}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate('/help'); }} className={ITEM}>Help and quick answers</button>
          <a role="menuitem" href={`mailto:${SUPPORT_EMAIL}`} onClick={() => setOpen(false)} className={ITEM}>Contact support</a>
        </div>
      )}
    </div>
  );
};

export default HelpMenu;
