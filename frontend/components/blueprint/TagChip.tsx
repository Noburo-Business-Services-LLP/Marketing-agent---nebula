import React from 'react';
import { claimLabel } from '../../utils/blueprint';
import type { BlueprintTag } from '../../utils/blueprint';

const BG: Record<BlueprintTag, string> = {
  verified: 'var(--gv-mint)',
  inference: 'var(--gv-sky)',
  proposed: 'var(--gv-lav)',
  unverified: 'var(--gv-peach)',
};

/** The tag is always spelled out, so its meaning never depends on colour. */
const TagChip: React.FC<{ tag: BlueprintTag; className?: string }> = ({ tag, className = '' }) => (
  <span
    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold leading-5 ${className}`}
    style={{ background: BG[tag], color: 'var(--gv-text-primary)', border: '1px solid var(--gv-border-subtle)' }}
  >
    {claimLabel(tag)}
  </span>
);

export default TagChip;
