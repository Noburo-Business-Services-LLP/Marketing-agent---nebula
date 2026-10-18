import React from 'react';
import { Svg, ArtProps } from './Svg';

export const BlueprintArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFF0C7">
    <path d="M100 98l-5 18 11-6 11 6-5-18z" fill="#C4471A" />
    <path d="M44 12h42l22 22v70a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6z" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".16" />
    <path d="M86 12v16a6 6 0 0 0 6 6h16z" fill="#F5A623" opacity=".5" />
    <rect x="48" y="40" width="40" height="6" rx="3" fill="#14203A" opacity="0.55" />
    <rect x="48" y="54" width="52" height="32" rx="5" fill="#FFF0C7" />
    <rect x="54" y="70" width="8" height="10" rx="2" fill="#F5A623" /><rect x="66" y="64" width="8" height="16" rx="2" fill="#EE6330" /><rect x="78" y="58" width="8" height="22" rx="2" fill="#3E8B5A" />
    <rect x="48" y="92" width="52" height="4" rx="2" fill="#14203A" opacity="0.2" /><rect x="48" y="100" width="34" height="4" rx="2" fill="#14203A" opacity="0.2" />
    <circle cx="112" cy="86" r="16" fill="#EE6330" /><path transform="translate(112 86) scale(1.3)" d="M0-9 2.6-3 9-2.4 4.2 1.7 5.6 8 0 4.7-5.6 8-4.2 1.7-9-2.4-2.6-3z" fill="#FFFDF8" />
  </Svg>
);
