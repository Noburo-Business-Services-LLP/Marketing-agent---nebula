/**
 * Numbers behind the pictures on My plan: the marketing mix donut, the channel marks, the content pillar chips, the
 * 90-day timeline and the plan's title card. Pure and defensive like `strategyLevels.ts`: every value is read from the
 * stored plan (never guessed), an old or empty plan gives empty lists or nulls, and nothing calls a server.
 */

export type Platform = 'instagram' | 'facebook' | 'whatsapp' | 'google' | 'youtube' | 'linkedin' | 'x' | 'website' | 'email' | 'offline' | 'other';
export type PostShape = 'image' | 'carousel' | 'reel' | 'story' | 'other';

export interface MixSegments {
  /** Average organic share across the channels that have a split, whole percent; null when the plan has no split. */
  organic: number | null;
  paid: number | null;
  /** How many channels the organic and paid average is taken from. */
  splitChannels: number;
  online: number;
  offline: number;
}

export interface Arc { key: string; value: number; length: number; offset: number }

export interface ChannelCard {
  name: string;
  platform: Platform;
  offline: boolean;
  /** Organic share for this channel, or null when the plan does not split it. */
  organic: number | null;
  makes: string[];
  youDo: number;
}

export interface PillarChip { name: string; tone: number; posts: number; shapes: PostShape[] }

export interface TitleCard { text: string; tag?: string; kind: 'line' | 'territory' | 'promise' }

const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const words = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const claimText = (c: unknown): string => (isObj(c) ? words(c.text) : '');

/** The stored plan (`result.plan`), whether the page view, the stored run or nothing usable is passed in. */
function inner(input: any): Record<string, any> {
  const run = isObj(input) && isObj(input.plan) && 'result' in input.plan ? input.plan : input;
  return isObj(run) && isObj(run.result) && isObj(run.result.plan) ? run.result.plan : {};
}

function splits(p: Record<string, any>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of list(p.effort)) {
    const name = isObj(e) ? words(e.channel) : '';
    if (!name || out.has(name)) continue;
    const organic = Math.round(Number(e.organicPct));
    if (Number.isFinite(organic) && organic >= 0 && organic <= 100) out.set(name, organic);
  }
  return out;
}

function onlineNames(p: Record<string, any>): string[] {
  const names: string[] = [];
  for (const c of [...list(p.channels), ...list(p.effort)]) {
    const n = isObj(c) ? words(c.channel) : '';
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}

const offlineRows = (p: Record<string, any>): any[] => list(p.offline).filter((o) => isObj(o) && words(o.channel));

/** The two rings of the donut, from the stored effort split and the channel lists. The same average as the funnel. */
export function mixSegments(input: unknown): MixSegments {
  const p = inner(input);
  const s = splits(p);
  const vals = Array.from(s.values());
  const organic = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  return { organic, paid: organic === null ? null : 100 - organic, splitChannels: vals.length, online: onlineNames(p).length, offline: offlineRows(p).length };
}

/**
 * Stroke lengths and offsets for a ring of circumference `total`, in the given order. Zero or bad values draw nothing;
 * lengths are rounded to a tenth and the last drawn arc absorbs the rounding, so the ring always closes exactly.
 */
export function donutArcs(parts: Array<{ key: string; value: number }>, total: number): Arc[] {
  const good = parts.filter((x) => Number.isFinite(x.value) && x.value > 0);
  const sum = good.reduce((a, x) => a + x.value, 0);
  if (!sum || !(total > 0)) return [];
  const out: Arc[] = [];
  let used = 0;
  good.forEach((x, i) => {
    const length = i === good.length - 1 ? Math.round((total - used) * 10) / 10 : Math.round(((x.value / sum) * total) * 10) / 10;
    out.push({ key: x.key, value: x.value, length, offset: Math.round(-used * 10) / 10 || 0 });
    used += length;
  });
  return out;
}

const PLATFORM_WORDS: Array<[Platform, RegExp]> = [
  ['instagram', /insta/i],
  ['whatsapp', /whats\s*app/i],
  ['facebook', /facebook|\bfb\b|\bmeta\b/i],
  ['google', /google|maps|business profile|\bgbp\b/i],
  ['youtube', /you\s*tube|shorts/i],
  ['linkedin', /linked\s*in/i],
  ['x', /twitter|^x$|\bx \(/i],
  ['email', /e-?mail|newsletter/i],
  ['website', /website|web site|blog|\bseo\b|site/i],
];

/** Which small mark a channel gets. Offline rows always get the shop mark; an unknown online channel a megaphone. */
export function platformOf(name: unknown, offline = false): Platform {
  if (offline) return 'offline';
  const n = words(name);
  for (const [k, re] of PLATFORM_WORDS) if (re.test(n)) return k;
  return 'other';
}

/** One card per channel, online first in the plan's order, then the offline rows. */
export function channelCards(input: unknown): ChannelCard[] {
  const p = inner(input);
  const s = splits(p);
  const effort = new Map<string, any>();
  for (const e of list(p.effort)) { const n = isObj(e) ? words(e.channel) : ''; if (n && !effort.has(n)) effort.set(n, e); }
  const online: ChannelCard[] = onlineNames(p).map((name) => {
    const e = effort.get(name);
    return {
      name, platform: platformOf(name), offline: false,
      organic: s.has(name) ? (s.get(name) as number) : null,
      makes: e ? list(e.nebulaaDoes).map(words).filter(Boolean) : [],
      youDo: e ? list(e.youDo).filter((c) => claimText(c)).length : 0,
    };
  });
  const offline: ChannelCard[] = offlineRows(p).map((o) => ({
    name: words(o.channel), platform: 'offline' as Platform, offline: true, organic: null, makes: [], youDo: list(o.youDo).filter((c) => claimText(c)).length,
  }));
  return [...online, ...offline];
}

/** "reel" -> reel; "image post", "post" -> image; "carousel" -> carousel; "story" -> story. */
export function shapeOf(format: unknown): PostShape {
  const f = words(format).toLowerCase();
  if (!f) return 'other';
  if (/reel|video|short/.test(f)) return 'reel';
  if (/carousel|slides?/.test(f)) return 'carousel';
  if (/story|stories/.test(f)) return 'story';
  if (/post|image|photo|picture/.test(f)) return 'image';
  return 'other';
}

/** The content pillars as colour chips: how many of this month's posts sit under each, and their most used shapes. */
export function pillarChips(input: unknown, tones = 5): PillarChip[] {
  const p = inner(input);
  const cal = list(p.calendar).filter(isObj);
  const seen = new Set<string>();
  const out: PillarChip[] = [];
  for (const x of list(p.pillars)) {
    const name = isObj(x) ? words(x.name) : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const mine = cal.filter((c) => words(c.pillar).toLowerCase() === name.toLowerCase());
    const counts = new Map<PostShape, number>();
    mine.forEach((c) => { const s = shapeOf(c.format); if (s !== 'other') counts.set(s, (counts.get(s) || 0) + 1); });
    const shapes = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 3);
    out.push({ name, tone: out.length % Math.max(1, tones), posts: mine.length, shapes });
  }
  return out;
}

/** This month's posts by shape, most first, for the small thumbnails. */
export function shapeCounts(input: unknown): Array<{ shape: PostShape; count: number }> {
  const counts = new Map<PostShape, number>();
  list(inner(input).calendar).forEach((c) => { if (!isObj(c)) return; const s = shapeOf(c.format); if (s !== 'other') counts.set(s, (counts.get(s) || 0) + 1); });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([shape, count]) => ({ shape, count }));
}

/** Day of the plan, counted like `currentPhase` (day 1 on the day it was made); null without a usable date. */
export function planDay(madeAt: unknown, now: Date = new Date()): number | null {
  if (!madeAt) return null;
  const d = new Date(madeAt as any);
  if (Number.isNaN(d.valueOf())) return null;
  return Math.max(1, Math.floor((now.getTime() - d.getTime()) / 86400000));
}

/** How far along the 90 days the marker sits, 0 to 100. */
export function timelinePct(day: number | null): number {
  if (day === null || !Number.isFinite(day)) return 0;
  return Math.max(0, Math.min(100, Math.round((day / 90) * 1000) / 10));
}

/** The one line for the plan's title card: the message, else where to stand out, else the aim. Null when none. */
export function titleCard(input: unknown): TitleCard | null {
  const p = inner(input);
  const pos = isObj(p.positioning) ? p.positioning : {};
  if (claimText(pos.line)) return { text: claimText(pos.line), ...(pos.line.tag ? { tag: String(pos.line.tag) } : {}), kind: 'line' };
  const t = isObj(pos.territory) ? words(pos.territory.name) : '';
  if (t) return { text: t, kind: 'territory' };
  if (claimText(p.promise)) return { text: claimText(p.promise), ...(p.promise.tag ? { tag: String(p.promise.tag) } : {}), kind: 'promise' };
  return null;
}

/** The few counts under the title card, each only when the plan has it: channels, themes, posts this month, plan day. */
export function heroStats(input: unknown, now: Date = new Date()): Array<{ value: string; label: string }> {
  const p = inner(input);
  const run: any = isObj(input) && isObj((input as any).plan) && 'result' in (input as any).plan ? (input as any).plan : input;
  const out: Array<{ value: string; label: string }> = [];
  const chans = onlineNames(p).length + offlineRows(p).length;
  if (chans) out.push({ value: String(chans), label: chans === 1 ? 'channel' : 'channels' });
  const themes = pillarChips(input).length;
  if (themes) out.push({ value: String(themes), label: themes === 1 ? 'content theme' : 'content themes' });
  const posts = list(p.calendar).filter(isObj).length;
  if (posts) out.push({ value: String(posts), label: posts === 1 ? 'post planned this month' : 'posts planned this month' });
  const hasRoad = list(p.roadmap).some(isObj);
  const day = hasRoad ? planDay(isObj(run) ? run.completedAt : null, now) : null;
  if (day !== null) out.push({ value: day > 90 ? '90+' : String(day), label: 'of 90 days' });
  return out;
}

/** Initials for a name in any script: the first character of the first two words. */
export function initialsOf(name: unknown): string {
  const ws = words(name).split(' ').filter(Boolean);
  if (!ws.length) return '';
  const first = (w: string) => Array.from(w)[0] || '';
  return (first(ws[0]) + (ws[1] ? first(ws[1]) : '')).toUpperCase();
}
