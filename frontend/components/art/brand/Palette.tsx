import React from 'react';
import { BrandFrame } from './Frame';

/** Colours: a painter's palette with three paint dots and a brush. */
export const BrandPaletteArt: React.FC = () => (
  <BrandFrame tint="#FFF0C7">
    <path d="M32 12c-12 0-21 8-21 18 0 8 6 13 12 12 4-1 3-5 6-6 4-1 6 3 11 2 7-2 13-7 13-13 0-8-9-13-21-13z" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".16" />
    <circle cx="22" cy="26" r="4" fill="#EE6330" />
    <circle cx="32" cy="20" r="4" fill="#F5A623" />
    <circle cx="43" cy="24" r="4" fill="#1F9D9A" />
    <circle cx="25" cy="35.5" r="3.2" fill="#FFF0C7" stroke="#14203A" strokeOpacity=".12" />
    <path d="M52 33L40 46" stroke="#7B5CC4" strokeWidth="4" strokeLinecap="round" />
    <path d="M40 46l-3 3" stroke="#14203A" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
  </BrandFrame>
);
