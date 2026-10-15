import React from 'react';
import { Layers, Sparkles, GalleryHorizontalEnd, Linkedin, Check } from 'lucide-react';

export type CreateModeKey = 'campaign' | 'single' | 'carousel' | 'linkedin';

const COPY: Record<CreateModeKey, { title: string; what: string; best: string[]; Icon: React.ComponentType<{ className?: string }> }> = {
  single: {
    title: 'Single post',
    what: 'One picture with one message, ready to post.',
    best: ['Today\'s offer or a new arrival', 'A festival greeting', 'A change in timings'],
    Icon: Sparkles,
  },
  carousel: {
    title: 'Carousel',
    what: 'One post people swipe through: 3 to 10 slides that tell one story, step by step.',
    best: ['How something works', 'Tips, steps or products', 'Before and after'],
    Icon: GalleryHorizontalEnd,
  },
  campaign: {
    title: 'Campaign',
    what: 'A set of separate posts over days or weeks, with one look and one goal.',
    best: ['A festival week or a sale', 'Launching a product or shop', 'Staying active around a theme'],
    Icon: Layers,
  },
  linkedin: {
    title: 'LinkedIn post',
    what: 'A written post in your own voice, with a clear point of view. No picture needed.',
    best: ['What you learned', 'News about your business', 'Building trust'],
    Icon: Linkedin,
  },
};

/** What the chosen kind of content is and when to pick it. The tab above already names it, so this is one slim block. */
const ModeExplainer: React.FC<{ mode: CreateModeKey }> = ({ mode }) => {
  const c = COPY[mode];
  const Icon = c.Icon;
  return (
    <div className="max-w-2xl mx-auto mb-6 rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] px-4 py-3" aria-live="polite">
      <p className="flex items-center gap-2 text-[13px] leading-snug text-[var(--gv-text-secondary)]">
        <Icon className="h-4 w-4 shrink-0 text-[var(--gv-accent)]" />
        <span>{c.what}</span>
      </p>
      <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Good for">
        {c.best.map((b) => (
          <li key={b} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--gv-text-secondary)]">
            <Check className="h-3 w-3 text-[var(--gv-accent)]" aria-hidden="true" />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ModeExplainer;
