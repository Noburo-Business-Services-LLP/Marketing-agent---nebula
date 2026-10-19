import React from 'react';
import { InboxStepFrame } from './Frame';

/** Google reviews: a small review card with five gold stars and a reply line; the last star pops now and then. */
export const ReviewStarsArt: React.FC = () => {
  const star = 'M0-4.6 1.4-1.5 4.6-1.2 2.2 1 2.9 4.2 0 2.5-2.9 4.2-2.2 1-4.6-1.2-1.4-1.5z';
  return (
    <InboxStepFrame tint="#DDF2E6">
      <rect x="10" y="14" width="44" height="28" rx="6" fill="#FFFDF8" stroke="#22603A" strokeOpacity=".35" strokeWidth="1.5" />
      {[17, 25, 33, 41].map((x) => <path key={x} transform={`translate(${x} 22)`} d={star} fill="#F5A623" />)}
      <path className="nb-ix-pop" transform="translate(49 22)" d={star} fill="#F5A623" />
      <path d="M16 31h26M16 36h18" stroke="#9DBFA9" strokeWidth="2" strokeLinecap="round" />
    </InboxStepFrame>
  );
};
