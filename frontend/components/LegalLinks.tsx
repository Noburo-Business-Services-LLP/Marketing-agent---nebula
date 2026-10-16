import React from 'react';
import { LEGAL_PAGES } from '../constants/legal';

/** Terms, Privacy and Refunds, as plain links. Used in the footers so the legal pages are one click away everywhere. */
const LegalLinks: React.FC<{ className?: string; linkClassName?: string }> = ({ className = '', linkClassName = 'hover:underline underline-offset-2' }) => (
  <nav aria-label="Legal" className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 ${className}`}>
    {LEGAL_PAGES.map((p) => <a key={p.href} href={p.href} className={linkClassName}>{p.label}</a>)}
  </nav>
);

export default LegalLinks;
