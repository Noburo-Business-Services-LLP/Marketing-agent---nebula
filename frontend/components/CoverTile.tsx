import React from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronsRight, Play } from 'lucide-react';
import { tileTag, type RasterArt } from '../utils/tiles';
import SamplePhoto from './SamplePhoto';
import './CoverTile.css';

/**
 * A cover tile: the illustration fills the whole card like a poster or a video thumbnail, on its own
 * colour-graded background, with the title, one line and a small price over a dark scrim.
 * Wide and short (about 132 px tall), for a few big choices on Create content and later on hero areas.
 * Not for dense lists: use the compact `Tile` variants there.
 *
 * With `image` (a small sample photo from public/samples, see utils/samplePhotos.ts) the photo fills the card
 * once it has loaded; until then, or when the file is missing, the drawn art stays (components/SamplePhoto.tsx).
 *
 * A real link (`to`) or a real button (`onClick`), never a clickable div. Styles are plain CSS in
 * CoverTile.css; motion only runs when the visitor has not asked for reduced motion.
 */
export const COVER_PALETTES = ['gold', 'coral', 'teal', 'blue', 'ink', 'plum'] as const;
export type CoverPalette = typeof COVER_PALETTES[number];

export interface CoverTileProps {
  title: string;
  subtitle?: string;
  /** The small price pill, for example "11 Quarks" or "12 Quarks for each post". Hidden while empty. */
  price?: string;
  /** An illustration from components/art (decorative). */
  art: React.ReactNode;
  /** An optional sample photo that replaces the art once it has loaded (decorative, alt=""). */
  image?: RasterArt | null;
  /** A small mark drawn over the photo: a play button for a video, a swipe mark for slides. */
  overlay?: 'play' | 'slides';
  palette: CoverPalette;
  to?: string;
  onClick?: () => void;
  /** For tiles that choose between options: marks the current one (gold ring and a tick). */
  selected?: boolean;
  dataAttrs?: Record<string, string>;
}

/** The amount in bold, the rest as written: "12 Quarks" + " for each post". The words are unchanged. */
function priceParts(price: string): React.ReactNode {
  const m = /^([\d,.]+ Quarks?)(.*)$/.exec(price);
  return m ? <><b>{m[1]}</b>{m[2].trim() && <span>{m[2]}</span>}</> : price;
}

const CoverTile: React.FC<CoverTileProps> = ({ title, subtitle, price, art, image, overlay, palette, to, onClick, selected, dataAttrs }) => {
  const kind = tileTag({ to, onClick });
  const shared = {
    className: 'nb-cover',
    'data-palette': palette,
    'data-selected': selected ? 'true' : undefined,
    ...dataAttrs,
  };
  const artEl = <span className="nb-cover-art" aria-hidden="true">{art}</span>;
  const inner = (
    <>
      {image ? <SamplePhoto photo={image} fallback={artEl} /> : artEl}
      <span className="nb-cover-scrim" aria-hidden="true" />
      {image && overlay && (
        <span className="nb-cover-overlay" data-overlay={overlay} aria-hidden="true">
          {overlay === 'play' ? <Play size={15} strokeWidth={2.6} fill="currentColor" /> : <ChevronsRight size={16} strokeWidth={2.6} />}
        </span>
      )}
      {selected && <span className="nb-cover-check" aria-hidden="true"><Check size={13} strokeWidth={3.2} /></span>}
      <span className="nb-cover-text">
        <span className="nb-cover-title">{title}</span>
        {subtitle && <span className="nb-cover-sub">{subtitle}</span>}
      </span>
      {price && <span className="nb-cover-price">{priceParts(price)}</span>}
    </>
  );
  if (kind === 'link') {
    return <Link to={to as string} aria-current={selected ? 'true' : undefined} {...shared}>{inner}</Link>;
  }
  return (
    <button type="button" onClick={onClick} disabled={kind === 'disabled'} aria-pressed={selected === undefined ? undefined : selected} {...shared}>
      {inner}
    </button>
  );
};

export default CoverTile;
