import React, { useState } from 'react';
import { Link } from 'react-router-dom';
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
      {/* Same pill-shaped switcher as Create's Campaign/Single post/Carousel
          toggle — the one tab control style the whole app should share. */}
      <div className="mb-8 overflow-x-auto">
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap h-9 px-5 rounded-full text-[13px] font-semibold transition-colors ${
                tab === t.key ? 'bg-white/[0.10] text-[#F5F4F1]' : 'text-white/55 hover:text-white/80'
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
        <div
          className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl p-5"
          style={{ background: 'var(--gv-panel)', border: '1px solid var(--gv-border-subtle)' }}
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold" style={{ color: 'var(--gv-text-primary)' }}>Brand Growth Blueprint</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: 'var(--gv-text-secondary)' }}>
              Build a 90-day plan from your website and Instagram page, then use it to plan your calendar.
            </p>
          </div>
          <Link
            to="/blueprint/new"
            className="shrink-0 inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)]"
          >
            Create a Blueprint
          </Link>
        </div>
        <ContentCalendar />
      </div>
      <div className={tab === 'schedule' ? '' : 'hidden'}>
        <GravityCalendar />
      </div>
    </div>
  );
};

export default CalendarHome;
