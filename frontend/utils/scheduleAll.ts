/**
 * "Schedule all" on the Create results (pages/GravityCreate.tsx): the posts that can be scheduled together, the times
 * they go out (one post every N days from a chosen first date and time) and the sentence the confirm shows, so the
 * customer knows exactly what happens before anything is scheduled. Nothing is posted at once. Pure: no network.
 *
 * A post can be scheduled together when it is made by hand (posts Nebulaa made for the customer are approved first),
 * is finished (not being made, not failed), is not scheduled or posted already, and has a picture or is a text post
 * for LinkedIn. Carousel slides are parts of one post and are left out.
 */
import { needsApproval } from './draftStatus.ts';
import { platformList } from './postActions.ts';

const READY = ['draft', 'ready', 'completed', 'approved', 'pending'];

export interface ScheduleCandidate {
  _id?: unknown; status?: unknown; isCarouselSlide?: unknown; imageUrl?: unknown; platforms?: unknown;
  creative?: { imageUrls?: unknown } | null; origin?: unknown; contentCalendarId?: unknown; calendarDay?: unknown;
  sourceType?: unknown; contentType?: unknown;
}

const hasPicture = (d: ScheduleCandidate): boolean => {
  const one = String(d.imageUrl || (d.creative && Array.isArray(d.creative.imageUrls) && d.creative.imageUrls[0]) || '');
  return /^(https?:|data:image\/)/i.test(one);
};
const linkedinText = (d: ScheduleCandidate): boolean =>
  Array.isArray(d.platforms) && d.platforms.length > 0 && (d.platforms as unknown[]).every((p) => String(p).toLowerCase() === 'linkedin');

/** The results that "Schedule all" would schedule, in the order shown. */
export function schedulable<T extends ScheduleCandidate>(results: T[]): T[] {
  return (Array.isArray(results) ? results : []).filter((d) => {
    if (!d || !d._id || d.isCarouselSlide) return false;
    const s = String(d.status || 'draft').toLowerCase();
    if (!READY.includes(s)) return false;
    if (needsApproval(d as any)) return false;
    return hasPicture(d) || linkedinText(d);
  });
}

/** How many days apart the posts go out by default: the campaign's posts per week spread over the week. */
export function defaultGapDays(postsPerWeek: unknown): number {
  const n = Number(postsPerWeek);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.min(7, Math.round(7 / n)));
}

/** The time each post goes out: the first at `first`, then one every `gapDays` days at the same time of day. */
export function scheduleTimes(first: Date, count: number, gapDays: number): Date[] {
  const gap = Math.max(1, Math.round(Number(gapDays) || 1));
  const out: Date[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const d = new Date(first.getTime());
    d.setDate(d.getDate() + i * gap);
    out.push(d);
  }
  return out;
}

const dayText = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const timeText = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const gapText = (gap: number) => (gap === 1 ? 'one a day' : gap === 7 ? 'one a week' : `one every ${gap} days`);

/** The confirm sentence: how many posts, where, when the first and the last go out. */
export function scheduleSummary(count: number, platforms: unknown, first: Date, gapDays: number): string {
  if (count <= 0) return 'There is nothing to schedule.';
  const where = platformList(platforms);
  const times = scheduleTimes(first, count, gapDays);
  const last = times[times.length - 1];
  const posts = `${count} ${count === 1 ? 'post' : 'posts'}`;
  const to = where ? ` to ${where}` : '';
  if (count === 1) return `This schedules 1 post${to} for ${dayText(first)} at ${timeText(first)}. Nothing is posted now.`;
  return `This schedules ${posts}${to}, ${gapText(Math.max(1, Math.round(gapDays)))} at ${timeText(first)}: the first on ${dayText(first)}, the last on ${dayText(last)}. Nothing is posted now.`;
}

/** The platforms of all the posts together, for the sentence. */
export function platformsOf(results: ScheduleCandidate[]): string[] {
  const all = (Array.isArray(results) ? results : []).flatMap((d) => (Array.isArray(d.platforms) ? (d.platforms as unknown[]).map((p) => String(p).toLowerCase()) : []));
  return Array.from(new Set(all.filter(Boolean)));
}
