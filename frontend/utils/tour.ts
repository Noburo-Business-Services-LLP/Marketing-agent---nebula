/** The guided tour engine: steps, start rule, state machine and card placement. Pure, no DOM access. */

export interface TourStep {
  id: string;
  route: string;
  target: string;
  title: string;
  body: string;
  placement?: 'auto';
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', route: '/dashboard', target: '[data-tour="this-week"]', title: 'This is your week', body: 'Every week Nebulaa suggests what to make, based on your plan. Say yes and the posts are made for you.' },
  { id: 'create', route: '/dashboard', target: '[data-tour="nav-create"]', title: 'Make something yourself', body: 'Posts, carousels and videos start here, when you want to make one now.' },
  { id: 'review', route: '/dashboard', target: '[data-tour="nav-review"]', title: 'Review and approve', body: 'Everything Nebulaa makes waits here until you approve it.' },
  { id: 'calendar', route: '/dashboard', target: '[data-tour="nav-calendar"]', title: 'Your calendar', body: 'See what is planned and what has gone out.' },
  { id: 'plan', route: '/dashboard', target: '[data-tour="nav-plan"]', title: 'My plan', body: 'Who your customers are, where to show up, and what the next 90 days look like.' },
  { id: 'help', route: '/dashboard', target: '[data-tour="help"]', title: 'Help is always here', body: 'Replay this tour or see your setup steps any time from this button.' },
];

export function visibleSteps(steps: TourStep[], hasTarget: (selector: string) => boolean): TourStep[] {
  return steps.filter((s) => hasTarget(s.target));
}

export interface WaitOptions { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; cancelled?: () => boolean }

/** Waits for the page to draw its targets: returns the selectors that are present, as soon as all are, or at the timeout the ones that are. */
export async function waitForTargets(selectors: string[], hasTarget: (selector: string) => boolean, opts: WaitOptions = {}): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const intervalMs = Math.max(1, opts.intervalMs ?? 100);
  const sleep = opts.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let elapsed = 0;
  for (;;) {
    const present = selectors.filter((sel) => hasTarget(sel));
    if (present.length === selectors.length || elapsed >= timeoutMs || (opts.cancelled && opts.cancelled())) return present;
    await sleep(intervalMs);
    elapsed += intervalMs;
  }
}

export interface AutoStartInput {
  user: any;
  path: string;
  hasCsmPass: boolean;
}

export function shouldAutoStart({ user, path, hasCsmPass }: AutoStartInput): boolean {
  if (!user || !user.onboardingCompleted) return false;
  if (user.staffRole || user.isCsm) return false;
  if (user.actingAgency || hasCsmPass) return false;
  if (user.tour && (user.tour.completedAt || user.tour.skippedAt)) return false;
  return path === '/dashboard' || path === '/';
}

export interface TourState { index: number; open: boolean; total: number; finished?: boolean; skipped?: boolean }
export type TourAction = { type: 'start' | 'next' | 'back' | 'skip' | 'finish' };

export function reduce(state: TourState, action: TourAction): TourState {
  const total = state.total;
  switch (action.type) {
    case 'start': return { index: 0, open: true, total };
    case 'back': return { ...state, index: Math.max(0, state.index - 1) };
    case 'next':
      if (state.index + 1 >= total) return { index: state.index, open: false, total, finished: true };
      return { ...state, index: state.index + 1 };
    case 'skip': return { index: state.index, open: false, total, skipped: true };
    case 'finish': return { index: state.index, open: false, total, finished: true };
    default: return state;
  }
}

export interface Rect { top: number; left: number; width: number; height: number }
export interface Viewport { w: number; h: number }
export interface CardSize { w: number; h: number }
export type Placement = 'below' | 'above' | 'right' | 'left' | 'bottom-sheet';

const MARGIN = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

export function placeCard({ target, viewport, card, gap = 12 }: { target: Rect; viewport: Viewport; card: CardSize; gap?: number }): { top: number; left: number; placement: Placement } {
  if (viewport.w < 640) return { placement: 'bottom-sheet', top: viewport.h - card.h - MARGIN, left: MARGIN };
  const maxTop = viewport.h - card.h - MARGIN;
  const maxLeft = viewport.w - card.w - MARGIN;
  const centreLeft = target.left + target.width / 2 - card.w / 2;
  const centreTop = target.top + target.height / 2 - card.h / 2;
  const tries: Array<{ placement: Placement; top: number; left: number; ok: boolean }> = [];
  const below = target.top + target.height + gap;
  tries.push({ placement: 'below', top: below, left: centreLeft, ok: below <= maxTop });
  const above = target.top - gap - card.h;
  tries.push({ placement: 'above', top: above, left: centreLeft, ok: above >= MARGIN });
  const right = target.left + target.width + gap;
  tries.push({ placement: 'right', top: centreTop, left: right, ok: right <= maxLeft });
  const left = target.left - gap - card.w;
  tries.push({ placement: 'left', top: centreTop, left, ok: left >= MARGIN });
  const pick = tries.find((t) => t.ok) || tries[0];
  return { placement: pick.placement, top: clamp(pick.top, MARGIN, maxTop), left: clamp(pick.left, MARGIN, maxLeft) };
}

export function spotlightRect(target: Rect, viewport: Viewport, pad = 6): Rect {
  const top = Math.max(0, target.top - pad);
  const left = Math.max(0, target.left - pad);
  const bottom = Math.min(viewport.h, target.top + target.height + pad);
  const right = Math.min(viewport.w, target.left + target.width + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
