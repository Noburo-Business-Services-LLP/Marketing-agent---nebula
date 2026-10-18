import React from 'react';

export interface ArtProps { title?: string }

/** Shared frame for the illustration set: a 160 by 120 canvas with a soft background blob. Decorative unless a title is given. */
export const Svg: React.FC<ArtProps & { tint: string; children: React.ReactNode }> = ({ title, tint, children }) => (
  <svg
    viewBox="0 0 160 120" width="160" height="120" preserveAspectRatio="xMidYMid meet"
    {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: 'false' })}
  >
    {title && <title>{title}</title>}
    <path d="M18 66C10 36 40 12 80 12s68 22 62 54-28 48-62 48S26 96 18 66z" fill={tint} />
    {children}
  </svg>
);
