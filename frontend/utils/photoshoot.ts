// The Photoshoot page: the shapes the server sends and the small rules the page follows. Pure functions only, tested in
// tests/photoshoot.test.mjs. Prices are never typed here: they come from the server (config/apiCosts.js) and are written
// with the shared Quark wording (utils/plans.ts).
import { worthText } from './plans.ts';

export interface PhotoshootChoice { key: string; label: string }
export interface PhotoshootPack {
  key: string; title: string; subtitle: string; counts: number[]; defaultCount: number;
  aspectRatios: PhotoshootChoice[]; backgrounds: PhotoshootChoice[]; place: boolean; scenes: PhotoshootChoice[];
  quarks: number; price: string; worth: string; minutes: number;
}
export interface PhotoshootCatalogue {
  success?: boolean; perPhoto: { quarks: number; price: string; worth: string }; packs: PhotoshootPack[];
  maxProducts: number; maxPhotos: number; costs: Record<string, number>;
}
export interface PhotoshootProduct { id: string; name: string; hasPhoto: boolean; thumbnail: string }
export interface PhotoshootPlace { id: string; name: string; thumbnail: string }
export interface PhotoshootOptions extends PhotoshootCatalogue {
  staff?: boolean; enabled?: boolean; entitled?: boolean; locked?: string | null; postsOnly?: boolean; pass?: boolean;
  products?: PhotoshootProduct[]; places?: PhotoshootPlace[]; perDay?: number; left?: number | null;
}
export type PhotoStatus = 'waiting' | 'making' | 'done' | 'failed';
export interface PhotoshootPhoto { index: number; scene: string; sceneLabel: string; product: string; status: PhotoStatus; url: string; inLibrary: boolean }
export interface PhotoshootVersion { id: string; index: number; status: string; url: string; inLibrary: boolean }
export interface PhotoshootJob {
  id: string; kind: 'pack' | 'redo'; pack: string; packTitle: string; parent: string | null; parentIndex: number | null;
  status: 'running' | 'done' | 'partial' | 'failed' | 'refused'; aspectRatio: string; background: string;
  products: Array<{ id: string; name: string }>; place: { name: string } | null;
  photoCount: number; done: number; failed: number; photos: PhotoshootPhoto[]; quarks: number; refundedQuarks: number;
  minutes: number; notice: string; versions: PhotoshootVersion[]; createdAt: string; finishedAt: string | null;
}
export interface PhotoshootSelection { pack: PhotoshootPack | null; productIds: string[]; count: number; aspectRatio: string; background: string; placeId: string }

/** The cover palette of each pack's tile (one colour family each, from the cover tile set). */
export const PACK_PALETTE: Record<string, 'plum' | 'blue' | 'gold' | 'teal' | 'coral' | 'ink'> = {
  product: 'plum', marketplace: 'blue', festival: 'gold', lifestyle: 'teal', flatlay: 'coral', white: 'ink',
};

const noun = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** "4 photos" or "8 photos per product". */
export function photosLine(count: number, products = 1): string {
  return products > 1 ? `${noun(count * products, 'photo', 'photos')} (${count} for each product)` : noun(count, 'photo', 'photos');
}

/** "About 3 minutes". */
export function minutesText(minutes: number): string {
  const m = Math.max(1, Math.round(Number(minutes) || 1));
  return `About ${noun(m, 'minute', 'minutes')}`;
}

/** Same rule as the server: photos made two at a time, about a minute each. */
export function minutesFor(photos: number): number {
  return Math.max(1, Math.ceil(Math.ceil(Math.max(1, photos) / 2) * 60 / 60));
}

/** "60 Quarks": the price as the customer reads it on the Photoshoot page (owner, 2026-10-19: no "posts' worth" here, it was
 * not understood). Agency accounts never see Quarks (the agency rule), so for them it stays the posts' worth only. */
export function priceLine(quarks: number, costs: Record<string, number> | null | undefined, postsOnly = false): string {
  if (!(quarks > 0)) return '';
  if (postsOnly) { const w = worthText(quarks, costs); return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; }
  return noun(quarks, 'Quark', 'Quarks');
}

/** "4 photos" for a pack with one fixed count, "Up to 8 photos" when the customer may choose fewer. Real counts only. */
export function packPhotosText(p: Pick<PhotoshootPack, 'counts' | 'defaultCount'>): string {
  const counts = (Array.isArray(p.counts) ? p.counts : []).filter((n) => Number.isFinite(n) && n > 0);
  const most = counts.length ? Math.max(...counts) : p.defaultCount;
  const varies = counts.length > 1 && Math.min(...counts) !== most;
  return varies ? `Up to ${noun(most, 'photo', 'photos')}` : noun(most, 'photo', 'photos');
}

/** The pack tile's price chip and its one line ("Up to 6 photos, about 3 minutes"). */
export function packTileLines(p: PhotoshootPack, costs: Record<string, number> | null | undefined, postsOnly = false): { price: string; subtitle: string } {
  return { price: priceLine(p.quarks, costs, postsOnly), subtitle: `${packPhotosText(p)}, ${minutesText(p.minutes).toLowerCase()}` };
}

/** The choices to start from when a pack is picked. */
export function selectionFor(pack: PhotoshootPack, keep: Partial<PhotoshootSelection> = {}): PhotoshootSelection {
  return {
    pack, productIds: keep.productIds || [], count: pack.defaultCount,
    aspectRatio: pack.aspectRatios[0] ? pack.aspectRatios[0].key : '1:1',
    background: pack.backgrounds[0] ? pack.backgrounds[0].key : '', placeId: '',
  };
}

export function photoTotal(s: PhotoshootSelection): number {
  return s.pack ? s.count * s.productIds.length : 0;
}

/** Adds or removes a product, keeping at most `max`. */
export function toggleProduct(ids: string[], id: string, max: number): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= max ? ids : [...ids, id];
}

/** Whether Create can be pressed, and the plain reason when it cannot. */
export function createState(o: PhotoshootOptions | null, s: PhotoshootSelection, busy = false): { ok: boolean; reason: string } {
  if (!o) return { ok: false, reason: '' };
  if (o.staff && !o.pass) return { ok: false, reason: 'Staff accounts cannot make photoshoots here. Open a client to make one for them.' };
  if (o.entitled === false) return { ok: false, reason: o.pass ? 'Photoshoots are not available for this account.' : 'Photoshoots are part of the paid plans.' };
  if (o.enabled === false) return { ok: false, reason: 'Photoshoots open soon.' };
  if (busy) return { ok: false, reason: 'A photoshoot is being made. You can start another one when it has finished.' };
  if (!s.pack) return { ok: false, reason: 'Choose a pack to start.' };
  if (!s.productIds.length) return { ok: false, reason: 'Choose at least one product with a photo.' };
  const total = photoTotal(s);
  if (total > (o.maxPhotos || 24)) return { ok: false, reason: `A photoshoot can make at most ${o.maxPhotos || 24} photos. Choose fewer products or photos.` };
  if (typeof o.left === 'number' && total > o.left) return { ok: false, reason: o.left > 0 ? `You can make ${noun(o.left, 'more photo', 'more photos')} today.` : 'You have made all of today\'s photos. You can make more tomorrow.' };
  return { ok: true, reason: '' };
}

/** "3 of 6 photos ready". */
export function progressText(j: PhotoshootJob): string {
  if (j.status === 'running') return `${j.done} of ${noun(j.photoCount, 'photo', 'photos')} ready`;
  if (j.status === 'done') return `${noun(j.done, 'photo', 'photos')} ready`;
  if (j.status === 'partial') return `${j.done} of ${noun(j.photoCount, 'photo', 'photos')} ready`;
  return 'No photos could be made';
}

export const isFinished = (j: PhotoshootJob | null | undefined): boolean => Boolean(j && ['done', 'partial', 'failed', 'refused'].includes(j.status));

/** The newest finished version of one photo ("Make this one again"), or null. A running version is reported too. */
export function versionOf(j: PhotoshootJob, index: number): { running: boolean; failed: boolean; latest: PhotoshootVersion | null } {
  const mine = (j.versions || []).filter((v) => v.index === index);
  const latest = [...mine].reverse().find((v) => v.status === 'done' && v.url) || null;
  const last = mine[mine.length - 1];
  return { running: Boolean(last && last.status === 'running'), failed: Boolean(last && last.status === 'failed'), latest };
}

/** "Photo 3 of 6, Studio light, Brownie box". */
export function photoAlt(p: PhotoshootPhoto, total: number): string {
  return [`Photo ${p.index + 1} of ${total}`, p.sceneLabel, p.product].filter(Boolean).join(', ');
}

/** A key for one press of a button (the server makes it one job and one charge). */
export function newKey(rand: () => number = Math.random, now: () => number = Date.now): string {
  return `ps-${now().toString(36)}-${Math.floor(rand() * 1e12).toString(36)}`.slice(0, 64);
}

/** "Make again (10 Quarks)", or "Make again (about 1 post's worth)" for agency accounts: the price is on the button. */
export function redoLabel(perPhoto: number, costs: Record<string, number> | null | undefined, postsOnly = false): string {
  if (!(perPhoto > 0)) return 'Make again';
  if (postsOnly) { const w = worthText(perPhoto, costs); return w ? `Make again (${w})` : 'Make again'; }
  return `Make again (${perPhoto.toLocaleString('en-IN')} ${perPhoto === 1 ? 'Quark' : 'Quarks'})`;
}

/** The photo files a person may pick for "Add a product". */
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export function uploadProblem(file: { type: string; size: number } | null | undefined): string {
  if (!file) return 'Choose a photo first.';
  if (!UPLOAD_TYPES.includes(String(file.type).toLowerCase())) return 'Please choose a PNG, JPEG or WEBP photo.';
  if (file.size > UPLOAD_MAX_BYTES) return 'Please choose a photo of up to 6 MB.';
  return '';
}

/** The banner under the results: the server's plain notice, or nothing. */
export function resultNotice(j: PhotoshootJob | null): string {
  return j && isFinished(j) ? String(j.notice || '') : '';
}

/** The calm note shown instead of Create for an account that cannot use photoshoots (never an upsell inside a client). */
export function lockedNote(o: PhotoshootOptions | null): { text: string; to: string; action: string } | null {
  if (!o || o.entitled !== false) return null;
  if (o.pass) return { text: 'Photoshoots are not available for this account.', to: '', action: '' };
  return { text: 'Photoshoots are part of the paid plans. You can look at the packs and prices here.', to: '/trial-expired', action: 'See plans' };
}
