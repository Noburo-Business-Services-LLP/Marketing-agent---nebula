import React from 'react';
import { InboxStepFrame } from './Frame';

/** Step 1, Connect: two linked chain rings (blue and gold) with a small pulsing spark where they meet. */
export const StepConnectArt: React.FC = () => (
  <InboxStepFrame tint="#DCEBFA">
    <g transform="rotate(-30 32 28)" fill="none" strokeWidth="5">
      <rect x="11" y="21" width="24" height="14" rx="7" stroke="#3B82C4" />
      <rect x="29" y="21" width="24" height="14" rx="7" stroke="#F5A623" />
    </g>
    <circle className="nb-ix-pulse" cx="32" cy="28" r="3" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".3" />
    <path transform="translate(50 12) scale(.6)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" />
  </InboxStepFrame>
);
