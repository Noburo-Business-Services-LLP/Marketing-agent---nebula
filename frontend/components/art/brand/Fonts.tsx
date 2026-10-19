import React from 'react';
import { BrandFrame } from './Frame';

/** Fonts: a large letter A drawn with shapes, a small round letter beside it and a baseline. */
export const BrandFontsArt: React.FC = () => (
  <BrandFrame tint="#ECE6FB">
    <path d="M12 45L25 12h5l13 33h-7l-3-8H22l-3 8zM24 31h8l-4-11z" fill="#5B3FA6" />
    <circle cx="48" cy="38" r="6.5" fill="none" stroke="#D8527A" strokeWidth="4" />
    <path d="M54.5 31v14" stroke="#D8527A" strokeWidth="4" strokeLinecap="round" />
    <path d="M10 49h46" stroke="#14203A" strokeOpacity=".18" strokeWidth="2.5" strokeLinecap="round" />
  </BrandFrame>
);
