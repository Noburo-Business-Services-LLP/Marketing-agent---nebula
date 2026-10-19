import React from 'react';
import type { Platform, PostShape } from '../../utils/planVisuals';

/**
 * Small drawn marks for My plan: a channel mark (a simple generic glyph on a colour square, not a copy of any logo)
 * and a mini post thumbnail for each post shape. Shapes only, decorative, sized in CSS.
 */

const MARK_BG: Record<Platform, string> = {
  instagram: '#D8527A', facebook: '#3B6FD0', whatsapp: '#2E9D6A', google: '#3B82C4', youtube: '#C2361F', linkedin: '#2867B2',
  x: '#33405C', website: '#1F9D9A', email: '#7B5CC4', offline: '#6E9B4E', other: '#F5A623',
};

const W = { fill: 'none', stroke: '#FFFDF8', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const GLYPH: Record<Platform, React.ReactNode> = {
  instagram: <><rect x="6.5" y="6.5" width="11" height="11" rx="3.2" {...W} /><circle cx="12" cy="12" r="2.6" {...W} /><circle cx="15.2" cy="8.8" r=".9" fill="#FFFDF8" /></>,
  facebook: <path d="M13.2 18.5v-5.6h1.9l.3-2.2h-2.2V9.3c0-.6.2-1.1 1.1-1.1h1.2v-2c-.2 0-.9-.1-1.7-.1-1.7 0-2.8 1-2.8 2.9v1.7H9v2.2h2v5.6z" fill="#FFFDF8" />,
  whatsapp: <><path d="M12 6a6 6 0 0 0-5.2 9l-.8 3 3.1-.8A6 6 0 1 0 12 6z" {...W} /><path d="M10 10.2c.3 1.6 1.7 3.1 3.6 3.6" {...W} /></>,
  google: <><path d="M12 18.5s-4.8-4.3-4.8-8a4.8 4.8 0 0 1 9.6 0c0 3.7-4.8 8-4.8 8z" fill="#FFFDF8" /><circle cx="12" cy="10.4" r="1.8" fill="#3B82C4" /></>,
  youtube: <><rect x="5.5" y="7.5" width="13" height="9" rx="2.6" fill="#FFFDF8" /><path d="M10.6 9.8v4.4l3.8-2.2z" fill="#C2361F" /></>,
  linkedin: <><circle cx="8.6" cy="7.9" r="1.2" fill="#FFFDF8" /><path d="M8.6 10.5v6.5M11.8 17v-6.5M11.8 13.2c0-1.6 1-2.7 2.3-2.7s2.2.9 2.2 2.6V17" {...W} /></>,
  x: <path d="M7.5 7l9 10M16.5 7l-9 10" {...W} />,
  website: <><circle cx="12" cy="12" r="5.8" {...W} /><path d="M6.2 12h11.6M12 6.2c-2.4 3.4-2.4 8.2 0 11.6M12 6.2c2.4 3.4 2.4 8.2 0 11.6" {...W} strokeWidth={1.4} /></>,
  email: <><rect x="6" y="8" width="12" height="8.6" rx="1.6" {...W} /><path d="M6.6 8.8l5.4 4 5.4-4" {...W} /></>,
  offline: <><path d="M6.5 10.5l1.2-3.5h8.6l1.2 3.5z" fill="#FFFDF8" /><path d="M7.5 11v6.5h9V11" {...W} /><path d="M11 17.5v-3.4h2v3.4" {...W} strokeWidth={1.4} /></>,
  other: <><path d="M6.5 10.5h2.8l6.2-3.4v9.8l-6.2-3.4H6.5z" fill="#14203A" fillOpacity=".8" /><path d="M17.4 10.2a2.6 2.6 0 0 1 0 3.6" fill="none" stroke="#14203A" strokeOpacity=".8" strokeWidth="1.6" strokeLinecap="round" /></>,
};

export const PlatformMark: React.FC<{ platform: Platform; size?: number }> = ({ platform, size = 28 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="nb-plan-mark">
    <rect width="24" height="24" rx="7" fill={MARK_BG[platform]} />
    {GLYPH[platform]}
  </svg>
);

/** Card colours for the mini posts, one per tone (gold, coral, teal, sage, lilac). */
export const TONES = [
  { deep: '#F5A623', soft: '#FFF0C7' },
  { deep: '#EE6330', soft: '#FFE3D0' },
  { deep: '#1F9D9A', soft: '#D6F1EF' },
  { deep: '#6E9B4E', soft: '#E3EFD9' },
  { deep: '#7B5CC4', soft: '#ECE6FB' },
];

/** A tiny post: a square image post, a stack of carousel slides, or a tall reel or story. */
export const PostThumb: React.FC<{ shape: PostShape; tone?: number }> = ({ shape, tone = 0 }) => {
  const t = TONES[((tone % TONES.length) + TONES.length) % TONES.length];
  const card = { fill: '#FFFDF8', stroke: '#14203A', strokeOpacity: 0.16 };
  return (
    <svg viewBox="0 0 36 44" width="36" height="44" aria-hidden="true" focusable="false" className="nb-plan-thumb">
      {shape === 'carousel' && <rect x="9" y="5" width="25" height="27" rx="3.5" fill={t.soft} stroke="#14203A" strokeOpacity=".12" />}
      {(shape === 'image' || shape === 'carousel' || shape === 'other') && (
        <>
          <rect x="2" y="9" width="27" height="27" rx="3.5" {...card} />
          <rect x="5" y="12" width="21" height="15" rx="2" fill={t.soft} />
          <circle cx="21" cy="16" r="2.2" fill={t.deep} />
          <path d="M5 27l6-6 4 4 3-3 8 5z" fill={t.deep} opacity=".85" />
          <rect x="5" y="30" width="13" height="2.4" rx="1.2" fill="#14203A" fillOpacity=".25" />
          {shape === 'carousel' && <><circle cx="12.5" cy="40" r="1.3" fill={t.deep} /><circle cx="16.5" cy="40" r="1.3" fill="#14203A" fillOpacity=".2" /><circle cx="20.5" cy="40" r="1.3" fill="#14203A" fillOpacity=".2" /></>}
        </>
      )}
      {(shape === 'reel' || shape === 'story') && (
        <>
          <rect x="7" y="2" width="22" height="40" rx="4" {...card} />
          <rect x="9.5" y="4.5" width="17" height="35" rx="2.5" fill={t.soft} />
          {shape === 'reel'
            ? <><circle cx="18" cy="21" r="6" fill={t.deep} /><path d="M16.2 18.2v5.6l4.6-2.8z" fill="#FFFDF8" /></>
            : <><rect x="11" y="6.5" width="14" height="1.8" rx=".9" fill={t.deep} /><circle cx="13.5" cy="12.5" r="2.2" fill={t.deep} /><path d="M11 34h14" stroke="#14203A" strokeOpacity=".25" strokeWidth="2.2" strokeLinecap="round" /></>}
        </>
      )}
    </svg>
  );
};
