import React from 'react';

/** Small frame for the Automatic replies step glyphs: a 64 by 56 canvas with a soft tinted disc. Always decorative. */
export const InboxStepFrame: React.FC<{ tint: string; children: React.ReactNode }> = ({ tint, children }) => (
  <svg viewBox="0 0 64 56" width="64" height="56" aria-hidden="true" focusable="false" className="nb-ix-glyph">
    <circle cx="32" cy="28" r="24" fill={tint} />
    {children}
  </svg>
);
