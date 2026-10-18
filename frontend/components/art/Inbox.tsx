import React from 'react';
import { Svg, ArtProps } from './Svg';

export const InboxArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#DCEBFA">
    <path d="M26 18h66a10 10 0 0 1 10 10v24a10 10 0 0 1-10 10H48L34 73V62h-8a10 10 0 0 1-10-10V28a10 10 0 0 1 10-10z" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="28" y="30" width="56" height="5" rx="2.5" fill="#14203A" opacity="0.5" /><rect x="28" y="41" width="38" height="5" rx="2.5" fill="#14203A" opacity="0.2" />
    <path d="M68 58h66a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10h-8v10l-14-10H68a10 10 0 0 1-10-10V68a10 10 0 0 1 10-10z" fill="#3B82C4" />
    <rect x="70" y="70" width="56" height="5" rx="2.5" fill="#fff" opacity="0.9" /><rect x="70" y="81" width="36" height="5" rx="2.5" fill="#fff" opacity="0.55" />
    <circle cx="102" cy="20" r="8" fill="#EE6330" /><path transform="translate(138 36)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
