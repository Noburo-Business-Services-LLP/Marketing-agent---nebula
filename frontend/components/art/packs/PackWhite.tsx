import React from 'react';
import { Svg, ArtProps } from '../Svg';

/** Clean white background: one jar on white with a soft shadow and a faint reflection. */
export const PackWhiteArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#E1E5FB">
    <rect x="36" y="16" width="88" height="90" rx="10" fill="#FFFDF8" />
    <ellipse cx="80" cy="88" rx="26" ry="5" fill="#14203A" opacity=".18" />
    <rect x="62" y="44" width="36" height="42" rx="8" fill="#5B6BDC" />
    <rect x="60" y="34" width="40" height="12" rx="4" fill="#14203A" />
    <rect x="68" y="56" width="24" height="16" rx="3" fill="#FFFDF8" />
    <rect x="66" y="92" width="28" height="8" rx="4" fill="#5B6BDC" opacity=".18" />
    <path transform="translate(112 30) scale(.8)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
