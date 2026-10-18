import React from 'react';
import { Svg, ArtProps } from './Svg';

export const PerformanceArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#ECE6FB">
    <rect x="24" y="104" width="112" height="3" rx="1.5" fill="#14203A" opacity=".2" />
    <rect x="30" y="82" width="20" height="22" rx="5" fill="#CDBDF5" />
    <rect x="56" y="68" width="20" height="36" rx="5" fill="#B39EEA" />
    <rect x="82" y="54" width="20" height="50" rx="5" fill="#9A80DE" />
    <rect x="108" y="38" width="20" height="66" rx="5" fill="#7B5CC4" />
    <path d="M34 62L64 46 86 50 126 20" fill="none" stroke="#3E8B5A" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M112 20h14v14" fill="none" stroke="#3E8B5A" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="34" cy="62" r="4" fill="#F5A623" />
  </Svg>
);
