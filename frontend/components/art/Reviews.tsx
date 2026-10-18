import React from 'react';
import { Svg, ArtProps } from './Svg';

export const ReviewsArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFF0C7">
    <defs><path id="nb-art-star" d="M0-8l2.4 5 5.6.8-4 3.9.9 5.5L0 4.5l-4.9 2.7.9-5.5-4-3.9 5.6-.8z" fill="#F5A623" /></defs>
    <rect x="22" y="30" width="116" height="72" rx="12" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <circle cx="42" cy="50" r="10" fill="#FBDCE5" /><circle cx="42" cy="47" r="3.5" fill="#D8527A" /><path d="M35 58a7 7 0 0 1 14 0z" fill="#D8527A" />
    <rect x="58" y="45" width="44" height="5" rx="2.5" fill="#14203A" opacity="0.5" />
    <use href="#nb-art-star" x="40" y="72" /><use href="#nb-art-star" x="60" y="72" /><use href="#nb-art-star" x="80" y="72" /><use href="#nb-art-star" x="100" y="72" /><use href="#nb-art-star" x="120" y="72" />
    <rect x="36" y="86" width="88" height="4" rx="2" fill="#14203A" opacity="0.2" /><rect x="36" y="94" width="60" height="4" rx="2" fill="#14203A" opacity="0.2" />
    <path transform="translate(138 26) scale(1.2)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" /><path transform="translate(22 24) scale(0.8)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
