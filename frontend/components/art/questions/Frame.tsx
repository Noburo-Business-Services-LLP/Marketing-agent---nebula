import React from 'react';

/** Frame for the questionnaire tile glyphs: a 56 by 44 canvas with a soft tinted disc. Always decorative. */
export const QFrame: React.FC<{ tint: string; children: React.ReactNode }> = ({ tint, children }) => (
  <svg viewBox="0 0 56 44" width="56" height="44" aria-hidden="true" focusable="false" className="nb-q-glyph">
    <circle cx="28" cy="22" r="20" fill={tint} />
    {children}
  </svg>
);
