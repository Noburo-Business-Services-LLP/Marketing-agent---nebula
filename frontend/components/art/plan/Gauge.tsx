import React from 'react';
import { PlanFrame } from './Frame';

/** Level 9, numbers to watch: a gauge with three bands and a needle. */
export const PlanGaugeArt: React.FC = () => (
  <PlanFrame tint="#ECE6FB">
    <path d="M12 42a21 21 0 0 1 9-17" fill="none" stroke="#EE6330" strokeWidth="7" />
    <path d="M22.5 24a21 21 0 0 1 21 0" fill="none" stroke="#F5A623" strokeWidth="7" />
    <path d="M45 25a21 21 0 0 1 9 17" fill="none" stroke="#6E9B4E" strokeWidth="7" />
    <path d="M33 42l11-13" stroke="#14203A" strokeOpacity=".75" strokeWidth="3" strokeLinecap="round" />
    <circle cx="33" cy="42" r="4" fill="#7B5CC4" />
  </PlanFrame>
);
