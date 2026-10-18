import React from 'react';
import { Svg, ArtProps } from './Svg';

export const CalendarArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#DDF2E6">
    <rect x="32" y="20" width="96" height="88" rx="11" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <path d="M32 44V31a11 11 0 0 1 11-11h74a11 11 0 0 1 11 11v13z" fill="#EE6330" />
    <rect x="52" y="12" width="6" height="14" rx="3" fill="#14203A" /><rect x="102" y="12" width="6" height="14" rx="3" fill="#14203A" />
    <circle cx="50" cy="63" r="7" fill="#3E8B5A" /><path d="M47 63l2.5 2.5 4-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="70" cy="63" r="7" fill="#3E8B5A" /><path d="M67 63l2.5 2.5 4-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><rect x="83" y="57" width="14" height="12" rx="4" fill="#F3E8D4" /><circle cx="110" cy="63" r="7" fill="#3E8B5A" /><path d="M107 63l2.5 2.5 4-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="50" cy="81" r="7" fill="#3E8B5A" /><path d="M47 81l2.5 2.5 4-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><rect x="63" y="75" width="14" height="12" rx="4" fill="#F3E8D4" /><circle cx="90" cy="81" r="7" fill="#3E8B5A" /><path d="M87 81l2.5 2.5 4-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><rect x="103" y="75" width="14" height="12" rx="4" fill="#F3E8D4" /><rect x="43" y="93" width="14" height="12" rx="4" fill="#F3E8D4" /><circle cx="70" cy="99" r="7" fill="#3E8B5A" /><path d="M67 99l2.5 2.5 4-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><rect x="83" y="93" width="14" height="12" rx="4" fill="#F3E8D4" /><rect x="103" y="93" width="14" height="12" rx="4" fill="#F3E8D4" />
  </Svg>
);
