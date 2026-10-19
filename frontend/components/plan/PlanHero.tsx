import React from 'react';
import { CalendarDays } from 'lucide-react';
import type { PlanBannerState } from '../../utils/plan';
import type { TitleCard } from '../../utils/planVisuals';
import { PlanMapArt } from '../art/PlanMap';
import { PlanSparkleArt } from '../art/plan/Sparkle';
import { TagChip } from './PlanBits';

/**
 * The top of My plan: the business name, when the plan was made and whether it is current, how much of it is ready,
 * a few counts from the plan, and the plan's one line as a title card with a soft gold glow.
 */

export interface HeroStat { value: string; label: string }

const STATE_CHIP: Partial<Record<PlanBannerState, { text: string; tone: string }>> = {
  ready: { text: 'Up to date', tone: 'sage' },
  stale: { text: 'A few weeks old', tone: 'coral' },
  building: { text: 'Being built', tone: 'gold' },
  failed: { text: 'Not built yet', tone: 'coral' },
};
const CARD_LABEL: Record<TitleCard['kind'], string> = { line: 'Your message', territory: 'Where you can stand out', promise: 'What the plan aims for' };

/** A small ring for "n of 9 ready", drawn from the count. */
const ReadyRing: React.FC<{ ready: number; total: number }> = ({ ready, total }) => {
  const c = 2 * Math.PI * 15;
  const len = total > 0 ? (ready / total) * c : 0;
  return (
    <span className="nb-plan-ready">
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false">
        <circle cx="20" cy="20" r="15" fill="none" stroke="rgb(20 32 58 / 0.08)" strokeWidth="5" />
        {len > 0 && <circle cx="20" cy="20" r="15" fill="none" stroke="#6E9B4E" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${len} ${c}`} transform="rotate(-90 20 20)" className="nb-plan-arc" style={{ ['--c' as any]: c }} />}
      </svg>
      <span><b>{ready} of {total}</b> parts ready</span>
    </span>
  );
};

const PlanHero: React.FC<{
  name: string;
  made: string;
  state: PlanBannerState;
  ready?: { ready: number; total: number } | null;
  card?: TitleCard | null;
  stats?: HeroStat[];
  action?: React.ReactNode;
}> = ({ name, made, state, ready, card, stats = [], action }) => {
  const chip = STATE_CHIP[state];
  return (
    <header className="nb-plan-hero nb-plan-in" style={{ ['--i' as any]: 0 }}>
      <div className="nb-plan-hero-top">
        <div className="nb-plan-hero-id">
          {/* The page title is the shared page header above this card; the card names the business. */}
          <h2>
            <span className="nb-plan-eyebrow">Made for</span>
            <span className="nb-plan-hero-name">{name || 'Your business'}</span>
          </h2>
          <div className="nb-plan-hero-meta">
            {made && state !== 'building' && <span className="nb-plan-meta"><CalendarDays aria-hidden />Made on {made}</span>}
            {chip && <span className="nb-plan-meta" data-tone={chip.tone}><span className="nb-plan-status-dot" aria-hidden="true" />{chip.text}</span>}
            {ready && <ReadyRing ready={ready.ready} total={ready.total} />}
          </div>
        </div>
        {action && <div className="nb-plan-hero-action">{action}</div>}
        <span className="nb-plan-hero-art" aria-hidden="true"><PlanMapArt /></span>
      </div>
      {card && (
        <figure className="nb-plan-card">
          <PlanSparkleArt className="nb-plan-spark" />
          <figcaption>{CARD_LABEL[card.kind]}</figcaption>
          <blockquote><p>{card.text}</p></blockquote>
          <TagChip tag={card.tag} />
        </figure>
      )}
      {stats.length > 0 && (
        <ul className="nb-plan-stats" aria-label="Your plan in numbers">
          {stats.map((s) => <li key={s.label}><b>{s.value}</b><span>{s.label}</span></li>)}
        </ul>
      )}
    </header>
  );
};

export default PlanHero;
