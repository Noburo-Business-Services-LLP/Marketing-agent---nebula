import React from 'react';
import { Eye, CalendarCheck, MessageSquareText } from 'lucide-react';
import { APPROVAL, INBOX_LINES_VISIBLE } from '../../constants/landingCopy';

const POINT_ICONS = [Eye, CalendarCheck, MessageSquareText];

/** Glow band 2: you stay in charge, how approval works, as a warm gold card (no dark panel). */
export const ApprovalBand: React.FC = () => {
  const points = APPROVAL.points.filter((p) => INBOX_LINES_VISIBLE || !p.inbox);
  return (
    <section className="nb-land-section" id="approval" aria-labelledby="approval-title" style={{ paddingTop: 0 }}>
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
