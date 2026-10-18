import React from 'react';

/**
 * Cover art for the plan and add-on cards on the Plans page. Simple warm illustrations drawn in SVG,
 * so they load instantly, need no image files and stay sharp at any width. Decorative only.
 */
type Art = { bg: [string, string]; draw: React.ReactNode };

const INK = '#14203A';
const CORAL = '#EE6330';
const SUN = '#FFCB2E';
const GOLD = '#F5A623';
const CREAM = '#FFFDF8';

const tile = (x: number, y: number, w: number, h: number, fill: string, r = 10) => (
  <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx={r} fill={fill} stroke={INK} strokeOpacity="0.12" />
);

const ART: Record<string, Art> = {
  starter: {
    bg: ['#FFE9D2', '#FFD4B0'],
    draw: (
      <>
        <circle cx="320" cy="34" r="22" fill={SUN} />
        {tile(150, 30, 100, 86, CREAM, 12)}
        {tile(160, 40, 80, 46, '#FFB88A', 8)}
        <rect x="160" y="94" width="56" height="6" rx="3" fill={INK} opacity="0.55" />
        <rect x="160" y="105" width="36" height="5" rx="2.5" fill={INK} opacity="0.25" />
        <path d="M70 120 C70 96 72 84 80 70" stroke="#3E8B5A" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M80 70 C62 68 56 58 56 48 C70 48 80 56 80 70Z" fill="#5FB57A" />
        <path d="M80 82 C98 80 106 70 106 58 C92 58 80 68 80 82Z" fill="#3E8B5A" />
      </>
    ),
  },
  professional: {
    bg: ['#FFF0C7', '#FFD97A'],
    draw: (
      <>
        <circle cx="330" cy="30" r="20" fill={CORAL} opacity="0.9" />
        {tile(70, 80, 50, 40, CREAM, 8)}
        {tile(130, 62, 50, 58, CREAM, 8)}
        {tile(190, 44, 50, 76, CREAM, 8)}
        {tile(250, 26, 50, 94, CREAM, 8)}
        <rect x="80" y="92" width="30" height="5" rx="2.5" fill={GOLD} />
        <rect x="140" y="76" width="30" height="5" rx="2.5" fill={GOLD} />
        <rect x="200" y="58" width="30" height="5" rx="2.5" fill={GOLD} />
        <rect x="260" y="40" width="30" height="5" rx="2.5" fill={GOLD} />
        <path d="M80 70 L150 52 L215 34 L280 14" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="1 8" />
      </>
    ),
  },
  agency: {
    bg: ['#DCEBFA', '#C9DDF5'],
    draw: (
      <>
        {tile(60, 50, 64, 56, '#FFE3D0')}
        {tile(106, 26, 64, 56, '#DDF2E6')}
        {tile(152, 52, 64, 56, CREAM)}
        {tile(198, 24, 64, 56, '#ECE6FB')}
        {tile(244, 50, 64, 56, '#FFF0C7')}
        {[84, 130, 176, 222, 268].map((x, i) => <circle key={x} cx={x} cy={i % 2 ? 60 : 80} r="9" fill={[CORAL, '#3E8B5A', INK, '#7A5BD0', GOLD][i]} opacity="0.85" />)}
        <circle cx="344" cy="34" r="18" fill={SUN} />
      </>
    ),
  },
  publish: {
    bg: ['#DDF2E6', '#BFE6CF'],
    draw: (
      <>
        {tile(122, 34, 112, 76, CREAM, 12)}
        {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={132 + (i % 3) * 32} y={46 + Math.floor(i / 3) * 28} width="26" height="20" rx="5" fill={i === 4 ? CORAL : '#E5D8BF'} />)}
        <path d="M232 62 L282 34 L262 82 L252 66 Z" fill={INK} />
        <path d="M252 66 L282 34" stroke={CREAM} strokeWidth="2" />
      </>
    ),
  },
  competitors: {
    bg: ['#ECE6FB', '#DAD0F6'],
    draw: (
      <>
        {[18, 38, 58].map((r) => <circle key={r} cx="200" cy="70" r={r} fill="none" stroke={INK} strokeOpacity="0.22" strokeWidth="2" />)}
        <circle cx="200" cy="70" r="6" fill={INK} />
        <path d="M200 70 L252 36" stroke={CORAL} strokeWidth="3" strokeLinecap="round" />
        <circle cx="236" cy="46" r="7" fill={CORAL} />
        <circle cx="160" cy="92" r="6" fill={GOLD} />
        <circle cx="176" cy="40" r="5" fill="#3E8B5A" />
        <circle cx="262" cy="94" r="5" fill="#7A5BD0" />
      </>
    ),
  },
  inbox: {
    bg: ['#FFE3D0', '#FFCDAE'],
    draw: (
      <>
        <path d="M120 30 h86 a12 12 0 0 1 12 12 v28 a12 12 0 0 1 -12 12 h-52 l-18 16 v-16 h-16 a12 12 0 0 1 -12 -12 v-28 a12 12 0 0 1 12 -12z" fill={CREAM} stroke={INK} strokeOpacity="0.12" />
        <rect x="130" y="44" width="62" height="6" rx="3" fill={INK} opacity="0.5" />
        <rect x="130" y="56" width="40" height="6" rx="3" fill={INK} opacity="0.25" />
        <path d="M196 70 h56 a10 10 0 0 1 10 10 v18 a10 10 0 0 1 -10 10 h-8 v14 l-16 -14 h-32 a10 10 0 0 1 -10 -10 v-18 a10 10 0 0 1 10 -10z" fill={GOLD} />
        <rect x="204" y="80" width="40" height="6" rx="3" fill={INK} opacity="0.55" />
        <rect x="204" y="91" width="26" height="6" rx="3" fill={INK} opacity="0.3" />
      </>
    ),
  },
  bundle: {
    bg: ['#FFF0C7', '#FFE0A0'],
    draw: (
      <>
        <circle cx="160" cy="64" r="40" fill={CORAL} opacity="0.75" />
        <circle cx="210" cy="64" r="40" fill="#7A5BD0" opacity="0.6" />
        <circle cx="185" cy="38" r="40" fill="#3E8B5A" opacity="0.6" />
        <circle cx="300" cy="30" r="14" fill={SUN} />
      </>
    ),
  },
};

/** A top-up pack: a stack of post cards that grows with the size of the pack (level 1 to 5), with one play-button card. */
const topupArt = (level: number): Art => {
  const n = Math.min(5, Math.max(1, Math.round(level)));
  const tints = ['#FFE3D0', '#DDF2E6', '#ECE6FB', '#FFF0C7', '#DCEBFA'];
  const x0 = 200 - (n * 26 + 34) / 2;
  return {
    bg: ['#FFF0C7', '#FFE0A0'],
    draw: (
      <>
        {Array.from({ length: n }, (_, i) => (
          <g key={i} transform={`translate(${x0 + i * 26} ${58 - i * 6})`}>
            {tile(0, 0, 54, 50, i === n - 1 ? CREAM : tints[i % tints.length], 9)}
            <rect x="8" y="9" width="38" height="20" rx="5" fill={i === n - 1 ? '#FFB88A' : GOLD} opacity={i === n - 1 ? 1 : 0.5} />
            <rect x="8" y="35" width="26" height="5" rx="2.5" fill={INK} opacity="0.35" />
          </g>
        ))}
        <circle cx="318" cy="30" r="14" fill={SUN} />
      </>
    ),
  };
};

const PlanArt: React.FC<{ id: string; level?: number; className?: string }> = ({ id, level = 1, className = '' }) => {
  const art = id === 'topup' ? topupArt(level) : (ART[id] || ART.starter);
  return (
    <div
      className={`overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, ${art.bg[0]}, ${art.bg[1]})` }}
      aria-hidden="true"
      data-plan-art={id}
    >
      <svg viewBox="50 0 300 120" preserveAspectRatio="xMidYMid meet" className="block h-full w-full">
        {art.draw}
      </svg>
    </div>
  );
};

export default PlanArt;
