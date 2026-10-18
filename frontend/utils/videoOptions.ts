/** Rules for the Videos flow options (style, language, length, shape, parts), kept apart from the page so they can be tested. */
import { videosLeft } from './studioVideo.ts';

export type Shape = '9:16' | '16:9';
export interface StyleOption { key: string; label: string; hint?: string; image?: string }
export interface LengthOption { clips: number; seconds: number; quarks: number }
export interface Part { beats: string[]; spokenLine: string }

export const DEFAULT_STYLE = 'daily-life-vlog';
/** Indian languages whose speech is new: the person is asked to read the line before making the video. */
export const NEW_SPEECH_LANGUAGES = ['hindi', 'telugu', 'kannada', 'malayalam'];
export const SHOW_FIRST_STYLES = 8;

export function isNewSpeech(language: string): boolean {
  return NEW_SPEECH_LANGUAGES.includes(String(language || '').toLowerCase());
}
export const NEW_SPEECH_NOTE = 'Speech in this language is new. Check the line in the next step before you make the video.';

/** The shape that suits the chosen platforms: the one most of them prefer; a tie goes to vertical. Null with no platforms. */
export function shapeForPlatforms(platforms: string[], shapes: Record<string, string>): Shape | null {
  let v = 0; let w = 0;
  for (const p of platforms || []) {
    const s = shapes?.[p];
    if (s === '9:16') v++; else if (s === '16:9') w++;
  }
  if (!v && !w) return null;
  return w > v ? '16:9' : '9:16';
}

/** "Suggested for Instagram and Facebook" for a shape. Empty when no chosen platform suits it. */
export function suggestionHint(shape: Shape, platformIds: string[], shapes: Record<string, string>, labelOf: (id: string) => string): string {
  const names = platformIds.filter((p) => shapes?.[p] === shape).map(labelOf);
  if (!names.length) return '';
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `Suggested for ${list}`;
}

/** Style tiles: the default first, then the order the server gave. The first `n` are shown when collapsed, always including the chosen one. */
export function orderStyles<T extends { key: string }>(styles: T[], preferred = DEFAULT_STYLE): T[] {
  const i = styles.findIndex((s) => s.key === preferred);
  if (i <= 0) return styles.slice();
  return [styles[i], ...styles.slice(0, i), ...styles.slice(i + 1)];
}
export function visibleStyles<T extends { key: string }>(styles: T[], selected: string, expanded: boolean, n = SHOW_FIRST_STYLES): T[] {
  if (expanded || styles.length <= n) return styles;
  const head = styles.slice(0, n);
  if (head.some((s) => s.key === selected)) return head;
  const chosen = styles.find((s) => s.key === selected);
  return chosen ? [...head.slice(0, n - 1), chosen] : head;
}

/** The photo, or the .svg of the same name when the photo is missing. */
export function styleImageFallback(src: string): string | null {
  return /\.svg$/i.test(src) ? null : src.replace(/\.[a-z0-9]+$/i, '.svg');
}

/** How many parts a balance pays for (each part is one clip). */
export function partsLeft(balance: number, perClip: number): number {
  return videosLeft(balance, perClip);
}

/** Longest length (in clips) the balance pays for, at least 0. */
export function affordableClips(balance: number, perClip: number, max: number): number {
  return Math.min(max, partsLeft(balance, perClip));
}

export function lengthLine(seconds: number, clips: number): string {
  return clips > 1 ? `${seconds} seconds, made in ${clips} parts that follow each other` : `${seconds} seconds, made in one part`;
}

/** Calm price line in posts-and-videos words: no Quarks. */
export function priceLine(opts: { seconds: number; clips: number; total: number; balance: number | null }): string {
  const { seconds, clips, total, balance } = opts;
  if (!total) return '';
  const base = `A ${seconds} second video`;
  if (balance == null) return base;
  const n = videosLeft(balance, total);
  if (n < 1) return base;
  return `${base} · you have enough for ${n} video${n === 1 ? '' : 's'} like this`;
}

/** Shown when the balance covers less than the chosen length; empty when it covers it. */
export function shortBalanceMessage(opts: { balance: number | null; perClip: number; clips: number; clipSeconds: number }): string {
  const { balance, perClip, clips, clipSeconds } = opts;
  if (balance == null || !perClip || clips < 1 || balance >= perClip * clips) return '';
  const n = partsLeft(balance, perClip);
  if (n < 1) return 'You do not have enough left for a video. Please top up or choose a plan.';
  return `You have enough for ${n} part${n === 1 ? '' : 's'} (${n * clipSeconds} seconds). Choose a shorter length or top up.`;
}

/** One part per clip: edited parts are kept, missing ones padded from the idea of the whole, extra ones dropped. */
export function padParts(parts: Part[] | undefined, clips: number, fallback: Part = { beats: [], spokenLine: '' }): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < clips; i++) {
    const p = parts?.[i];
    out.push(p ? { beats: Array.isArray(p.beats) ? p.beats.slice() : [], spokenLine: String(p.spokenLine || '') } : { beats: fallback.beats.slice(), spokenLine: i === 0 ? fallback.spokenLine : '' });
  }
  return out;
}
export function editPartLine(parts: Part[], index: number, spokenLine: string): Part[] {
  return parts.map((p, i) => (i === index ? { ...p, spokenLine } : p));
}
export function editPartBeats(parts: Part[], index: number, text: string): Part[] {
  const beats = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return parts.map((p, i) => (i === index ? { ...p, beats } : p));
}
export const partsToText = (beats: string[]) => (beats || []).join('\n');
export function partLabel(i: number, total: number): string { return `Part ${i + 1} of ${total}`; }

/** While a longer video is made: "Part 2 of 3". Empty for one clip. */
export function progressLabel(clips: number, clipsDone: number): string {
  if (!(clips > 1)) return '';
  return partLabel(Math.min(clips - 1, Math.max(0, clipsDone || 0)), clips);
}

/** Changes are only for 10 second videos. */
export function canChange(seconds: number): boolean { return !(seconds > 10); }
export const NO_CHANGE_NOTE = 'Changes are available for 10-second videos. For a longer video, make a new version.';

/** Remembered choices: read and write are safe when storage is blocked. */
const KEY = 'nb_video_choices';
export interface Remembered { style?: string; language?: string; voice?: string; transition?: string; subtitles?: boolean; logo?: boolean }
export function readChoices(): Remembered {
  try { return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
export function saveChoices(c: Remembered): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage may be blocked */ }
}

/** Server sentences that mention Quarks, put in posts-and-videos words for the customer. */
export function plainMessage(m: string): string {
  const t = String(m || '');
  if (!/quark/i.test(t)) return t;
  if (/needs? \d+ quarks/i.test(t)) return 'You do not have enough left for this. Please top up or choose a plan.';
  if (/returned/i.test(t)) return 'The video could not be made. You were not charged.';
  return t.replace(/\s*(?:your\s+)?quarks\b/gi, ' allowance').replace(/\s+/g, ' ').trim();
}

/** How the parts are joined (only matters with more than one part). */
export type Transition = 'fade' | 'zoom' | 'cut';
export const END_LINE_MAX = 60;
export const FALLBACK_TRANSITIONS: Array<{ key: Transition; label: string }> = [
  { key: 'fade', label: 'Smooth fade' }, { key: 'zoom', label: 'Quick zoom' }, { key: 'cut', label: 'Cut' }
];
export const NO_LOGO_HINT = 'Add your logo in Brand assets first';
export const SUBTITLES_HINT = 'Words appear on screen in the spoken language';

export function transitionOf(v: unknown): Transition {
  return v === 'zoom' || v === 'cut' ? v : 'fade';
}
/** The closing line as it will be sent: control characters out, spaces tidied, at most 60 characters. */
export function cleanEndLine(v: string): string {
  const t = String(v || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, END_LINE_MAX).join('').trim();
}
export const showTransitions = (clips: number): boolean => clips > 1;
export const showSubtitles = (language: string): boolean => language !== 'none';
/** What the screen sends to /create for the finishing choices. Choices that do not apply are switched off. */
export function finishPayload(o: { clips: number; language: string; transition: string; subtitles: boolean; logo: boolean; hasLogo: boolean; endLine: string }): { transition: Transition; subtitles: boolean; logo: boolean; endLine: string } {
  const logo = !!o.logo && !!o.hasLogo;
  return {
    transition: o.clips > 1 ? transitionOf(o.transition) : 'fade',
    subtitles: !!o.subtitles && showSubtitles(o.language),
    logo,
    endLine: logo ? cleanEndLine(o.endLine) : ''
  };
}
