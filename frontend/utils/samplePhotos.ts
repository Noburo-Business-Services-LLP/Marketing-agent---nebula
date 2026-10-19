// Sample photos for the cover tiles (Create content, Photoshoot packs, Home). One small webp per slot in
// public/samples/<slot>.webp, made once by the owner with backend/scripts/generate-sample-photos.js (prompts in
// backend/config/samplePhotoPrompts.js, the same slot names; a test keeps the two lists equal).
// A slot whose file is missing simply keeps its drawn art: components/SamplePhoto.tsx falls back on a load error.
import type { RasterArt } from './tiles.ts';

/** The size every sample photo is saved at (16:10, wide enough for a 2x screen on a three-column tile). */
export const SAMPLE_PHOTO_SIZE = { width: 768, height: 480 } as const;

/** Photoshoot pack key to its photo slot. */
export const PACK_PHOTO_SLOTS: Record<string, string> = {
  product: 'pack-product', marketplace: 'pack-marketplace', festival: 'pack-festival',
  lifestyle: 'pack-lifestyle', flatlay: 'pack-flatlay', white: 'pack-white',
};

/** Create choice (Create content and Home) to its photo slot. */
export const CREATE_PHOTO_SLOTS: Record<string, string> = {
  video: 'create-video', photoshoot: 'create-photoshoot', single: 'create-single',
  campaign: 'create-campaign', carousel: 'create-carousel', linkedin: 'create-linkedin',
};

/** Every slot, in the order the generation script makes them. */
export const SAMPLE_SLOTS: string[] = [...Object.values(PACK_PHOTO_SLOTS), ...Object.values(CREATE_PHOTO_SLOTS)];

/** The decorative photo for one slot (alt is empty: the tile title next to it says what it is), or null for an unknown slot. */
export function samplePhoto(slot: string | null | undefined): RasterArt | null {
  if (!slot || !SAMPLE_SLOTS.includes(slot)) return null;
  return { src: `/samples/${slot}.webp`, width: SAMPLE_PHOTO_SIZE.width, height: SAMPLE_PHOTO_SIZE.height, alt: '' };
}

export const packPhoto = (key: string | null | undefined) => samplePhoto(key ? PACK_PHOTO_SLOTS[key] : null);
export const createPhoto = (key: string | null | undefined) => samplePhoto(key ? CREATE_PHOTO_SLOTS[key] : null);

/** What the tile shows: the photo once it has loaded, otherwise the drawn art. Pure, for the tests. */
export function photoStateAfter(prev: 'loading' | 'ready' | 'failed', event: 'load' | 'error' | 'reset', hasPhoto = true): 'loading' | 'ready' | 'failed' {
  if (event === 'reset') return hasPhoto ? 'loading' : 'failed';
  if (!hasPhoto) return 'failed';
  if (event === 'error') return 'failed';
  return prev === 'failed' ? 'failed' : 'ready';
}
