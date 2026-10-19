/** Performance page (pages/GravityInsights.tsx): KPI tiles, sparklines, change chips and the best post of the month.
 *  Only stored data: the Home summary numbers (newest daily snapshot, with reasons), the stored daily snapshots
 *  (GET /api/analytics/history) and published campaigns. A figure that is not stored shows its reason, never 0.
 *  See docs/superpowers/impact-maps/performance-brand.md section 6. */
import type { HomeNumber, HomeSummary } from '../types';
import { formatCount, formatPercent, formatShort } from './formatCount.ts';
import { istWeek, IST_OFFSET_MINUTES } from './week.ts';

export type KpiKey = 'reach' | 'engagement' | 'followers' | 'posts';
export type ChipDir = 'up' | 'down' | 'flat';
export interface KpiChip { text: string; dir: ChipDir }
export interface KpiLink { to: string; text: string }
export interface KpiTile {
  key: KpiKey;
  title: string;
  /** The big figure, or null when it is not available. */
  value: string | null;
  /** One short line under the figure ("12,450 followers now"). */
  detail: string | null;
  chip: KpiChip | null;
  /** The reason in words when the figure is not available. */
  reason: string | null;
  link: KpiLink | null;
  /** Real stored points, oldest first; null when there are fewer than two. */
  spark: number[] | null;
  /** Says what the line covers, or why there is none. */
  sparkNote: string;
  label: string;
}

export interface SnapshotPoint { date: string; platforms?: Record<string, any> | null; totals?: Record<string, any> | null }

const NOT_LOADED = 'We could not load this just now.';
const DAY_MS = 86400000;
const OFFSET_MS = IST_OFFSET_MINUTES * 60000;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** The link under a reason. Plan links never show inside a client workspace. */
export function reasonLink(reason: string, clientWorkspace: boolean): KpiLink | null {
  const r = reason.toLowerCase();
  if (r.includes('connect an account')) return { to: '/connect-socials', text: 'Connect an account' };
  if (clientWorkspace) return null;
  if (r.includes('paid plan')) return { to: '/trial-expired', text: 'See plans' };
  return null;
}

/** "Up 12 percent on last week", "Down 3 percent on last week", "Same as last week"; null without both weeks. */
export function changeWords(current: unknown, previous: unknown): KpiChip | null {
  if (!isNum(current) || !isNum(previous)) return null;
  if (previous === 0) return current > 0 ? { text: 'None last week', dir: 'flat' } : null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const r = Math.round(Math.abs(pct));
  if (r === 0) return { text: 'Same as last week', dir: 'flat' };
  return { text: `${pct > 0 ? 'Up' : 'Down'} ${formatCount(r)} percent on last week`, dir: pct > 0 ? 'up' : 'down' };
}

/** Change chip from a server number that already carries previous and changePct. */
function chipFromNumber(n: HomeNumber | null | undefined): KpiChip | null {
  if (!n || !n.available || !isNum(n.value) || !isNum(n.previous)) return null;
  return changeWords(n.value, n.previous);
}

const dayOf = (s: SnapshotPoint) => {
  const t = new Date(s && s.date).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Snapshots sorted oldest first, broken rows dropped. */
export function cleanHistory(history: unknown): SnapshotPoint[] {
  if (!Array.isArray(history)) return [];
  return (history as SnapshotPoint[])
    .filter((s) => s && typeof s === 'object' && dayOf(s) !== null)
    .sort((a, b) => (dayOf(a) as number) - (dayOf(b) as number));
}

/** Mean of the platforms that report an engagement rate above 0 (as Home does); null when none does. */
export function engagementOf(s: SnapshotPoint): number | null {
  const rates = Object.values((s && s.platforms) || {}).map((m: any) => (m ? m.engagementRate : 0)).filter((r) => isNum(r) && r > 0) as number[];
  if (!rates.length) return null;
  return Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100;
}

/** The real points of one measure, oldest first. Reach 0 means "not reported" and is skipped; followers need a platform. */
export function seriesOf(history: SnapshotPoint[], key: 'reach' | 'engagement' | 'followers'): number[] {
  const out: number[] = [];
  for (const s of history) {
    if (key === 'engagement') { const e = engagementOf(s); if (e !== null) out.push(e); continue; }
    const v = s && s.totals ? s.totals[key] : undefined;
    if (!isNum(v)) continue;
    if (key === 'reach' && v <= 0) continue;
    if (key === 'followers' && !Object.keys((s && s.platforms) || {}).length) continue;
    out.push(v);
  }
  return out;
}

/** Followers gained in the week before the newest snapshot's comparison point: needs snapshots 7 and 14 days back. */
export function followerGains(history: SnapshotPoint[]): { thisWeek: number | null; lastWeek: number | null } {
  const pts = history.filter((s) => s.totals && isNum(s.totals.followers) && Object.keys(s.platforms || {}).length);
  if (!pts.length) return { thisWeek: null, lastWeek: null };
  const newest = pts[pts.length - 1];
  const t0 = dayOf(newest) as number;
  // The newest snapshot that is at least `days` older than `from` and within 7 more days.
  const back = (from: number, days: number) => {
    for (let i = pts.length - 1; i >= 0; i--) {
      const t = dayOf(pts[i]) as number;
      if (t <= from - days * DAY_MS + DAY_MS / 2) return t >= from - (days + 7) * DAY_MS ? pts[i] : null;
    }
    return null;
  };
  const a = back(t0, 7);
  if (!a) return { thisWeek: null, lastWeek: null };
  const b = back(dayOf(a) as number, 7);
  const f = (s: SnapshotPoint): number => (s.totals && isNum(s.totals.followers) ? s.totals.followers : 0);
  return { thisWeek: f(newest) - f(a), lastWeek: b ? f(a) - f(b) : null };
}

/** India calendar month key "2026-10" of a date. */
export function istMonthKey(d: Date | string | number): string | null {
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + OFFSET_MS).toISOString().slice(0, 7);
}

const publishedAt = (c: any): number | null => {
  const raw = c && (c.publishedAt || c.scheduledFor);
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const isPosted = (c: any) => String((c && c.status) || '').toLowerCase() === 'posted';

/** Published posts per India week, oldest first, for up to `weeks` weeks ending this week.
 *  When the list is full (the campaigns call returns at most `limit`), weeks older than the oldest returned campaign are left out. */
export function weeklyPosts(campaigns: unknown, now: Date, weeks = 8, limit = 50): { counts: number[]; complete: boolean } {
  const list = Array.isArray(campaigns) ? campaigns : [];
  const thisWeek = istWeek(now).startsAt.getTime();
  let firstWeek = thisWeek - (weeks - 1) * 7 * DAY_MS;
  let complete = true;
  if (list.length >= limit) {
    const created = list.map((c: any) => new Date(c && c.createdAt).getTime()).filter(Number.isFinite) as number[];
    const oldest = created.length ? Math.min(...created) : thisWeek;
    while (firstWeek < oldest && firstWeek < thisWeek) { firstWeek += 7 * DAY_MS; complete = false; }
  }
  const counts: number[] = [];
  for (let w = firstWeek; w <= thisWeek; w += 7 * DAY_MS) {
    counts.push(list.filter((c: any) => { const t = publishedAt(c); return isPosted(c) && t !== null && t >= w && t < w + 7 * DAY_MS; }).length);
  }
  return { counts, complete };
}

export interface BuildInput {
  summary: HomeSummary | null;
  summaryFailed?: boolean;
  history: unknown;
  historyFailed?: boolean;
  campaigns: unknown;
  campaignsFailed?: boolean;
  now?: Date;
}

const sparkOrNull = (pts: number[]) => (pts.length >= 2 ? pts : null);

/** The four KPI tiles, in order: reach, engagement, new followers, posts published. */
export function buildKpis(input: BuildInput): KpiTile[] {
  const now = input.now || new Date();
  const s = input.summary;
  const client = Boolean(s && s.account && s.account.clientWorkspace);
  const disconnected = Boolean(s && s.connected && s.connected.count === 0);
  // An old snapshot of an account that was disconnected is not shown (as on Home).
  const history = input.historyFailed || disconnected ? [] : cleanHistory(input.history);
  // `what` is kept for the screen-reader label; the visible note stays one short line.
  const lineNote = (pts: number[], _what: string) => (pts.length >= 2
    ? plural(pts.length, 'day', 'days')
    : 'The line appears after two days of numbers.');

  const unavailable = (key: KpiKey, title: string, n: HomeNumber | null | undefined): KpiTile => {
    const given = (n && !n.available && typeof n.reason === 'string' && n.reason.trim()) || '';
    const reason = input.summaryFailed || !s || !given || /^we could not load/i.test(given) ? NOT_LOADED : given;
    return { key, title, value: null, detail: null, chip: null, reason, link: reasonLink(reason, client), spark: null, sparkNote: '', label: `${title}: ${reason}` };
  };

  const nums = s && s.numbers;
  const tiles: KpiTile[] = [];

  // Reach
  const reach = nums && nums.reach;
  if (reach && reach.available && isNum(reach.value)) {
    const pts = seriesOf(history, 'reach');
    const chip = chipFromNumber(reach);
    const value = reach.value >= 100000 ? formatShort(reach.value) : formatCount(reach.value);
    tiles.push({ key: 'reach', title: 'Reach', value, detail: 'people reached', chip, reason: null, link: null, spark: sparkOrNull(pts), sparkNote: lineNote(pts, 'Reach'), label: `Reach: ${formatCount(reach.value)} people${chip ? `. ${chip.text}` : ''}` });
  } else tiles.push(unavailable('reach', 'Reach', reach));

  // Engagement
  const eng = nums && nums.engagement;
  if (eng && eng.available && isNum(eng.value)) {
    const pts = seriesOf(history, 'engagement');
    const chip = chipFromNumber(eng);
    tiles.push({ key: 'engagement', title: 'Engagement', value: formatPercent(eng.value), detail: 'average rate', chip, reason: null, link: null, spark: sparkOrNull(pts), sparkNote: lineNote(pts, 'Engagement rate'), label: `Engagement: ${formatPercent(eng.value)}${chip ? `. ${chip.text}` : ''}` });
  } else tiles.push(unavailable('engagement', 'Engagement', eng));

  // New followers
  const fol = nums && nums.followers;
  if (fol && fol.available && isNum(fol.value)) {
    const pts = seriesOf(history, 'followers');
    const gains = followerGains(history);
    const change = isNum(fol.change) ? fol.change : isNum(fol.previous) ? fol.value - fol.previous : null;
    const nowText = `${formatCount(fol.value)} ${fol.value === 1 ? 'follower' : 'followers'} now`;
    if (change !== null) {
      const chip = gains.lastWeek !== null && gains.thisWeek === change ? changeWords(change, gains.lastWeek) : null;
      const value = `${change > 0 ? '+' : ''}${formatCount(change)}`;
      tiles.push({ key: 'followers', title: 'New followers', value, detail: `in a week, ${formatCount(fol.value)} in all`, chip, reason: null, link: null, spark: sparkOrNull(pts), sparkNote: lineNote(pts, 'Followers'), label: `New followers: ${value} over the last week, ${nowText}${chip ? `. ${chip.text}` : ''}` });
    } else {
      tiles.push({ key: 'followers', title: 'New followers', value: formatCount(fol.value), detail: 'followers now; new ones show after a week', chip: null, reason: null, link: null, spark: sparkOrNull(pts), sparkNote: lineNote(pts, 'Followers'), label: `Followers: ${formatCount(fol.value)}. New followers show after a week of numbers.` });
    }
  } else tiles.push(unavailable('followers', 'New followers', fol));

  // Posts published (this India week)
  const posts = nums && nums.postsPublishedThisWeek;
  if (posts && posts.available && isNum(posts.value)) {
    const weekly = input.campaignsFailed ? { counts: [], complete: true } : weeklyPosts(input.campaigns, now);
    const pts = weekly.counts;
    const chip = changeWords(posts.value, isNum(posts.previous) ? posts.previous : undefined);
    const note = pts.length >= 2
      ? `${plural(pts.length, 'week', 'weeks')}${weekly.complete ? '' : ' we can count'}`
      : 'The line appears after two weeks of posts.';
    tiles.push({ key: 'posts', title: 'Posts published', value: formatCount(posts.value), detail: 'this week', chip, reason: null, link: null, spark: pts.length >= 2 && pts.some((n) => n > 0) ? pts : null, sparkNote: pts.length >= 2 && !pts.some((n) => n > 0) ? 'No posts in these weeks' : note, label: `Posts published this week: ${formatCount(posts.value)}${chip ? `. ${chip.text}` : ''}` });
  } else tiles.push(unavailable('posts', 'Posts published', posts));

  return tiles;
}

/** The SVG path of a sparkline in a `w` by `h` box (2 px inset top and bottom), oldest point on the left. */
export function sparkPath(points: number[], w = 120, h = 36): string {
  const pts = (Array.isArray(points) ? points : []).filter(isNum);
  if (pts.length < 2) return '';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min;
  const pad = 2;
  const step = w / (pts.length - 1);
  const y = (v: number) => (span === 0 ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2));
  return pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
}

/** Reach by day for the larger chart: real points with their dates (reach 0 skipped). */
export function reachDays(history: unknown, disconnected = false): Array<{ date: string; value: number }> {
  if (disconnected) return [];
  return cleanHistory(history)
    .filter((s) => s.totals && isNum(s.totals.reach) && s.totals.reach > 0)
    .map((s) => ({ date: String(s.date), value: Number(s.totals && s.totals.reach) }));
}

export interface BestPost {
  kind: 'best' | 'latest' | 'none';
  title: string;
  id?: string;
  name?: string;
  image?: string | null;
  platform?: string | null;
  when?: string | null;
  stats?: string[];
  note: string;
}

const engagementScore = (c: any): number => {
  const p = (c && c.performance) || {};
  const parts = ['likes', 'comments', 'shares'].map((k) => (isNum(p[k]) ? p[k] : 0)).reduce((a, b) => a + b, 0);
  return parts > 0 ? parts : isNum(p.engagement) ? p.engagement : 0;
};
const reachScore = (c: any): number => (c && c.performance && isNum(c.performance.reach) ? c.performance.reach : 0);
const httpsImage = (c: any): string | null => {
  const list = (c && c.creative && Array.isArray(c.creative.imageUrls) && c.creative.imageUrls) || [];
  const u = list.find((x: unknown) => typeof x === 'string' && /^https?:\/\//i.test(x)) || (typeof c?.imageUrl === 'string' && /^https?:\/\//i.test(c.imageUrl) ? c.imageUrl : null);
  return u || null;
};
const nameOf = (c: any): string => {
  const raw = (c && (c.name || (c.creative && (c.creative.captions || c.creative.textContent)))) || '';
  const t = String(raw).replace(/\s+/g, ' ').trim();
  return t ? (t.length > 70 ? `${t.slice(0, 67).trim()}...` : t) : 'Your post';
};

/** The best published post of this India month by stored engagement, then reach; the latest one when no post has numbers. */
export function bestPostOfMonth(campaigns: unknown, now: Date = new Date()): BestPost {
  const month = istMonthKey(now);
  const list = (Array.isArray(campaigns) ? campaigns : []).filter((c: any) => {
    const t = publishedAt(c);
    return isPosted(c) && t !== null && t <= now.getTime() + DAY_MS && istMonthKey(t) === month;
  });
  if (!list.length) return { kind: 'none', title: 'Best post of the month', note: 'Nothing has been published this month yet. Your best post shows here once one is out.' };
  const scored = list.filter((c: any) => engagementScore(c) > 0 || reachScore(c) > 0);
  const pick = (c: any, kind: 'best' | 'latest', note: string): BestPost => {
    const stats: string[] = [];
    const p = c.performance || {};
    if (isNum(p.reach) && p.reach > 0) stats.push(`${formatCount(p.reach)} reached`);
    if (isNum(p.likes) && p.likes > 0) stats.push(plural(p.likes, 'like', 'likes'));
    if (isNum(p.comments) && p.comments > 0) stats.push(plural(p.comments, 'comment', 'comments'));
    if (isNum(p.shares) && p.shares > 0) stats.push(plural(p.shares, 'share', 'shares'));
    if (!stats.length && engagementScore(c) > 0) stats.push(plural(engagementScore(c), 'reaction', 'reactions'));
    const t = publishedAt(c);
    return {
      kind, title: kind === 'best' ? 'Best post of the month' : 'Latest post this month', id: String(c._id || c.id || ''), name: nameOf(c),
      image: httpsImage(c), platform: Array.isArray(c.platforms) && c.platforms[0] ? String(c.platforms[0]) : null,
      when: t !== null ? new Date(t).toISOString() : null, stats, note,
    };
  };
  if (scored.length) {
    scored.sort((a: any, b: any) => engagementScore(b) - engagementScore(a) || reachScore(b) - reachScore(a) || (publishedAt(b) as number) - (publishedAt(a) as number));
    const n = list.length;
    return pick(scored[0], 'best', `Chosen from ${plural(n, 'post', 'posts')} published this month, by likes, comments and shares.`);
  }
  list.sort((a: any, b: any) => (publishedAt(b) as number) - (publishedAt(a) as number));
  return pick(list[0], 'latest', 'Numbers for single posts have not arrived yet, so the best one cannot be picked. This is your latest post.');
}

/** The hero sentence: what the stored numbers say, or what the customer can do next. */
export function heroLine(tiles: KpiTile[]): string {
  const reach = tiles.find((t) => t.key === 'reach');
  const posts = tiles.find((t) => t.key === 'posts');
  if (reach && reach.value) return `Your posts reached ${reach.value} people${reach.chip && reach.chip.dir !== 'flat' ? `, ${reach.chip.text.charAt(0).toLowerCase()}${reach.chip.text.slice(1)}` : ''}.`;
  if (reach && reach.reason && /connect an account/i.test(reach.reason)) return 'Connect an account and your reach, engagement and followers show here.';
  if (reach && reach.reason && /paid plan/i.test(reach.reason)) return 'Your reach, engagement and followers show here once your accounts are connected. Connecting accounts comes with a paid plan.';
  if (posts && posts.value && posts.value !== '0') return `${posts.value === '1' ? '1 post' : `${posts.value} posts`} published this week. Reach and followers show as soon as your accounts report them.`;
  return 'Your numbers show here as soon as your accounts report them.';
}

/** "18 Oct" for the as-of line, India time. */
export function dayMonth(d: unknown): string | null {
  const t = new Date(d as any).getTime();
  if (!Number.isFinite(t)) return null;
  const x = new Date(t + OFFSET_MS);
  return `${x.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()]}`;
}

/** Line and filled area for the reach chart: x follows the real dates, y the value (0 at the bottom). */
export function chartPaths(points: Array<{ date: string; value: number }>, w = 300, h = 110): { line: string; area: string } {
  const pts = (Array.isArray(points) ? points : []).map((p) => ({ t: new Date(p.date).getTime(), v: p.value })).filter((p) => Number.isFinite(p.t) && isNum(p.v));
  if (pts.length < 2) return { line: '', area: '' };
  const t0 = pts[0].t;
  const span = Math.max(1, pts[pts.length - 1].t - t0);
  const max = Math.max(...pts.map((p) => p.v), 1);
  const xy = pts.map((p) => [((p.t - t0) / span) * w, h - 4 - (p.v / max) * (h - 12)]);
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}
