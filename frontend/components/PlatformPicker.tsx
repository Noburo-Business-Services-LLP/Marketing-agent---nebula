import React from 'react';
import PlatformIcon from './PlatformIcon';
import { PickerItem, platformHint } from '../utils/platforms';

/**
 * A row of platform icons. Pointing at (or tabbing to) an icon shows what it does, for example
 * "Post to Instagram". Used on Create content, in the video flow and wherever posts are sent.
 */
const PlatformPicker: React.FC<{
  items: PickerItem[];
  selected: string[];
  onToggle: (key: string) => void;
  kind?: 'image' | 'video';
  className?: string;
}> = ({ items, selected, onToggle, kind = 'image', className = '' }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    {items.map((item) => {
      const active = selected.includes(item.key);
      const disabled = Boolean(item.soon || item.blocked);
      const hint = platformHint(item, kind);
      return (
        <div key={item.key} className="relative group">
          <button
            type="button"
            aria-label={hint}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => !disabled && onToggle(item.key)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${disabled ? 'opacity-40 cursor-not-allowed ' : ''}${
              active
                ? 'bg-[var(--gv-surface-3)] text-[var(--gv-text-primary)] border border-[var(--gv-border-strong)]'
                : 'bg-transparent text-[var(--gv-text-muted)] border border-[var(--gv-border-subtle)] hover:text-[var(--gv-text-secondary)]'
            }`}
          >
            <PlatformIcon platform={item.key} className="w-4 h-4" />
          </button>
          {/* shows on hover and on keyboard focus; the wrapper, not the button, so it still shows for a disabled icon */}
          <span
            role="tooltip"
            data-nb-surface="dark"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 z-30 whitespace-nowrap rounded-md bg-[#1B2A4A] px-2.5 py-1 text-[12px] font-medium text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {hint}
          </span>
        </div>
      );
    })}
  </div>
);

export default PlatformPicker;
