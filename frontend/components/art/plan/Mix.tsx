import React from 'react';
import { PlanFrame } from './Frame';

/** Level 5, marketing mix: a ring in four parts with one part lifted out. */
export const PlanMixArt: React.FC = () => (
  <PlanFrame tint="#ECE6FB">
    <circle cx="31" cy="31" r="13" fill="none" stroke="#7B5CC4" strokeWidth="9" />
    <circle cx="31" cy="31" r="13" fill="none" stroke="#1F9D9A" strokeWidth="9" strokeDasharray="20 62" strokeDashoffset="-41" />
    <circle cx="31" cy="31" r="13" fill="none" stroke="#F5A623" strokeWidth="9" strokeDasharray="27 55" />
    <path d="M42 11a19 19 0 0 1 11 12l-8 2.6a11 11 0 0 0-5.6-6.8z" fill="#EE6330" />
  </PlanFrame>
);
