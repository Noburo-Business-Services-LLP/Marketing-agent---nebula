import React from 'react';
import { ContentCalendarItem } from '../../types';
import { monthGrid, sortPlanItems } from '../../utils/calendarPlan';

export const formatChipStyle = (format?: string): React.CSSProperties => {
  const f = String(format || '').toLowerCase();
  const bg = /reel|video/.test(f) ? 'var(--gv-lav)' : /carousel/.test(f) ? 'var(--gv-sky)' : /story|stories/.test(f) ? 'var(--gv-mint)' : 'var(--gv-peach)';
  return { background: bg, color: 'var(--gv-text-primary)' };
};

export const statusMark = (status?: string): { mark: string; label: string } =>
  status === 'approved' ? { mark: '✓', label: 'Approved' }
    : status === 'rejected' ? { mark: '✕', label: 'Rejected' }
      : { mark: '○', label: 'Draft' };

const WEEKDAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Props {
  month: string;
  items: ContentCalendarItem[];
}

const PlanMonthGrid: React.FC<Props> = ({ month, items }) => {
  const cells = monthGrid(month);
  if (!cells.length) return null;
  const byDay = new Map<number, ContentCalendarItem[]>();
  for (const item of sortPlanItems(items)) {
    const list = byDay.get(item.day) || [];
    list.push(item);
    byDay.set(item.day, list);
  }
  const jump = (day: number) => {
    const el = document.getElementById(`plan-day-${day}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section
      aria-label="Month overview"
      className="rounded-xl border p-2 sm:p-4"
      style={{ background: 'var(--gv-panel)', borderColor: 'var(--gv-border-subtle)', boxShadow: 'var(--gv-shadow-card)' }}
    >
      <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1 sm:mb-2">
        {WEEKDAY_HEADS.map((w) => (
          <div key={w} className="text-center text-[10px] sm:text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--gv-text-tertiary)' }}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {cells.map((cell, index) => {
          if (cell.day === null) return <div key={`blank-${index}`} aria-hidden="true" />;
          const dayItems = byDay.get(cell.day) || [];
          return (
            <button
              key={cell.day}
              type="button"
              onClick={() => jump(cell.day as number)}
              aria-label={`Go to day ${cell.day}, ${dayItems.length} planned ${dayItems.length === 1 ? 'item' : 'items'}`}
              className="min-w-0 min-h-[56px] sm:min-h-[92px] rounded-lg border p-1 sm:p-2 text-left flex flex-col gap-1 overflow-hidden"
              style={{ background: 'var(--gv-panel)', borderColor: 'var(--gv-border-subtle)', color: 'var(--gv-text-primary)' }}
            >
              <span className="text-[11px] sm:text-sm font-semibold" style={{ color: 'var(--gv-text-secondary)' }}>{cell.day}</span>
              <span className="flex flex-wrap gap-[2px] sm:flex-col sm:gap-1 min-w-0">
                {dayItems.map((item) => {
                  const s = statusMark(item.status);
                  return (
                    <span
                      key={item._id}
                      title={`${item.format}, ${s.label}`}
                      className="inline-flex items-center gap-[2px] sm:gap-1 rounded px-[3px] sm:px-1.5 py-[1px] text-[9px] sm:text-[11px] font-semibold leading-tight min-w-0 max-w-full"
                      style={formatChipStyle(item.format)}
                    >
                      <span className="sm:hidden">{String(item.format || '?').charAt(0).toUpperCase()}</span>
                      <span className="hidden sm:inline truncate">{item.format}</span>
                      <span aria-hidden="true">{s.mark}</span>
                      <span className="sr-only">{s.label}</span>
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--gv-text-tertiary)' }}>
        Marks on each item: a tick means approved, a cross means rejected, and an empty circle means draft.
      </p>
    </section>
  );
};

export default PlanMonthGrid;
