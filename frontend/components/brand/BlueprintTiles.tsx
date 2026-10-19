import React from 'react';
import { blueprintFormTiles, blueprintPartTiles, tileSpans, type FormLike } from '../../utils/brandTiles';
import { StatusTileCard, StatusTileGrid, type StatusTileCardProps } from './StatusTiles';
import { BrandGlobeArt } from '../art/brand/Globe';
import { BrandTargetArt } from '../art/brand/Target';
import { BrandBinocularsArt } from '../art/brand/Binoculars';
import { BrandMonthArt } from '../art/brand/Month';
import { BrandChecklistArt } from '../art/brand/Checklist';
import { PlanShopArt } from '../art/plan/Shop';
import { PlanMixArt } from '../art/plan/Mix';
import { PlanPeopleArt } from '../art/plan/People';
import { PlanPillarsArt } from '../art/plan/Pillars';
import { PlanProductsArt } from '../art/plan/Products';
import { PlanMegaphoneArt } from '../art/plan/Megaphone';
import { PlanRoadArt } from '../art/plan/Road';
import { PlanSpeechArt } from '../art/plan/Speech';

type Tone = StatusTileCardProps['tone'];

const FORM_ART: Record<string, [React.ReactNode, Tone]> = {
  business: [<PlanShopArt />, 'gold'], online: [<BrandGlobeArt />, 'blue'], goal: [<BrandTargetArt />, 'coral'], extras: [<PlanMixArt />, 'lilac'],
};

/** Four compact tiles above the Blueprint form: what has been filled in, from the live form. A tile moves to the first gap. */
export const BlueprintFormTiles: React.FC<{ form: FormLike; onGo: (field: string) => void }> = ({ form, onGo }) => {
  const tiles = blueprintFormTiles(form);
  return (
    <StatusTileGrid label="Your answers so far" wide={4} dense>
      {tiles.map((t, i) => (
        <StatusTileCard key={t.key} dataKey={t.key} index={i} title={t.title} status={t.status} state={t.state} line={t.line}
          art={FORM_ART[t.key][0]} tone={FORM_ART[t.key][1]} onClick={() => onGo(t.field)} />
      ))}
    </StatusTileGrid>
  );
};

const PART_ART: Record<string, [React.ReactNode, Tone]> = {
  'where-today': [<PlanShopArt />, 'gold'],
  'audience-positioning': [<PlanPeopleArt />, 'teal'],
  'competitor-read': [<BrandBinocularsArt />, 'coral'],
  'content-pillars': [<PlanPillarsArt />, 'lilac'],
  'calendar-preview': [<BrandMonthArt />, 'teal'],
  'offers-hooks': [<PlanProductsArt />, 'pink'],
  'channel-plan': [<PlanMegaphoneArt />, 'blue'],
  'roadmap-90': [<PlanRoadArt />, 'sage'],
  'first-steps': [<BrandChecklistArt />, 'sage'],
};

/** One tile per page of the finished Blueprint; a tile scrolls to its page. */
export const BlueprintPartTiles: React.FC<{ result: any }> = ({ result }) => {
  const tiles = blueprintPartTiles(result);
  if (!tiles.length) return null;
  const s3 = tileSpans(tiles.length, 3);
  const s2 = tileSpans(tiles.length, 2);
  const go = (id: string) => {
    const el = document.querySelector(`[data-page="${id}"]`) as HTMLElement | null;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    const h = el.querySelector('h2') as HTMLElement | null;
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  };
  return (
    <section className="bp-noprint nb-brand-glance" aria-labelledby="bp-parts-h">
      <div className="nb-brand-glance-head">
        <h2 id="bp-parts-h">What is in your Blueprint</h2>
        <p>{tiles.length} {tiles.length === 1 ? 'page' : 'pages'}. Open a tile to go to that page.</p>
      </div>
      <StatusTileGrid label="What is in your Blueprint" wide={3}>
        {tiles.map((t, i) => {
          const [art, tone] = PART_ART[t.id] || [<PlanSpeechArt />, 'gold' as Tone];
          return (
            <StatusTileCard key={t.id} dataKey={t.id} index={i} title={t.title} status={t.status} state={t.state} line={t.line}
              art={art} tone={tone} span3={s3[i]} span2={s2[i]} onClick={() => go(t.id)} />
          );
        })}
      </StatusTileGrid>
    </section>
  );
};
