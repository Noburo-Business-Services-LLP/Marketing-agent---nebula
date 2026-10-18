import React from 'react';
import { Svg, ArtProps } from './Svg';

export const ReelArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFE3D0">
    <defs><linearGradient id="nb-art-reel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F5A623" /><stop offset="1" stopColor="#EE6330" /></linearGradient></defs>
    <rect x="52" y="8" width="56" height="104" rx="12" fill="#14203A" />
    <rect x="56" y="13" width="48" height="94" rx="9" fill="url(#nb-art-reel)" />
    <rect x="72" y="16" width="16" height="3" rx="1.5" fill="#14203A" opacity=".5" />
    <circle cx="80" cy="52" r="15" fill="#FFFDF8" />
    <path d="M75 44v16l13-8z" fill="#EE6330" />
    <rect x="61" y="86" width="28" height="4" rx="2" fill="#fff" opacity="0.95" /><rect x="61" y="94" width="18" height="3" rx="1.5" fill="#fff" opacity="0.6" />
    <circle cx="97" cy="68" r="3.5" fill="#fff" opacity=".9" /><circle cx="97" cy="79" r="3.5" fill="#fff" opacity=".9" /><circle cx="97" cy="90" r="3.5" fill="#fff" opacity=".9" />
    <path transform="translate(128 44) scale(1.6)" d="M0 6C-9-1-8-9-3-9C-1-9 0-7 0-6C0-7 1-9 3-9C8-9 9-1 0 6z" fill="#EE6330" /><path transform="translate(28 34)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#F5A623" />
    <path d="M32 96V78l12-3v18" fill="none" stroke="#14203A" strokeWidth="3" strokeLinecap="round" /><circle cx="29" cy="96" r="4" fill="#14203A" /><circle cx="41" cy="93" r="4" fill="#14203A" />
  </Svg>
);
