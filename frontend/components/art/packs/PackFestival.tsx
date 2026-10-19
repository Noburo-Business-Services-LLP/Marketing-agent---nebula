import React from 'react';
import { Svg, ArtProps } from '../Svg';

/** Festival pack: a small oil lamp, marigolds and string lights. */
export const PackFestivalArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFF0C7">
    <path d="M22 26q58 24 116 0" fill="none" stroke="#14203A" strokeWidth="2" />
    <circle cx="40" cy="32" r="4" fill="#FFCB2E" /><circle cx="64" cy="38" r="4" fill="#EE6330" /><circle cx="96" cy="38" r="4" fill="#FFCB2E" /><circle cx="120" cy="32" r="4" fill="#EE6330" />
    <path d="M52 78h56q-4 22-28 22T52 78z" fill="#C2410C" />
    <path d="M52 78h56l-4 6H56z" fill="#14203A" opacity=".2" />
    <path d="M80 50q10 12 0 26q-10-14 0-26z" fill="#FFCB2E" />
    <path d="M80 60q4 6 0 13q-4-7 0-13z" fill="#F5A623" />
    <circle cx="30" cy="96" r="9" fill="#F5A623" /><circle cx="30" cy="96" r="4" fill="#C2410C" />
    <circle cx="130" cy="96" r="9" fill="#F5A623" /><circle cx="130" cy="96" r="4" fill="#C2410C" />
  </Svg>
);
