/**
 * The strategy funnel on My plan: turns an already stored plan into nine ordered levels, from the business at the top
 * down to the numbers to watch. Pure and defensive: an old plan, an empty one or a broken one never throws, and a level
 * the plan cannot fill says so in plain words instead of inventing anything. Nothing here calls a model or a server.
 */
import { PHASE_TITLES } from './plan.ts';

export type LevelStatus = 'ready' | 'thin' | 'missing';
export type LevelId = 'business' | 'products' | 'customers' | 'positioning' | 'mix' | 'channels' | 'content' | 'roadmap' | 'numbers';

export interface LevelSub { label: string; text: string }
export interface LevelItem {
  label?: string;
  text: string;
  /** The claim tag from the plan (verified, inference, proposed, unverified), shown in words by the page. */
  tag?: string;
  sub?: LevelSub[];
  /** A short list under the text, for example the actions of one roadmap phase. */
  bullets?: string[];
  /** Organic and paid split for one channel, in whole percent. */
  split?: { organic: number; paid: number };
  /** The roadmap phase the account is in today. */
  current?: boolean;
  /** An offline row (no Nebulaa work). */
  offline?: boolean;
}
export interface LevelLink { to: string; label: string }
export interface StrategyLevel {
  n: number;
  id: LevelId;
  title: string;
  summary: string;
  items: LevelItem[];
  status: LevelStatus;
  link?: LevelLink;
  /** A short plain note shown in the details, for example why a level is empty. */
  note?: string;
}
export interface LevelExtras { products?: unknown; now?: Date }

export const SUMMARY_MAX = 140;
export const ITEM_MAX = 400;

export const STATUS_TEXT = {
  ready: 'Ready',
  thin: 'Needs more detail',
  missing: 'Not decided yet',
  refresh: 'Added when your plan is next refreshed.',
} as const;

export const LEVEL_COPY: Record<LevelId, { title: string; missing: string }> = {
  business: { title: 'Your business', missing: 'Not described yet. Check your business details.' },
  products: { title: 'Products and services', missing: 'Add what you sell in Brand assets so your posts can name it.' },
  customers: { title: 'Your customers', missing: 'Your ideal customer is not described yet.' },
  positioning: { title: 'Positioning and message', missing: 'Your message is not set out yet.' },
  mix: { title: 'Marketing mix', missing: 'No mix of channels and formats yet.' },
  channels: { title: 'Channels and who does what', missing: 'No channels chosen yet.' },
  content: { title: 'Content pillars and this month', missing: 'No content themes yet.' },
  roadmap: { title: 'The next 90 days', missing: 'No 90-day roadmap yet.' },
  numbers: { title: 'Numbers to watch', missing: 'Nothing to measure is listed yet.' },
};

const LINKS: Partial<Record<LevelId, LevelLink>> = {
  business: { to: '/settings?tab=business', label: 'Edit business details' },
  products: { to: '/brand-assets?tab=products', label: 'Edit products and services' },
  positioning: { to: '/brand-assets', label: 'Open Brand assets' },
  channels: { to: '/dashboard', label: 'See this week' },
  content: { to: '/campaigns', label: 'Make a post' },
  roadmap: { to: '/dashboard', label: 'See this week' },
  numbers: { to: '/analytics', label: 'See your numbers' },
};

const METRIC_LABELS: Record<string, { label: string; live: boolean }> = {
  reach: { label: 'Reach', live: true },
  engagement: { label: 'Engagement', live: true },
  followers: { label: 'Followers', live: true },
  posts_published: { label: 'Posts published', live: true },
  enquiries: { label: 'Enquiries', live: false },
  reviews: { label: 'Reviews', live: false },
  website_visits: { label: 'Website visits', live: false },
};

const PHASE_DAYS: Record<string, string> = { foundation: 'Days 1 to 30', storytelling: 'Days 31 to 60', growth: 'Days 61 to 90' };
const PLURAL: Record<string, string> = { 'image post': 'image posts', carousel: 'carousels', reel: 'reels', story: 'stories' };

const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const words = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const claimText = (c: unknown): string => (isObj(c) ? words(c.text) : '');
const claimsOf = (v: unknown): any[] => list(v).filter((c) => claimText(c));

let segmenter: any = null;
function graphemes(s: string): string[] {
  try {
    const Seg = (Intl as any).Segmenter;
    if (Seg) {
      if (!segmenter) segmenter = new Seg(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(s), (x: any) => x.segment as string);
    }
  } catch { /* fall through */ }
  return Array.from(s);
}

/** Tidy spaces and cut long text on a whole character (never half a Tamil or Hindi syllable), adding an ellipsis. */
export function clampText(v: unknown, max: number): string {
  const s = words(v);
  if (!s) return '';
  const g = graphemes(s);
  if (g.length <= max) return s;
  return `${g.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`;
}

/** "a", "a and b", "a, b and c". */
function joinWords(ws: string[]): string {
  if (ws.length <= 1) return ws[0] || '';
  return `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`;
}

/** Names, at most `max` shown, the rest counted: "a, b, c and 6 more". */
function joinSome(ws: string[], max: number): string {
  if (ws.length <= max + 1) return joinWords(ws);
  return `${ws.slice(0, max).join(', ')} and ${ws.length - max} more`;
}

const item = (c: any, label?: string): LevelItem => ({ ...(label ? { label } : {}), text: clampText(c.text, ITEM_MAX), ...(c.tag ? { tag: String(c.tag) } : {}) });

/** The stored plan (`result.plan`), whether the page view, the stored run or nothing usable is passed in. */
function innerOf(input: any): { p: Record<string, any>; madeAt: unknown } {
  const run = isObj(input) && isObj(input.plan) && 'result' in input.plan ? input.plan : input;
  const p = isObj(run) && isObj(run.result) && isObj(run.result.plan) ? run.result.plan : {};
  return { p, madeAt: isObj(run) ? run.completedAt : null };
}

/** Which roadmap phase the account is in: days 1 to 30, 31 to 60, then the rest (as `planContext.js` on the server). */
export function currentPhase(madeAt: unknown, now: Date = new Date()): 'foundation' | 'storytelling' | 'growth' | null {
  if (!madeAt) return null;
  const d = new Date(madeAt as any);
  if (Number.isNaN(d.valueOf())) return null;
  const day = Math.max(1, Math.floor((now.getTime() - d.getTime()) / 86400000)); // the same count as the server
  if (day <= 30) return 'foundation';
  if (day <= 60) return 'storytelling';
  return 'growth';
}

function level(n: number, id: LevelId, status: LevelStatus, summary: string, items: LevelItem[], note?: string, linkOverride?: LevelLink | null): StrategyLevel {
  // A missing level only links where the owner can fill it himself (his details, his products).
  const link = linkOverride === null || (status === 'missing' && id !== 'business' && id !== 'products') ? undefined : linkOverride || LINKS[id];
  // A missing level says what is missing in its summary; the details add how it gets filled.
  const text = clampText(summary, SUMMARY_MAX) || LEVEL_COPY[id].missing;
  const out: StrategyLevel = { n, id, title: LEVEL_COPY[id].title, summary: status === 'missing' ? LEVEL_COPY[id].missing : text, items, status };
  if (link) out.link = link;
  const why = note || (status === 'missing' && id !== 'products' ? STATUS_TEXT.refresh : '');
  if (why) out.note = why;
  return out;
}

const statusOf = (has: number, enough: number): LevelStatus => (has <= 0 ? 'missing' : has >= enough ? 'ready' : 'thin');

function businessLevel(p: Record<string, any>): StrategyLevel {
  const promise = isObj(p.promise) && claimText(p.promise) ? p.promise : null;
  const today = claimsOf(p.whereToday);
  const rivals = list(p.competitors).map((c) => (isObj(c) ? words(c.name) : '')).filter(Boolean);
  const items: LevelItem[] = [];
  if (promise) items.push(item(promise, 'What the plan aims for'));
  today.forEach((c) => items.push(item(c, 'Where you are today')));
  if (rivals.length) items.push({ label: 'Others in your space', text: clampText(joinSome(rivals, 4), ITEM_MAX) });
  const status = statusOf((promise ? 1 : 0) + (today.length ? 1 : 0), 2);
  return level(1, 'business', status, promise ? claimText(promise) : today.length ? claimText(today[0]) : '', items);
}

function productsLevel(products: unknown): StrategyLevel {
  // null means the list could not be loaded: say that, rather than telling the owner to add products he already has.
  if (products === null) return level(2, 'products', 'missing', '', [], 'We could not load your products just now.');
  const rows = list(products).filter((r) => isObj(r) && words(r.name));
  const names = rows.map((r) => words(r.name));
  const items: LevelItem[] = rows.map((r) => {
    const kind = r.type === 'service' ? 'Service' : r.type === 'product' ? 'Product' : '';
    const price = words(r.priceNote) || (Number.isFinite(Number(r.price)) && Number(r.price) > 0 ? `Rs ${Number(r.price).toLocaleString('en-IN')}` : '');
    const detail = [kind, price].filter(Boolean).join(', ');
    return { label: 'What you sell', text: clampText(detail ? `${words(r.name)} (${detail})` : words(r.name), ITEM_MAX) };
  });
  if (!rows.length) return level(2, 'products', 'missing', '', []);
  const summary = `${rows.length} ${rows.length === 1 ? 'item' : 'items'}: ${joinSome(names, 3)}`;
  return level(2, 'products', 'ready', summary, items, 'Taken from your list of products and services.');
}

function customersLevel(p: Record<string, any>): StrategyLevel {
  const icp = isObj(p.icp) ? p.icp : {};
  const parts: Array<[string, any[]]> = [['Who they are', claimsOf(icp.who)], ['What bothers them', claimsOf(icp.pains)], ['Where they spend time', claimsOf(icp.where)], ['What makes them buy', claimsOf(icp.triggers)]];
  const items: LevelItem[] = [];
  parts.forEach(([label, cs]) => cs.forEach((c) => items.push(item(c, label))));
  if (items.length) {
    const filled = parts.filter(([, cs]) => cs.length).length;
    const first = parts.find(([, cs]) => cs.length)![1][0];
    return level(3, 'customers', filled >= 3 && parts[0][1].length ? 'ready' : 'thin', claimText(first), items);
  }
  // An older plan has no customer block: the audience line stands in, and the level says it is thin.
  const audience = claimsOf(isObj(p.positioning) ? p.positioning.audience : null);
  if (audience.length) return level(3, 'customers', 'thin', claimText(audience[0]), audience.map((c) => item(c, 'Who you speak to')), STATUS_TEXT.refresh);
  return level(3, 'customers', 'missing', '', []);
}

function positioningLevel(p: Record<string, any>): StrategyLevel {
  const pos = isObj(p.positioning) ? p.positioning : {};
  const line = isObj(pos.line) && claimText(pos.line) ? pos.line : null;
  const t = isObj(pos.territory) ? pos.territory : null;
  const tName = t ? words(t.name) : '';
  const items: LevelItem[] = [];
  if (line) items.push(item(line, 'Your message'));
  if (tName) items.push({ label: 'Where you can stand out', text: clampText(tName, ITEM_MAX) });
  if (t && claimText(t.rationale)) items.push(item(t.rationale, 'Why it fits'));
  if (t && claimText(t.risk)) items.push(item(t.risk, 'Watch out for'));
  return level(4, 'positioning', statusOf((line ? 1 : 0) + (tName ? 1 : 0), 2), line ? claimText(line) : tName, items);
}

interface EffortRow { channel: string; organic: number; paid: number; does: string[]; youDo: string[] }
function effortOf(p: Record<string, any>): EffortRow[] {
  const out: EffortRow[] = [];
  for (const e of list(p.effort)) {
    if (!isObj(e) || !words(e.channel) || out.some((x) => x.channel === words(e.channel))) continue;
    const organic = Math.round(Number(e.organicPct));
    if (!Number.isFinite(organic) || organic < 0 || organic > 100) continue;
    out.push({ channel: words(e.channel), organic, paid: 100 - organic, does: list(e.nebulaaDoes).map(words).filter(Boolean), youDo: claimsOf(e.youDo).map(claimText) });
  }
  return out;
}

function channelsOf(p: Record<string, any>): Array<{ channel: string; role: any }> {
  const out: Array<{ channel: string; role: any }> = [];
  for (const c of list(p.channels)) {
    if (!isObj(c) || !words(c.channel) || out.some((x) => x.channel === words(c.channel))) continue;
    out.push({ channel: words(c.channel), role: claimText(c.role) ? c.role : null });
  }
  return out;
}

function offlineOf(p: Record<string, any>): Array<{ channel: string; role: any; youDo: string[] }> {
  return list(p.offline).filter((o) => isObj(o) && words(o.channel)).map((o) => ({ channel: words(o.channel), role: claimText(o.role) ? o.role : null, youDo: claimsOf(o.youDo).map(claimText) }));
}

function formatCounts(p: Record<string, any>): Array<[string, number]> {
  const counts = new Map<string, number>();
  list(p.calendar).forEach((c) => { const f = isObj(c) ? words(c.format).toLowerCase() : ''; if (f) counts.set(f, (counts.get(f) || 0) + 1); });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

const formatPhrase = (counts: Array<[string, number]>): string => joinWords(counts.map(([f, n]) => `${n} ${n === 1 ? f : PLURAL[f] || f}`));

function mixLevel(p: Record<string, any>): StrategyLevel {
  const rows = effortOf(p);
  const online = new Set([...channelsOf(p).map((c) => c.channel), ...rows.map((r) => r.channel)]);
  const offline = offlineOf(p);
  const counts = formatCounts(p);
  const items: LevelItem[] = rows.map((r) => ({ label: r.channel, text: `${r.organic}% organic, ${r.paid}% paid`, split: { organic: r.organic, paid: r.paid } }));
  let summary = '';
  if (rows.length) {
    const avg = Math.round(rows.reduce((a, r) => a + r.organic, 0) / rows.length);
    const anyPaid = rows.some((r) => r.paid > 0);
    summary = anyPaid ? `${avg}% organic on average` : 'All organic, no paid promotion';
    if (!anyPaid) items.push({ label: 'Paid promotion', text: 'No paid promotion is suggested in this plan.' });
  } else if (online.size) {
    items.push({ label: 'Organic and paid', text: 'Your plan does not split organic and paid effort yet.' });
  }
  if (online.size || offline.length) {
    const n = online.size;
    const text = offline.length
      ? `${n} online ${n === 1 ? 'channel' : 'channels'} and ${offline.length} offline.`
      : `All ${n} ${n === 1 ? 'channel' : 'channels'} in this plan ${n === 1 ? 'is' : 'are'} online. Your plan does not include offline activity yet, such as local events, posters or referrals.`;
    items.push({ label: 'Online and offline', text });
    if (!summary) summary = offline.length ? `${n} online and ${offline.length} offline` : `All online, ${n} ${n === 1 ? 'channel' : 'channels'}`;
    else summary += offline.length ? `, ${offline.length} offline` : ', all online';
  }
  if (counts.length) {
    items.push({ label: 'Formats this month', text: `${formatPhrase(counts)}.` });
    if (!summary) summary = formatPhrase(counts);
  }
  // Channels alone (an older plan) still say something true about the mix: thin, not missing.
  const status: LevelStatus = rows.length && counts.length ? 'ready' : rows.length || counts.length || online.size || offline.length ? 'thin' : 'missing';
  return level(5, 'mix', status, summary, items, undefined, null);
}

function channelsLevel(p: Record<string, any>): StrategyLevel {
  const chans = channelsOf(p);
  const rows = effortOf(p);
  const offline = offlineOf(p);
  const names = Array.from(new Set([...chans.map((c) => c.channel), ...rows.map((r) => r.channel)]));
  const items: LevelItem[] = names.map((name) => {
    const role = chans.find((c) => c.channel === name)?.role;
    const row = rows.find((r) => r.channel === name);
    const out: LevelItem = { label: name, text: role ? clampText(role.text, ITEM_MAX) : 'No role set for this channel yet.', ...(role && role.tag ? { tag: String(role.tag) } : {}) };
    if (row) {
      out.sub = [
        { label: 'Nebulaa does', text: row.does.length ? `Makes your ${joinWords(row.does)}.` : 'Nothing set for this channel yet.' },
        { label: 'You do', text: row.youDo.length ? clampText(row.youDo.join(' '), ITEM_MAX) : 'Nothing needed.' },
      ];
    }
    return out;
  });
  offline.forEach((o) => items.push({
    label: o.channel, offline: true,
    text: o.role ? clampText(o.role.text, ITEM_MAX) : 'No role set for this yet.',
    sub: [{ label: 'Nebulaa does', text: 'Nothing offline. This one is yours.' }, { label: 'You do', text: o.youDo.length ? clampText(o.youDo.join(' '), ITEM_MAX) : 'Nothing set yet.' }],
  }));
  if (!names.length && !offline.length) return level(6, 'channels', 'missing', '', []);
  const all = [...names, ...offline.map((o) => o.channel)];
  const status: LevelStatus = names.length && rows.length ? 'ready' : 'thin';
  return level(6, 'channels', status, joinSome(all, 3), items, rows.length ? undefined : 'Who does what on each channel is added when your plan is next refreshed.');
}

function contentLevel(p: Record<string, any>): StrategyLevel {
  const pillars = list(p.pillars).filter((x) => isObj(x) && words(x.name));
  const counts = formatCounts(p);
  const items: LevelItem[] = pillars.map((x) => (claimText(x.why) ? item(x.why, clampText(x.name, 60)) : { label: clampText(x.name, 60), text: 'A theme your posts come back to.' }));
  if (counts.length) items.push({ label: 'This month', text: `${formatPhrase(counts)}, ${list(p.calendar).filter(isObj).length} in all.` });
  if (!pillars.length && !counts.length) return level(7, 'content', 'missing', '', []);
  const status: LevelStatus = pillars.length >= 3 && counts.length ? 'ready' : 'thin';
  return level(7, 'content', status, pillars.length ? joinSome(pillars.map((x) => words(x.name)), 4) : formatPhrase(counts), items);
}

function roadmapLevel(p: Record<string, any>, madeAt: unknown, now: Date): StrategyLevel {
  const phases = list(p.roadmap).filter((r) => isObj(r) && (claimText(r.focus) || claimsOf(r.actions).length));
  const now0 = currentPhase(madeAt, now);
  const items: LevelItem[] = phases.map((r) => {
    const id = words(r.phase);
    const title = `${PHASE_DAYS[id] || 'Next'}, ${PHASE_TITLES[id] || id || 'phase'}`;
    return {
      label: title,
      text: claimText(r.focus) ? clampText(r.focus.text, ITEM_MAX) : 'No focus set for this phase yet.',
      ...(r.focus && r.focus.tag ? { tag: String(r.focus.tag) } : {}),
      ...(id && id === now0 ? { current: true } : {}),
      bullets: claimsOf(r.actions).map((c) => clampText(c.text, ITEM_MAX)),
    };
  });
  if (!items.length) return level(8, 'roadmap', 'missing', '', []);
  const cur = items.find((i) => i.current);
  const summary = cur ? `Now: ${cur.label.replace(/^Days/, 'days')}. ${cur.text}` : items[0].text;
  return level(8, 'roadmap', items.length >= 3 ? 'ready' : 'thin', summary, items);
}

function numbersLevel(p: Record<string, any>): StrategyLevel {
  const items: LevelItem[] = [];
  const seen = new Set<string>();
  for (const m of list(p.metrics)) {
    if (!isObj(m)) continue;
    for (const id of list(m.ids).map(words)) {
      const def = METRIC_LABELS[id];
      if (!def || seen.has(id)) continue;
      seen.add(id);
      items.push({ label: def.label, text: def.live ? 'Nebulaa reads this from your connected accounts.' : 'You track this yourself.' });
    }
  }
  const metricNames = items.map((i) => String(i.label).toLowerCase());
  let measures = 0;
  for (const r of list(p.roadmap)) {
    if (!isObj(r)) continue;
    const ms = claimsOf(r.measure);
    if (!ms.length) continue;
    // One row per phase, the signs listed under it. A shared tag is kept; mixed tags are left to the detail below.
    const tags = new Set(ms.map((c) => String(c.tag || 'proposed')));
    const id = words(r.phase);
    items.push({
      label: `${PHASE_DAYS[id] || 'Next'}, ${PHASE_TITLES[id] || id || 'phase'}`,
      text: clampText(ms[0].text, ITEM_MAX),
      ...(tags.size === 1 ? { tag: [...tags][0] } : {}),
      ...(ms.length > 1 ? { bullets: ms.slice(1).map((c) => clampText(c.text, ITEM_MAX)) } : {}),
    });
    measures += ms.length;
  }
  if (!items.length) return level(9, 'numbers', 'missing', '', []);
  const structured = metricNames.length > 0;
  const summary = structured ? `Watch ${joinSome(metricNames, 4)}` : items[0].text;
  return level(9, 'numbers', structured || measures >= 3 ? 'ready' : 'thin', summary, items);
}

/** The nine funnel levels, in the owner's order. `products` is the customer's own catalogue (optional). */
export function levelsOf(input: unknown, extras: LevelExtras = {}): StrategyLevel[] {
  const { p, madeAt } = innerOf(input);
  const now = extras.now instanceof Date ? extras.now : new Date();
  return [
    businessLevel(p),
    productsLevel(extras.products),
    customersLevel(p),
    positioningLevel(p),
    mixLevel(p),
    channelsLevel(p),
    contentLevel(p),
    roadmapLevel(p, madeAt, now),
    numbersLevel(p),
  ];
}

/** "6 of 9 levels ready". */
export function readyCount(levels: StrategyLevel[]): string {
  const n = levels.filter((l) => l.status === 'ready').length;
  return `${n} of ${levels.length} levels ready`;
}
