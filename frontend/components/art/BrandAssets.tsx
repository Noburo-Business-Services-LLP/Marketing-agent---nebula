import React from 'react';
import { Svg, ArtProps } from './Svg';

export const BrandAssetsArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FBDCE5">
    <path d="M80 18C48 18 26 40 26 66c0 16 12 26 26 26h8c8 0 10 6 6 12-3 5 0 8 8 8 30 0 52-20 52-46S112 18 80 18z" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".18" strokeWidth="1.5" />
    <circle cx="62" cy="84" r="6" fill="#FBDCE5" />
    <circle cx="50" cy="56" r="8" fill="#EE6330" /><circle cx="74" cy="38" r="8" fill="#F5A623" /><circle cx="102" cy="44" r="8" fill="#1F9D9A" /><circle cx="112" cy="70" r="8" fill="#3B82C4" /><circle cx="86" cy="68" r="8" fill="#D8527A" />
    <path d="M122 98l14-18" stroke="#14203A" strokeWidth="5" strokeLinecap="round" /><path d="M136 80l7-9" stroke="#EE6330" strokeWidth="5" strokeLinecap="round" />
  </Svg>
);
