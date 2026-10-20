/**
 * The actions of things that are not posts, in the same order and words as the post actions (utils/postActions.ts):
 *  - studio videos (Videos page and the Library): Download, Make again (with its price), Delete. Nebulaa has no
 *    route that posts or schedules a studio video, so there is no Schedule or Post now for them (owner decision,
 *    2026-10-19: do not build it now). They are downloaded and posted by the customer.
 *  - Hero videos, step-by-step video drafts (Library): Download, Open or Edit, Delete. Their Archive and Bin do not exist on
 *    the server (a delete is for good), and Hero has no make-again route, so those two are not offered. Posting a Hero
 *    video is its own form (HeroShare, POST /hero-video/jobs/:id/publish) in the open panel; reels from the plan are
 *    post drafts and use the post actions themselves (components/PostActions.tsx).
 *  - Photoshoot photos: Use in Create, Download, Make again (with its price), Save to Library or Remove from Library,
 *    and Delete photo. "Remove from Library" only takes the photo out of the Library (it stays in its photoshoot);
 *    "Delete photo" removes the photo for good everywhere (owner decision D14, 2026-10-20).
 * Pure: no React, no network.
 */
import type { ConfirmText } from './postActions.ts';

export type MediaActionKey = 'useInCreate' | 'download' | 'open' | 'edit' | 'makeAgain' | 'save' | 'remove' | 'delete' | 'deletePhoto';
export const MEDIA_ORDER: readonly MediaActionKey[] = Object.freeze(['useInCreate', 'download', 'open', 'edit', 'makeAgain', 'save', 'remove', 'delete', 'deletePhoto'] as MediaActionKey[]);

export const MEDIA_LABELS: Record<MediaActionKey, string> = {
  useInCreate: 'Use in Create', download: 'Download', open: 'Open', edit: 'Edit', makeAgain: 'Make again', save: 'Save to Library',
  remove: 'Remove from Library', delete: 'Delete', deletePhoto: 'Delete photo',
};

const quarkWord = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'Quark' : 'Quarks'}`;

/** A studio video's actions: a finished one can be downloaded, made again or deleted; one that did not finish can be made again or deleted. */
export function studioVideoActionKeys(v: { status?: unknown; videoUrl?: unknown } | null | undefined): MediaActionKey[] {
  if (!v) return [];
  const s = String(v.status || '').toLowerCase();
  if (s === 'completed' && v.videoUrl) return ['download', 'makeAgain', 'delete'];
  if (s === 'failed' || s === 'completed') return ['makeAgain', 'delete'];
  return [];
}

/** What making a studio video again costs: the price of its length (the same table the Videos page shows). */
export function studioAgainQuarks(v: { clips?: unknown } | null | undefined, lengths: Array<{ clips: number; quarks: number }>, perClip: number): number {
  const clips = Math.max(1, Math.round(Number(v && v.clips) || 1));
  const fromTable = (Array.isArray(lengths) ? lengths : []).find((l) => l && l.clips === clips);
  const q = fromTable && fromTable.quarks > 0 ? fromTable.quarks : (Number(perClip) > 0 ? perClip * clips : 0);
  return Math.round(q);
}

export const STUDIO_HINTS = {
  download: 'Save the video to your device, then post it where you like.',
  makeAgain: (quarks: number) => (quarks ? `Opens this video's plan again. You pay ${quarkWord(quarks)} only when you press Make my video.` : "Opens this video's plan again. You pay only when you press Make my video."),
  delete: 'Remove this video for good.',
};

export function studioDeleteConfirm(title: string): ConfirmText {
  return { title: `Delete "${title || 'this video'}"?`, message: 'This removes the video for good. Quarks already spent are not returned.', confirmLabel: 'Delete', danger: true };
}

/**
 * A Photoshoot photo's actions. canRedo: the photoshoot is finished and the account may make photos. canDelete: the
 * photoshoot is finished (the server refuses a delete while it is running).
 */
export function photoActionKeys(p: { hasPhoto: boolean; inLibrary: boolean; canRedo: boolean; canDelete?: boolean }): MediaActionKey[] {
  const out: MediaActionKey[] = [];
  if (p.hasPhoto) out.push('useInCreate', 'download');
  if (p.canRedo) out.push('makeAgain');
  if (p.hasPhoto) out.push(p.inLibrary ? 'remove' : 'save');
  if (p.hasPhoto && p.canDelete) out.push('deletePhoto');
  return out;
}

/** The two questions about a photo that must never be mixed up: take it out of the Library, or delete it for good. */
export const PHOTO_HINTS = {
  save: 'Keep this photo in your Library.',
  remove: 'Take this photo out of your Library. It stays in its photoshoot.',
  deletePhoto: 'Delete this photo for good, from your Library and from its photoshoot.',
};

export function photoDeleteConfirm(): ConfirmText {
  return {
    title: 'Delete this photo?',
    message: 'This deletes the photo for good, from your Library and from its photoshoot. Quarks already spent are not returned. To only take it out of your Library, use Remove from Library instead.',
    confirmLabel: 'Delete photo', danger: true,
  };
}

/**
 * The actions of a video in the Library that is not a post draft (Hero, step-by-step draft, Videos page). Same order as
 * a post: Download, Open or Edit, Make again, Delete. Nothing while it is still being made.
 */
export function libraryVideoActionKeys(i: { source?: unknown; status?: unknown; mediaUrl?: unknown } | null | undefined): MediaActionKey[] {
  if (!i) return [];
  const status = String(i.status || '');
  if (status === 'creating') return [];
  const dl: MediaActionKey[] = i.mediaUrl ? ['download'] : [];
  switch (i.source) {
    case 'hero': return [...dl, 'delete'];
    case 'video-draft': return [...dl, status === 'draft' || status === 'failed' ? 'edit' : 'open', 'delete'];
    case 'studio': return status === 'failed' ? ['makeAgain', 'delete'] : [...dl, 'makeAgain', 'delete'];
    default: return [];
  }
}

export function photoMakeAgainConfirm(quarks: number): ConfirmText {
  return {
    title: 'Make this photo again?',
    message: quarks ? `This makes a new version of this photo for ${quarkWord(quarks)}. The one you have stays.` : 'This makes a new version of this photo. The one you have stays.',
    confirmLabel: 'Make again',
  };
}
