import React from 'react';
import { Svg, ArtProps } from './Svg';

export const MemoryArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#ECE6FB">
    <path d="M72 90h16v10a8 8 0 0 1-16 0z" fill="#9A80DE" />
    <g fill="#B39EEA"><circle cx="58" cy="52" r="20" /><circle cx="102" cy="52" r="20" /><circle cx="68" cy="72" r="20" /><circle cx="92" cy="72" r="20" /><circle cx="80" cy="46" r="20" /></g>
    <path d="M80 30v58" stroke="#fff" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />
    <path d="M50 54c6-6 14-2 14 6M110 54c-6-6-14-2-14 6M60 76c6 4 12 0 12-6M100 76c-6 4-12 0-12-6" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="3" strokeLinecap="round" />
    <path transform="translate(130 26) scale(1.2)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" /><path transform="translate(26 32) scale(0.9)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" /><path transform="translate(134 90) scale(1.2)" d="M0 6C-9-1-8-9-3-9C-1-9 0-7 0-6C0-7 1-9 3-9C8-9 9-1 0 6z" fill="#EE6330" />
  </Svg>
);
