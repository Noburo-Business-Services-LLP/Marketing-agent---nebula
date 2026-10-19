import React, { forwardRef } from 'react';
import { Check } from 'lucide-react';
import { styleImageFallback } from '../../utils/videoOptions';
import { StyleFilter, styleChips } from '../../utils/videoStyleGroups';
import './videoStyles.css';

/**
 * One video style as a wide, short picture tile (a radio in its group). On hover or keyboard focus the existing photo
 * enlarges a little and the full one-line hint shows over it; nothing plays. Shared by Videos, the step-by-step studio
 * and Hero Studio. Styles in videoStyles.css.
 */
export interface VideoStyleTileProps {
  label: string;
  hint?: string;
  image?: string;
  /** small chip on the picture, for example "Ads" */
  group?: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
}

export const VideoStyleTile = forwardRef<HTMLButtonElement, VideoStyleTileProps>(function VideoStyleTile(
  { label, hint, image, group, selected, onSelect, disabled, tabIndex, onKeyDown, ariaLabel }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel || (hint ? `${label}. ${hint}` : label)}
      tabIndex={tabIndex}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      title={hint || undefined}
      className="nb-vstyle"
    >
      <span className="nb-vstyle-pic">
        {image && (
          <img src={image} alt="" loading="lazy" decoding="async"
            onError={(e) => { const img = e.currentTarget; const f = styleImageFallback(img.getAttribute('src') || ''); if (f) img.src = f; }} />
        )}
        {group && <span className="nb-vstyle-group">{group}</span>}
        {selected && <span className="nb-vstyle-tick" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3} /></span>}
        {hint && <span className="nb-vstyle-preview" aria-hidden="true"><span>{hint}</span></span>}
      </span>
      <span className="nb-vstyle-body">
        <span className="nb-vstyle-label">{label}</span>
        {hint && <span className="nb-vstyle-hint">{hint}</span>}
      </span>
    </button>
  );
});

/** The category chips above a style grid (All, Ads, Stories, Social, Explainers; only groups that have styles). */
export const VideoStyleChips: React.FC<{ styles: Array<{ key: string }>; value: StyleFilter; onChange: (f: StyleFilter) => void }> = ({ styles, value, onChange }) => {
  const chips = styleChips(styles);
  if (chips.length <= 2) return null;
  return (
    <div className="nb-vchips" role="group" aria-label="Kind of video">
      {chips.map((c) => (
        <button key={c.key} type="button" className="nb-vchip" aria-pressed={value === c.key} onClick={() => onChange(c.key)}>
          {c.label}<span className="nb-vchip-count">{c.count}</span>
        </button>
      ))}
    </div>
  );
};

export default VideoStyleTile;
