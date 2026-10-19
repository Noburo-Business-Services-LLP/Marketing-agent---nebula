import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { TileState } from '../../utils/brandTiles';
import './statusTiles.css';

/**
 * Compact status tiles (Brand assets, Blueprint form and result): small vector art, a title with a status word, one
 * line and, when stored, small pictures, colour swatches or a font sample. A real link or button. Rows are filled by
 * the spans the caller passes (fillRows), and every tile of a row has the same height (grid stretch).
 */
export interface StatusTileCardProps {
  title: string;
  status: string;
  state: TileState;
  line?: string;
  art: React.ReactNode;
  tone: 'pink' | 'gold' | 'lilac' | 'teal' | 'coral' | 'sage' | 'blue';
  thumbs?: string[];
  swatches?: string[];
  font?: string;
  to?: string;
  onClick?: () => void;
  span4?: number;
  span3?: number;
  span2?: number;
  index?: number;
  dataKey?: string;
}

export const StatusTileCard: React.FC<StatusTileCardProps> = ({
  title, status, state, line, art, tone, thumbs, swatches, font, to, onClick, span4, span3, span2, index = 0, dataKey,
}) => {
  const body = (
    <>
      <span className="nb-stile-art" aria-hidden="true">{art}</span>
      <span className="nb-stile-body">
        <span className="nb-stile-top">
          <span className="nb-stile-title">{title}</span>
          <span className="nb-stile-status" data-state={state}>{status}</span>
        </span>
        {line && <span className="nb-stile-line">{line}</span>}
        {(thumbs && thumbs.length > 0) || (swatches && swatches.length > 0) || font ? (
          <span className="nb-stile-extra" aria-hidden="true">
            {(swatches || []).map((c) => <span key={c} className="nb-stile-swatch" style={{ background: c }} />)}
            {font && <span className="nb-stile-font" style={{ fontFamily: `'${font}', Georgia, serif` }}>Aa</span>}
            {(thumbs || []).map((u) => <img key={u} className="nb-stile-thumb" src={u} alt="" width={26} height={26} loading="lazy" decoding="async" />)}
          </span>
        ) : null}
      </span>
      <ArrowRight className="nb-stile-go" aria-hidden />
    </>
  );
  const shared = {
    className: 'nb-stile',
    'data-tone': tone,
    'data-span4': span4,
    'data-span3': span3,
    'data-span2': span2,
    'data-key': dataKey,
    style: { ['--i' as any]: index },
    'aria-label': `${title}: ${status}${line ? `. ${line}` : ''}`,
  };
  return (
    <li className="nb-stile-cell" data-span4={span4} data-span3={span3} data-span2={span2}>
      {to ? <Link to={to} {...shared}>{body}</Link> : <button type="button" onClick={onClick} {...shared}>{body}</button>}
    </li>
  );
};

/** The grid: one column on a phone (two when `dense`), two from 520 px of room, three from 700 px (`wide` 3) or four from 880 px (`wide` 4). */
export const StatusTileGrid: React.FC<{ label: string; wide?: 3 | 4; dense?: boolean; children: React.ReactNode }> = ({ label, wide = 4, dense, children }) => (
  <div className="nb-stile-wrap">
    <ul className="nb-stile-grid" data-wide={wide} data-dense={dense ? 'true' : undefined} aria-label={label}>{children}</ul>
  </div>
);
