import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ContentCalendar from './ContentCalendar';
import GravityCalendar from './GravityCalendar';

// Two ways to look at the same content, because they answer different
// questions. Plan is the AI's month-by-month strategy — pillars, themes,
// day-by-day briefs, the PDF a client gets before anything is made. Schedule
// is what's actually going out and when — a real month grid, a post sitting
// on the day it's scheduled for, useful for "what happened in August" once
// the plan and reality have diverged (which they always do — customers move
// posts, add their own ideas, reject and redo).
type CalendarTab = 'plan' | 'schedule';

const TABS: { key: CalendarTab; label: string }[] = [
  { key: 'plan', label: 'Month plan' },
  { key: 'schedule', label: 'Schedule' },
];

const CalendarHome: React.FC = () => {
  // Kept in the address (&view=schedule) so a link and the browser back button open the same view. Replace, so
  // flipping the view does not add history entries of its own.
  const [params, setParams] = useSearchParams();
  const tab: CalendarTab = params.get('view') === 'schedule' ? 'schedule' : 'plan';
  const setTab = (t: CalendarTab) => { const next = new URLSearchParams(params); if (t === 'plan') next.delete('view'); else next.set('view', t); setParams(next, { replace: true }); };

  return (
    <div className="pb-16">
      {/* Same pill-shaped switcher as Create's Campaign/Single post/Carousel
          toggle — the one tab control style the whole app should share. */}
      <div className="mb-5 overflow-x-auto">
        <div role="tablist" aria-label="Calendar views" className="inline-flex items-center gap-1 p-1 rounded-full bg-[var(--gv-panel)] border border-[var(--gv-border-default)]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap h-8 px-5 rounded-full text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A4A00] ${
                tab === t.key ? 'bg-[#FFF1D2] text-[#2B1D0E] shadow-[inset_0_0_0_1px_#F5A623]' : 'text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Both kept mounted rather than swapped in/out — ContentCalendar's own
          internal state (which month card is expanded, which detail tab)
          would otherwise reset every time someone flips back from Schedule. */}
      <div className={tab === 'plan' ? '' : 'hidden'}>
        <ContentCalendar />
      </div>
      <div className={tab === 'schedule' ? '' : 'hidden'}>
        <GravityCalendar />
      </div>
    </div>
  );
};

export default CalendarHome;
