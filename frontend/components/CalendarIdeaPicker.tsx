import React, { useMemo, useState } from 'react';
import { CalendarDays, Loader2, X, Search } from 'lucide-react';
import { useContentCalendarIdeas, CalendarIdea } from '../hooks/useContentCalendarIdeas';

/**
 * Picker for ideas already planned in the content calendar.
 *
 * Shared by Create and AI Reels so the two cannot drift apart again — they
 * previously had different behaviour for the same job.
 */
const CalendarIdeaPicker: React.FC<{
  open: boolean;
  onClose: () => void;
  onPick: (idea: CalendarIdea) => void;
  type?: 'post' | 'reel';
}> = ({ open, onClose, onPick, type }) => {
  const { ideas, pillars, hasPlan, month, loading } = useContentCalendarIdeas(type);
  const [pillar, setPillar] = useState<string>('all');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ideas.filter((i) => {
      const pillarOk = pillar === 'all' || i.contentPillar === pillar;
      if (!pillarOk) return false;
      if (!q) return true;
      return `${i.headline || ''} ${i.creativeConcept || ''}`.toLowerCase().includes(q);
    });
  }, [ideas, pillar, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="gravity-glow w-full max-w-4xl rounded-2xl">
        <div className="relative w-full rounded-2xl border border-white/[0.08] bg-[#111111] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">

          <div className="px-6 py-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
            <div>
              <h3 className="font-serif-display text-[22px] text-[#F5F4F1] flex items-center gap-2.5">
                <CalendarDays className="w-5 h-5 text-[#F5A623]" />
                Ideas from your calendar
              </h3>
              <p className="text-[12.5px] text-white/45 mt-1">
                {month ? `Planned for ${month}. ` : ''}Pick one to fill the brief, or close this and write your own.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06]"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {(pillars.length > 0 || ideas.length > 0) && (
            <div className="px-6 py-3.5 border-b border-white/[0.06] flex flex-wrap items-center gap-2">
              <button
                onClick={() => setPillar('all')}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  pillar === 'all'
                    ? 'bg-[#F5A623] text-[#1A1208]'
                    : 'text-white/55 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08]'
                }`}
              >
                All · {ideas.length}
              </button>
              {pillars.map((p) => {
                const count = ideas.filter((i) => i.contentPillar === p).length;
                return (
                  <button
                    key={p}
                    onClick={() => setPillar(p)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                      pillar === p
                        ? 'bg-[#F5A623] text-[#1A1208]'
                        : 'text-white/55 hover:text-[#F5F4F1] hover:bg-white/[0.05] border border-white/[0.08]'
                    }`}
                  >
                    {p} · {count}
                  </button>
                );
              })}
              <div className="relative ml-auto min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ideas..."
                  className="gravity-bare w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[12.5px] text-[#F5F4F1] placeholder:text-white/25 outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" />
              </div>
            ) : !hasPlan ? (
              <div className="text-center py-14">
                <p className="text-[13.5px] text-[#F5F4F1]">No content calendar yet.</p>
                <p className="text-[12.5px] text-white/45 mt-1">
                  Generate a monthly plan in Calendar and its ideas will appear here.
                </p>
              </div>
            ) : shown.length === 0 ? (
              <div className="text-center py-14">
                <p className="text-[13.5px] text-[#F5F4F1]">
                  {ideas.length === 0 ? 'Every idea in this plan has been used.' : 'Nothing matches that filter.'}
                </p>
                <p className="text-[12.5px] text-white/45 mt-1">
                  {ideas.length === 0
                    ? 'Generate next month’s plan in Calendar for more.'
                    : 'Try another content pillar or clear the search.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {shown.map((idea) => (
                  <button
                    key={idea._id}
                    onClick={() => { onPick(idea); onClose(); }}
                    className="text-left rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 hover:border-[#F5A623]/40 hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-[#F5A623]/20 text-[#F5A623]">
                        {idea.format || 'Post'}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-white/30">
                        Week {idea.weekNumber} · Day {idea.day}
                      </span>
                    </div>
                    <div className="font-semibold text-[13.5px] text-[#F5F4F1] line-clamp-2">
                      {idea.headline || 'Untitled idea'}
                    </div>
                    {idea.creativeConcept && (
                      <p className="text-[11.5px] mt-1.5 text-white/45 line-clamp-3 leading-relaxed">
                        {idea.creativeConcept}
                      </p>
                    )}
                    {idea.contentPillar && (
                      <div className="text-[10px] uppercase tracking-wide text-white/30 mt-2.5">
                        {idea.contentPillar}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarIdeaPicker;
