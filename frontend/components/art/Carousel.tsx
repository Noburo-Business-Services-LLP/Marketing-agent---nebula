import React from 'react';
import { Svg, ArtProps } from './Svg';

export const CarouselArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#DCEBFA">
    <rect x="20" y="26" width="54" height="64" rx="8" fill="#FFE3D0" />
    <rect x="86" y="26" width="54" height="64" rx="8" fill="#DDF2E6" />
    <rect x="48" y="14" width="64" height="80" rx="9" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="55" y="21" width="50" height="40" rx="5" fill="#FFD27A" />
    <circle cx="88" cy="34" r="6" fill="#EE6330" />
    <path d="M55 57l13-12 9 8 8-6 15 12v2a5 5 0 0 1-5 5H60a5 5 0 0 1-5-5z" fill="#3E8B5A" />
    <rect x="55" y="68" width="40" height="5" rx="2.5" fill="#14203A" opacity="0.5" /><rect x="55" y="77" width="26" height="4" rx="2" fill="#14203A" opacity="0.2" />
    <circle cx="54" cy="107" r="3" fill="#14203A" opacity=".2" /><circle cx="64" cy="107" r="3" fill="#14203A" opacity=".2" />
    <rect x="72" y="104" width="16" height="6" rx="3" fill="#F5A623" />
    <circle cx="96" cy="107" r="3" fill="#14203A" opacity=".2" /><circle cx="106" cy="107" r="3" fill="#14203A" opacity=".2" />
    <path d="M122 102h22m-6-6 6 6-6 6" fill="none" stroke="#EE6330" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
