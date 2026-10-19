import React from 'react';
import { BrandFrame } from './Frame';

/** What to do first: a short list with two ticks. */
export const BrandChecklistArt: React.FC = () => (
  <BrandFrame tint="#E3EFD9">
    <rect x="15" y="11" width="34" height="38" rx="6" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".16" />
    <path d="M20 20l3 3 5-6M20 30l3 3 5-6" fill="none" stroke="#3E8B5A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="21" y="38" width="5" height="5" rx="1.5" fill="none" stroke="#14203A" strokeOpacity=".35" strokeWidth="2" />
    <path d="M32 20h11M32 30h11M32 40.5h8" stroke="#14203A" strokeOpacity=".3" strokeWidth="3" strokeLinecap="round" />
    <circle cx="49" cy="45" r="5" fill="#F5A623" />
  </BrandFrame>
);
