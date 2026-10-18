import React from 'react';
import { Svg, ArtProps } from './Svg';

export const SinglePostArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFE3D0">
    <rect x="46" y="12" width="68" height="96" rx="9" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="53" y="19" width="54" height="46" rx="6" fill="#FFD27A" />
    <circle cx="69" cy="33" r="6" fill="#EE6330" />
    <path d="M53 59l15-13 11 9 9-7 19 14v3a6 6 0 0 1-6 3H59a6 6 0 0 1-6-6z" fill="#3E8B5A" />
    <path transform="translate(62 80) scale(1.1)" d="M0 6C-9-1-8-9-3-9C-1-9 0-7 0-6C0-7 1-9 3-9C8-9 9-1 0 6z" fill="#EE6330" />
    <rect x="76" y="76" width="30" height="5" rx="2.5" fill="#14203A" opacity="0.5" />
    <rect x="53" y="90" width="54" height="5" rx="2.5" fill="#14203A" opacity="0.18" />
    <rect x="53" y="99" width="34" height="5" rx="2.5" fill="#14203A" opacity="0.18" />
    <path transform="translate(130 28)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
    <circle cx="30" cy="84" r="4" fill="#F5A623" />
  </Svg>
);
