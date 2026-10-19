import React from 'react';
import { BrandFrame } from './Frame';

/** Brand memory: a lit bulb with two small rays. */
export const BrandBulbArt: React.FC = () => (
  <BrandFrame tint="#FFF0C7">
    <path d="M33 11c-8 0-14 6-14 13 0 5 3 8 5 10 1.5 1.6 2 3 2 5h14c0-2 .5-3.4 2-5 2-2 5-5 5-10 0-7-6-13-14-13z" fill="#FFCB2E" />
    <path d="M28 33c0-5 2-9 5-12" fill="none" stroke="#FFFDF8" strokeWidth="2.5" strokeLinecap="round" />
    <rect x="26" y="40" width="14" height="4" rx="2" fill="#14203A" opacity=".55" />
    <rect x="28" y="45.5" width="10" height="4" rx="2" fill="#14203A" opacity=".4" />
    <path d="M12 20l-4-2M54 20l4-2M14 33l-4 1M52 33l4 1" stroke="#F5A623" strokeWidth="2.5" strokeLinecap="round" />
  </BrandFrame>
);
