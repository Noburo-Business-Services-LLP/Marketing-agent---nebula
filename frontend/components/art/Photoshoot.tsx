import React from 'react';
import { Svg, ArtProps } from './Svg';

export const PhotoshootArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#F4E1F8">
    <path d="M54 42l5-13h26l5 13z" fill="#14203A" />
    <rect x="28" y="42" width="104" height="62" rx="12" fill="#14203A" />
    <rect x="28" y="56" width="104" height="9" fill="#A63EBB" />
    <rect x="104" y="46" width="14" height="6" rx="2" fill="#FFCB2E" />
    <circle cx="42" cy="49" r="3" fill="#FFCB2E" />
    <circle cx="80" cy="83" r="23" fill="#FFFDF8" />
    <circle cx="80" cy="83" r="16" fill="#5B6BDC" />
    <circle cx="80" cy="83" r="8" fill="#14203A" opacity=".55" />
    <circle cx="74" cy="77" r="4" fill="#fff" opacity=".85" />
    <path transform="translate(130 24) scale(1.7)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" /><path transform="translate(148 50)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" /><path transform="translate(110 18) scale(0.8)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
  </Svg>
);
