import React from 'react';

/** Small frame for the Brand, Blueprint and Performance glyphs: a 64 by 56 canvas with a soft tinted disc. Always decorative. */
export const BrandFrame: React.FC<{ tint: string; children: React.ReactNode }> = ({ tint, children }) => (
  <svg viewBox="0 0 64 56" width="64" height="56" aria-hidden="true" focusable="false" className="nb-brand-glyph">
    <circle cx="34" cy="29" r="24" fill={tint} />
    {children}
  </svg>
);
