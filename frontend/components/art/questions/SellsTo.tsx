import React from 'react';
import { QFrame } from './Frame';

const INK = '#14203A';
const GOLD = '#F5A623';

const Person = ({ x, fill }: { x: number; fill: string }) => (
  <g>
    <circle cx={x} cy="15" r="4.6" fill={fill} stroke={INK} strokeWidth="1.4" />
    <path d={`M${x - 8} 34c0-6 3.6-10 8-10s8 4 8 10z`} fill={fill} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
  </g>
);

const Office = ({ x }: { x: number }) => (
  <g>
    <rect x={x} y="11" width="16" height="24" rx="1.5" fill="#FFFDF8" stroke={INK} strokeWidth="1.5" />
    <path d={`M${x + 4} 16h3M${x + 9} 16h3M${x + 4} 21h3M${x + 9} 21h3M${x + 4} 26h3M${x + 9} 26h3`} stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
    <rect x={x + 6} y="30" width="4" height="5" fill={GOLD} />
  </g>
);

/** People: two customers. */
export const PeopleGlyph = () => (
  <QFrame tint="#FFF0C7">
    <Person x={21} fill={GOLD} />
    <Person x={35} fill="#FFFDF8" />
  </QFrame>
);

/** Businesses: an office block. */
export const BusinessGlyph = () => (
  <QFrame tint="#DCEBFA">
    <Office x={20} />
  </QFrame>
);

/** Both: a customer beside an office block. */
export const BothGlyph = () => (
  <QFrame tint="#FFE3D0">
    <Person x={19} fill={GOLD} />
    <Office x={29} />
  </QFrame>
);
