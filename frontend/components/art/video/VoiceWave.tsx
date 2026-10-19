import React from 'react';

/** Videos, Voice: a small voice wave. The lighter voice has quicker, taller peaks; the deeper one slower, rounder ones. Decorative. */
const LIGHT = [6, 12, 20, 10, 24, 14, 8, 18, 22, 9, 15, 6];
const DEEP = [8, 12, 15, 17, 18, 17, 15, 12, 14, 16, 12, 8];

export const VoiceWaveArt: React.FC<{ deep?: boolean; on?: boolean }> = ({ deep, on }) => (
  <svg viewBox="0 0 56 28" width="56" height="28" aria-hidden="true" focusable="false">
    {(deep ? DEEP : LIGHT).map((h, i) => (
      <rect key={i} x={2 + i * 4.4} y={14 - h / 2} width="2.4" height={h} rx="1.2" fill={on ? '#E8A33D' : '#14203A'} opacity={on ? 1 : 0.28} />
    ))}
  </svg>
);
