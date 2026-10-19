import React from 'react';
import { PlanFrame } from './Frame';

/** Level 2, products and services: a shopping bag beside a box with a price tag. */
export const PlanProductsArt: React.FC = () => (
  <PlanFrame tint="#FFE3D0">
    <rect x="34" y="28" width="20" height="19" rx="2" fill="#F5A623" />
    <path d="M34 34h20" stroke="#FFFDF8" strokeWidth="2" /><path d="M44 28v6" stroke="#FFFDF8" strokeWidth="2" />
    <path d="M13 22h22l-2 27H15z" fill="#EE6330" />
    <path d="M19 25v-5a5 5 0 0 1 10 0v5" fill="none" stroke="#14203A" strokeOpacity=".55" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M40 12l10 0 4 4-8 8-6-6z" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".3" />
    <circle cx="48.5" cy="15.5" r="1.6" fill="#14203A" fillOpacity=".5" />
  </PlanFrame>
);
