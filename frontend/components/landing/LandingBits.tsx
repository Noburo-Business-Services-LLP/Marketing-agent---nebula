import React from 'react';
import { ArrowRight } from 'lucide-react';

/**
 * Small shared pieces of the public landing page. The app uses a HashRouter, so a plain "#plans" link would be
 * read as a route; in-page links scroll to their section instead and leave the address alone.
 */
export function scrollToSection(id: string, e?: React.MouseEvent): void {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!el) return;
  e?.preventDefault();
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  // Move focus for keyboard and screen reader users without a second jump.
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/** An in-page link to one section. */
export const SectionLink: React.FC<{ id: string; className?: string; kind?: 'outline'; onDone?: () => void; children: React.ReactNode }> = ({ id, className, kind, onDone, children }) => (
  <a href={`#${id}`} className={className} data-kind={kind} onClick={(e) => { scrollToSection(id, e); onDone?.(); }}>{children}</a>
);

/** The section heading: eyebrow, serif title with a gold italic emphasis, an optional line. */
export const SectionHead: React.FC<{ id: string; eyebrow: string; title: string; emphasis: string; line?: string; center?: boolean }> = ({ id, eyebrow, title, emphasis, line, center }) => (
  <div className="nb-land-head" data-center={center ? '' : undefined}>
    <p className="nb-land-eyebrow">{eyebrow}</p>
    <h2 className="nb-land-h2" id={id}>{title} <span className="nb-land-em">{emphasis}</span></h2>
    {line && <p className="nb-land-lede">{line}</p>}
  </div>
);

/** The one gold action (sign up). A real button. */
export const GoldButton: React.FC<{ onClick: () => void; children: React.ReactNode; size?: 'sm'; full?: boolean; arrow?: boolean }> = ({ onClick, children, size, full, arrow = true }) => (
  <button type="button" className="nb-land-btn" data-kind="gold" data-size={size} data-full={full ? '' : undefined} onClick={onClick}>
    {children}
    {arrow && <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />}
  </button>
);
