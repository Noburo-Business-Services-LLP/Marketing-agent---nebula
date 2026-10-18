import React from 'react';
import { Svg, ArtProps } from './Svg';

export const IdeasArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFF0C7">
    <path d="M80 14a32 32 0 0 0-18 58c3 3 4 6 4 10h28c0-4 1-7 4-10A32 32 0 0 0 80 14z" fill="#FFCB2E" />
    <path d="M64 38a18 18 0 0 1 12-14" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".8" />
    <path d="M70 66l6-14 4 8 4-8 6 14" fill="none" stroke="#14203A" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="66" y="84" width="28" height="8" rx="3" fill="#14203A" /><rect x="70" y="94" width="20" height="8" rx="4" fill="#14203A" />
    <path d="M24 52h-10M30 28l-8-6M130 28l8-6M136 52h10" fill="none" stroke="#F5A623" strokeWidth="4" strokeLinecap="round" />
    <path transform="translate(120 82)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#EE6330" /><path transform="translate(40 84) scale(0.8)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
