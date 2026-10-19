import React from 'react';

/** A tiny sample picture (sky, sun, hill) that fills any frame; used inside the shape and logo choices on Create content. Decorative. */
export const SampleSceneArt: React.FC = () => (
  <svg viewBox="0 0 40 40" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="40" height="40" fill="#FFD9A0" />
    <circle cx="13" cy="14" r="5" fill="#EE6330" />
    <path d="M0 30l12-9 8 6 7-5 13 9v9H0z" fill="#3E8B5A" />
    <path d="M0 35l14-5 12 4 14-3v9H0z" fill="#2F6E47" />
  </svg>
);
