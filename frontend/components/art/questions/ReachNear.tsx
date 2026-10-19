import React from 'react';
import { QFrame } from './Frame';

const INK = '#14203A';
const GOLD = '#F5A623';

/** My area: a small house with a map pin. */
export const AreaGlyph = () => (
  <QFrame tint="#FFF0C7">
    <path d="M14 26l9-8 9 8v9H14z" fill="#FFFDF8" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
    <rect x="20.5" y="28" width="5" height="7" rx="1" fill={GOLD} />
    <path d="M40 9a6 6 0 0 0-6 6c0 4.5 6 11 6 11s6-6.5 6-11a6 6 0 0 0-6-6z" fill="#EE6330" />
    <circle cx="40" cy="15" r="2.2" fill="#FFFDF8" />
  </QFrame>
);

/** My city: three buildings. */
export const CityGlyph = () => (
  <QFrame tint="#FFE3D0">
    <rect x="13" y="20" width="9" height="16" rx="1.2" fill="#FFFDF8" stroke={INK} strokeWidth="1.5" />
    <rect x="23" y="11" width="10" height="25" rx="1.2" fill={GOLD} stroke={INK} strokeWidth="1.5" />
    <rect x="34" y="17" width="9" height="19" rx="1.2" fill="#FFFDF8" stroke={INK} strokeWidth="1.5" />
    <path d="M26 16h4M26 21h4M26 26h4M16 24h3M16 29h3M37 22h3M37 27h3" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
  </QFrame>
);

