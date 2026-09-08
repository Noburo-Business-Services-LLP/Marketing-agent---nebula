import React, { useState } from 'react';
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
  { key: 'plan', label: 'Plan' },
  { key: 'schedule', label: 'Schedule' },
];

const CalendarHome: React.FC = () => {
  const [tab, setTab] = useState<CalendarTab>('plan');

  return (
    <div className="max-w-[1440px] mx-auto pb-16">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.07] mb-8">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative whitespace-nowrap px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${
              tab === t.key ? 'text-[#F5A623]' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {t.label}
            {tab === t.key && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[#F5A623]" />}
          </button>
        ))}
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
