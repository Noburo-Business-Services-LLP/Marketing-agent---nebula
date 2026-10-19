import React from 'react';
import { BrandFrame } from './Frame';

/** Where you are online: a globe with a small location pin. */
export const BrandGlobeArt: React.FC = () => (
  <BrandFrame tint="#DCEBFA">
    <circle cx="30" cy="30" r="15" fill="#FFFDF8" stroke="#3B82C4" strokeWidth="3" />
    <ellipse cx="30" cy="30" rx="6.5" ry="15" fill="none" stroke="#3B82C4" strokeWidth="2.5" />
    <path d="M15 30h30M18 22h24M18 38h24" stroke="#3B82C4" strokeWidth="2" />
    <path d="M47 12c-4 0-7 3-7 7 0 5 7 11 7 11s7-6 7-11c0-4-3-7-7-7z" fill="#EE6330" />
    <circle cx="47" cy="19" r="2.6" fill="#FFFDF8" />
  </BrandFrame>
);
