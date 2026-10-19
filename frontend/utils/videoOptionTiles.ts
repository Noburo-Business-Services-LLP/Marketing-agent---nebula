/**
 * Words and small rules for the Videos options (pages/CreateVideo.tsx, components/video/VideoOptions.tsx).
 * Pure, so the tests can read them. Nothing here changes what is sent: the page still sends the same choices.
 */

/** A short sample of each language's own script, shown in the language tile. Null means no speech (a music note). */
const GLYPHS: Record<string, string> = {
  english: 'A', tamil: 'த', hindi: 'हि', telugu: 'తె', kannada: 'ಕ', malayalam: 'മ', bengali: 'বা', marathi: 'म',
  gujarati: 'ગુ', punjabi: 'ਪੰ', urdu: 'اُ', odia: 'ଓ', spanish: 'Ñ', french: 'É', arabic: 'ع',
};

export function languageGlyph(key: string, label = ''): string | null {
  const k = String(key || '').toLowerCase();
  if (k === 'none') return null;
  if (GLYPHS[k]) return GLYPHS[k];
  const first = String(label || key || '').trim().charAt(0);
  return first ? first.toUpperCase() : 'A';
}

/** The voice tile name: Female or Male, otherwise the label the server sent. */
export function voiceName(key: string, label: string): string {
  return key === 'male' ? 'Male' : key === 'female' ? 'Female' : label;
}

/** One quiet line under a voice tile. */
export function voiceLine(key: string): string {
  return key === 'male' ? 'A deeper, steady voice' : key === 'female' ? 'A warm, clear voice' : '';
}

/** The two shapes with the one-line use shown under each. */
export const SHAPE_CHOICES: ReadonlyArray<{ value: '9:16' | '16:9'; name: string; use: string; w: number; h: number }> = [
  { value: '9:16', name: 'Vertical', use: 'Reels, Shorts, Stories', w: 9, h: 16 },
  { value: '16:9', name: 'Wide', use: 'YouTube, websites, LinkedIn', w: 16, h: 9 },
];

/** The line under a length tile: how many parts it is made in. */
export function partsLine(clips: number): string {
  const n = Math.max(1, Math.round(Number(clips) || 1));
  return n === 1 ? 'Made in one part' : `Made in ${n} parts`;
}

/** The sentence over the people, place and product rows. */
export const YOURS_TITLE = 'Your people, place and products';
export const YOURS_LINE = 'Add your own people, place and products so the video looks like your business. Skip any of these and we will choose something believable.';

/** The short platform name on a tile. */
export function platformShort(key: string, label: string): string {
  return key === 'gmb' ? 'Google' : label;
}

/**
 * How many columns a row of tiles uses. A row fills its width with equal tiles; on a phone a row of four or more
 * becomes two across (a row of five platform icons stays one row, as icons fit).
 */
export function tileColumns(count: number, phone: boolean, iconsOnly = false): number {
  const n = Math.max(1, Math.round(Number(count) || 1));
  if (!phone || iconsOnly || n <= 3) return n;
  return 2;
}
