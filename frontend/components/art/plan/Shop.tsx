import React from 'react';
import { PlanFrame } from './Frame';

/** Level 1, your business: a small shop front with a striped awning. */
export const PlanShopArt: React.FC = () => (
  <PlanFrame tint="#FFF0C7">
    <rect x="14" y="25" width="38" height="24" rx="3" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".18" />
    <path d="M11 14h44l-2 11H13z" fill="#F5A623" />
    <path d="M22 14l-1.5 11M33 14v11M44 14l1.5 11" stroke="#FFFDF8" strokeWidth="3.5" />
    <path d="M13 25a5 4 0 0 0 10 0a5 4 0 0 0 10 0a5 4 0 0 0 10 0a5 4 0 0 0 10 0" fill="#EE6330" />
    <rect x="29" y="35" width="9" height="14" rx="1.5" fill="#1F9D9A" />
    <rect x="18" y="34" width="7" height="7" rx="1.5" fill="#D6F1EF" /><rect x="42" y="34" width="7" height="7" rx="1.5" fill="#D6F1EF" />
  </PlanFrame>
);
