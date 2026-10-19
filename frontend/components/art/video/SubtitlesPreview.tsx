import React from 'react';

/** Videos, Subtitles: a small vertical video with two lines of words near the bottom. Decorative. */
export const SubtitlesPreviewArt: React.FC<{ on?: boolean }> = ({ on }) => (
  <svg viewBox="0 0 28 44" width="28" height="44" aria-hidden="true" focusable="false">
    <rect x=".5" y=".5" width="27" height="43" rx="4" fill="#FFFDF8" stroke="#14203A" strokeOpacity=".16" />
    <circle cx="14" cy="15" r="6" fill="#F3E3C2" />
    <path d="M6 30c3-4 6-5 8-5s5 1 8 5z" fill="#F3E3C2" />
    <rect x="5" y="32" width="18" height="3" rx="1.5" fill={on ? '#E8A33D' : '#14203A'} opacity={on ? 1 : 0.4} />
    <rect x="8" y="37" width="12" height="2.6" rx="1.3" fill={on ? '#E8A33D' : '#14203A'} opacity={on ? 0.7 : 0.25} />
  </svg>
);
