import React from 'react';
import { Svg, ArtProps } from '../Svg';

/** Flat lay: a top-down arrangement of the product with props around it. */
export const PackFlatLayArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFE3D0">
    <rect x="30" y="20" width="100" height="84" rx="10" fill="#FFFDF8" />
    <rect x="62" y="40" width="36" height="44" rx="6" fill="#EE6330" />
    <rect x="70" y="50" width="20" height="12" rx="2" fill="#FFFDF8" />
    <circle cx="46" cy="38" r="9" fill="#FFCB2E" />
    <circle cx="116" cy="86" r="10" fill="#14203A" opacity=".85" />
    <path d="M112 30c10 0 12 10 4 16-6-4-8-10-4-16zM40 80c10-2 14 8 8 14-6-2-10-8-8-14z" fill="#1F9D9A" />
    <circle cx="112" cy="58" r="3" fill="#F5A623" /><circle cx="46" cy="62" r="3" fill="#F5A623" />
  </Svg>
);
