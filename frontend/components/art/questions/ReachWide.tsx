import React from 'react';
import { QFrame } from './Frame';

const INK = '#14203A';
const GOLD = '#F5A623';

const MAP = 'M12 13l10-3 12 3 10-3v21l-10 3-12-3-10 3z';

/** My state: a folded map with a route. */
export const StateGlyph = () => (
  <QFrame tint="#D6F1EF">
    <path d={MAP} fill="#FFFDF8" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M22 10v21M34 13v21" stroke={INK} strokeWidth="1.2" opacity=".45" />
    <path d="M16 26c5-1 6-8 12-8s7 5 12 3" fill="none" stroke="#1F9D9A" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.5 3.5" />
    <circle cx="40" cy="21" r="2.6" fill={GOLD} stroke={INK} strokeWidth="1.2" />
  </QFrame>
);

/** All of India: a map with pins in several places. */
export const IndiaGlyph = () => (
  <QFrame tint="#FFF0C7">
    <path d={MAP} fill="#FFFDF8" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="18" cy="18" r="2.4" fill="#EE6330" />
    <circle cx="28" cy="24" r="2.4" fill={GOLD} />
    <circle cx="37" cy="16" r="2.4" fill="#1F9D9A" />
    <circle cx="33" cy="29" r="2.4" fill="#EE6330" />
  </QFrame>
);

/** Other countries: a globe. */
export const WorldGlyph = () => (
  <QFrame tint="#DCEBFA">
    <circle cx="28" cy="22" r="13" fill="#FFFDF8" stroke={INK} strokeWidth="1.6" />
    <ellipse cx="28" cy="22" rx="5.5" ry="13" fill="none" stroke={INK} strokeWidth="1.3" />
    <path d="M15 22h26M17 15h22M17 29h22" stroke={INK} strokeWidth="1.2" />
    <circle cx="39" cy="12" r="3" fill={GOLD} />
  </QFrame>
);
