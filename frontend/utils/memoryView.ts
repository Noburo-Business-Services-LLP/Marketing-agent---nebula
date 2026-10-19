/**
 * Brand memory page (pages/AIMemory.tsx): how the stored learned notes are shown. Nothing here makes up a pattern:
 * the tiles are the notes the account has, grouped by their stored category, and the strength comes from the note's
 * stored confidence. Tested in tests/memoryView.test.mjs.
 */

export type MemoryCategory = 'timing' | 'format' | 'copy' | 'cta' | 'hashtags' | 'visual';

export interface LearnedNote {
  _id: string;
  text: string;
  category: MemoryCategory | string;
  confidence?: number;
  updatedAt?: string;
  createdAt?: string;
}

export interface CategoryInfo { title: string; line: string; tone: 'gold' | 'coral' | 'teal' | 'sage' | 'lilac' }

/** In reading order: when, what shape, what words, what ask, what tags, what look. */
export const CATEGORY_ORDER: MemoryCategory[] = ['timing', 'format', 'copy', 'cta', 'hashtags', 'visual'];

export const CATEGORY_INFO: Record<MemoryCategory, CategoryInfo> = {
  timing: { title: 'Best days and times', line: 'When your posts do best', tone: 'gold' },
  format: { title: 'Formats that work', line: 'Which kinds of post do best', tone: 'coral' },
  copy: { title: 'Words and tone', line: 'How your best captions sound', tone: 'teal' },
  cta: { title: 'Calls to action', line: 'What gets people to act', tone: 'lilac' },
  hashtags: { title: 'Hashtags and topics', line: 'What people respond to', tone: 'sage' },
  visual: { title: 'Visual style', line: 'How your best pictures look', tone: 'gold' },
};

export type Strength = 'strong' | 'good' | 'early';
export const STRENGTH_LABEL: Record<Strength, string> = { strong: 'Strong signal', good: 'Good signal', early: 'Early signal' };

/** The stored confidence (0 to 1) as a whole percent; a missing or broken value counts as one half, as stored by default. */
export function confidencePct(confidence: unknown): number {
  const n = Number(confidence);
  const c = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  return Math.round(c * 100);
}

export function strengthOf(confidence: unknown): Strength {
  const pct = confidencePct(confidence);
  return pct >= 75 ? 'strong' : pct >= 50 ? 'good' : 'early';
}

const categoryOf = (c: unknown): MemoryCategory => (CATEGORY_ORDER.includes(c as MemoryCategory) ? (c as MemoryCategory) : 'copy');

export interface PatternGroup extends CategoryInfo {
  category: MemoryCategory;
  notes: Array<LearnedNote & { pct: number; strength: Strength }>;
}

/** The notes grouped by category, in reading order, strongest first inside a group. Empty groups are left out. */
export function groupNotes(notes: unknown): PatternGroup[] {
  const list = Array.isArray(notes) ? notes.filter((n): n is LearnedNote => !!n && typeof (n as any).text === 'string' && !!(n as any).text.trim()) : [];
  return CATEGORY_ORDER
    .map((category) => ({
      category,
      ...CATEGORY_INFO[category],
      notes: list
        .filter((n) => categoryOf(n.category) === category)
        .map((n) => ({ ...n, pct: confidencePct(n.confidence), strength: strengthOf(n.confidence) }))
        .sort((a, b) => b.pct - a.pct),
    }))
    .filter((g) => g.notes.length > 0);
}

/** The hint while nothing is learned yet, from the number of posts really tracked. */
export function waitingHint(tracked: number): { title: string; text: string } {
  const n = Math.max(0, Math.floor(Number(tracked) || 0));
  if (n === 0) {
    return {
      title: 'Nothing learned yet',
      text: 'Once your posts are published, Nebulaa tracks how each one does. After they have been live for a few days, the patterns it finds show here.',
    };
  }
  return {
    title: 'Learning from your posts',
    text: `${n} ${n === 1 ? 'post is' : 'posts are'} being tracked. Patterns appear once a post has been live long enough to show a clear result. Select Refresh now to look again.`,
  };
}

/** "Based on 12 tracked posts" for the hero. */
export function trackedLabel(tracked: number): string {
  const n = Math.max(0, Math.floor(Number(tracked) || 0));
  return `${n} tracked ${n === 1 ? 'post' : 'posts'}`;
}
