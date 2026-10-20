import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NAV_COPY, NAV_LINKS } from '../../constants/landingCopy';
import { GoldButton, SectionLink } from './LandingBits';

/** Sticky top bar: logo, section links (desktop), Sign in and the gold sign-up button; a menu sheet on a phone. */
const LandingNav: React.FC<{ solid: boolean; startLabel: string; onSignUp: () => void; onSignIn: () => void }> = ({ solid, startLabel, onSignUp, onSignIn }) => {
  const [open, setOpen] = useState(false);
  return (
    <nav className="nb-land-nav" data-solid={solid || open ? '' : undefined} data-open={open ? '' : undefined} aria-label="Main">
      <div className="nb-land-wrap">
        <div className="nb-land-nav-row">
          <a href="/" className="nb-land-logo" aria-label={NAV_COPY.home}>
            <img src="/assets/logo-nebulaa.png" alt="Nebulaa" width={96} height={44} />
          </a>
          <ul className="nb-land-links">
            {NAV_LINKS.map((l) => <li key={l.id}><SectionLink id={l.id}>{l.label}</SectionLink></li>)}
          </ul>
          <div className="nb-land-nav-cta">
            <button type="button" className="nb-land-signin" onClick={onSignIn}>{NAV_COPY.signIn}</button>
            <GoldButton size="sm" onClick={onSignUp} arrow={false}>{startLabel}</GoldButton>
            <button
              type="button" className="nb-land-menu-btn" onClick={() => setOpen((o) => !o)}
              aria-expanded={open} aria-controls="nb-land-sheet" aria-label={open ? NAV_COPY.menuClose : NAV_COPY.menuOpen}
            >
              {open ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {open && (
          <div className="nb-land-sheet" id="nb-land-sheet">
            {NAV_LINKS.map((l) => <SectionLink key={l.id} id={l.id} onDone={() => setOpen(false)}>{l.label}</SectionLink>)}
            <div className="nb-land-sheet-actions">
              <button type="button" className="nb-land-btn" data-kind="outline" onClick={onSignIn}>{NAV_COPY.signIn}</button>
              <GoldButton onClick={onSignUp} arrow={false}>{startLabel}</GoldButton>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default LandingNav;
