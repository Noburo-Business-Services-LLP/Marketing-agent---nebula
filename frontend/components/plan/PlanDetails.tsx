import React from 'react';
import { Check, Flag, Frown, MapPin, Sparkles, Target, Users } from 'lucide-react';
import CompetitorInsights from '../CompetitorInsights';
import ListeningCard from '../ListeningCard';
import type { PlanView } from '../../types';
import { PHASE_TITLES, effortRows, sectionsOf } from '../../utils/plan';
import { currentPhase } from '../../utils/strategyLevels';
import { initialsOf, platformOf, shapeCounts } from '../../utils/planVisuals';
import { TagChip } from './PlanBits';
import { PlatformMark, PostThumb } from './PlanMarks';

/**
 * "Your plan in detail": the same sections as before (business today, customer, where to show up, the 90 days, this
 * month's mix, what to do first), now as cards with icons, colour chips and small drawings instead of text blocks.
 * Every claim keeps its tag in words. Sections the plan does not have are left out, as before.
 */

type Claim = { text?: string | null; tag?: string; label?: string | null };
const has = (c?: Claim | null): c is Claim => !!c && typeof c.text === 'string' && !!c.text.trim();
const claims = (v: unknown): Claim[] => (Array.isArray(v) ? v.filter(has) : []);

const ClaimText: React.FC<{ c?: Claim | null; className?: string }> = ({ c, className }) => (has(c) ? <p className={className || 'nb-plan-claim'}>{c.text}<TagChip tag={c.tag} /></p> : null);

const Card: React.FC<{ id: string; title: string; icon: React.ReactNode; tone: string; wide?: boolean; index: number; children: React.ReactNode }> = ({ id, title, icon, tone, wide, index, children }) => (
  <section className="nb-plan-dcard nb-plan-in" data-tone={tone} data-wide={wide ? 'true' : undefined} aria-labelledby={`plan-h-${id}`} style={{ ['--i' as any]: index }}>
    <h2 id={`plan-h-${id}`} className="nb-plan-dcard-title"><span className="nb-plan-dcard-icon" aria-hidden="true">{icon}</span>{title}</h2>
    {children}
  </section>
);

const Mini: React.FC<{ title: string; icon?: React.ReactNode; tone?: string; children: React.ReactNode }> = ({ title, icon, tone, children }) => (
  <div className="nb-plan-mini" data-tone={tone}>
    <h3>{icon && <span aria-hidden="true">{icon}</span>}{title}</h3>
    {children}
  </div>
);

const ICON = { className: 'nb-plan-i' };

const PlanDetails: React.FC<{ view: PlanView; showCompetitors?: boolean; showListening?: boolean }> = ({ view, showCompetitors, showListening }) => {
  const p: any = view.plan?.result?.plan || {};
  const rows = effortRows(view.plan);
  const roleOf = (name: string) => (p.channels || []).find((c: any) => c && c.channel === name)?.role;
  const channelNames: string[] = Array.from(new Set<string>([...(p.channels || []).filter((c: any) => c && c.channel).map((c: any) => String(c.channel)), ...rows.map((r) => r.channel)]));
  const sections = sectionsOf(view.plan);
  const now = currentPhase(view.plan?.completedAt);
  const cards: React.ReactNode[] = [];

  sections.forEach((s, idx) => {
    if (s.id === 'today') {
      const pos = p.positioning || {};
      cards.push(
        <Card key={s.id} id={s.id} title={s.title} icon={<Flag {...ICON} />} tone="gold" index={idx}>
          <div className="nb-plan-dgrid">
            {has(p.promise) && <Mini title="What the plan aims for" icon={<Target {...ICON} />} tone="gold"><ClaimText c={p.promise} className="nb-plan-claim is-big" /></Mini>}
            {pos.territory?.name && (
              <Mini title="Where you can stand out" icon={<Sparkles {...ICON} />} tone="teal">
                <p className="nb-plan-claim is-strong">{pos.territory.name}</p>
                <ClaimText c={pos.territory.rationale} />
              </Mini>
            )}
            {claims(pos.audience).length > 0 && <Mini title="Who you speak to" icon={<Users {...ICON} />} tone="lilac">{claims(pos.audience).map((c, i) => <ClaimText key={i} c={c} />)}</Mini>}
          </div>
          {claims(p.whereToday).length > 0 && (
            <>
              <h3 className="nb-plan-dsub">Where you are today</h3>
              <ul className="nb-plan-notes">{claims(p.whereToday).map((c, i) => <li key={i}><MapPin aria-hidden className="nb-plan-i" /><span>{c.text}<TagChip tag={c.tag} /></span></li>)}</ul>
            </>
          )}
          {Array.isArray(p.competitors) && p.competitors.some((c: any) => c && c.name) && (
            <>
              <h3 className="nb-plan-dsub">Others in your space</h3>
              <ul className="nb-plan-rivals">
                {p.competitors.filter((c: any) => c && c.name).map((c: any, i: number) => (
                  <li key={i}>
                    <span className="nb-plan-avatar" data-tone={['coral', 'teal', 'lilac', 'sage'][i % 4]} aria-hidden="true">{initialsOf(c.name)}</span>
                    <div><p className="nb-plan-claim is-strong">{c.name}</p>{claims(c.observations).map((o, j) => <ClaimText key={j} c={o} />)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>,
      );
    } else if (s.id === 'customer') {
      const icp = p.icp || {};
      const parts: Array<[string, Claim[], React.ReactNode, string]> = [
        ['Who they are', claims(icp.who), <Users {...ICON} />, 'teal'],
        ['What bothers them', claims(icp.pains), <Frown {...ICON} />, 'coral'],
        ['Where they spend time', claims(icp.where), <MapPin {...ICON} />, 'sage'],
        ['What makes them buy', claims(icp.triggers), <Sparkles {...ICON} />, 'lilac'],
      ];
      cards.push(
        <Card key={s.id} id={s.id} title={s.title} icon={<Users {...ICON} />} tone="teal" index={idx}>
          <div className="nb-plan-quad">
            {parts.filter(([, v]) => v.length > 0).map(([label, v, icon, tone]) => (
              <Mini key={label} title={label} icon={icon} tone={tone}>{v.map((c, i) => <ClaimText key={i} c={c} />)}</Mini>
            ))}
          </div>
        </Card>,
      );
    } else if (s.id === 'channels') {
      cards.push(
        <Card key={s.id} id={s.id} title={s.title} icon={<MapPin {...ICON} />} tone="teal" index={idx}>
          <ul className="nb-plan-chcards">
            {channelNames.map((name) => {
              const row = rows.find((r) => r.channel === name);
              return (
                <li key={name}>
                  <div className="nb-plan-chcard-head"><PlatformMark platform={platformOf(name)} size={32} /><h3>{name}</h3></div>
                  <ClaimText c={roleOf(name)} />
                  {row && (
                    <>
                      <div className="nb-plan-chcard-split" role="img" aria-label={`${row.organicPct}% organic, ${row.paidPct}% paid`}>
                        <span className="nb-plan-bar" aria-hidden="true"><span style={{ width: `${row.organicPct}%` }} /></span>
                        <span aria-hidden="true">{row.organicPct}% organic, {row.paidPct}% paid</span>
                      </div>
                      <div className="nb-plan-who-cols">
                        <div><p className="nb-plan-who-h" data-who="us">Nebulaa does</p>
                          <p className="nb-plan-claim">{row.nebulaaDoes ? `Makes your ${row.nebulaaDoes}.` : 'Nothing here yet.'}</p></div>
                        <div><p className="nb-plan-who-h" data-who="you">You do</p>
                          {row.youDo.length
                            ? <ul className="nb-plan-checks">{row.youDo.map((t, i) => <li key={i}><Check aria-hidden className="nb-plan-i" />{t}</li>)}</ul>
                            : <p className="nb-plan-claim is-quiet">Nothing needed.</p>}</div>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>,
      );
    } else if (s.id === 'roadmap') {
      cards.push(
        <Card key={s.id} id={s.id} title={s.title} icon={<Flag {...ICON} />} tone="sage" index={idx}>
          <ol className="nb-plan-phasecards">
            {(p.roadmap || []).filter((r: any) => r && typeof r === 'object').map((r: any, i: number) => (
              <li key={i} data-tone={['sage', 'gold', 'coral'][i % 3]} className={r.phase && r.phase === now ? 'is-current' : ''}>
                <p className="nb-plan-phasecard-top"><span className="nb-plan-phasecard-n" aria-hidden="true">{i + 1}</span>{PHASE_TITLES[r.phase] || r.phase}{r.phase && r.phase === now && <span className="nb-plan-here">You are here</span>}</p>
                <ClaimText c={r.focus} className="nb-plan-claim is-strong" />
                {claims(r.actions).length > 0 && <><p className="nb-plan-dsub">Actions</p><ul className="nb-plan-checks">{claims(r.actions).map((c, j) => <li key={j}><Check aria-hidden className="nb-plan-i" /><span>{c.text}<TagChip tag={c.tag} /></span></li>)}</ul></>}
                {claims(r.measure).length > 0 && <><p className="nb-plan-dsub">How you will know</p><ul className="nb-plan-checks is-target">{claims(r.measure).map((c, j) => <li key={j}><Target aria-hidden className="nb-plan-i" /><span>{c.text}<TagChip tag={c.tag} /></span></li>)}</ul></>}
              </li>
            ))}
          </ol>
        </Card>,
      );
    } else if (s.id === 'mix') {
      const counts = new Map<string, number>();
      (p.calendar || []).forEach((c: any) => { if (c && c.format) counts.set(String(c.format), (counts.get(String(c.format)) || 0) + 1); });
      const shapes = new Map(shapeCounts(view.plan).map((x, i) => [x.shape, i]));
      cards.push(
        <Card key={s.id} id={s.id} title={s.title} icon={<Sparkles {...ICON} />} tone="coral" index={idx}>
          {counts.size > 0 && (
            <>
              <h3 className="nb-plan-dsub">What we will make</h3>
              <ul className="nb-plan-formats">{Array.from(counts.entries()).map(([f, n], i) => {
                const low = f.toLowerCase();
                const shape = /reel|video/.test(low) ? 'reel' : /carousel/.test(low) ? 'carousel' : /story/.test(low) ? 'story' : 'image';
                return <li key={f}><PostThumb shape={shape} tone={(shapes.get(shape) ?? i) + 1} /><span><b>{n}</b> {f}</span></li>;
              })}</ul>
            </>
          )}
          {Array.isArray(p.pillars) && p.pillars.some((pl: any) => pl && pl.name) && (
            <>
              <h3 className="nb-plan-dsub">What your posts talk about</h3>
              <ul className="nb-plan-pillarcards">{p.pillars.filter((pl: any) => pl && pl.name).map((pl: any, i: number) => (
                <li key={i} data-tone={['gold', 'coral', 'teal', 'sage', 'lilac'][i % 5]}><p className="nb-plan-claim is-strong">{pl.name}</p><ClaimText c={pl.why} /></li>
              ))}</ul>
            </>
          )}
        </Card>,
      );
    } else {
      cards.push(
        <Card key={s.id} id={s.id} title={s.title} icon={<Check {...ICON} />} tone="gold" index={idx}>
          <ol className="nb-plan-steps">{claims(p.firstSteps).map((c, i) => (
            <li key={i}><span className="nb-plan-step-n" aria-hidden="true">{i + 1}</span><p className="nb-plan-claim">{c.text}<TagChip tag={c.tag} /></p></li>
          ))}</ol>
        </Card>,
      );
    }
  });

  return (
    <>
      {cards.length > 0 && (
        <div className="nb-plan-detail-wrap">
          <header className="nb-plan-section-head">
            <div>
              <p className="nb-plan-eyebrow">Your plan in detail</p>
              <p className="nb-plan-lede">Everything the plan says, part by part, with how sure we are of each point.</p>
            </div>
          </header>
          <div className="nb-plan-dgrid-main">{cards}</div>
        </div>
      )}
      {showCompetitors && <CompetitorInsights />}
      {showListening && <ListeningCard lockedNote />}
    </>
  );
};

export default PlanDetails;
