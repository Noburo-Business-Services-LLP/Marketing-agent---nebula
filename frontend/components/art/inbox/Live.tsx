import React from 'react';
import { InboxStepFrame } from './Frame';

/** Live updates: a phone with a speech bubble and two signal arcs that pulse (only without reduced motion). */
export const LiveUpdatesArt: React.FC = () => (
  <InboxStepFrame tint="#FFF0C7">
    <rect x="22" y="12" width="20" height="34" rx="4" fill="#FFFDF8" stroke="#8A5000" strokeWidth="2" />
    <rect x="26" y="19" width="12" height="8" rx="2.5" fill="#F5A623" />
    <path d="M26 31h12M26 35h8" stroke="#C9A36A" strokeWidth="2" strokeLinecap="round" />
    <g className="nb-ix-pulse" fill="none" stroke="#3B82C4" strokeWidth="2.4" strokeLinecap="round">
      <path d="M47 20a8 8 0 0 1 0 12" />
      <path d="M51 16a14 14 0 0 1 0 20" strokeOpacity=".55" />
    </g>
  </InboxStepFrame>
);
