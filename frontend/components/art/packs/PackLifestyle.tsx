import React from 'react';
import { Svg, ArtProps } from '../Svg';

/** Lifestyle and in use: a sunny window, a table, a plant, a cup and the product. */
export const PackLifestyleArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#D6F1EF">
    <rect x="92" y="16" width="44" height="50" rx="4" fill="#FFFDF8" stroke="#14203A" strokeWidth="3" />
    <path d="M114 16v50M92 41h44" stroke="#14203A" strokeWidth="2.5" />
    <rect x="18" y="92" width="124" height="7" rx="3" fill="#14203A" />
    <path d="M34 92l4-18h16l4 18z" fill="#EE6330" />
    <path d="M46 74c-14-6-12-24 0-28 4 10 4 20 0 28zM46 74c12-4 18-16 12-26-8 6-12 16-12 26z" fill="#1F9D9A" />
    <rect x="70" y="58" width="22" height="34" rx="6" fill="#FFCB2E" />
    <rect x="74" y="66" width="14" height="10" rx="2" fill="#FFFDF8" />
    <path d="M104 78h18v14h-18z" fill="#FFFDF8" stroke="#14203A" strokeWidth="2.5" />
    <path d="M122 82h5a4 4 0 0 1 0 8h-5" fill="none" stroke="#14203A" strokeWidth="2.5" />
  </Svg>
);
