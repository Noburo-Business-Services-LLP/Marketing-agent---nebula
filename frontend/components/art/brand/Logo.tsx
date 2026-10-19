import React from 'react';
import { BrandFrame } from './Frame';

/** Logo: a round seal with a star, on a small tag. */
export const BrandLogoArt: React.FC = () => (
  <BrandFrame tint="#FBDCE5">
    <rect x="14" y="12" width="38" height="34" rx="9" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".16" />
    <circle cx="33" cy="29" r="11" fill="#D8527A" />
    <path d="M33 21.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill="#FFCB2E" />
    <circle cx="48" cy="44" r="5" fill="#F5A623" />
  </BrandFrame>
);
