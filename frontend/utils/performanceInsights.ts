/** Performance page, second version (pages/GravityInsights.tsx): everything is drawn from ONE answer,
 *  GET /api/analytics/performance (backend/services/performance/view.js). These are the pure rules that turn that answer
 *  into tiles, chips, cards and bars. A number shows only when the answer holds it; otherwise its reason in words.
 *  See docs/superpowers/ops/performance-view.md. */
import { formatCount, formatPercent, formatShort } from './formatCount.ts';
import { reasonLink, type KpiChip, type KpiTile, type KpiLink } from './performanceView.ts';
import type { Platform as MarkPlatform } from './planVisuals.ts';

export type RangeKey = 'week' | 'month' | '90d';
export interface PvMetric {
  value: number | null; previous: number | null; change: number | null; changePct: number | null;
  available: boolean; reason: string | null; unit?: string; asOf?: string | null; posts?: number; capped?: boolean;
}
export type PvMetricKey = 'followers' | 'reach' | 'engagementRate' | 'likes' | 'comments' | 'shares' | 'posts';
export interface PvPlatform {
  platform: string; label: string; connected: boolean; state: 'ready' | 'nodata' | 'notconnected' | 'error';
  reason: string | null; asOf: string | null; postsMeasured: number;
  metrics: Partial<Record<PvMetricKey, PvMetric>>;
  spark: Partial<Record<'followers' | 'reach' | 'engagementRate', number[]>>;
}
export interface PvPost {
  id: string; campaignId: string | null; platform: string; platformLabel: string; title: string; thumbnail: string | null; url: string | null;
  publishedAt: string | null; date: string | null; format: string; metric: string; value: number | null; metrics: Record<string, number>;
}
export interface PvAction { kind: 'video' | 'post'; mode: 'single' | 'carousel'; platform: string | null; brief: string }
export interface PvInsight { id: string; kind: string; tone: string; text: string; source: string; evidence: Record<string, unknown>; action: PvAction | null }
export interface PvCompareRow { label: string; posts: number; average: number | null; format?: string; weekday?: number; key?: string; hours?: string }
export interface PvCompare { available: boolean; reason: string | null; metric: string; rows: PvCompareRow[]; best?: (PvCompareRow & { lift: number }) | null; average?: number | null; posts?: number }
export interface PerformanceView {
  range: { key: RangeKey; days: number; from: string; to: string; previousFrom: string; words: string };
  platform: string | null;
  account: { free: boolean; canConnect: boolean; clientWorkspace: boolean; staff: boolean };
  connected: { count: number; platforms: string[] };
  overall: { followers: PvMetric; reach: PvMetric; engagementRate: PvMetric; likes: PvMetric; posts: PvMetric; postsMeasured: PvMetric; spark: Partial<Record<'followers' | 'reach' | 'engagementRate' | 'posts', number[] | null>> };
  platforms: PvPlatform[];
  topPosts: { measured: number; reason: string | null; lists: Record<TopKey, { posts: PvPost[]; reason: string | null }> };
  byFormat: PvCompare; byDay: PvCompare; byTime: PvCompare;
  insights: PvInsight[]; insightsReason: string | null;
  degraded: string[];
}

export const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: '90d', label: 'Last 90 days' },
];
const BEFORE: Record<RangeKey, string> = { week: 'the week before', month: 'the month before', '90d': 'the 90 days before' };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
const NOT_LOADED = 'We could not load this just now.';

/** A plausible answer from the server (anything else is treated as a failed load). */
export function isPerformanceView(v: unknown): v is PerformanceView {
  const x = v as PerformanceView;
  return Boolean(x && x.range && x.overall && Array.isArray(x.platforms) && x.topPosts && x.topPosts.lists);
}

/** "Up 12 percent on the month before"; null without both periods. */
export function rangeChip(current: unknown, previous: unknown, range: RangeKey): KpiChip | null {
  if (!isNum(current) || !isNum(previous)) return null;
  const before = BEFORE[range] || BEFORE.month;
  if (previous === 0) return current > 0 ? { text: `None ${before}`, dir: 'flat' } : null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const r = Math.round(Math.abs(pct));
  if (r === 0) return { text: `Same as ${before}`, dir: 'flat' };
  return { text: `${pct > 0 ? 'Up' : 'Down'} ${formatCount(r)} percent on ${before}`, dir: pct > 0 ? 'up' : 'down' };
}

/** "+120 on the month before" style chip for a follower change (a count, not a percent). */
export function gainChip(change: unknown, range: RangeKey): KpiChip | null {
  if (!isNum(change)) return null;
  if (change === 0) return { text: 'No change', dir: 'flat' };
  return { text: `${change > 0 ? '+' : '-'}${formatCount(Math.abs(change))} ${range === 'week' ? 'this week' : range === 'month' ? 'this month' : 'in 90 days'}`, dir: change > 0 ? 'up' : 'down' };
}

const sparkOf = (pts: number[] | null | undefined) => (Array.isArray(pts) && pts.filter(isNum).length >= 2 ? pts.filter(isNum) : null);

/** The four KPI tiles for the chosen range (and platform): reach, engagement, new followers, posts published. */
export function kpisFromView(view: PerformanceView | null, failed = false): KpiTile[] {
  const range = (view && view.range && view.range.key) || 'month';
  const client = Boolean(view && view.account && view.account.clientWorkspace);
  const o = view && view.overall;
  const spark = (o && o.spark) || {};
  const lineNote = (pts: number[] | null, unit: 'day' | 'part') => (pts ? (unit === 'day' ? plural(pts.length, 'day', 'days') : 'Across the period') : 'The line appears after two days of numbers.');
  const off = (key: KpiTile['key'], title: string, m: PvMetric | undefined): KpiTile => {
    const given = (m && !m.available && m.reason) || '';
    const reason = failed || !view || !given || /^we could not load/i.test(given) ? NOT_LOADED : given;
    return { key, title, value: null, detail: null, chip: null, reason, link: reasonLink(reason, client), spark: null, sparkNote: '', label: `${title}: ${reason}` };
  };
  const tiles: KpiTile[] = [];
  const reach = o && o.reach;
  if (reach && reach.available && isNum(reach.value)) {
    const chip = rangeChip(reach.value, reach.previous, range);
    const pts = sparkOf(spark.reach);
    tiles.push({ key: 'reach', title: 'Reach', value: reach.value >= 100000 ? formatShort(reach.value) : formatCount(reach.value), detail: 'people reached', chip, reason: null, link: null, spark: pts, sparkNote: lineNote(pts, 'day'), label: `Reach: ${formatCount(reach.value)} people${chip ? `. ${chip.text}` : ''}` });
  } else tiles.push(off('reach', 'Reach', reach));
  const eng = o && o.engagementRate;
  if (eng && eng.available && isNum(eng.value)) {
    const chip = rangeChip(eng.value, eng.previous, range);
    const pts = sparkOf(spark.engagementRate);
    tiles.push({ key: 'engagement', title: 'Engagement', value: formatPercent(eng.value), detail: 'average rate', chip, reason: null, link: null, spark: pts, sparkNote: lineNote(pts, 'day'), label: `Engagement: ${formatPercent(eng.value)}${chip ? `. ${chip.text}` : ''}` });
  } else tiles.push(off('engagement', 'Engagement', eng));
  const fol = o && o.followers;
  if (fol && fol.available && isNum(fol.value)) {
    const pts = sparkOf(spark.followers);
    if (isNum(fol.change)) {
      const value = `${fol.change > 0 ? '+' : ''}${formatCount(fol.change)}`;
      tiles.push({ key: 'followers', title: 'New followers', value, detail: `${formatCount(fol.value)} in all`, chip: rangeChip(fol.value, fol.previous, range), reason: null, link: null, spark: pts, sparkNote: lineNote(pts, 'day'), label: `New followers: ${value}, ${formatCount(fol.value)} in all` });
    } else {
      tiles.push({ key: 'followers', title: 'New followers', value: formatCount(fol.value), detail: 'followers now; the change shows once there is a number from the start of the period', chip: null, reason: null, link: null, spark: pts, sparkNote: lineNote(pts, 'day'), label: `Followers: ${formatCount(fol.value)}` });
    }
  } else tiles.push(off('followers', 'New followers', fol));
  const posts = o && o.posts;
  if (posts && posts.available && isNum(posts.value)) {
    const chip = rangeChip(posts.value, posts.previous, range);
    const pts = sparkOf(spark.posts);
    const measured = o && o.postsMeasured && isNum(o.postsMeasured.value) ? o.postsMeasured.value : 0;
    tiles.push({ key: 'posts', title: 'Posts published', value: formatCount(posts.value), detail: measured ? `${formatCount(measured)} measured` : (view ? view.range.words : ''), chip, reason: null, link: null, spark: pts, sparkNote: pts ? '' : posts.value ? 'The line shows once posts fall in two parts of the period.' : 'No posts in this period', label: `Posts published: ${formatCount(posts.value)}${chip ? `. ${chip.text}` : ''}` });
  } else tiles.push(off('posts', 'Posts published', posts));
  return tiles;
}

/** The drawn mark for a stored platform key. */
export function markOf(platform: string): MarkPlatform {
  const p = String(platform || '').toLowerCase();
  if (p === 'twitter' || p === 'x') return 'x';
  if (p === 'gmb' || p === 'google') return 'google';
  if (['instagram', 'facebook', 'linkedin', 'youtube'].includes(p)) return p as MarkPlatform;
  return 'other';
}

export interface StatCell { key: string; label: string; value: string | null; reason: string | null }
export interface PlatformTileView {
  platform: string; label: string; mark: MarkPlatform; state: PvPlatform['state'];
  headline: string | null; headlineNote: string; chip: KpiChip | null; stats: StatCell[]; spark: number[] | null;
  reason: string | null; action: KpiLink | null; selectable: boolean; aria: string;
}

const cell = (key: string, label: string, m: PvMetric | undefined, fmt: (n: number) => string): StatCell => (
  m && m.available && isNum(m.value) ? { key, label, value: fmt(m.value), reason: null } : { key, label, value: null, reason: (m && m.reason) || 'Not reported yet.' });

/** One platform tile: followers as the headline, reach, engagement, likes and posts as small cells, a follower line. */
export function platformTile(p: PvPlatform, range: RangeKey, clientWorkspace = false): PlatformTileView {
  const mark = markOf(p.platform);
  const base = { platform: p.platform, label: p.label, mark, state: p.state };
  if (p.state === 'notconnected') {
    const reason = p.reason || `Connect ${p.label} to see its numbers here.`;
    const link = /paid plan/i.test(reason) ? (clientWorkspace ? null : { to: '/trial-expired', text: 'See plans' }) : { to: '/connect-socials', text: 'Connect' };
    return { ...base, headline: null, headlineNote: 'Not connected', chip: null, stats: [], spark: null, reason, action: link, selectable: false, aria: `${p.label}: not connected. ${reason}` };
  }
  const m = p.metrics || {};
  const short = (n: number) => (n >= 100000 ? formatShort(n) : formatCount(n));
  const stats = [
    cell('reach', 'Reach', m.reach, short),
    cell('engagementRate', 'Engagement', m.engagementRate, (n) => formatPercent(n)),
    cell('likes', 'Likes', m.likes, short),
    cell('posts', 'Posts', m.posts, (n) => formatCount(n)),
  ];
  const fol = m.followers;
  const headline = fol && fol.available && isNum(fol.value) ? short(fol.value) : null;
  const chip = fol && fol.available ? gainChip(fol.change, range) : null;
  const spark = sparkOf(p.spark && p.spark.followers);
  const reason = p.state === 'ready' ? null : (p.reason || 'No numbers yet.');
  const headlineNote = headline ? 'followers' : (fol && fol.reason) || 'Followers not reported yet';
  const anyNumber = Boolean(headline) || stats.some((s) => s.value !== null);
  return {
    ...base, headline, headlineNote, chip, stats, spark, reason, action: null, selectable: p.state !== 'error' && anyNumber,
    aria: `${p.label}: ${headline ? `${headline} followers` : headlineNote}${chip ? `, ${chip.text}` : ''}. ${stats.map((s) => `${s.label} ${s.value ?? 'not available'}`).join(', ')}`,
  };
}

export type TopKey = 'engagement' | 'likes' | 'comments' | 'reach';
export const TOP_TABS: Array<{ key: TopKey; label: string }> = [
  { key: 'engagement', label: 'Most engagement' },
  { key: 'likes', label: 'Most likes' },
  { key: 'comments', label: 'Most comments' },
  { key: 'reach', label: 'Most reach' },
];

/** The small number chips on a post card, the ranking measure first. */
export function postChips(post: PvPost): Array<{ key: string; text: string; lead: boolean }> {
  const m = post.metrics || {};
  const words: Record<string, [string, string]> = { likes: ['like', 'likes'], comments: ['comment', 'comments'], shares: ['share', 'shares'], saves: ['save', 'saves'], reach: ['reached', 'reached'], views: ['view', 'views'] };
  const order = ['likes', 'comments', 'shares', 'saves', 'reach', 'views'];
  const lead = post.metric === 'engagement' ? null : post.metric;
  const keys = [...(lead && isNum(m[lead]) ? [lead] : []), ...order.filter((k) => k !== lead && isNum(m[k]) && m[k] > 0)].slice(0, 3);
  const chips = keys.map((k) => ({ key: k, text: k === 'reach' ? `${formatShort(m[k])} reached` : plural(m[k], words[k][0], words[k][1]), lead: k === lead }));
  if (post.metric === 'engagement' && isNum(m.engagement)) chips.unshift({ key: 'engagement', text: `${formatShort(m.engagement)} engagement`, lead: true });
  return chips.slice(0, 3);
}

/** "12 Oct" in India time from a "YYYY-MM-DD" day or a date. */
export function shortDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (m) return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  const x = new Date(t + 330 * 60000);
  return `${x.getUTCDate()} ${months[x.getUTCMonth()]}`;
}

/** "20 Sep to 20 Oct" for the chosen period. */
export function rangeSpan(view: PerformanceView | null): string | null {
  if (!view || !view.range) return null;
  const a = shortDate(view.range.from);
  const b = shortDate(view.range.to);
  return a && b ? `${a} to ${b}` : null;
}

/** Bars for a comparison: width in percent of the largest average (only rows with a number). */
export function compareBars(c: PvCompare | null | undefined): Array<PvCompareRow & { width: number; best: boolean }> {
  const rows = (c && Array.isArray(c.rows) ? c.rows : []).filter((r) => isNum(r.average) && r.posts > 0);
  const max = Math.max(0, ...rows.map((r) => r.average as number));
  return rows.map((r, i) => ({ ...r, width: max > 0 ? Math.max(6, Math.round(((r.average as number) / max) * 100)) : 0, best: i === 0 }));
}

/** A heat strip: every row with a level 0 (no posts) to 4 (the highest average). */
export function heatStrip(c: PvCompare | null | undefined): Array<PvCompareRow & { level: number }> {
  const rows = c && Array.isArray(c.rows) ? c.rows : [];
  const vals = rows.map((r) => (isNum(r.average) && r.posts > 0 ? (r.average as number) : null));
  const max = Math.max(0, ...vals.filter(isNum));
  return rows.map((r, i) => ({ ...r, level: vals[i] === null || max <= 0 ? 0 : Math.max(1, Math.ceil(((vals[i] as number) / max) * 4)) }));
}

export interface Handoff { target: 'carousel'; route: string; data: { mode: 'single' | 'carousel'; topic: string; platform?: string; source: 'home' } }
export interface VideoHandoff { target: 'video'; route: string; data: { idea: string; source: 'home' } }
/** "Make a post like this": the Create (or Videos) screen opens with the neutral brief written by the server. */
export function insightHandoff(a: PvAction | null | undefined): Handoff | VideoHandoff | null {
  const brief = String((a && a.brief) || '').trim().slice(0, 300);
  if (!a || !brief) return null;
  if (a.kind === 'video') return { target: 'video', route: '/reels', data: { idea: brief, source: 'home' } };
  const platform = String(a.platform || '').trim().toLowerCase();
  return { target: 'carousel', route: '/campaigns', data: { mode: a.mode === 'carousel' ? 'carousel' : 'single', topic: brief, ...(platform ? { platform } : {}), source: 'home' } };
}

/** The line under the page heading: what the stored numbers say for the period, or what to do next. */
export function heroSentence(view: PerformanceView | null, failed = false): string {
  if (failed || !view) return 'We could not load your numbers just now. Please try again in a moment.';
  const o = view.overall;
  const where = view.platform ? ` on ${(view.platforms.find((p) => p.platform === view.platform) || { label: view.platform }).label}` : '';
  const words = view.range.words;
  if (o.reach.available && isNum(o.reach.value)) {
    const posts = o.posts.available && isNum(o.posts.value) ? `, from ${plural(o.posts.value, 'post', 'posts')} published ${words}` : '';
    return `Your accounts${where} reached ${formatCount(o.reach.value)} people${posts}.`;
  }
  if (view.connected.count === 0) {
    return view.account.canConnect ? 'Connect an account and your reach, followers and best posts show here.' : 'Your reach, followers and best posts show here once your accounts are connected. Connecting accounts comes with a paid plan.';
  }
  if (o.posts.available && isNum(o.posts.value) && o.posts.value > 0) return `${plural(o.posts.value, 'post', 'posts')} published${where} ${words}. Their numbers show as soon as the platforms report them.`;
  return 'Your numbers show here as soon as your accounts report them.';
}

/** Tiles of a row stretch to fill it: the CSS needs to know how many there are. */
export function platformColumns(count: number): number {
  if (count <= 4) return Math.max(1, count);
  return count === 5 ? 5 : 3;
}
