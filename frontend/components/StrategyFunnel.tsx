import React, { useMemo, useState } from 'react';
import { ChevronDown, Eye, Flag, Globe, Heart, MessageCircle, Send, Star, Users } from 'lucide-react';
import { LEVEL_COPY, type LevelId, type LevelItem, type StrategyLevel } from '../utils/strategyLevels';
import { channelCards, initialsOf, mixSegments, pillarChips, planDay, shapeCounts } from '../utils/planVisuals';
import { ChipRow, LevelDetails, StatusChip, TagChip } from './plan/PlanBits';
import { MixDonut, RoadTimeline } from './plan/PlanCharts';
import { PlatformMark, PostThumb } from './plan/PlanMarks';
import { PlanShopArt } from './art/plan/Shop';
import { PlanProductsArt } from './art/plan/Products';
import { PlanPeopleArt } from './art/plan/People';
import { PlanSpeechArt } from './art/plan/Speech';
import { PlanMixArt } from './art/plan/Mix';
import { PlanMegaphoneArt } from './art/plan/Megaphone';
import { PlanPillarsArt } from './art/plan/Pillars';
import { PlanRoadArt } from './art/plan/Road';
import { PlanGaugeArt } from './art/plan/Gauge';

/**
 * The strategy as nine illustrated tiles, read in order: the business first, the numbers to watch last. Each tile has
 * its own small picture, a status in words, a drawn summary of the level (the mix donut, the channel marks, the pillar
 * chips, the 90-day timeline, the numbers) and the full details opened in place. Every number comes from the stored plan.
 */

const ART: Record<LevelId, React.FC> = {
  business: PlanShopArt, products: PlanProductsArt, customers: PlanPeopleArt, positioning: PlanSpeechArt, mix: PlanMixArt,
  channels: PlanMegaphoneArt, content: PlanPillarsArt, roadmap: PlanRoadArt, numbers: PlanGaugeArt,
};
const TONE: Record<LevelId, string> = {
  business: 'gold', products: 'coral', customers: 'teal', positioning: 'gold', mix: 'lilac', channels: 'teal', content: 'coral', roadmap: 'sage', numbers: 'lilac',
};
const SPAN: Partial<Record<LevelId, number>> = { positioning: 2, channels: 2, roadmap: 3, numbers: 3 };
const CUSTOMER_TONE: Record<string, string> = { 'Who they are': 'teal', 'What bothers them': 'coral', 'Where they spend time': 'sage', 'What makes them buy': 'lilac', 'Who you speak to': 'teal' };
const KPI_ICON: Record<string, React.FC<{ 'aria-hidden'?: boolean }>> = {
  Reach: Eye, Engagement: Heart, Followers: Users, 'Posts published': Send, Enquiries: MessageCircle, Reviews: Star, 'Website visits': Globe,
};
const SHAPE_WORD: Record<string, [string, string]> = { image: ['image post', 'image posts'], carousel: ['carousel', 'carousels'], reel: ['reel', 'reels'], story: ['story', 'stories'] };

interface Ctx { plan: unknown; now: Date }

const labelCounts = (items: LevelItem[]): Array<[string, number]> => {
  const m = new Map<string, number>();
  items.forEach((it) => { if (it.label) m.set(it.label, (m.get(it.label) || 0) + 1); });
  return Array.from(m.entries());
};

/** The drawn part of each tile. Only shown when the level has something; a missing level shows its plain note instead. */
const Visual: React.FC<{ level: StrategyLevel; ctx: Ctx }> = ({ level, ctx }) => {
  const { items } = level;
  switch (level.id) {
    case 'business': {
      const rivals = items.find((i) => i.label === 'Others in your space');
      const names = rivals ? rivals.text.replace(/ and \d+ more$/, '').split(/, | and /).filter(Boolean) : [];
      const today = items.filter((i) => i.label === 'Where you are today').length;
      return (
        <div className="nb-plan-facts">
          {today > 0 && <span className="nb-plan-fact"><b>{today}</b> {today === 1 ? 'note' : 'notes'} on where you are today</span>}
          {names.length > 0 && (
            <span className="nb-plan-fact">
              <span className="nb-plan-avatars" aria-hidden="true">{names.slice(0, 3).map((n, i) => <i key={i} data-tone={['coral', 'teal', 'lilac'][i]}>{initialsOf(n)}</i>)}</span>
              <span>Others in your space: {rivals!.text}</span>
            </span>
          )}
        </div>
      );
    }
    case 'products':
      return <ChipRow items={items.map((i) => i.text.replace(/ \([^)]*\)$/, ''))} max={4} tone="coral" label="What you sell" />;
    case 'customers': {
      const parts = labelCounts(items);
      return (
        <ul className="nb-plan-chips" aria-label="What the plan knows about your customers">
          {parts.map(([label, n]) => <li key={label} data-tone={CUSTOMER_TONE[label] || 'teal'}>{label}<b>{n}</b></li>)}
        </ul>
      );
    }
    case 'positioning': {
      const msg = items.find((i) => i.label === 'Your message');
      const stand = items.find((i) => i.label === 'Where you can stand out');
      const why = items.find((i) => i.label === 'Why it fits');
      const risk = items.find((i) => i.label === 'Watch out for');
      return (
        <div className="nb-plan-bubble-wrap">
          <div className="nb-plan-bubble-side">
            {msg && <blockquote className="nb-plan-bubble"><p>{msg.text}</p><TagChip tag={msg.tag} /></blockquote>}
            {stand && <p className="nb-plan-stand"><span>Where you can stand out</span>{stand.text}</p>}
          </div>
          {(why || risk) && (
            <div className="nb-plan-bubble-side">
              {why && <div className="nb-plan-mini" data-tone="sage"><h4 className="nb-plan-mini-h">Why it fits</h4><p>{why.text}<TagChip tag={why.tag} /></p></div>}
              {risk && <div className="nb-plan-mini" data-tone="coral"><h4 className="nb-plan-mini-h">Watch out for</h4><p>{risk.text}<TagChip tag={risk.tag} /></p></div>}
            </div>
          )}
        </div>
      );
    }
    case 'mix': {
      const mix = mixSegments(ctx.plan);
      return <MixDonut mix={mix} />;
    }
    case 'channels': {
      const cards = channelCards(ctx.plan);
      if (!cards.length) return null;
      return (
        <ul className="nb-plan-chan">
          {cards.slice(0, 5).map((c) => (
            <li key={c.name}>
              <PlatformMark platform={c.platform} />
              <span className="nb-plan-chan-name">{c.name}</span>
              <span className="nb-plan-chan-who">
                {c.offline && <span className="nb-plan-who" data-who="you">Offline, yours</span>}
                {!c.offline && c.makes.length > 0 && <span className="nb-plan-who" data-who="us">Nebulaa makes {c.makes.length === 1 ? c.makes[0] : `${c.makes[0]} and ${c.makes.length - 1} more`}</span>}
                {c.youDo > 0 && <span className="nb-plan-who" data-who="you">You: {c.youDo} {c.youDo === 1 ? 'task' : 'tasks'}</span>}
              </span>
              {c.organic !== null && (
                <span className="nb-plan-chan-split" title={`${c.organic}% organic, ${100 - c.organic}% paid`}>
                  <span className="nb-plan-bar" aria-hidden="true"><span style={{ width: `${c.organic}%` }} /></span>
                  <span>{c.organic}% organic</span>
                </span>
              )}
            </li>
          ))}
          {cards.length > 5 && <li className="nb-plan-chan-more">and {cards.length - 5} more in the details</li>}
        </ul>
      );
    }
    case 'content': {
      const chips = pillarChips(ctx.plan);
      const shapes = shapeCounts(ctx.plan);
      return (
        <>
          {chips.length > 0 && (
            <ul className="nb-plan-pillars" aria-label="Content pillars">
              {chips.slice(0, 5).map((c) => <li key={c.name} data-tone={['gold', 'coral', 'teal', 'sage', 'lilac'][c.tone]}><span className="nb-plan-pillar-dot" aria-hidden="true" />{c.name}{c.posts > 0 && <b>{c.posts}</b>}</li>)}
            </ul>
          )}
          {shapes.length > 0 && (
            <ul className="nb-plan-thumbs" aria-label="This month's posts">
              {shapes.map((s, i) => (
                <li key={s.shape}><PostThumb shape={s.shape} tone={i + 1} /><span><b>{s.count}</b> {SHAPE_WORD[s.shape][s.count === 1 ? 0 : 1]}</span></li>
              ))}
            </ul>
          )}
        </>
      );
    }
    case 'roadmap': {
      const run: any = ctx.plan;
      return <RoadTimeline phases={items} day={planDay(run?.completedAt ?? run?.plan?.completedAt, ctx.now)} />;
    }
    case 'numbers':
      return (
        <ul className="nb-plan-kpis">
          {items.map((it, i) => {
            const Icon = KPI_ICON[String(it.label)] || Flag;
            const live = /connected accounts/.test(it.text);
            const metric = !!KPI_ICON[String(it.label)];
            return (
              <li key={i} data-tone={metric ? (live ? 'teal' : 'gold') : ['sage', 'gold', 'coral'][i % 3]}>
                <span className="nb-plan-kpi-icon"><Icon aria-hidden /></span>
                <span className="nb-plan-kpi-label">{it.label}</span>
                <span className="nb-plan-kpi-text">{metric ? (live ? 'Read from your accounts' : 'You track this') : it.text}</span>
                {!metric && it.bullets && it.bullets.length > 0 && <span className="nb-plan-kpi-more">and {it.bullets.length} more {it.bullets.length === 1 ? 'sign' : 'signs'}</span>}
              </li>
            );
          })}
        </ul>
      );
    default:
      return null;
  }
};

/** Tiles whose drawing already says what the summary says do not repeat it. */
const HIDE_SUMMARY = new Set<LevelId>(['products', 'positioning', 'mix', 'channels', 'roadmap', 'numbers']);

const LevelTile: React.FC<{ level: StrategyLevel; index: number; open: boolean; onToggle: () => void; ctx: Ctx }> = ({ level, index, open, onToggle, ctx }) => {
  const Art = ART[level.id];
  const missing = level.status === 'missing';
  const panelId = `funnel-panel-${level.id}`;
  const showSummary = missing || !HIDE_SUMMARY.has(level.id);
  return (
    <li className="nb-plan-tile nb-plan-in" data-tone={TONE[level.id]} data-status={level.status} data-span={missing ? 1 : SPAN[level.id] || 1} style={{ ['--i' as any]: index }}>
      <div className="nb-plan-tile-head">
        <span className="nb-plan-tile-art"><Art /></span>
        <div className="nb-plan-tile-titles">
          <span className="nb-plan-num" aria-hidden="true">{String(level.n).padStart(2, '0')}</span>
          <h3 id={`funnel-h-${level.id}`}>{level.title}</h3>
          <StatusChip status={level.status} />
        </div>
      </div>
      {showSummary && <p className="nb-plan-tile-sum" title={level.summary}>{level.summary}</p>}
      {!missing && <div className="nb-plan-tile-visual"><Visual level={level} ctx={ctx} /></div>}
      <button type="button" className="nb-plan-toggle" onClick={onToggle} aria-expanded={open} aria-controls={panelId} aria-describedby={`funnel-h-${level.id}`}>
        {open ? 'Hide details' : missing ? 'Why it is empty' : 'Show details'}<ChevronDown aria-hidden />
      </button>
      {open && <LevelDetails level={level} id={panelId} />}
    </li>
  );
};

const StrategyFunnel: React.FC<{ levels: StrategyLevel[]; plan?: unknown; now?: Date }> = ({ levels, plan, now }) => {
  const [open, setOpen] = useState<Set<LevelId>>(() => new Set());
  const toggle = (id: LevelId) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOpen = open.size === levels.length;
  const ctx = useMemo<Ctx>(() => ({ plan, now: now || new Date() }), [plan, now]);
  return (
    <section aria-labelledby="funnel-h" className="nb-plan-strategy">
      <header className="nb-plan-section-head">
        <div>
          <p className="nb-plan-eyebrow">Your strategy</p>
          <h2 id="funnel-h">From your business to the numbers</h2>
          <p className="nb-plan-lede">Nine parts, in order. Open any of them to see the details.</p>
        </div>
        <div className="nb-plan-section-tools">
          <button type="button" className="nb-plan-textbtn" onClick={() => setOpen(allOpen ? new Set() : new Set(levels.map((l) => l.id)))}>{allOpen ? 'Close all' : 'Open all'}</button>
        </div>
      </header>
      <ol className="nb-plan-grid">
        {levels.map((l, i) => <LevelTile key={l.id} level={l} index={i} open={open.has(l.id)} onToggle={() => toggle(l.id)} ctx={ctx} />)}
      </ol>
    </section>
  );
};

/** Before there is a plan: the nine parts it will cover, as small quiet tiles, so the page shows what is coming. */
export const PlanPreview: React.FC<{ title: string }> = ({ title }) => (
  <section className="nb-plan-preview nb-plan-in" aria-label={title} style={{ ['--i' as any]: 2 }}>
    <p className="nb-plan-eyebrow">{title}</p>
    <ol>
      {(Object.keys(ART) as LevelId[]).map((id, i) => {
        const Art = ART[id];
        return <li key={id} data-tone={TONE[id]}><span className="nb-plan-preview-art"><Art /></span><span><small>{String(i + 1).padStart(2, '0')}</small>{LEVEL_COPY[id].title}</span></li>;
      })}
    </ol>
  </section>
);

export default StrategyFunnel;
