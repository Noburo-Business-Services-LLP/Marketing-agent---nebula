import React from 'react';

/** Videos, Length: a timeline cut into the parts the video is made in, a play mark at the start. Decorative. */
export const LengthTimelineArt: React.FC<{ parts: number; of: number; on?: boolean }> = ({ parts, of, on }) => {
  const total = 52;
  const used = Math.round((total * parts) / Math.max(1, of));
  const w = (used - (parts - 1) * 2) / parts;
  return (
    <svg viewBox="0 0 64 24" width="84" height="32" aria-hidden="true" focusable="false">
      <path d="M2 7.5v9l7-4.5z" fill={on ? '#C06F00' : '#14203A'} opacity={on ? 1 : 0.4} />
      <rect x="11" y="10" width={total} height="4" rx="2" fill="#14203A" opacity=".08" />
      {Array.from({ length: parts }, (_, i) => (
        <rect key={i} x={11 + i * (w + 2)} y="10" width={w} height="4" rx="2" fill={on ? '#E8A33D' : '#14203A'} opacity={on ? 1 : 0.32} />
      ))}
    </svg>
  );
};
