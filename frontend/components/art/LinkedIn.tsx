import React from 'react';
import { Svg, ArtProps } from './Svg';

export const LinkedInArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#D9E8F7">
    <rect x="30" y="34" width="100" height="72" rx="10" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="24" y="14" width="44" height="44" rx="10" fill="#2B6CB0" />
    <g transform="translate(21 14)" fill="#fff"><circle cx="13" cy="13" r="3.4" /><rect x="9.7" y="19" width="6.6" height="16" rx="1.5" /><path d="M21 19h6.2v2.6c1.3-2 3.3-3 6-3 5.2 0 6.8 3.2 6.8 8V35h-6.5v-7.6c0-2.4-.7-3.8-2.9-3.8s-3.3 1.4-3.3 4.1V35H21z" /></g>
    <rect x="76" y="38" width="46" height="6" rx="3" fill="#14203A" opacity="0.55" /><rect x="76" y="48" width="30" height="5" rx="2.5" fill="#14203A" opacity="0.2" />
    <rect x="40" y="68" width="80" height="6" rx="3" fill="#14203A" opacity="0.16" /><rect x="40" y="79" width="80" height="6" rx="3" fill="#14203A" opacity="0.16" /><rect x="40" y="90" width="52" height="6" rx="3" fill="#14203A" opacity="0.16" />
    <path transform="translate(118 94) scale(1.1)" d="M0 6C-9-1-8-9-3-9C-1-9 0-7 0-6C0-7 1-9 3-9C8-9 9-1 0 6z" fill="#EE6330" />
    <path transform="translate(142 24)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
