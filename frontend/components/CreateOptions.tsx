import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import PlatformIcon from './PlatformIcon';
import { platformHint } from '../utils/platforms';
import { stepChoice } from '../utils/logoChoice';
import { LOGO_GRID, LOGO_GRID_LABELS } from '../constants/logoPositions';
import type { LogoGridPosition } from '../constants/logoPositions';
import { SampleSceneArt } from './art/SampleScene';
import { LookCleanArt } from './art/LookClean';
import { LookBalancedArt } from './art/LookBalanced';
import { LookRichArt } from './art/LookRich';
import './createOptions.css';

/**
 * The options under the idea box on Create content: language, platforms, shape, logo and look.
 * Every choice is one small picture tile of the same height, with a short title under the picture,
 * a light border, and a gold ring when it is chosen. Single choices are radio groups: Tab reaches the
 * chosen tile, the arrow keys move and choose.
 *
 * Two rows (owner, 2026-10-19): Language and Platforms, then Aspect ratio, Logo and Look, in `.nb-opt-rows` >
 * `.nb-opt-row` drawn by the Create page. In a row the groups share the full width in proportion to how many tiles
 * they hold, the tiles of a group stretch evenly across it, and every tile is the same height (88 px), so the labels
 * ("Instagram", "Your logo") have room. Rows that wrap on a phone are filled the same way. Layout: createOptions.css.
 */

const TILE = 'relative flex h-[88px] shrink-0 flex-col items-center justify-between rounded-xl border px-1 pt-1.5 pb-[7px] outline-none transition-[border-color,box-shadow,background-color] focus-visible:ring-2 focus-visible:ring-[var(--gv-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--gv-bg)]';
const TILE_ON = 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] shadow-[0_0_0_1px_var(--gv-accent)]';
const TILE_OFF = 'border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] hover:border-[var(--gv-border-default)] hover:shadow-[0_1px_4px_rgb(20_32_58/0.06)]';
const ART = 'flex h-[52px] w-full items-center justify-center';
const NAME = 'block max-w-full truncate text-[12px] font-semibold leading-tight tracking-[-0.01em]';
const nameTone = (on: boolean) => (on ? 'text-[var(--gv-accent-text)]' : 'text-[var(--gv-text-secondary)]');

export const tileClass = (on: boolean, width: string) => `${TILE} ${width} ${on ? TILE_ON : TILE_OFF}`;

/** A small uppercase muted title over a group, with an optional quiet note beside it. */
export const OptionGroup: React.FC<{ label: string; note?: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ label, note, hint, className = '', children }) => (
  <div className={`nb-opt-group min-w-0 ${className}`}>
    <div className="nb-opt-label gravity-label mb-1.5 text-[var(--gv-text-muted)]">
      {label}{note && <span className="ml-1 normal-case tracking-normal">{note}</span>}
    </div>
    {children}
    {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--gv-text-muted)]">{hint}</p>}
  </div>
);

export interface TileChoice<T extends string> {
  value: T;
  name: string;
  /** Read out with the name, for example "Portrait, best for the Instagram feed". */
  description?: string;
  art: React.ReactNode;
}

/** One row of single-choice picture tiles with roving focus. */
export function TileRadioRow<T extends string>({ label, value, choices, onChange, width, className = '', after }: {
  label: string;
  value: T;
  choices: TileChoice<T>[];
  onChange: (v: T) => void;
  width: string;
  className?: string;
  after?: React.ReactNode;
}) {
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
    <div className={`nb-opt-tiles ${className}`} role="radiogroup" aria-label={label}>
      {choices.map((c, i) => {
        const on = i === current;
        return (
          <button
            key={c.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c.description ? `${c.name}, ${c.description}` : c.name}
            title={c.description}
            tabIndex={on || (current < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(c.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={tileClass(on, width)}
          >
            <span className={ART} aria-hidden="true">{c.art}</span>
            <span className={`${NAME} ${nameTone(on)}`}>{c.name}</span>
          </button>
        );
      })}
      {after}
    </div>
  );
}

/** A frame drawn in the picture's real shape (the longer side 34 pixels) with a sample picture inside. */
export const ShapeArt: React.FC<{ w: number; h: number; on: boolean }> = ({ w, h, on }) => {
  const scale = 34 / Math.max(w, h);
  return (
    <span
      className={`nb-opt-shape block overflow-hidden rounded-[4px] border ${on ? 'border-[var(--gv-accent)]' : 'border-[rgb(20_32_58/0.16)]'}`}
      style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
    >
      <SampleSceneArt />
    </span>
  );
};

const CORNER: Record<LogoGridPosition, string> = {
  'top-left': 'top-[3px] left-[3px]', 'top-center': 'top-[3px] left-1/2 -translate-x-1/2', 'top-right': 'top-[3px] right-[3px]',
  'bottom-left': 'bottom-[3px] left-[3px]', 'bottom-center': 'bottom-[3px] left-1/2 -translate-x-1/2', 'bottom-right': 'bottom-[3px] right-[3px]',
};

/** A small post with the logo sitting where it will go. No logo: an empty post. No logo picture: a gold mark. */
export const LogoPostArt: React.FC<{ position?: LogoGridPosition; logoUrl?: string; size?: 'sm' | 'md' }> = ({ position, logoUrl, size = 'md' }) => (
  <span className={`relative block overflow-hidden rounded-[4px] border border-[rgb(20_32_58/0.16)] ${size === 'sm' ? 'h-[30px] w-[24px]' : 'h-[44px] w-[36px]'}`}>
    <SampleSceneArt />
    {position && (logoUrl
      ? <img src={logoUrl} alt="" className={`absolute ${CORNER[position]} ${size === 'sm' ? 'h-[9px] w-[9px]' : 'h-[14px] w-[14px]'} rounded-[3px] bg-white object-contain p-px shadow-sm`} />
      : <span className={`absolute ${CORNER[position]} h-[7px] w-[7px] rounded-[2px] bg-[var(--gv-accent)] ring-1 ring-white`} />)}
  </span>
);

const POP_WIDTH = 3 * 76 + 2 * 6 + 2 * 8 + 2;

/** The "where does the logo go" tile: shows the post with the logo in place; opens the six positions. */
export const LogoPositionTile: React.FC<{ value: LogoGridPosition; logoUrl?: string; onChange: (p: LogoGridPosition) => void }> = ({ value, logoUrl, onChange }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cells = useRef<Array<HTMLButtonElement | null>>([]);
  const [left, setLeft] = useState<number | null>(null);
  const index = LOGO_GRID.indexOf(value);
  // Right-aligned under the tile, but moved so it never runs off either side of a phone screen.
  useLayoutEffect(() => {
    if (!open || !wrap.current) { setLeft(null); return; }
    const r = wrap.current.getBoundingClientRect();
    // Three 76 px cells, two 6 px gaps, 8 px padding and a 1 px border each side. A fixed number, because the
    // style sheet may not have the cell widths yet on the first frame.
    const w = POP_WIDTH;
    const want = r.left + r.width - w;
    const fit = Math.min(Math.max(want, 16), window.innerWidth - 16 - w);
    setLeft(fit - r.left);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    cells.current[Math.max(0, index)]?.focus();
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // The grid is 3 across and 2 down: up and down jump a row.
    const next = e.key === 'ArrowDown' || e.key === 'ArrowUp' ? (i + 3) % 6 : stepChoice(LOGO_GRID.length, i, e.key);
    if (next === i || next < 0) return;
    e.preventDefault();
    onChange(LOGO_GRID[next]);
    cells.current[next]?.focus();
  };
  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Logo position: ${LOGO_GRID_LABELS[value]}. Change`}
        className={tileClass(false, 'w-[76px]')}
      >
        <span className={ART} aria-hidden="true"><LogoPostArt position={value} logoUrl={logoUrl} /></span>
        <ChevronDown className="absolute right-1 top-1 h-3 w-3 text-[var(--gv-text-muted)]" aria-hidden="true" />
        <span className={`${NAME} text-[var(--gv-text-secondary)]`}>{LOGO_GRID_LABELS[value]}</span>
      </button>
      {open && (
        <div style={left === null ? { right: 0 } : { left }} className="absolute top-full z-30 mt-1.5 w-max rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-2 shadow-xl">
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Logo position">
            {LOGO_GRID.map((pos, i) => {
              const on = value === pos;
              return (
                <button
                  key={pos}
                  ref={(el) => { cells.current[i] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={LOGO_GRID_LABELS[pos]}
                  tabIndex={on ? 0 : -1}
                  onClick={() => { onChange(pos); close(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') return; onKey(e, i); }}
                  className={`${tileClass(on, 'w-[76px]')} !h-[64px]`}
                >
                  <span className="flex h-[34px] items-center" aria-hidden="true"><LogoPostArt position={pos} logoUrl={logoUrl} size="sm" /></span>
                  <span className={`${NAME} text-[10px] ${nameTone(on)}`}>{LOGO_GRID_LABELS[pos]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/** The language, as a tile of the same height that opens the list. */
export const LanguageTile: React.FC<{ value: string; open: boolean; onToggle: () => void }> = ({ value, open, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-haspopup="true"
    aria-expanded={open}
    aria-label={`Language: ${value}. Change`}
    title={value}
    className={`${tileClass(false, 'w-full')} !items-start !justify-center gap-1.5 !px-3`}
  >
    <span className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--gv-accent-fill)]" aria-hidden="true">
        <Globe className="h-3.5 w-3.5 text-[var(--gv-accent)]" />
      </span>
      <ChevronDown className={`h-3.5 w-3.5 text-[var(--gv-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </span>
    <span className="block max-w-full truncate text-[13px] font-semibold leading-tight text-[var(--gv-text-primary)]">{value}</span>
  </button>
);

const SHORT: Record<string, string> = { gmb: 'Google' };

/** The platforms as even small tiles; several can be on at once. */
export const PlatformTiles: React.FC<{
  items: Array<{ key: string; label: string; soon?: boolean }>;
  selected: string[];
  onToggle: (key: string) => void;
}> = ({ items, selected, onToggle }) => (
  <div className="nb-opt-tiles nb-opt-platforms" role="group" aria-label="Platforms">
    {items.map((item) => {
      const on = selected.includes(item.key);
      const disabled = Boolean(item.soon);
      return (
        <button
          key={item.key}
          type="button"
          aria-pressed={on}
          aria-label={platformHint(item, 'image')}
          title={platformHint(item, 'image')}
          disabled={disabled}
          onClick={() => !disabled && onToggle(item.key)}
          className={`${tileClass(on, 'w-[63px]')} !px-0.5 ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          <span className={ART} aria-hidden="true">
            <span className={`flex h-8 w-8 items-center justify-center rounded-full ${on ? 'bg-[var(--gv-accent)] text-[#1A1208]' : 'bg-[var(--gv-surface-2)] text-[var(--gv-text-tertiary)]'}`}>
              <PlatformIcon platform={item.key} className="h-4 w-4" />
            </span>
          </span>
          <span className={`${NAME} ${nameTone(on)}`}>{SHORT[item.key] || item.label}</span>
        </button>
      );
    })}
  </div>
);

export const LOOK_ART: Record<'clean' | 'balanced' | 'rich', React.ReactNode> = {
  clean: <LookCleanArt />,
  balanced: <LookBalancedArt />,
  rich: <LookRichArt />,
};
