import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { tagLabel } from '../../utils/plan';
import { STATUS_TEXT, type LevelItem, type LevelStatus, type StrategyLevel } from '../../utils/strategyLevels';

/** Small pieces shared by the plan tiles and the detail cards. Plain CSS classes from `plan.css`. */

/** Ready, needs more detail or not decided yet: always in words, the colour only adds to it. */
export const StatusChip: React.FC<{ status: LevelStatus }> = ({ status }) => (
  <span className="nb-plan-status" data-status={status}><span className="nb-plan-status-dot" aria-hidden="true" />{STATUS_TEXT[status]}</span>
);

/** The claim tag from the plan (Confirmed, Our reading, Suggested, Not confirmed). */
export const TagChip: React.FC<{ tag?: string | null }> = ({ tag }) => (tag ? <span className="nb-plan-tag" data-tag={tag}>{tagLabel(tag)}</span> : null);

const ItemBody: React.FC<{ it: LevelItem; first: boolean }> = ({ it, first }) => (
  <>
    <p className={`nb-plan-item-text${first ? '' : ' is-next'}`}>{it.text}<TagChip tag={it.tag} /></p>
    {it.bullets && it.bullets.length > 0 && (
      <ul className="nb-plan-bullets">{it.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
    )}
    {it.sub && it.sub.length > 0 && (
      <dl className={`nb-plan-sub${it.sub.length === 2 ? ' is-pair' : ''}`}>
        {it.sub.map((s, i) => <div key={i}><dt>{s.label}</dt><dd>{s.text}</dd></div>)}
      </dl>
    )}
  </>
);

function groupItems(items: LevelItem[]): LevelItem[][] {
  const out: LevelItem[][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && it.label && last[0].label === it.label && !it.current && !it.offline) last.push(it);
    else out.push([it]);
  }
  return out;
}

/** The details of one level, opened in place: every item of the level, the note and the link. */
export const LevelDetails: React.FC<{ level: StrategyLevel; id: string }> = ({ level, id }) => {
  const splits = level.items.filter((it) => it.split);
  const rest = level.items.filter((it) => !it.split);
  return (
    <div id={id} className="nb-plan-details">
      {splits.length > 0 && (
        <ul className="nb-plan-splits" aria-label="Organic and paid, by channel">
          {splits.map((it, i) => (
            <li key={i}>
              <span className="nb-plan-splits-name">{it.label}</span>
              <span className="nb-plan-bar" aria-hidden="true"><span style={{ width: `${it.split!.organic}%` }} /></span>
              <span className="nb-plan-splits-num">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <ul className="nb-plan-items">
          {groupItems(rest).map((g, i) => (
            <li key={i} className={g[0].current ? 'is-current' : ''}>
              {g[0].label && (
                <p className="nb-plan-item-label">
                  {g[0].label}
                  {g[0].current && <span className="nb-plan-here">You are here</span>}
                  {g[0].offline && <span className="nb-plan-offline">Offline</span>}
                </p>
              )}
              {g.map((it, j) => <ItemBody key={j} it={it} first={j === 0} />)}
            </li>
          ))}
        </ul>
      )}
      {level.note && <p className="nb-plan-note">{level.note}</p>}
      {level.link && <Link to={level.link.to} className="nb-plan-link">{level.link.label}<ArrowRight aria-hidden /></Link>}
    </div>
  );
};

/** A row of short chips; the rest are counted ("and 3 more"). */
export const ChipRow: React.FC<{ items: string[]; max?: number; tone?: string; label?: string }> = ({ items, max = 4, tone, label }) => {
  if (!items.length) return null;
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return (
    <ul className="nb-plan-chips" aria-label={label}>
      {shown.map((t, i) => <li key={i} data-tone={tone}>{t}</li>)}
      {more > 0 && <li className="is-more">and {more} more</li>}
    </ul>
  );
};
