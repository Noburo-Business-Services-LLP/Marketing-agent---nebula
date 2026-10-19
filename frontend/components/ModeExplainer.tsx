import React from 'react';
import { Layers, Sparkles, GalleryHorizontalEnd, Linkedin } from 'lucide-react';

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

/** What the chosen kind of content is and when to pick it: one quiet line under the tiles, no box. */
const ModeExplainer: React.FC<{ mode: CreateModeKey }> = ({ mode }) => {
  const c = COPY[mode];
  const Icon = c.Icon;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-snug text-[var(--gv-text-secondary)]" aria-live="polite">
      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--gv-accent)]" aria-hidden="true" />
      <span>{c.what}</span>
      <span className="text-[var(--gv-text-tertiary)]">
        Good for: <span className="sr-only">{c.best.join(', ')}</span>
        <span aria-hidden="true">{c.best.join(' · ')}</span>
      </span>
    </div>
  );
};

export default ModeExplainer;
