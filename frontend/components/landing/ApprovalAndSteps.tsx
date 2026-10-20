import React from 'react';
import { Eye, CalendarCheck, MessageSquareText } from 'lucide-react';
import { APPROVAL, HOW, INBOX_LINES_VISIBLE } from '../../constants/landingCopy';
import { GoldButton, SectionHead } from './LandingBits';

const POINT_ICONS = [Eye, CalendarCheck, MessageSquareText];

/** Glow band 2: how approval works, as a warm gold card (no dark panel). */
export const ApprovalBand: React.FC = () => {
  const points = APPROVAL.points.filter((p) => INBOX_LINES_VISIBLE || !p.inbox);
  return (
    <section className="nb-land-section" id="approval" aria-labelledby="approval-title">
      <div className="nb-land-wrap">
        <div className="nb-land-gold nb-land-approval">
          <div>
            <p className="nb-land-eyebrow">{APPROVAL.eyebrow}</p>
            <h2 className="nb-land-h2" id="approval-title">{APPROVAL.title} <span className="nb-land-em">{APPROVAL.emphasis}</span></h2>
          </div>
          <ul className="nb-land-points">
            {points.map((p, i) => {
              const Icon = POINT_ICONS[i] || Eye;
              return (
                <li key={p.title} className="nb-land-point">
                  <span className="nb-land-point-mark" aria-hidden="true"><Icon size={19} strokeWidth={2.2} /></span>
                  <div><h3>{p.title}</h3><p>{p.text}</p></div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
};

/** The seven real steps, then a start card so both desktop rows of four are full. */
export const HowSection: React.FC<{ startLabel: string; onSignUp: () => void }> = ({ startLabel, onSignUp }) => {
  const steps = HOW.steps.filter((s) => INBOX_LINES_VISIBLE || !s.inbox);
  // The start card widens to close the last row (four columns on a desktop, two on a tablet).
  const fill = (cols: number) => { const rem = (steps.length + 1) % cols; return rem === 0 ? 1 : 1 + cols - rem; };
  const ctaStyle = { '--span4': fill(4), '--span2': fill(2) } as React.CSSProperties;
  return (
    <section className="nb-land-section" id="how" aria-labelledby="how-title">
      <div className="nb-land-wrap">
        <SectionHead id="how-title" eyebrow={HOW.eyebrow} title={HOW.title} emphasis={HOW.emphasis} />
        <ol className="nb-land-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="nb-land-step">
              <div className="nb-land-step-top">
                <span className="nb-land-step-num" aria-hidden="true">{i + 1}</span>
                {s.addon && <span className="nb-land-chip">{HOW.addon}</span>}
              </div>
              <h3><span className="sr-only">{`Step ${i + 1}: `}</span>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
          <li className="nb-land-step nb-land-gold" data-cta="" style={ctaStyle}>
            <div>
              <h3>{HOW.cta.title}</h3>
              <p style={{ marginTop: 8 }}>{HOW.cta.text}</p>
            </div>
            <GoldButton onClick={onSignUp} full>{startLabel}</GoldButton>
          </li>
        </ol>
      </div>
    </section>
  );
};
