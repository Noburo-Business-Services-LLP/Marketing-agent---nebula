import React, { useRef } from 'react';
import { stepChoice } from '../../utils/logoChoice';
import { tileColumns } from '../../utils/videoOptionTiles';
import './videoOptions.css';

/**
 * The Videos options (pages/CreateVideo.tsx, step "Make it yours"), in the Create options style: every choice is a
 * picture tile of one height with a light border and a gold ring when chosen, labels are small uppercase muted
 * headings, and every row fills the full width of the column with equal tiles. Single choices are radio groups
 * (Tab reaches the chosen tile, the arrow keys move and choose); on and off choices are switches.
 */

/** A section: the small uppercase heading, the row, and an optional quiet line under it. */
export const OptionSection: React.FC<{ label: string; note?: string; id?: string; className?: string; children: React.ReactNode }> = ({ label, note, id, className = '', children }) => (
  <section className={`nb-vopt-section ${className}`} aria-labelledby={id}>
    <h3 id={id} className="nb-vopt-label">{label}{note && <span className="nb-vopt-note">{note}</span>}</h3>
    {children}
  </section>
);

/** Two sections side by side on a wide screen, stacked on a phone. A single section fills the row. */
export const OptionPair: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="nb-vopt-pair">{children}</div>;

/** A calm full-width strip of centred lines, for the helper text under a row. */
export const InfoStrip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`nb-vopt-info ${className}`}>
    <div className="nb-vopt-info-text">{children}</div>
  </div>
);

export interface VideoChoice {
  value: string;
  name: string;
  line?: string;
  /** Read out with the name. */
  description?: string;
  art: (on: boolean) => React.ReactNode;
}

const cols = (count: number, iconsOnly = false) => ({
  '--n': tileColumns(count, false, iconsOnly),
  '--n-phone': tileColumns(count, true, iconsOnly),
}) as React.CSSProperties;

/** One row of single-choice tiles that fills the width, with roving focus. */
export const ChoiceTiles: React.FC<{
  label: string; value: string; choices: VideoChoice[]; onChange: (v: string) => void; size?: 'md' | 'sm';
}> = ({ label, value, choices, onChange, size = 'md' }) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = choices.findIndex((c) => c.value === value);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = stepChoice(choices.length, i, e.key);
    if (next === i || next < 0) return;
    e.preventDefault();
    onChange(choices[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="nb-vopt-tiles" role="radiogroup" aria-label={label} style={cols(choices.length)} data-two={tileColumns(choices.length, true) === 2 && choices.length > 3}>
      {choices.map((c, i) => {
        const on = i === current;
        return (
          <button
            key={c.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={[c.name, c.line, c.description].filter(Boolean).join(', ')}
            title={c.line}
            tabIndex={on || (current < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(c.value)}
            onKeyDown={(e) => onKey(e, i)}
            className="nb-vopt-tile"
            data-on={on}
            data-size={size}
          >
            <span className="nb-vopt-art" aria-hidden="true">{c.art(on)}</span>
            <span className="nb-vopt-name">{c.name}</span>
            {c.line && <span className="nb-vopt-line">{c.line}</span>}
          </button>
        );
      })}
    </div>
  );
};

/** Several-at-once tiles (the platforms): each one is a pressed or not pressed button. */
export const MultiTiles: React.FC<{
  label: string;
  items: Array<{ key: string; name: string; hint: string; disabled?: boolean; art: (on: boolean) => React.ReactNode }>;
  selected: string[];
  onToggle: (key: string) => void;
}> = ({ label, items, selected, onToggle }) => (
  <div className="nb-vopt-tiles" role="group" aria-label={label} style={cols(items.length, true)}>
    {items.map((item) => {
      const on = selected.includes(item.key);
      return (
        <button
          key={item.key}
          type="button"
          aria-pressed={on}
          aria-label={item.hint}
          title={item.hint}
          disabled={item.disabled}
          onClick={() => !item.disabled && onToggle(item.key)}
          className="nb-vopt-tile"
          data-on={on}
          data-size="sm"
        >
          <span className="nb-vopt-art" aria-hidden="true">{item.art(on)}</span>
          <span className="nb-vopt-name">{item.name}</span>
        </button>
      );
    })}
  </div>
);

/** An on and off choice as a tile: a small preview, the name and its line, and a switch. The whole tile is the switch. */
export const ToggleTile: React.FC<{
  name: string; line: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; art: (on: boolean) => React.ReactNode;
}> = ({ name, line, checked, disabled, onChange, art }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={`${name}. ${line}`}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    className="nb-vopt-toggle"
    data-on={checked}
  >
    <span className="nb-vopt-toggle-art" aria-hidden="true">{art(checked)}</span>
    <span className="nb-vopt-toggle-text">
      <span className="nb-vopt-name">{name}</span>
      <span className="nb-vopt-line">{line}</span>
    </span>
    <span className="nb-vopt-switch" aria-hidden="true"><span /></span>
  </button>
);
