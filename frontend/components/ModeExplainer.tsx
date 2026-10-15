import React from 'react';

export type CreateModeKey = 'campaign' | 'single' | 'carousel' | 'linkedin';

const COPY: Record<CreateModeKey, { title: string; what: string; best: string[] }> = {
  single: {
    title: 'Single post',
    what: 'One picture with one message, ready to post.',
    best: ['Today\'s offer or a new arrival', 'A festival greeting', 'Announcing a change in timings'],
  },
  carousel: {
    title: 'Carousel',
    what: 'One post that people swipe through: 3 to 10 slides that tell one story, step by step.',
    best: ['Explaining how something works', 'Listing tips, steps or products', 'Before and after, or a small story'],
  },
  campaign: {
    title: 'Campaign',
    what: 'A set of separate posts for several days or weeks that share one look and one goal.',
    best: ['A festival week or a sale', 'Launching a new product or shop', 'Keeping your page active around one theme'],
  },
  linkedin: {
    title: 'LinkedIn post',
    what: 'A written post for LinkedIn: a clear point of view in your own voice, with no picture needed.',
    best: ['Sharing what you learned', 'Announcing news about your business', 'Building trust with other businesses'],
  },
};

/** A short, plain explanation of the chosen kind of content: what it is, and when it is the right choice. */
const ModeExplainer: React.FC<{ mode: CreateModeKey }> = ({ mode }) => {
  const c = COPY[mode];
  return (
    <div className="max-w-2xl mx-auto -mt-8 mb-10 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] px-5 py-4" aria-live="polite">
      <p className="text-[14px] font-semibold text-[var(--gv-text-primary)]">{c.title}</p>
      <p className="mt-0.5 text-[13.5px] text-[var(--gv-text-secondary)]">{c.what}</p>
      <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--gv-text-tertiary)]">Good for</p>
      <ul className="mt-1 grid gap-1 sm:grid-cols-3 text-[13px] text-[var(--gv-text-secondary)]">
        {c.best.map((b) => <li key={b} className="flex gap-2"><span aria-hidden="true" className="text-[var(--gv-accent)]">•</span><span>{b}</span></li>)}
      </ul>
    </div>
  );
};

export default ModeExplainer;
