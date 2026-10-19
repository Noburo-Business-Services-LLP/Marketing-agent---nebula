import React from 'react';

/** Create content, Look: Balanced. A picture, a clear headline, two lines of support and a button. Decorative. */
export const LookBalancedArt: React.FC = () => (
  <svg viewBox="0 0 40 48" width="40" height="48" aria-hidden="true" focusable="false">
    <rect x=".5" y=".5" width="39" height="47" rx="4" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".14" />
    <rect x="4" y="4" width="32" height="20" rx="2.5" fill="#FFD27A" />
    <circle cx="12" cy="11" r="3" fill="#EE6330" />
    <path d="M4 21l9-7 6 5 5-4 12 8v1a2.5 2.5 0 0 1-2.5 2.5h-27A2.5 2.5 0 0 1 4 24z" fill="#3E8B5A" />
    <rect x="4" y="28" width="24" height="3" rx="1.5" fill="#14203A" opacity=".6" />
    <rect x="4" y="33.5" width="30" height="2" rx="1" fill="#14203A" opacity=".2" />
    <rect x="4" y="37.5" width="22" height="2" rx="1" fill="#14203A" opacity=".2" />
    <rect x="25" y="41" width="11" height="4" rx="2" fill="#E8A33D" />
  </svg>
);
