/**
 * The Library merges three lists (post and image drafts, step-by-step video drafts, Hero videos) into one
 * card shape, so one page can browse, filter and open all of them. Pure functions only.
 */
export type LibraryKind = 'image' | 'video';
export type LibrarySource = 'post' | 'video-draft' | 'hero';
export type LibraryStatus = 'creating' | 'draft' | 'ready' | 'scheduled' | 'posted' | 'archived' | 'failed';

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
      : s === 'published' ? 'posted' : s === 'archived' ? 'archived' : s === 'completed' ? 'ready' : 'draft';
  const url = String(d.imageUrl || '');
  const isVideo = VIDEO_FILE.test(url) || String(d.contentType || d.sourceType || '').toLowerCase() === 'reel';
  return {
    id: String(d._id), kind: isVideo ? 'video' : 'image', source: 'post',
    title: text(d.title) || text(d.caption, 70) || 'Untitled post', status,
    thumbnailUrl: isVideo ? stillFor(url) : url, mediaUrl: url,
    caption: text(d.caption, 600), platforms: list(d.platforms), createdAt: ms(d.createdAt || d.updatedAt || d.scheduledDate),
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
  creating: 'Creating', draft: 'Draft', ready: 'Ready', scheduled: 'Scheduled', posted: 'Posted', archived: 'Archived', failed: 'Did not finish',
};
