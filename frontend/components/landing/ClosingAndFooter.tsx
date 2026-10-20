import React from 'react';
import LegalLinks from '../LegalLinks';
import { SUPPORT_EMAIL } from '../../constants/legal';
import { CLOSING, FOOTER, NAV_COPY, NAV_LINKS } from '../../constants/landingCopy';
import { GoldButton, SectionLink } from './LandingBits';

/** Glow band 3: the last call to action. */
export const ClosingBand: React.FC<{ startLabel: string; onSignUp: () => void; onSignIn: () => void }> = ({ startLabel, onSignUp, onSignIn }) => (
  <section className="nb-land-section" aria-labelledby="closing-title" style={{ paddingTop: 0 }}>
    <div className="nb-land-wrap">
      <div className="nb-land-gold nb-land-closing">
        <h2 className="nb-land-h2" id="closing-title">{CLOSING.title} <span className="nb-land-em">{CLOSING.emphasis}</span></h2>
        <p className="nb-land-lede">{CLOSING.line}</p>
        <GoldButton onClick={onSignUp}>{startLabel}</GoldButton>
        <p className="nb-land-closing-sub">
          {CLOSING.haveAccount}{' '}
          <button type="button" className="nb-land-linkbtn" onClick={onSignIn}>{NAV_COPY.signIn}</button>
        </p>
      </div>
    </div>
  </section>
);

/** Footer: logo, section links, the legal pages, contact, and the giant gold wordmark. */
export const LandingFooter: React.FC = () => (
  <footer className="nb-land-footer">
    <div className="nb-land-wrap">
      <div className="nb-land-foot-row">
        <img src="/assets/logo-nebulaa.png" alt="Nebulaa" width={87} height={40} loading="lazy" decoding="async" style={{ height: 40, width: "auto" }} />
        <ul className="nb-land-foot-links">
          {NAV_LINKS.map((l) => <li key={l.id}><SectionLink id={l.id}>{l.label}</SectionLink></li>)}
        </ul>
        <LegalLinks className="nb-land-foot-legal" linkClassName="" />
      </div>
      <div className="nb-land-foot-meta">
        <span>{FOOTER.rights(new Date().getFullYear())}</span>
        <span>{FOOTER.contact}: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></span>
      </div>
      <span className="nb-land-wordmark" aria-hidden="true">{FOOTER.wordmark}</span>
    </div>
  </footer>
);
