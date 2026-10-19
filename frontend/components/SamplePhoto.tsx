import React, { useEffect, useRef, useState } from 'react';
import { rasterAttrs, type RasterArt } from '../utils/tiles';
import { photoStateAfter } from '../utils/samplePhotos';
import './SamplePhoto.css';

/**
 * A decorative photo over the drawn art. The art stays visible until the photo has really loaded; if the file is
 * missing or will not load (onError), the photo is removed and the art stays, so there is never a broken-image icon.
 * A file that failed once is not asked for again during the visit. The photo is lazy, decoded off the main thread and
 * has a fixed size (rasterAttrs), alt="" because the tile title beside it already names it.
 */
const failedOnce = new Set<string>();

const SamplePhoto: React.FC<{ photo?: RasterArt | null; fallback: React.ReactNode }> = ({ photo, fallback }) => {
  const src = photo ? photo.src : '';
  const usable = Boolean(photo) && !failedOnce.has(src);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(usable ? 'loading' : 'failed');
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => { setState((s) => photoStateAfter(s, 'reset', usable)); }, [src, usable]);
  // A photo already in the browser cache can finish before React attaches onLoad.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete) setState((s) => photoStateAfter(s, img.naturalWidth > 0 ? 'load' : 'error'));
  }, [src, state]);

  const onError = () => { if (src) failedOnce.add(src); setState((s) => photoStateAfter(s, 'error')); };
  return (
    <span className="nb-photo" data-photo={state} aria-hidden="true">
      <span className="nb-photo-fallback">{fallback}</span>
      {photo && state !== 'failed' && (
        <img {...rasterAttrs(photo)} ref={ref} className="nb-photo-img" onLoad={() => setState((s) => photoStateAfter(s, 'load'))} onError={onError} />
      )}
    </span>
  );
};

export default SamplePhoto;
