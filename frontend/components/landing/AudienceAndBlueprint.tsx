import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { SinglePostArt } from '../art/SinglePost';
import { ProductArt } from '../art/Product';
import { CalendarArt } from '../art/Calendar';
import { CampaignArt } from '../art/Campaign';
import { BlueprintArt } from '../art/Blueprint';
import { BLUEPRINT_COPY } from '../../constants/blueprintCopy';
import { BUILT_FOR, type AudienceArt } from '../../constants/landingCopy';
import { GoldButton, SectionHead } from './LandingBits';

const ART: Record<AudienceArt, React.ReactNode> = { single: <SinglePostArt />, product: <ProductArt />, calendar: <CalendarArt />, campaign: <CampaignArt /> };

/** "Built for": four audience cards, one even row on a desktop. */
export const BuiltForSection: React.FC = () => (
  <section className="nb-land-section" id="built-for" aria-labelledby="built-title" style={{ paddingTop: 0 }}>
    <div className="nb-land-wrap">
      <SectionHead id="built-title" eyebrow={BUILT_FOR.eyebrow} title={BUILT_FOR.title} emphasis={BUILT_FOR.emphasis} />
      <ul className="nb-land-aud-grid">
        {BUILT_FOR.cards.map((c) => (
          <li key={c.title} className="nb-land-aud" data-tone={c.tone}>
            <div className="nb-land-aud-art" aria-hidden="true">{ART[c.art]}</div>
            <div className="nb-land-aud-body"><h3>{c.title}</h3><p>{c.text}</p></div>
          </li>
        ))}
      </ul>
    </div>
  </section>
);

const LEGEND_TINTS = ['#DDF2E6', '#DCEBFA', '#ECE6FB', '#FFE3D0'];

/** The free Brand Growth Blueprint. Every word comes from BLUEPRINT_COPY (shared with the Blueprint pages). */
export const BlueprintSection: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  const BP = BLUEPRINT_COPY.landing;
  return (
    <section className="nb-land-section" id="blueprint" aria-labelledby="blueprint-title" style={{ paddingTop: 0 }}>
      <div className="nb-land-wrap">
        <div className="nb-land-bp">
          <div>
            <p className="nb-land-eyebrow">{BP.eyebrow}</p>
            <h2 className="nb-land-h2" id="blueprint-title">{BP.headline}</h2>
            <p className="nb-land-lede">{BP.subline}</p>
            <ul>
              {BP.receive.map((line) => <li key={line}><CheckCircle2 size={17} aria-hidden="true" /><span>{line}</span></li>)}
            </ul>
            {/* BP.note ("It uses 7 of your Quarks.") is left out here: it is a typed Quark figure and reads against "free". */}
            <GoldButton onClick={onStart}>{BP.button}</GoldButton>
          </div>
          <div className="nb-land-bp-legend">
            <div className="nb-land-bp-legend-art" aria-hidden="true"><BlueprintArt /></div>
            <h3>{BP.legendTitle}</h3>
            <dl>
              {BP.legend.map((l, i) => (
                <div key={l.label}>
                  <dt><span style={{ background: LEGEND_TINTS[i % LEGEND_TINTS.length] }}>{l.label}</span></dt>
                  <dd>{l.meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
};
