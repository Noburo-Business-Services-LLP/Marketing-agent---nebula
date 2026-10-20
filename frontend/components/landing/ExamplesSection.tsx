import React from 'react';
import { SHOWCASE_SLIDES } from '../onboarding/showcaseData';
import { EXAMPLES } from '../../constants/landingCopy';
import { SectionHead } from './LandingBits';

/** One post per kind of business, from the showcase set already in the repo (public/assets/showcase). */
const KINDS = ['Hotels & stays', 'Jewellery & retail', 'Food & FMCG', 'Textiles & apparel', 'Real estate', 'Furniture & appliances', 'Automobiles', 'Financial services'];
export const EXAMPLE_POSTS = KINDS.map((k) => SHOWCASE_SLIDES.find((s) => s.label === k)).filter((s): s is NonNullable<typeof s> => Boolean(s));

const label = (k: string) => k.replace('&', 'and');

/** Proof first: example posts, each clearly marked "Example", lazy and with a fixed size. */
const ExamplesSection: React.FC = () => (
  <section className="nb-land-section" id="examples" aria-labelledby="examples-title">
    <div className="nb-land-wrap">
      <SectionHead id="examples-title" eyebrow={EXAMPLES.eyebrow} title={EXAMPLES.title} emphasis={EXAMPLES.emphasis} line={EXAMPLES.line} />
      <ul className="nb-land-examples">
        {EXAMPLE_POSTS.map((s) => (
          <li key={s.src}>
            <figure className="nb-land-example">
              <div className="nb-land-example-pic">
                <img src={s.src} alt={EXAMPLES.alt(label(s.label))} width={900} height={900} loading="lazy" decoding="async" />
                <span className="nb-land-example-chip" aria-hidden="true">{EXAMPLES.chip}</span>
              </div>
              <figcaption>{label(s.label)}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </div>
  </section>
);

export default ExamplesSection;
