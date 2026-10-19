import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Lock } from 'lucide-react';
import {
  accentOf, variantOf, badgeText, tileLabel, tileTag, isRasterArt, rasterAttrs,
  type RasterArt, type TileAccent, type TileVariant,
} from '../utils/tiles';

/**
 * One tile: a picture area with the signature glow, a clear title, one line of text, an optional
 * footer and an arrow. A real link (`to`) or a real button (`onClick`), never a clickable div.
 * Styles live in index.html (.nb-tile); they are plain CSS so tiles add no start-up work.
 *
 * `art` is an inline SVG component (decorative, hidden from screen readers) or a small photo
 * `{ src, width, height, alt }` that is always lazy-loaded with a fixed size.
 */
export interface TileProps {
  title: string;
  subtitle?: string;
  art?: React.ReactNode | RasterArt;
  accent?: TileAccent;
  badge?: string | number;
  footer?: string;
  to?: string;
  onClick?: () => void;
  locked?: boolean;
  disabled?: boolean;
  variant?: TileVariant;
  /** For tiles that choose between options (a mode switch): marks the current one. */
  selected?: boolean;
  /** Extra data attributes, for example the guided tour anchors. */
  dataAttrs?: Record<string, string>;
  className?: string;
}

const Tile: React.FC<TileProps> = ({
  title, subtitle, art, accent, badge, footer, to, onClick, locked, disabled, variant, selected, dataAttrs, className,
}) => {
  const kind = tileTag({ to, onClick, disabled });
  const v = variantOf(variant);
  const badgeStr = badgeText(badge);
  const shared = {
    className: `nb-tile${className ? ` ${className}` : ''}`,
    'data-accent': accentOf(accent),
    'data-variant': v,
    'data-locked': locked ? 'true' : undefined,
    'data-selected': selected ? 'true' : undefined,
    ...dataAttrs,
  };

  const artEl = isRasterArt(art) ? (
    <img {...rasterAttrs(art)} aria-hidden={art.alt === '' ? true : undefined} />
  ) : art ? (
    <span className="nb-tile-artwrap" aria-hidden="true">{art}</span>
  ) : null;

  const inner = (
    <>
      <span className="nb-tile-art">
        {artEl}
        {locked && (
          <span className="nb-tile-mark" aria-hidden="true"><Lock size={14} strokeWidth={2.4} /></span>
        )}
        {/* A choice tile shows its selection with the ring alone: no tick, no arrow. */}
        {selected && v !== 'choice' && (
          <span className="nb-tile-mark nb-tile-check" aria-hidden="true"><Check size={15} strokeWidth={3} /></span>
        )}
        {kind !== 'disabled' && v !== 'compact' && v !== 'choice' && (
          <span className="nb-tile-go" aria-hidden="true"><ArrowRight size={16} strokeWidth={2.4} /></span>
        )}
      </span>
      <span className="nb-tile-body">
        <span className="nb-tile-title">
          <span>{title}</span>
          {badgeStr && <span className="nb-tile-badge">{badgeStr}</span>}
        </span>
        {subtitle && <span className="nb-tile-sub">{subtitle}</span>}
        {footer && <span className="nb-tile-foot">{footer}</span>}
      </span>
    </>
  );

  // The visible text already names the tile; the longer label is only needed to add the lock state.
  const label = locked || disabled ? tileLabel({ title, subtitle, footer, badge, locked, disabled }) : undefined;

  if (kind === 'link') {
    return <Link to={to as string} aria-label={label} aria-current={selected ? 'true' : undefined} {...shared}>{inner}</Link>;
  }
  if (kind === 'button') {
    return (
      <button type="button" onClick={onClick} aria-label={label} aria-pressed={selected === undefined ? undefined : selected} {...shared}>
        {inner}
      </button>
    );
  }
  return (
    <button type="button" disabled aria-label={label} {...shared} data-disabled="true">
      {inner}
    </button>
  );
};

export default Tile;
