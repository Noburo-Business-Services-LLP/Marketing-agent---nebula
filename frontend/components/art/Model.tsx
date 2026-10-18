import React from 'react';
import { Svg, ArtProps } from './Svg';

export const ModelArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FBDCE5">
    <path d="M46 112c0-24 15-38 34-38s34 14 34 38z" fill="#D8527A" />
    <rect x="73" y="62" width="14" height="18" rx="5" fill="#F2B58C" />
    <path d="M67 76l13 17 13-17z" fill="#F2B58C" />
    <ellipse cx="80" cy="46" rx="15" ry="17" fill="#F2B58C" />
    <path d="M64 46C61 28 71 19 82 19c12 0 19 10 15 28-3-10-7-14-17-14-8 0-13 5-16 13z" fill="#14203A" />
    <circle cx="65" cy="54" r="2.5" fill="#F5A623" />
    <path d="M24 32V20a4 4 0 0 1 4-4h12M120 16h12a4 4 0 0 1 4 4v12M136 90v12a4 4 0 0 1-4 4h-12M40 106H28a4 4 0 0 1-4-4V90" fill="none" stroke="#14203A" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
    <path transform="translate(124 50)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
