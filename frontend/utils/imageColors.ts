import { extractPaletteFromPixels } from './brandColors';

const SAMPLE_SIZE = 64; // images are scaled to this many pixels across before reading

/**
 * Reads the main colours of an image in the browser. Resolves with an empty
 * list when the image cannot be read (blocked by CORS, not an image, no canvas),
 * so a customer never sees an error because one picture could not be read.
 */
export function readImageColors(src: string, max = 4): Promise<string[]> {
  return new Promise((resolve) => {
    if (!src || typeof document === 'undefined') return resolve([]);
    const done = (value: string[]) => resolve(value);
    try {
      const img = new Image();
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
          const w = ratio >= 1 ? SAMPLE_SIZE : Math.max(1, Math.round(SAMPLE_SIZE * ratio));
          const h = ratio >= 1 ? Math.max(1, Math.round(SAMPLE_SIZE / ratio)) : SAMPLE_SIZE;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return done([]);
          ctx.drawImage(img, 0, 0, w, h);
          done(extractPaletteFromPixels(ctx.getImageData(0, 0, w, h).data, { max }));
        } catch {
          done([]); // the canvas is tainted: the image comes from a site that does not allow reading
        }
      };
      img.onerror = () => done([]);
      img.src = src;
    } catch {
      done([]);
    }
  });
}
