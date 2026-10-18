import React from 'react';
import { Svg, ArtProps } from './Svg';

export const ProductArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFF0C7">
    <path d="M64 50V38a16 16 0 0 1 32 0v12" fill="none" stroke="#14203A" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M44 46h72l6 60a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6z" fill="#EE6330" />
    <path d="M44 46h72l1 10H43z" fill="#14203A" opacity=".12" />
    <circle cx="80" cy="82" r="17" fill="#FFFDF8" />
    <path transform="translate(80 82) scale(1.4)" d="M0-9 2.6-3 9-2.4 4.2 1.7 5.6 8 0 4.7-5.6 8-4.2 1.7-9-2.4-2.6-3z" fill="#F5A623" />
    <path transform="translate(26 34)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" /><path transform="translate(134 40) scale(0.8)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" />
  </Svg>
);
