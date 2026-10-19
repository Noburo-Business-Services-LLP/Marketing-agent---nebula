import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Mail, Zap } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { TOUR_REPLAY_EVENT } from '../components/HelpMenu';
import { apiService } from '../services/api';
import { SUPPORT_EMAIL } from '../constants/legal';
import { shouldAutoStart } from '../utils/tour';
import { HELP_ANSWERS, QUARKS_HELP_LINK } from '../utils/help';
import type { User } from '../types';
import '../components/help/help.css';

/**
 * Help (Setup > Help in the menu, /help): take the tour again, quick answers, how Quarks work and how to reach
 * support. Tiles in one row share a height (symmetry rule, docs/superpowers/ops/tile-system.md).
 */
const Help: React.FC<{ user?: User | null }> = ({ user }) => {
  const hasCsmPass = (() => { try { return Boolean(localStorage.getItem('csmReturnToken')); } catch { return false; } })();
  // The tour is for a business's own account (the same rule the "?" menu uses); staff and people acting for a client do not see it.
  const canTour = shouldAutoStart({ user: user ? ({ ...user, tour: null } as any) : null, path: '/dashboard', hasCsmPass });
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('');

  const replayTour = () => {
    apiService.saveTour('replay');
    window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT));
  };
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(SUPPORT_EMAIL); setCopied('done'); } catch { setCopied('failed'); }
  };

  return (
    <div className="w-full pb-8">
      <PageHeader
        eyebrow="Help"
        title="How can we"
        emphasis="help?"
        description="Take the tour again, find a quick answer, or write to us."
      />

      <ul className="nb-help-row" aria-label="Help">
        {canTour && (
          <li className="nb-help-tile" data-accent="plan">
            <span className="nb-help-ico" aria-hidden="true"><Compass className="w-5 h-5" /></span>
            <h2 className="nb-help-title">Take the tour again</h2>
            <p className="nb-help-text">A short walk through the menu: Create, Library, Plan and where help is.</p>
            <button type="button" className="nb-help-btn" data-primary="true" onClick={replayTour}>Start the tour</button>
          </li>
        )}
        <li className="nb-help-tile" data-accent="create">
          <span className="nb-help-ico" aria-hidden="true"><Zap className="w-5 h-5" /></span>
          <h2 className="nb-help-title">How Quarks work</h2>
          <p className="nb-help-text">Quarks pay for what Nebulaa makes. The Billing tab in Settings lists the price of every post, carousel, video and photo, and what is free.</p>
          <Link to={QUARKS_HELP_LINK} className="nb-help-btn" data-primary={canTour ? undefined : 'true'}>See what things cost</Link>
        </li>
        <li className="nb-help-tile" data-accent="inbox">
          <span className="nb-help-ico" aria-hidden="true"><Mail className="w-5 h-5" /></span>
          <h2 className="nb-help-title">Contact support</h2>
          <p className="nb-help-text">Write to us at <strong className="nb-help-mail">{SUPPORT_EMAIL}</strong>. Tell us what you were doing and what you saw.</p>
          <div className="nb-help-actions">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="nb-help-btn">Write to us</a>
            <button type="button" className="nb-help-btn" onClick={copyAddress}>Copy the address</button>
          </div>
          <p className="nb-help-status" role="status">{copied === 'done' ? 'The address is copied.' : copied === 'failed' ? 'Copying did not work here. Please select the address above.' : ''}</p>
        </li>
      </ul>

      <section className="nb-help-faq" aria-labelledby="nb-help-faq-title">
        <h2 id="nb-help-faq-title" className="nb-help-h2">Quick answers</h2>
        <ul className="nb-help-faq-grid">
          {HELP_ANSWERS.map((a) => (
            <li key={a.id} className="nb-help-answer">
              <h3 className="nb-help-q">{a.question}</h3>
              <p className="nb-help-a">{a.answer}</p>
              {a.link && <Link to={a.link.to} className="nb-help-link">{a.link.label}</Link>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default Help;
