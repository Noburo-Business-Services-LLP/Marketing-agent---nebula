import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { placeCard, spotlightRect, visibleSteps, waitForTargets } from '../utils/tour';
import type { Rect, TourStep } from '../utils/tour';

export type TourCloseReason = 'finished' | 'skipped' | 'closed';

interface Props {
  open: boolean;
  steps: TourStep[];
  onClose: (reason: TourCloseReason) => void;
  /** Called with true when a step needs the phone menu open (the sidebar is collapsed), and false when it is no longer needed. */
  onNeedsMenu?: (needed: boolean) => void;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]';
const WAIT_MS = 1500;
const POLL_MS = 100;
const PHONE_MENU_QUERY = '(max-width: 767px)';
const TITLE_ID = 'guided-tour-title';
const BODY_ID = 'guided-tour-body';

const prefersReducedMotion = (): boolean => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
};
const isPhoneMenu = (): boolean => {
  try { return !!(window.matchMedia && window.matchMedia(PHONE_MENU_QUERY).matches); } catch { return false; }
};
const needsPhoneMenu = (step: TourStep): boolean => step.target.includes('data-tour="nav-');

/** Every element that matches and has a size (an element hidden by the layout has none). */
const sized = (selector: string): HTMLElement[] => {
  let list: HTMLElement[] = [];
  try { list = Array.from(document.querySelectorAll<HTMLElement>(selector)); } catch { return []; }
  return list.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
};
const exists = (selector: string): boolean => sized(selector).length > 0;
/** The visible match: the one on screen if the page has two (a phone and a computer header). */
const findTarget = (selector: string): HTMLElement | null => {
  const all = sized(selector);
  if (!all.length) return null;
  const vw = window.innerWidth;
  return all.find((el) => { const r = el.getBoundingClientRect(); return r.right > 1 && r.left < vw - 1; }) || all[0];
};
const toRect = (r: DOMRect): Rect => ({ top: r.top, left: r.left, width: r.width, height: r.height });

const GuidedTour: React.FC<Props> = (props) => (props.open ? <TourRun {...props} /> : null);

const TourRun: React.FC<Props> = ({ steps, onClose, onNeedsMenu }) => {
  const { pathname } = useLocation();
  // The list is chosen after the page has had time to draw (up to 2.5 s), not at the instant of opening.
  const [chosen, setChosen] = useState<TourStep[] | null>(null);
  const vis = useMemo(() => chosen || [], [chosen]);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardSize, setCardSize] = useState({ w: 360, h: 200 });
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dir = useRef(1);
  const menuOpen = useRef(false);
  const navigatingTo = useRef<string | null>(null);
  const live = useRef({ onClose, onNeedsMenu, index, count: vis.length, step: vis[index] });
  live.current = { onClose, onNeedsMenu, index, count: vis.length, step: vis[index] };
  const step: TourStep | undefined = vis[index];
  const reduced = prefersReducedMotion();

  const setMenu = useCallback((needed: boolean) => {
    if (menuOpen.current === needed) return;
    menuOpen.current = needed;
    try { live.current.onNeedsMenu?.(needed); } catch { /* the menu is a convenience */ }
  }, []);

  const finish = useCallback((reason: TourCloseReason) => live.current.onClose(reason), []);
  const goNext = useCallback(() => {
    const { index: i, count } = live.current;
    if (i + 1 >= count) { finish('finished'); return; }
    dir.current = 1; setTarget(null); setIndex(i + 1);
  }, [finish]);
  const goBack = useCallback(() => {
    const { index: i } = live.current;
    if (i <= 0) return;
    dir.current = -1; setTarget(null); setIndex(i - 1);
  }, []);
  // A step whose target never appeared is passed over in the direction the person was going.
  const passOver = useCallback(() => {
    const { index: i, count } = live.current;
    if (dir.current < 0 && i > 0) { setTarget(null); setIndex(i - 1); return; }
    if (i + 1 >= count) { finish(i === 0 && count === 1 ? 'closed' : 'finished'); return; }
    dir.current = 1; setTarget(null); setIndex(i + 1);
  }, [finish]);

  useEffect(() => {
    let stop = false;
    waitForTargets(steps.map((s) => s.target), exists, { cancelled: () => stop }).then((present) => {
      if (!stop) setChosen(visibleSteps(steps, (sel) => present.includes(sel)));
    });
    return () => { stop = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to show: leave quietly.
  useEffect(() => { if (chosen && chosen.length === 0) finish('closed'); }, [chosen, finish]);

  // Focus goes back to where it was when the tour closes, whatever closed it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      setMenu(false);
      try { if (opener && opener.isConnected) opener.focus?.({ preventScroll: true }); } catch { /* the opener may be gone */ }
    };
  }, [setMenu]);

  // Each step: go to its screen, wait for its target (up to 1.5 s), scroll it into view, then show it.
  useEffect(() => {
    if (!step) return undefined;
    if (pathname !== step.route) {
      navigatingTo.current = step.route;
      try { window.location.hash = `#${step.route}`; } catch { /* stays where it is */ }
    }
    const phoneNav = isPhoneMenu() && needsPhoneMenu(step);
    if (phoneNav) setMenu(true); else setMenu(false);
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      const el = findTarget(step.target);
      const r = el ? el.getBoundingClientRect() : null;
      // On a phone the menu slides in: wait until the item has arrived on screen.
      const ready = !!r && (!phoneNav || r.left >= -1);
      if (el && r && ready) {
        try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch { /* old browser */ }
        setTarget(toRect(el.getBoundingClientRect()));
        return;
      }
      if (Date.now() - started >= WAIT_MS) { passOver(); return; }
      timer = setTimeout(attempt, POLL_MS);
    };
    attempt();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [index, step, setMenu, passOver, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // Browser back, a link, or any other route change away from the tour's screen ends it (no stuck overlay).
  useEffect(() => {
    if (!step) return;
    if (navigatingTo.current) {
      if (pathname === navigatingTo.current) navigatingTo.current = null;
      return;
    }
    if (pathname !== step.route) finish('closed');
  }, [pathname, step, finish]);

  // Keep the spotlight on the element while the window or any scroll area moves.
  useEffect(() => {
    if (!step) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      setViewport((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      const el = findTarget(live.current.step.target);
      if (el) setTarget((old) => {
        const n = toRect(el.getBoundingClientRect());
        return old && old.top === n.top && old.left === n.left && old.width === n.width && old.height === n.height ? old : n;
      });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('scroll', schedule, true); // capture: the app scrolls inside its own main area
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [step]);

  // Measure the card before it is painted so it never flashes in the wrong place.
  useLayoutEffect(() => {
    const c = cardRef.current;
    if (!c) return;
    const measure = () => {
      const w = c.offsetWidth; const h = c.offsetHeight;
      setCardSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    // The text can wrap differently once fonts load or the window changes: keep the size current.
    let ro: ResizeObserver | undefined;
    try { if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(c); } } catch { /* the window listener below still applies */ }
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [index, !!target, viewport.w, viewport.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus moves into the card at each step.
  useEffect(() => {
    if (target && headingRef.current) { try { headingRef.current.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }, [index, !!target]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Escape skips, arrows move, Tab stays inside the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('skipped'); return; }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'ArrowRight' && !typing && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); goNext(); return; }
      if (e.key === 'ArrowLeft' && !typing && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); goBack(); return; }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) { e.preventDefault(); return; }
      const items = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = headingRef.current || items[0];
      const last = items[items.length - 1] || first;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !card.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); return; }
      if (e.shiftKey && (active === first || active === headingRef.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [finish, goNext, goBack]);

  if (!step || !target) return null;

  const phone = viewport.w < 640;
  const cardW = phone ? viewport.w - 16 : Math.min(360, viewport.w - 16);
  const spot = spotlightRect(target, viewport);
  const place = placeCard({ target, viewport, card: { w: cardW, h: cardSize.h } });
  const last = index === vis.length - 1;
  const move = reduced ? undefined : 'top 160ms ease, left 160ms ease, width 160ms ease, height 160ms ease';
  const BTN = `inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--gv-border-default)] bg-white px-4 text-[13px] font-semibold text-[#1d1a14] hover:bg-[#f3eee3] disabled:opacity-40 ${FOCUS}`;

  const scrollBehind = (e: React.WheelEvent) => {
    const main = document.querySelector('main');
    if (main) main.scrollBy({ top: e.deltaY, left: e.deltaX });
  };

  return (
    <div className="fixed inset-0 z-[120]" style={{ pointerEvents: 'none' }}>
      {/* Takes clicks on the page behind so a highlighted control is not pressed by accident; the wheel still scrolls the page. */}
      <div className="fixed inset-0" style={{ pointerEvents: 'auto' }} onWheel={scrollBehind} aria-hidden="true" />
      <div
        aria-hidden="true"
        className="fixed rounded-xl"
        style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height, boxShadow: '0 0 0 9999px rgba(20,16,10,0.6)', outline: '2px solid #ffffff', pointerEvents: 'none', transition: move }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={BODY_ID}
        className="fixed rounded-2xl border border-[var(--gv-border-default)] p-5 shadow-2xl"
        style={{ ...(place.placement === 'bottom-sheet' ? { left: 8, right: 8, bottom: 'calc(8px + env(safe-area-inset-bottom))' } : { top: place.top, left: place.left, width: cardW }), maxWidth: viewport.w - 16, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto', background: '#fffdf8', color: '#1d1a14', pointerEvents: 'auto', transition: move }}
      >
        <p className="text-[12px] font-medium text-[#5b5547]" aria-live="polite">{index + 1} of {vis.length}</p>
        <h2 id={TITLE_ID} ref={headingRef} tabIndex={-1} className="mt-1 text-[18px] font-semibold leading-snug text-[#1d1a14] outline-none">{step.title}</h2>
        <p id={BODY_ID} className="mt-1.5 text-[14px] leading-relaxed text-[#3d3829]">{step.body}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => finish('skipped')} className={`min-h-[44px] rounded-lg px-2 text-[13px] font-medium text-[#3d3829] underline underline-offset-2 hover:text-[#1d1a14] ${FOCUS}`}>Skip tour</button>
          <div className="flex gap-2">
            <button type="button" onClick={goBack} disabled={index === 0} className={BTN}>Back</button>
            <button type="button" onClick={goNext} className={`inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--gv-accent)] px-5 text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] ${FOCUS}`}>{last ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuidedTour;
