import React from 'react';
import { Svg, ArtProps } from './Svg';

export const PlanMapArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#D6F1EF">
    <rect x="20" y="16" width="120" height="88" rx="12" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <path d="M60 16h40v88H60z" fill="#D6F1EF" opacity=".7" />
    <path d="M60 16v88M100 16v88" stroke="#14203A" strokeOpacity=".08" strokeWidth="2" />
    <path d="M34 90C54 90 40 62 66 62S94 74 100 50 112 38 114 34" fill="none" stroke="#14203A" strokeOpacity=".5" strokeWidth="3" strokeDasharray="1 7" strokeLinecap="round" />
    <circle cx="34" cy="90" r="6" fill="#1F9D9A" /><circle cx="66" cy="62" r="5" fill="#F5A623" />
    <rect x="113" y="22" width="3" height="28" rx="1.5" fill="#14203A" /><path d="M116 22l16 6-16 6z" fill="#EE6330" />
  </Svg>
);
