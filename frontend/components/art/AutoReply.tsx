import React from 'react';
import { Svg, ArtProps } from './Svg';

export const AutoReplyArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#ECE6FB">
    <path d="M28 16h58a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10H48l-12 10V54h-8a10 10 0 0 1-10-10V26a10 10 0 0 1 10-10z" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="30" y="27" width="50" height="5" rx="2.5" fill="#14203A" opacity="0.5" /><rect x="30" y="37" width="32" height="5" rx="2.5" fill="#14203A" opacity="0.2" />
    <path d="M74 60h58a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10h-8v10l-12-10H74a10 10 0 0 1-10-10V70a10 10 0 0 1 10-10z" fill="#7B5CC4" />
    <rect x="76" y="71" width="50" height="5" rx="2.5" fill="#fff" opacity="0.9" /><rect x="76" y="81" width="30" height="5" rx="2.5" fill="#fff" opacity="0.55" />
    <circle cx="38" cy="92" r="16" fill="#F5A623" /><path d="M42 80L32 94h7l-2 11 12-15h-8z" fill="#FFFDF8" />
    <path transform="translate(132 30)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" />
  </Svg>
);
