import React from 'react';
import { PlanFrame } from './Frame';

/** Level 7, content pillars: three fanned post cards. */
export const PlanPillarsArt: React.FC = () => (
  <PlanFrame tint="#FFE3D0">
    <rect x="10" y="17" width="20" height="26" rx="3" fill="#1F9D9A" transform="rotate(-12 20 30)" />
    <rect x="36" y="17" width="20" height="26" rx="3" fill="#7B5CC4" transform="rotate(12 46 30)" />
    <rect x="22" y="12" width="22" height="30" rx="3" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".2" />
    <rect x="25" y="15" width="16" height="13" rx="2" fill="#F5A623" />
    <path d="M25 33h16M25 37h10" stroke="#14203A" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
    <circle cx="37" cy="19" r="2" fill="#FFFDF8" />
  </PlanFrame>
);
