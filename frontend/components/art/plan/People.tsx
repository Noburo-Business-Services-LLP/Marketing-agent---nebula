import React from 'react';
import { PlanFrame } from './Frame';

/** Level 3, your customers: three people side by side, the middle one nearest. */
export const PlanPeopleArt: React.FC = () => (
  <PlanFrame tint="#D6F1EF">
    <circle cx="18" cy="24" r="5.5" fill="#F5A623" /><path d="M8 46a10 11 0 0 1 20 0z" fill="#F5A623" />
    <circle cx="48" cy="24" r="5.5" fill="#EE6330" /><path d="M38 46a10 11 0 0 1 20 0z" fill="#EE6330" />
    <circle cx="33" cy="20" r="7" fill="#1F9D9A" stroke="#FFFDF8" strokeWidth="2" />
    <path d="M20 49a13 14 0 0 1 26 0z" fill="#1F9D9A" stroke="#FFFDF8" strokeWidth="2" />
  </PlanFrame>
);
