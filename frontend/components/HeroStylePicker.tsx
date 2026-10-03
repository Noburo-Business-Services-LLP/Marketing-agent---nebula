import React, { useRef } from 'react';
import { Check } from 'lucide-react';
import { HeroStyleOption } from '../services/api';

// Hero Studio style picker: a radio group of cover cards (image, label, blurb, selected glow).
// Arrow keys move and select, Home/End jump, and only the selected card is in the tab order.
// Uses the gravity theme tokens, so it reads in light and dark.

interface Props {
  styles: HeroStyleOption[];
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
}

const HeroStylePicker: React.FC<Props> = ({ styles, value, onChange, disabled }) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, styles.findIndex((s) => s.slug === value));
  // Photographic covers are 3:4; the shipped illustrations are 16:9. Keep the grid uniform.
  const allPhotos = styles.length > 0 && styles.every((s) => /\.jpe?g$/i.test(s.coverUrl));

  const move = (from: number, to: number) => {
    const n = styles.length;
    if (!n) return;
    const i = ((to % n) + n) % n;
    if (i === from) return;
    onChange(styles[i].slug);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (disabled) return;
    const keys: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: styles.length - 1 };
    if (e.key in keys) {
      e.preventDefault();
      move(i, keys[e.key]);
    }
  };

  return (
    <div role="radiogroup" aria-label="Video style" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {styles.map((s, i) => {
        const on = s.slug === value;
        return (
          <button
            key={s.slug}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${s.label}. ${s.blurb}`}
            tabIndex={i === selectedIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(s.slug)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`group relative text-left rounded-xl overflow-hidden border-2 bg-[var(--gv-surface-1)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--gv-bg)] disabled:opacity-50 disabled:cursor-not-allowed ${
              on
                ? 'border-[var(--gv-accent)] shadow-[0_0_0_4px_rgb(var(--gv-accent-rgb)/0.18),0_10px_28px_-8px_rgb(var(--gv-accent-rgb)/0.55)]'
                : 'border-[var(--gv-border-subtle)] hover:border-[var(--gv-border-strong)]'
            }`}
          >
            <div className="relative overflow-hidden bg-[var(--gv-surface-2)]">
              <img
                src={s.coverUrl}
                alt=""
                loading="lazy"
                className={`w-full ${allPhotos ? 'aspect-[3/4]' : 'aspect-video'} object-cover transition-transform duration-300 ${
                  on ? 'scale-[1.03]' : 'group-hover:scale-[1.03]'
                }`}
              />
              {on && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] flex items-center justify-center shadow">
                  <Check className="w-3 h-3" strokeWidth={3} />
                </span>
              )}
            </div>
            <div className={`px-2.5 py-2 ${on ? 'bg-[var(--gv-accent-fill)]' : ''}`}>
              <div className={`text-[12.5px] font-semibold leading-tight ${on ? 'text-[var(--gv-accent-text)]' : 'text-[var(--gv-text-primary)]'}`}>
                {s.label}
              </div>
              <div className="text-[11px] leading-snug mt-0.5 line-clamp-2 text-[var(--gv-text-tertiary)]">{s.blurb}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default HeroStylePicker;
