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
        <div
          className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl px-5 py-3.5"
          style={{ background: 'var(--gv-panel)', border: '1px solid var(--gv-border-subtle)' }}
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-[14.5px] font-semibold" style={{ color: 'var(--gv-text-primary)' }}>Brand Growth Blueprint</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: 'var(--gv-text-secondary)' }}>
              Build a 90-day plan from your website and Instagram page, then use it to plan your calendar.
            </p>
          </div>
          <Link
            to="/blueprint/new"
            className="shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-lg text-[13px] font-semibold border border-[var(--gv-border-default)] bg-[var(--gv-panel)] text-[var(--gv-text-primary)] hover:border-[var(--gv-border-strong)]"
          >
            Create a Blueprint
          </Link>
        </div>
      </div>
      <div className={tab === 'schedule' ? '' : 'hidden'}>
        <GravityCalendar />
      </div>
    </div>
  );
};

export default CalendarHome;
