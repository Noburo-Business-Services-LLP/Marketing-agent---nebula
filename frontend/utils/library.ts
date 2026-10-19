import { needsApproval } from './draftStatus.ts';

/**
 * The Library merges five lists (post and image drafts, step-by-step video drafts, Hero videos, videos from the Videos page,
 * Photoshoot photos) into one
 * card shape, so one page can browse, filter and open all of them. Pure functions only.
 */
export type LibraryKind = 'image' | 'video';
export type LibrarySource = 'post' | 'reel' | 'video-draft' | 'hero' | 'photoshoot' | 'studio';
export type LibraryStatus = 'creating' | 'draft' | 'ready' | 'approved' | 'scheduled' | 'posted' | 'archived' | 'binned' | 'failed';

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  source: LibrarySource;
  title: string;
  status: LibraryStatus;
  thumbnailUrl: string;
  /** the playable or viewable file; '' while there is none */
  mediaUrl: string;
  caption: string;
  platforms: string[];
  createdAt: number;
  /** the original post draft, kept so the editing sheet can open it; only for posts and images */
  raw?: any;
  /** carousels: the rendered slide pictures, in order, and how many slides it will have */
  slides?: string[];
  slideTotal?: number;
  /** a step-by-step video job this draft belongs to, if any */
  jobId?: string;
  /** Hero videos: the finishing options it was made with, for the edit panel */
  finish?: any;
  /** Hero videos: the prompt and settings to start a new version from */
  heroSource?: { prompt: string; tweak?: any };
  /** posts Nebulaa made for the customer that wait for their approval */
  needsApproval?: boolean;
  /** posts in the Bin: when they went there */
  binnedAt?: number;
  /** videos from the Videos page: how many 10 second parts (its Make again price) */
  clips?: number;
}

const ms = (v: any): number => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};
const text = (v: any, n = 120): string => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v: any): string[] => (Array.isArray(v) ? v.map((x) => String(x || '').toLowerCase()).filter(Boolean) : []);
const VIDEO_FILE = /\.(mp4|webm|mov|m4v)(\?|$)|\/video\/upload\//i;

/** A still frame for a hosted (Cloudinary) video link, or '' when it is not one. */
export function stillFor(videoUrl: string): string {
  const m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)$/.exec(String(videoUrl || ''));
  if (!m) return '';
  return `${m[1]}so_1,w_480,h_480,c_fill,g_auto,f_jpg/${m[2]}`.replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg');
}

export function fromPostDraft(d: any): LibraryItem | null {
  if (!d || !d._id) return null;
  const s = String(d.status || '').toLowerCase();
  const status: LibraryStatus =
    s === 'processing' ? 'creating' : s === 'failed' ? 'failed' : s === 'scheduled' ? 'scheduled'
      : s === 'published' ? 'posted' : s === 'archived' || s === 'rejected' ? 'archived' : s === 'completed' ? 'ready'
        : s === 'approved' ? 'approved' : s === 'binned' ? 'binned' : 'draft';
  const slideList: any[] = Array.isArray(d.carouselSlides) ? d.carouselSlides : [];
  const slides = slideList.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((x) => String(x && x.imageUrl || '')).filter((u) => /^https?:\/\//i.test(u));
  // A carousel keeps its pictures per slide; the first one stands in as its cover.
  const url = String(d.imageUrl || '') || slides[0] || '';
  const reelKind = ['reel', 'video'].includes(String(d.contentType || d.sourceType || '').toLowerCase());
  const videoFile = VIDEO_FILE.test(url) ? url : String((d.creative && d.creative.videoUrl) || '');
  const isVideo = reelKind || Boolean(videoFile);
  const media = isVideo ? videoFile : url;
  const jobId = d.generationProgress && d.generationProgress.jobId ? String(d.generationProgress.jobId) : undefined;
  return {
    id: String(d._id), kind: isVideo ? 'video' : 'image', source: isVideo ? 'reel' : 'post',
    title: text(d.title) || text(d.caption, 70) || 'Untitled post', status,
    thumbnailUrl: isVideo ? stillFor(media) : url, mediaUrl: media,
    caption: text(d.caption, 600), platforms: list(d.platforms), createdAt: ms(d.createdAt || d.updatedAt || d.scheduledDate),
    raw: d, ...(jobId ? { jobId } : {}),
    ...(slideList.length ? { slides, slideTotal: slideList.length } : {}),
    ...(needsApproval(d) ? { needsApproval: true } : {}),
    ...(status === 'binned' && d.binnedAt ? { binnedAt: ms(d.binnedAt) } : {}),
  };
}

export function fromVideoDraft(d: any): LibraryItem | null {
  if (!d || !d.jobId) return null;
  const s = String(d.status || '').toLowerCase();
  const media = String(d.finalVideoUrl || (d.merge && (d.merge.finalOutputUrl || d.merge.finalVideoUrl)) || '');
  const status: LibraryStatus =
    s === 'posted' ? 'posted' : s === 'scheduled' ? 'scheduled' : s === 'created' ? 'ready' : s === 'failed' ? 'failed' : 'draft';
  return {
    id: String(d.jobId), kind: 'video', source: 'video-draft',
    title: text(d.title) || 'AI video', status,
    thumbnailUrl: String(d.thumbnailUrl || (d.content && d.content.thumbnailUrl) || stillFor(media) || ''), mediaUrl: media,
    caption: text(d.content && d.content.caption, 600),
    platforms: list((d.platform && d.platform.selectedPlatforms) || d.platforms),
    createdAt: ms(d.createdAt || d.updatedAt),
  };
}

export function fromHeroJob(j: any): LibraryItem | null {
  if (!j || !j.jobId) return null;
  const s = String(j.status || '').toLowerCase();
  const published = j.publish && j.publish.status;
  const status: LibraryStatus =
    s === 'failed' ? 'failed' : s === 'completed' ? (published === 'published' ? 'posted' : published === 'scheduled' ? 'scheduled' : 'ready') : 'creating';
  return {
    id: String(j.jobId), kind: 'video', source: 'hero',
    title: text(j.title) || 'Hero video', status,
    thumbnailUrl: String(j.thumbnailUrl || stillFor(j.videoUrl) || ''), mediaUrl: String(j.videoUrl || ''),
    caption: '', platforms: list(j.publish && j.publish.platforms), createdAt: ms(j.createdAt),
    finish: j.finish,
    ...(j.prompt ? { heroSource: { prompt: String(j.prompt), tweak: j.tweak } } : {}),
  };
}

/**
 * A video made on the Videos page (GET /api/videos, backend/routes/studioVideos.js). It cannot be posted from Nebulaa
 * (there is no posting route for these), so its tile offers Open, Download and Make again, never Schedule or Post now.
 */
export function fromStudioVideo(v: any): LibraryItem | null {
  if (!v || !v.id) return null;
  const s = String(v.status || '').toLowerCase();
  const media = String(v.videoUrl || '');
  const status: LibraryStatus = s === 'processing' ? 'creating' : s === 'failed' ? 'failed' : 'ready';
  return {
    id: String(v.id), kind: 'video', source: 'studio',
    title: text(v.title) || 'Video', status,
    thumbnailUrl: stillFor(media), mediaUrl: status === 'ready' ? media : '',
    caption: text(v.concept, 600), platforms: list(v.platforms), createdAt: ms(v.createdAt || v.completedAt),
    clips: Math.max(1, Math.round(Number(v.clips) || 1)),
  };
}

/** One finished Photoshoot photo the customer keeps in the Library (GET /api/photoshoot/library), tagged Photoshoot. */
export function fromPhotoshootPhoto(p: any): LibraryItem | null {
  // The server only sends stored https links; the sample-data preview uses small inline pictures.
  if (!p || !p.jobId || !Number.isInteger(p.index) || !/^(https:\/\/|data:image\/)/i.test(String(p.url || ''))) return null;
  const title = [text(p.product, 60), text(p.scene, 40)].filter(Boolean).join(', ') || 'Photoshoot photo';
  return {
    id: `${p.jobId}-${p.index}`, kind: 'image', source: 'photoshoot', title, status: 'ready',
    thumbnailUrl: String(p.url), mediaUrl: String(p.url), caption: text(p.packTitle, 80) ? `Photoshoot: ${text(p.packTitle, 80)}` : 'Photoshoot',
    platforms: [], createdAt: ms(p.createdAt), jobId: String(p.jobId),
  };
}

export interface LibraryFilters { kind: 'all' | LibraryKind; status: 'all' | LibraryStatus; platform: string; source: 'all' | LibrarySource; query: string }
export const DEFAULT_FILTERS: LibraryFilters = { kind: 'all', status: 'all', platform: '', source: 'all', query: '' };

/** Filters, then newest first. A creating item stays visible in "All" and "Creating" so nothing seems to vanish. */
export function applyFilters(items: LibraryItem[], f: LibraryFilters): LibraryItem[] {
  const q = f.query.trim().toLowerCase();
  return items
    .filter((i) => (f.kind === 'all' || i.kind === f.kind)
      && (f.source === 'all' || i.source === f.source)
      && (f.status === 'all' || i.status === f.status)
      && (!f.platform || i.platforms.includes(f.platform))
      && (!q || `${i.title} ${i.caption}`.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const STATUS_WORD: Record<LibraryStatus, string> = {
  creating: 'Creating', draft: 'Draft', ready: 'Ready', approved: 'Approved', scheduled: 'Scheduled', posted: 'Posted', archived: 'Archived',
  binned: 'In the Bin', failed: 'Did not finish',
};

/** The word on a tile's status chip: "Needs approval" for posts waiting for the customer's OK. */
export function statusWordOf(i: Pick<LibraryItem, 'status' | 'needsApproval'>): string {
  if (i.needsApproval && i.status !== 'creating' && i.status !== 'failed') return 'Needs approval';
  return STATUS_WORD[i.status];
}

/** The Library views (owner, 2026-10-19): Needs approval first, the Bin last. `count` is the GET /drafts/counts key. */
export type LibraryView = 'approve' | 'approved' | 'scheduled' | 'posted' | 'all' | 'archived' | 'bin';
export const LIBRARY_VIEWS: ReadonlyArray<{ key: LibraryView; label: string; count?: 'needsApproval' | 'approved' | 'scheduled' | 'posted' | 'archived' | 'binned' }> = Object.freeze([
  { key: 'approve', label: 'Needs approval', count: 'needsApproval' },
  { key: 'approved', label: 'Approved', count: 'approved' },
  { key: 'scheduled', label: 'Scheduled', count: 'scheduled' },
  { key: 'posted', label: 'Posted', count: 'posted' },
  { key: 'all', label: 'All' },
  { key: 'archived', label: 'Archived', count: 'archived' },
  { key: 'bin', label: 'Bin', count: 'binned' },
]);

/** ?view= from the address, or '' when it names no view. */
export function viewFromQuery(v: unknown): LibraryView | '' {
  const s = String(v || '').toLowerCase();
  return (LIBRARY_VIEWS.some((x) => x.key === s) ? s : '') as LibraryView | '';
}

/** The view to open: the address wins; otherwise Needs approval while something waits, else All. */
export function defaultView(fromQuery: unknown, needsApprovalCount: number | null | undefined): LibraryView {
  return viewFromQuery(fromQuery) || (Number(needsApprovalCount) > 0 ? 'approve' : 'all');
}

/** Does an item belong in a view? All hides the Archived and the Bin; the Bin holds only binned posts. */
export function inView(i: Pick<LibraryItem, 'status' | 'needsApproval'>, view: LibraryView): boolean {
  switch (view) {
    case 'approve': return Boolean(i.needsApproval);
    case 'approved': return i.status === 'approved';
    case 'scheduled': return i.status === 'scheduled';
    case 'posted': return i.status === 'posted';
    case 'archived': return i.status === 'archived';
    case 'bin': return i.status === 'binned';
    default: return i.status !== 'archived' && i.status !== 'binned';
  }
}

/** Where an item came from, in words, for the source chip on its tile. */
export const SOURCE_WORD: Record<LibrarySource, string> = {
  post: 'Post', reel: 'Reel from your plan', 'video-draft': 'Video', hero: 'Video', photoshoot: 'Photoshoot', studio: 'Video',
};

export type LibraryAction = 'open' | 'edit' | 'download' | 'again';

/** The actions a tile offers on hover and focus. Nothing while it is still being made. */
export function libraryTileActions(i: Pick<LibraryItem, 'status' | 'mediaUrl' | 'source'>): LibraryAction[] {
  if (i.status === 'creating') return [];
  const out: LibraryAction[] = ['open'];
  if ((i.status === 'draft' || i.status === 'failed') && i.source !== 'studio') out.push('edit');
  if (i.mediaUrl && i.source !== 'post') out.push('download');
  // Videos from the Videos page are made again there (their plan opens again; the price shows before making).
  if (i.source === 'studio') out.push('again');
  return out;
}
