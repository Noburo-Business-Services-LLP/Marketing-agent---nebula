import React from 'react';
import { Check, Languages, LayoutGrid, Layers, Loader2, Package, Store, Target } from 'lucide-react';
import { CalendarCover } from './CalendarCover';
import { heroTitle, monthCounts, allItems, planInputs, monthName, PlanInput } from '../../utils/calendarHero';
import './calendarHero.css';

type Cal = {
  _id?: string; month?: string; businessName?: string; themeTitle?: string; themeSummary?: string; coverImageUrl?: string;
  coverStatus?: string; approved?: boolean; language?: string; businessVertical?: string; niche?: string; weeks?: any[];
};

/**
 * The month hero (owner, 2026-10-18: "<Business>'s October posts, in one tap"): the cover or the built-in cover,
 * the business and month, the theme, the planned, approved and published counts, and one primary button.
 * Styles in calendarHero.css (warm gold card on the cream page, no dark panel).
 */
export const MonthHero: React.FC<{
  calendar: Cal | null;
  /** the month the hero is about when there is no calendar yet ("2026-11") */
  month?: string;
  businessName?: string;
  primary: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean };
  /** quieter buttons beside the primary one */
  extra?: React.ReactNode;
  /** the plan for this month is being made right now */
  generating?: boolean;
  /** one short line under the text when there is no plan yet (the price note) */
  note?: string;
}> = ({ calendar, month, businessName, primary, extra, generating, note }) => {
  const m = calendar?.month || month || '';
  const name = calendar?.businessName || businessName || '';
  const counts = monthCounts(allItems(calendar as any));
  const pending = calendar?.coverStatus === 'pending';
  const year = /^(\d{4})-/.exec(m)?.[1] || '';
  return (
    <section className="nb-cal-hero" aria-label={`${monthName(m) || 'Monthly'} plan`} data-testid="calendar-hero">
      <div className="nb-cal-hero-cover">
        <CalendarCover imageUrl={calendar?.coverImageUrl} month={m} businessName={name} pending={pending || !!generating} tone="light" />
      </div>
      <div className="nb-cal-hero-main">
        <p className="nb-cal-eyebrow">
          Smart Calendar · {[monthName(m), year].filter(Boolean).join(' ') || 'Your plan'}
          {calendar?.approved && <span className="nb-cal-approved"><Check className="h-3 w-3" aria-hidden="true" />Approved</span>}
        </p>
        <h2 className="nb-cal-title">{heroTitle(name, m)}</h2>
        {generating ? (
          <p className="nb-cal-summary" role="status"><Loader2 className="nb-cal-spin h-3.5 w-3.5" aria-hidden="true" />Planning {monthName(m) || 'your month'}: a day-by-day plan from your brand and your goals. This takes about a minute.</p>
        ) : calendar ? (
          <>
            {calendar.themeTitle && <p className="nb-cal-theme">{calendar.themeTitle}</p>}
            {calendar.themeSummary && <p className="nb-cal-summary">{calendar.themeSummary}</p>}
            {pending && <p className="nb-cal-note">Making the cover picture. It appears here by itself.</p>}
          </>
        ) : (
          <>
            <p className="nb-cal-summary">No plan for {monthName(m) || 'this month'} yet. Nebulaa plans every day of the month from your brand, your plan and your products; you approve it before anything is made.</p>
            {note && <p className="nb-cal-note" data-testid="calendar-hero-note">{note}</p>}
          </>
        )}
        <div className="nb-cal-hero-foot">
          {calendar && !generating && (
            <dl className="nb-cal-counts">
              <div><dt>Planned</dt><dd>{counts.planned}</dd></div>
              <div><dt>Approved</dt><dd>{counts.approved}</dd></div>
              <div><dt>Published</dt><dd>{counts.published}</dd></div>
            </dl>
          )}
          <div className="nb-cal-actions">
            <button type="button" className="nb-cal-primary" onClick={primary.onClick} disabled={primary.disabled || primary.busy || generating}>
              {(primary.busy || generating) && <Loader2 className="nb-cal-spin h-4 w-4" aria-hidden="true" />}
              {primary.label}
            </button>
            {extra}
          </div>
        </div>
      </div>
    </section>
  );
};

const ICONS: Record<PlanInput['key'], React.ComponentType<{ className?: string }>> = {
  language: Languages, business: Store, goals: Target, pillars: Layers, products: Package, formats: LayoutGrid,
};

/** "What this plan was built from": six small tiles from the calendar's stored fields only. */
export const PlanInputsCard: React.FC<{ calendar: Cal | null }> = ({ calendar }) => {
  const inputs = planInputs(calendar as any);
  if (!inputs.length) return null;
  return (
    <section className="nb-cal-inputs" aria-labelledby="nb-cal-inputs-title">
      <div className="nb-cal-inputs-head">
        <h3 id="nb-cal-inputs-title">What this plan was built from</h3>
        <p>Read from the saved plan for {monthName(calendar?.month) || 'this month'}.</p>
      </div>
      <ul className="nb-cal-inputs-grid">
        {inputs.map((x) => {
          const Icon = ICONS[x.key];
          return (
            <li key={x.key} className="nb-cal-input" data-key={x.key} data-empty={x.empty || undefined}>
              <span className="nb-cal-input-mark" aria-hidden="true"><Icon className="h-4 w-4" /></span>
              <span className="nb-cal-input-label">{x.label}</span>
              <span className="nb-cal-input-values">
                {x.values.map((v) => <span key={v} className="nb-cal-input-value">{v}</span>)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
