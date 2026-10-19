import React from 'react';
import { BrandFrame } from './Frame';

/** Your goal: a target with an arrow in the middle. */
export const BrandTargetArt: React.FC = () => (
  <BrandFrame tint="#FFE3D0">
    <circle cx="30" cy="31" r="17" fill="#FFFDF8" stroke="#EE6330" strokeWidth="3.5" />
    <circle cx="30" cy="31" r="10" fill="none" stroke="#EE6330" strokeWidth="3.5" />
    <circle cx="30" cy="31" r="3.5" fill="#F5A623" />
    <path d="M31 30L50 12" stroke="#14203A" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />
    <path d="M45 11l6 1 1 6" fill="none" stroke="#1F9D9A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </BrandFrame>
);
