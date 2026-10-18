import React from 'react';
import { Svg, ArtProps } from './Svg';

export const CampaignArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFF0C7">
    <rect x="16" y="16" width="36" height="52" rx="7" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="20" y="20" width="28" height="26" rx="4" fill="#FFB88A" />
    <rect x="20" y="52" width="22" height="4" rx="2" fill="#14203A" opacity="0.5" /><rect x="20" y="60" width="14" height="3" rx="1.5" fill="#14203A" opacity="0.2" />
    <circle cx="34" cy="92" r="6" fill="#F5A623" /><path d="M34 68v18" stroke="#14203A" strokeOpacity=".22" strokeWidth="2" />
    <rect x="54" y="16" width="36" height="52" rx="7" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="58" y="20" width="28" height="26" rx="4" fill="#FFD27A" />
    <rect x="58" y="52" width="22" height="4" rx="2" fill="#14203A" opacity="0.5" /><rect x="58" y="60" width="14" height="3" rx="1.5" fill="#14203A" opacity="0.2" />
    <circle cx="72" cy="92" r="6" fill="#F5A623" /><path d="M72 68v18" stroke="#14203A" strokeOpacity=".22" strokeWidth="2" />
    <rect x="92" y="16" width="36" height="52" rx="7" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="96" y="20" width="28" height="26" rx="4" fill="#9AD4AE" />
    <rect x="96" y="52" width="22" height="4" rx="2" fill="#14203A" opacity="0.5" /><rect x="96" y="60" width="14" height="3" rx="1.5" fill="#14203A" opacity="0.2" />
    <circle cx="110" cy="92" r="6" fill="#F5A623" /><path d="M110 68v18" stroke="#14203A" strokeOpacity=".22" strokeWidth="2" />
    <path d="M24 92h112" stroke="#14203A" strokeOpacity=".35" strokeWidth="3" strokeDasharray="1 7" strokeLinecap="round" />
    <rect x="135" y="74" width="3" height="34" rx="1.5" fill="#14203A" />
    <path d="M138 74l16 7-16 7z" fill="#EE6330" />
  </Svg>
);
