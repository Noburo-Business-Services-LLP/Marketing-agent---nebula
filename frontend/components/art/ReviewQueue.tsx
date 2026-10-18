import React from 'react';
import { Svg, ArtProps } from './Svg';

export const ReviewQueueArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#DDF2E6">
    <rect x="34" y="108" width="92" height="6" rx="3" fill="#fff" opacity=".7" />
    <rect x="28" y="100" width="104" height="6" rx="3" fill="#fff" opacity=".9" />
    <rect x="22" y="12" width="116" height="26" rx="9" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <circle cx="40" cy="25" r="9" fill="#3E8B5A" /><path d="M36 25l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="58" y="19" width="54" height="5" rx="2.5" fill="#14203A" opacity="0.5" /><rect x="58" y="28" width="36" height="4" rx="2" fill="#14203A" opacity="0.2" />
    <rect x="22" y="42" width="116" height="26" rx="9" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <circle cx="40" cy="55" r="9" fill="#3E8B5A" /><path d="M36 55l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="58" y="49" width="54" height="5" rx="2.5" fill="#14203A" opacity="0.5" /><rect x="58" y="58" width="36" height="4" rx="2" fill="#14203A" opacity="0.2" />
    <rect x="22" y="72" width="116" height="26" rx="9" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <circle cx="40" cy="85" r="9" fill="none" stroke="#F5A623" strokeWidth="3.5" />
    <rect x="58" y="79" width="54" height="5" rx="2.5" fill="#14203A" opacity="0.5" /><rect x="58" y="88" width="36" height="4" rx="2" fill="#14203A" opacity="0.2" />
    <rect x="112" y="80" width="18" height="10" rx="5" fill="#FFCB2E" />
  </Svg>
);
