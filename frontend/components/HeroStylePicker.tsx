import React, { useMemo, useRef, useState } from 'react';
import { VideoStyleTile, VideoStyleChips } from './video/VideoStyleTile';
import { StyleFilter, groupOf, groupLabel, safeFilter } from '../utils/videoStyleGroups';
import { HeroStyleOption } from '../services/api';

// Hero Studio style picker: category chips and a radio group of the shared video style tiles (components/video).
// Arrow keys move and select, Home/End jump, and only the selected card is in the tab order.
// Uses the gravity theme tokens, so it reads in light and dark.

interface Props {
  styles: HeroStyleOption[];
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
}

const HeroStylePicker: React.FC<Props> = ({ styles: allStyles, value, onChange, disabled }) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const keyed = useMemo(() => allStyles.map((s) => ({ key: s.slug })), [allStyles]);
  const [want, setWant] = useState<StyleFilter>('all');
  const filter = safeFilter(keyed, want);
  // The chips narrow the cards; the chosen style stays chosen when its kind is hidden.
  const styles = filter === 'all' ? allStyles : allStyles.filter((s) => groupOf(s.slug) === filter);
  const found = styles.findIndex((s) => s.slug === value);
  const selectedIndex = Math.max(0, found);
  const chosen = allStyles.find((s) => s.slug === value);

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
    <div>
      <VideoStyleChips styles={keyed} value={filter} onChange={setWant} />
      {chosen && found < 0 && <p className="mb-2 text-[12px] text-[var(--gv-text-secondary)]">Chosen: {chosen.label}</p>}
      <div className="nb-vstyle-wrap">
        <div role="radiogroup" aria-label="Video style" className="nb-vstyle-grid">
          {styles.map((s, i) => (
            <div key={s.slug} className="nb-vstyle-cell">
              <VideoStyleTile
                ref={(el) => { refs.current[i] = el; }}
                label={s.label}
                hint={s.blurb}
                image={s.coverUrl}
                group={filter === 'all' ? groupLabel(s.slug) : undefined}
                selected={s.slug === value}
                tabIndex={i === selectedIndex ? 0 : -1}
                disabled={disabled}
                onSelect={() => onChange(s.slug)}
                onKeyDown={(e) => onKeyDown(e, i)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HeroStylePicker;
