import React from 'react';
import { BrandFrame } from './Frame';

/** First 30 days: a month page with a few days marked. */
export const BrandMonthArt: React.FC = () => (
  <BrandFrame tint="#D6F1EF">
    <rect x="13" y="13" width="40" height="34" rx="6" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".16" />
    <path d="M13 19a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v4H13z" fill="#1F9D9A" />
    <path d="M22 10v6M44 10v6" stroke="#14203A" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
    <rect x="18" y="27" width="6" height="5" rx="1.5" fill="#F5A623" /><rect x="30" y="27" width="6" height="5" rx="1.5" fill="#D6F1EF" />
    <rect x="42" y="27" width="6" height="5" rx="1.5" fill="#EE6330" /><rect x="18" y="36" width="6" height="5" rx="1.5" fill="#D6F1EF" />
    <rect x="30" y="36" width="6" height="5" rx="1.5" fill="#7B5CC4" /><rect x="42" y="36" width="6" height="5" rx="1.5" fill="#D6F1EF" />
  </BrandFrame>
);
