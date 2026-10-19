import React from 'react';
import { Svg, ArtProps } from '../Svg';

/** Product photoshoot: a bottle on a pedestal under a studio light. */
export const PackProductArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#F4E1F8">
    <path d="M70 8h20l22 74H48z" fill="#FFFDF8" opacity=".45" />
    <rect x="44" y="86" width="72" height="22" rx="4" fill="#14203A" />
    <rect x="44" y="86" width="72" height="5" rx="2" fill="#A63EBB" />
    <rect x="66" y="40" width="28" height="46" rx="8" fill="#FFCB2E" />
    <rect x="73" y="30" width="14" height="12" rx="3" fill="#14203A" />
    <rect x="70" y="56" width="20" height="14" rx="3" fill="#FFFDF8" />
    <path transform="translate(124 34)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
