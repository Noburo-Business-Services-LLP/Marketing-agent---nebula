import React from 'react';
import { Svg, ArtProps } from '../Svg';

/** Marketplace pack: four square photos on white, one of them large. */
export const PackMarketplaceArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#DCEBFA">
    <rect x="30" y="22" width="64" height="64" rx="8" fill="#FFFDF8" stroke="#14203A" strokeWidth="3" />
    <rect x="50" y="40" width="24" height="30" rx="4" fill="#3B82C4" />
    <rect x="56" y="34" width="12" height="7" rx="2" fill="#14203A" />
    <rect x="102" y="22" width="28" height="28" rx="5" fill="#FFFDF8" stroke="#14203A" strokeWidth="2.5" />
    <rect x="102" y="58" width="28" height="28" rx="5" fill="#FFFDF8" stroke="#14203A" strokeWidth="2.5" />
    <rect x="111" y="29" width="10" height="14" rx="2" fill="#3B82C4" />
    <rect x="109" y="66" width="14" height="12" rx="2" fill="#3B82C4" />
    <rect x="30" y="92" width="100" height="10" rx="5" fill="#F5A623" />
  </Svg>
);
