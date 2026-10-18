import React from 'react';

/**
 * A deep-ink feature panel with a soft gold glow border: the dark accent against the light page.
 * Use it sparingly (two or three per page at most) for the one thing the page most wants noticed.
 * Colours are set in index.html (.nb-darkpanel) so text keeps AA contrast on the ink.
 */
const DarkPanel: React.FC<{ title: string; eyebrow?: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }> = ({ title, eyebrow, children, action, className }) => (
  <section className={`nb-darkpanel${className ? ` ${className}` : ''}`} data-nb-surface="dark">
    {eyebrow && <p className="nb-darkpanel-eyebrow">{eyebrow}</p>}
    <h2 className="nb-darkpanel-title">{title}</h2>
    {children && <p className="nb-darkpanel-text">{children}</p>}
    {action && <div className="nb-darkpanel-action">{action}</div>}
  </section>
);

export default DarkPanel;
