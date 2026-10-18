import React from 'react';
import { Svg, ArtProps } from './Svg';

export const CompetitorsArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFE3D0">
    <rect x="36" y="24" width="30" height="16" rx="6" fill="#33405C" /><rect x="94" y="24" width="30" height="16" rx="6" fill="#33405C" />
    <rect x="30" y="36" width="42" height="64" rx="16" fill="#14203A" /><rect x="88" y="36" width="42" height="64" rx="16" fill="#14203A" />
    <rect x="64" y="52" width="32" height="22" rx="7" fill="#33405C" />
    <rect x="30" y="56" width="42" height="7" fill="#EE6330" /><rect x="88" y="56" width="42" height="7" fill="#EE6330" />
    <circle cx="51" cy="84" r="14" fill="#DCEBFA" /><circle cx="51" cy="84" r="9" fill="#3B82C4" /><circle cx="47" cy="80" r="3" fill="#fff" opacity=".85" />
    <circle cx="109" cy="84" r="14" fill="#DCEBFA" /><circle cx="109" cy="84" r="9" fill="#3B82C4" /><circle cx="105" cy="80" r="3" fill="#fff" opacity=".85" />
    <path transform="translate(142 26)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" /><path transform="translate(20 28) scale(0.8)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" />
  </Svg>
);
