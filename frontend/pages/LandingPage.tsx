import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { BLUEPRINT_SIGNUP_PATH } from '../utils/blueprint';
import { PLANS_SNAPSHOT, factsFrom, type LandingFacts } from '../utils/landingPlans';
import { LANDING_META, LANDING_ROUTES, startLabel } from '../constants/landingCopy';
import LandingNav from '../components/landing/LandingNav';
import LandingHero from '../components/landing/LandingHero';
import ExamplesSection from '../components/landing/ExamplesSection';
import MakeSection from '../components/landing/MakeSection';
import { ApprovalBand, HowSection } from '../components/landing/ApprovalAndSteps';
import { BuiltForSection, BlueprintSection } from '../components/landing/AudienceAndBlueprint';
import { PlansSection, FaqSection } from '../components/landing/PlansAndFaq';
import { ClosingBand, LandingFooter } from '../components/landing/ClosingAndFooter';
import { GoldButton } from '../components/landing/LandingBits';
import '../components/landing/landing.css';

/**
 * The public page for visitors (route "/", logged out). Everything leads to one action: sign up and choose a plan.
 * Proof first (example posts, what you can make), then how approval works, the seven steps, who it is for, the free
 * Blueprint, plans (from the public plans answer), questions, and a closing call. Words: constants/landingCopy.ts.
 * Legal pages in the footer through LegalLinks (Terms, Privacy, Refunds). Sign-up, the invitation code and the bot
 * check stay on the sign-up page (pages/Auth.tsx); this page only links to it.
 */
const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [facts, setFacts] = useState<LandingFacts>(PLANS_SNAPSHOT);
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);

  // Live prices from the server; the checked snapshot stays if the answer is missing or incomplete.
  useEffect(() => {
    let live = true;
    apiService.getPlans().then((res) => { const f = factsFrom(res); if (live && f) setFacts(f); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setScrolled(window.scrollY > 16);
        setPastHero(window.scrollY > 560);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, []);

  // Title and description while the page is shown; the previous values come back when it unmounts.
  useEffect(() => {
    const previous = document.title;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const created = !meta;
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    const prevDesc = meta.content;
    document.title = LANDING_META.title;
    meta.content = LANDING_META.description;
    return () => {
      document.title = previous;
      if (created) meta?.remove(); else if (meta) meta.content = prevDesc;
    };
  }, []);

  const signUp = () => navigate(LANDING_ROUTES.signUp);
  const signIn = () => navigate(LANDING_ROUTES.signIn);
  const signUpBlueprint = () => navigate(BLUEPRINT_SIGNUP_PATH);
  const start = startLabel(facts);

  return (
    <div className="nb-land">
      <LandingNav solid={scrolled} startLabel={start} onSignUp={signUp} onSignIn={signIn} />
      <main>
        <LandingHero startLabel={start} onSignUp={signUp} />
        <ExamplesSection />
        <MakeSection />
        <ApprovalBand />
        <HowSection startLabel={start} onSignUp={signUp} />
        <BuiltForSection />
        <BlueprintSection onStart={signUpBlueprint} />
        <PlansSection facts={facts} onChoose={signUp} />
        <FaqSection facts={facts} />
        <ClosingBand startLabel={start} onSignUp={signUp} onSignIn={signIn} />
      </main>
      <LandingFooter />
      {pastHero && (
        <div className="nb-land-bar">
          <GoldButton onClick={signUp} full>{start}</GoldButton>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
