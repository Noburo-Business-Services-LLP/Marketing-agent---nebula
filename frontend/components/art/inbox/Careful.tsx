import React from 'react';
import { InboxStepFrame } from './Frame';

/** Step 2, Choose how careful: a three-part dial (green, gold, coral) with a needle that sways slowly. */
export const StepCarefulArt: React.FC = () => (
  <InboxStepFrame tint="#FFF0C7">
    <g fill="none" strokeWidth="6" strokeLinecap="round">
      <path d="M14 38A18 18 0 0 1 23 22.4" stroke="#3E8B5A" />
      <path d="M26.4 20.9A18 18 0 0 1 37.6 20.9" stroke="#F5A623" />
      <path d="M41 22.4A18 18 0 0 1 50 38" stroke="#EE6330" />
    </g>
    <path className="nb-ix-sway" d="M32 38V23" stroke="#14203A" strokeWidth="3" strokeLinecap="round" />
    <circle cx="32" cy="38" r="4" fill="#14203A" />
  </InboxStepFrame>
);
