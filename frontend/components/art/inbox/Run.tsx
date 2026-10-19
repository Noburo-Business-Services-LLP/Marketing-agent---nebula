import React from 'react';
import { InboxStepFrame } from './Frame';

/** Step 3, Review or let it run: a reply bubble with a green tick and a small gold play button that pops. */
export const StepRunArt: React.FC = () => (
  <InboxStepFrame tint="#DDF2E6">
    <path d="M18 12h24a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7H29l-8 7v-7h-3a7 7 0 0 1-7-7V19a7 7 0 0 1 7-7z" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".16" />
    <path d="M22 24l5 5 9-10" fill="none" stroke="#3E8B5A" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <g className="nb-ix-pop">
      <circle cx="47" cy="40" r="9" fill="#F5A623" />
      <path d="M44.5 35.5v9l7-4.5z" fill="#1A1208" />
    </g>
  </InboxStepFrame>
);
