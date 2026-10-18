import React from 'react';
import { Svg, ArtProps } from './Svg';

export const VideoArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#E1E5FB">
    <defs><linearGradient id="nb-art-video" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5B6BDC" /><stop offset="1" stopColor="#9B6FE0" /></linearGradient></defs>
    <rect x="22" y="20" width="116" height="70" rx="11" fill="url(#nb-art-video)" />
    <circle cx="80" cy="55" r="20" fill="#FFFDF8" />
    <path d="M73 44v22l20-11z" fill="#EE6330" />
    <path transform="translate(40 36) scale(0.8)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" /><path transform="translate(122 74) scale(0.6)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" />
    <rect x="22" y="99" width="116" height="6" rx="3" fill="#14203A" opacity=".14" />
    <rect x="22" y="99" width="62" height="6" rx="3" fill="#EE6330" />
    <circle cx="84" cy="102" r="6" fill="#FFFDF8" stroke="#EE6330" strokeWidth="2.5" />
  </Svg>
);
