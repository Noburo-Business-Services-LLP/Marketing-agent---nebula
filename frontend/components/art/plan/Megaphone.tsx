import React from 'react';
import { PlanFrame } from './Frame';

/** Level 6, channels and who does what: a megaphone sending out three waves. */
export const PlanMegaphoneArt: React.FC = () => (
  <PlanFrame tint="#D6F1EF">
    <path d="M12 25h7l18-10v28L19 33h-7a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3z" fill="#1F9D9A" />
    <path d="M16 33l3 10h5l-2-10" fill="#14203A" fillOpacity=".45" />
    <rect x="35" y="13" width="5" height="32" rx="2.5" fill="#F5A623" />
    <path d="M45 22a9 9 0 0 1 0 14M49 17a15 15 0 0 1 0 24" fill="none" stroke="#EE6330" strokeWidth="2.6" strokeLinecap="round" />
  </PlanFrame>
);
