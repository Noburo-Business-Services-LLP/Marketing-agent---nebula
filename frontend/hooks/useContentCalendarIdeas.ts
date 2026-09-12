import { useCallback, useEffect, useMemo, useState } from 'react';
import { contentCalendarAPI } from '../services/api';
import { ContentCalendarItem } from '../types';

export interface CalendarIdea extends ContentCalendarItem {
  weekNumber: number;
}

/**
 * Ideas from the user's content calendar, for picking by hand.
 *
 * Deliberately unrelated to `autoGenerate`. That flag controls whether the
 * backend creates posts overnight on its own; it has nothing to do with
 * whether a person may browse the ideas they already planned. The older
 * useSmartCalendarAutoFill conflated the two and returned nothing at all when
 * auto-generation was off, hiding a full month of ideas that existed.
 *
 * Also covers every week of the plan, not just the current one.
 */
export const useContentCalendarIdeas = (type?: 'post' | 'reel') => {
  const [ideas, setIdeas] = useState<CalendarIdea[]>([]);
  const [hasPlan, setHasPlan] = useState(false);
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await contentCalendarAPI.get();
      const calendar = response?.calendar;
      if (!calendar) {
        setHasPlan(false);
        setIdeas([]);
        return;
      }
      setHasPlan(true);
      setMonth(calendar.month || '');

      // Every week, flattened, with its week number kept for display.
      const all: CalendarIdea[] = (calendar.weeks || []).flatMap((w: any) =>
        (w.items || []).map((item: ContentCalendarItem) => ({ ...item, weekNumber: w.weekNumber }))
      );

      const byType = type
        ? all.filter((item) => {
            const format = (item.format || '').toLowerCase();
            return type === 'reel'
              ? ['reel', 'video', 'short'].includes(format)
              : !['reel', 'video', 'short'].includes(format);
          })
        : all;

      // Already-made ideas are dropped: picking one you have built would
      // produce a confusing duplicate.
      const unused = byType.filter(
        (item) => !item.generatedCampaignId && !item.generatedDraftId && item.status !== 'rejected'
      );

      setIdeas(unused);
    } catch (err: any) {
      console.error('Failed to load calendar ideas:', err);
      setIdeas([]);
      setError('Could not load your content calendar.');
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const pillars = useMemo(() => {
    const seen = new Set<string>();
    ideas.forEach((i) => { if (i.contentPillar) seen.add(i.contentPillar); });
    return Array.from(seen).sort();
  }, [ideas]);

  return { ideas, pillars, hasPlan, month, loading, error, reload: load };
};
