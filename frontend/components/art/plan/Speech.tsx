import React from 'react';
import { PlanFrame } from './Frame';

/** Level 4, positioning and message: a speech bubble with a small star. */
export const PlanSpeechArt: React.FC = () => (
  <PlanFrame tint="#FFF0C7">
    <path d="M12 14h38a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H28l-9 8v-8h-7a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" fill="#FFFDF8" stroke="#F5A623" strokeWidth="2.5" />
    <path d="M17 23h22M17 30h15" stroke="#14203A" strokeOpacity=".4" strokeWidth="3" strokeLinecap="round" />
    <path d="M45 24l1.6 3.4 3.7.4-2.8 2.5.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.8-2.5 3.7-.4z" fill="#F5A623" />
  </PlanFrame>
);
