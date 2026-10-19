import React from 'react';
import { donutArcs, timelinePct, type MixSegments } from '../../utils/planVisuals';
import type { LevelItem } from '../../utils/strategyLevels';

/**
 * The two drawn charts on My plan, both from stored numbers only: the marketing mix donut (outer ring organic and
 * paid, inner ring online and offline channels) and the 90-day timeline with today's marker.
 */

const ORGANIC = '#F5A623';
const PAID = '#7B5CC4';
const ONLINE = '#1F9D9A';
const OFFLINE = '#6E9B4E';
const R_OUT = 44;
const R_IN = 29;
const C_OUT = 2 * Math.PI * R_OUT;
const C_IN = 2 * Math.PI * R_IN;

const Ring: React.FC<{ r: number; c: number; width: number; parts: Array<{ key: string; value: number; color: string }>; delay?: number }> = ({ r, c, width, parts, delay = 0 }) => {
  const arcs = donutArcs(parts, c);
  const color = (k: string) => parts.find((p) => p.key === k)?.color || ORGANIC;
  // A small gap between arcs reads better than a hairline; a single full ring has none.
  const gap = arcs.length > 1 ? 2 : 0;
  return (
    <>
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(20 32 58 / 0.06)" strokeWidth={width} />
      {arcs.map((a, i) => (
        <circle
          key={a.key} cx="60" cy="60" r={r} fill="none" stroke={color(a.key)} strokeWidth={width}
          strokeDasharray={`${Math.max(0, a.length - gap)} ${c}`} strokeDashoffset={a.offset}
          className="nb-plan-arc" style={{ ['--c' as any]: c, animationDelay: `${delay + i * 120}ms` }}
        />
      ))}
    </>
  );
};

/** The mix donut with its legend. Without a stored split the outer ring stays empty and says so. */
export const MixDonut: React.FC<{ mix: MixSegments }> = ({ mix }) => {
  const hasSplit = mix.organic !== null;
  const hasChannels = mix.online + mix.offline > 0;
  const label = [
    hasSplit ? `${mix.organic}% organic and ${mix.paid}% paid, on average over ${mix.splitChannels} ${mix.splitChannels === 1 ? 'channel' : 'channels'}` : 'Organic and paid not split yet',
    hasChannels ? `${mix.online} online and ${mix.offline} offline${mix.offlinePaid ? `, ${mix.offlinePaid} offline that ${mix.offlinePaid === 1 ? 'costs' : 'cost'} money` : ''}` : '',
    hasSplit && (mix.paid as number) > 0 ? 'Paid is a suggestion you run yourself' : '',
  ].filter(Boolean).join('. ');
  return (
    <div className="nb-plan-donut">
      <div className="nb-plan-donut-fig" role="img" aria-label={label}>
        <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true" focusable="false">
          <g transform="rotate(-90 60 60)">
            {hasSplit
              ? <Ring r={R_OUT} c={C_OUT} width={13} parts={[{ key: 'organic', value: mix.organic as number, color: ORGANIC }, { key: 'paid', value: mix.paid as number, color: PAID }]} />
              : <circle cx="60" cy="60" r={R_OUT} fill="none" stroke="rgb(20 32 58 / 0.22)" strokeWidth="2" strokeDasharray="3 5" />}
            {hasChannels
              ? <Ring r={R_IN} c={C_IN} width={8} delay={260} parts={[{ key: 'online', value: mix.online, color: ONLINE }, { key: 'offline', value: mix.offline, color: OFFLINE }]} />
              : <circle cx="60" cy="60" r={R_IN} fill="none" stroke="rgb(20 32 58 / 0.18)" strokeWidth="2" strokeDasharray="3 5" />}
          </g>
        </svg>
        <span className="nb-plan-donut-mid" aria-hidden="true">
          {hasSplit ? <><b>{mix.organic}%</b><small>organic</small></> : hasChannels ? <><b>{mix.online + mix.offline}</b><small>{mix.online + mix.offline === 1 ? 'channel' : 'channels'}</small></> : null}
        </span>
      </div>
      <ul className="nb-plan-legend">
        {hasSplit ? (
          <>
            <li><i style={{ background: ORGANIC }} />Organic<b>{mix.organic}%</b></li>
            <li><i style={{ background: PAID }} />Paid<b>{mix.paid}%</b></li>
          </>
        ) : <li className="is-empty"><i aria-hidden="true" />Organic and paid are not split yet</li>}
        <li><i style={{ background: ONLINE }} />Online<b>{mix.online} {mix.online === 1 ? 'channel' : 'channels'}</b></li>
        <li><i style={{ background: OFFLINE }} />Offline<b>{mix.offline ? `${mix.offline}${mix.offlinePaid ? `, ${mix.offlinePaid} paid` : ''}` : 'None yet'}</b></li>
      </ul>
    </div>
  );
};

const PHASE_TONE = ['sage', 'gold', 'coral'];

/** The 90 days as one track in three parts, today's marker on the real day, and one short card per phase. */
export const RoadTimeline: React.FC<{ phases: LevelItem[]; day: number | null }> = ({ phases, day }) => {
  const pct = timelinePct(day);
  return (
    <div className="nb-plan-road">
      <div className="nb-plan-track" aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className="nb-plan-track-part" data-tone={PHASE_TONE[i]} />)}
        {day !== null && <span className="nb-plan-track-fill" style={{ width: `${pct}%` }} />}
        {day !== null && <span className="nb-plan-track-now" data-edge={pct < 12 ? 'start' : pct > 88 ? 'end' : undefined} style={{ left: `${pct}%` }}><span>Day {Math.min(day, 90)}</span></span>}
      </div>
      <ol className="nb-plan-phases">
        {phases.map((ph, i) => {
          const [days, title] = String(ph.label || '').split(', ');
          return (
            <li key={i} data-tone={PHASE_TONE[i % 3]} className={ph.current ? 'is-current' : ''}>
              <span className="nb-plan-phase-dot" aria-hidden="true" />
              <p className="nb-plan-phase-days">{days}{ph.current && <span className="nb-plan-here">You are here</span>}</p>
              <p className="nb-plan-phase-title">{title || days}</p>
              <p className="nb-plan-phase-focus">{ph.text}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
