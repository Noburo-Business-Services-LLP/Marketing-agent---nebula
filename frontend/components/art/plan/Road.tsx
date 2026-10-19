import React from 'react';
import { PlanFrame } from './Frame';

/** Level 8, the next 90 days: a dotted path through three stops to a flag. */
export const PlanRoadArt: React.FC = () => (
  <PlanFrame tint="#E3EFD9">
    <path d="M10 46c12 0 8-14 20-14s10-12 20-14" fill="none" stroke="#14203A" strokeOpacity=".45" strokeWidth="2.6" strokeDasharray="1 5" strokeLinecap="round" />
    <circle cx="10" cy="46" r="4" fill="#6E9B4E" /><circle cx="30" cy="32" r="4" fill="#F5A623" />
    <rect x="49" y="8" width="2.6" height="20" rx="1.3" fill="#14203A" fillOpacity=".7" />
    <path d="M51.6 8l10 4-10 4z" fill="#EE6330" />
  </PlanFrame>
);
