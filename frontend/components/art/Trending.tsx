import React from 'react';
import { Svg, ArtProps } from './Svg';

export const TrendingArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFE9D2">
    <path d="M68 14c4 16 26 26 26 52 0 20-12 34-26 34S42 86 42 66c0-12 6-20 12-26 0 10 5 14 10 14-2-16-2-30 4-40z" fill="#EE6330" />
    <path d="M68 58c4 10 14 16 14 28 0 10-6 16-14 16s-14-6-14-16c0-8 4-12 8-16 0 5 3 8 5 8-1-8-1-14 1-20z" fill="#FFCB2E" />
    <path d="M102 98l14-16 10 9 16-24" fill="none" stroke="#3E8B5A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M130 67h12v12" fill="none" stroke="#3E8B5A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path transform="translate(124 30)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
