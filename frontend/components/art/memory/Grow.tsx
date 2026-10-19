import React from 'react';
import { Svg, ArtProps } from '../Svg';

/** Brand memory, nothing learned yet: three rising bars with a small sprout on the tallest and a sparkle. */
export const MemoryGrowArt: React.FC<ArtProps> = (p) => (
  <Svg {...p} tint="#FFF0C7">
    <path d="M38 98h84" stroke="#14203A" strokeOpacity=".18" strokeWidth="3" strokeLinecap="round" />
    <rect x="46" y="74" width="18" height="24" rx="5" fill="#EE6330" />
    <rect x="71" y="60" width="18" height="38" rx="5" fill="#F5A623" />
    <rect x="96" y="46" width="18" height="52" rx="5" fill="#6E9B4E" />
    <path d="M105 46V30" stroke="#44692C" strokeWidth="3" strokeLinecap="round" />
    <path d="M105 36c-9 0-13-6-13-12 8 0 13 5 13 12zM105 32c0-8 5-13 13-13 0 8-5 13-13 13z" fill="#6E9B4E" />
    <path transform="translate(40 40) scale(1.1)" d="M0-9 2.4-2.4 9 0 2.4 2.4 0 9-2.4 2.4-9 0-2.4-2.4z" fill="#FFCB2E" />
    <circle cx="130" cy="66" r="3" fill="#7B5CC4" />
  </Svg>
);
