import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { HERO } from '../../constants/landingCopy';
import { GoldButton, SectionLink } from './LandingBits';
import PhoneMock from './PhoneMock';

/** Glow band 1: the headline, two actions, the approval promise and the phone mock. */
const LandingHero: React.FC<{ startLabel: string; onSignUp: () => void }> = ({ startLabel, onSignUp }) => (
  <section className="nb-land-hero" aria-labelledby="hero-title">
    <div className="nb-land-wrap nb-land-hero-grid">
      <div>
        <p className="nb-land-eyebrow nb-land-rise">{HERO.eyebrow}</p>
        <h1 className="nb-land-h1 nb-land-rise" data-d="1" id="hero-title">
          {HERO.title} <span className="nb-land-em">{HERO.emphasis}</span>
        </h1>
        <p className="nb-land-hero-line nb-land-rise" data-d="2">{HERO.line}</p>
        <div className="nb-land-hero-ctas nb-land-rise" data-d="3">
          <GoldButton onClick={onSignUp}>{startLabel}</GoldButton>
          <SectionLink id="make" className="nb-land-btn" kind="outline">{HERO.secondary}</SectionLink>
        </div>
        <p className="nb-land-promise"><ShieldCheck size={18} strokeWidth={2.4} aria-hidden="true" />{HERO.promise}</p>
        <p className="nb-land-experience">{HERO.experience}</p>
      </div>
      <PhoneMock />
    </div>
  </section>
);

export default LandingHero;
