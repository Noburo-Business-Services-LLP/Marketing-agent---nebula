import React from 'react';
import { BrandFrame } from './Frame';

/** Competitor read: a pair of binoculars. */
export const BrandBinocularsArt: React.FC = () => (
  <BrandFrame tint="#FFE3D0">
    <rect x="19" y="14" width="9" height="12" rx="3" fill="#14203A" opacity=".7" />
    <rect x="38" y="14" width="9" height="12" rx="3" fill="#14203A" opacity=".7" />
    <rect x="28" y="27" width="10" height="8" rx="3" fill="#14203A" opacity=".55" />
    <circle cx="22" cy="36" r="10" fill="#EE6330" />
    <circle cx="44" cy="36" r="10" fill="#EE6330" />
    <circle cx="22" cy="36" r="5.5" fill="#DCEBFA" />
    <circle cx="44" cy="36" r="5.5" fill="#DCEBFA" />
    <circle cx="20" cy="34" r="1.8" fill="#FFFDF8" /><circle cx="42" cy="34" r="1.8" fill="#FFFDF8" />
  </BrandFrame>
);
