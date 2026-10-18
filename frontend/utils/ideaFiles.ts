/** Rules for files and recordings dropped into the Create box. Kept apart from the component so they can be tested. */
export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';
const OK_TYPES = /^(image\/(png|jpe?g|webp)|application\/pdf)$/i;

export function fileProblem(file: { type?: string; size?: number; name?: string } | null | undefined, alreadyAttached = 0): string {
  if (!file) return 'Choose a file.';
  if (alreadyAttached >= MAX_FILES) return `You can add up to ${MAX_FILES} files to one post.`;
  if (!OK_TYPES.test(String(file.type || ''))) return `"${file.name || 'This file'}" is not a picture or a PDF. Use PNG, JPG, WebP or PDF.`;
  if ((file.size || 0) > MAX_FILE_BYTES) return `"${file.name || 'This file'}" is over 8 MB. Please use a smaller file.`;
  return '';
}

/** The language hint for speech to text: Tamil for Tamil and Tamil + English, English otherwise. */
export function speechLanguage(languageLabel: string): 'en' | 'ta' {
  return /tamil/i.test(String(languageLabel || '')) ? 'ta' : 'en';
}

/** Adds spoken or read text to what is already in the box, without gluing words together or repeating itself. */
export function appendText(current: string, addition: string): string {
  const add = String(addition || '').trim();
  const cur = String(current || '').trimEnd();
  if (!add) return String(current || '');
  if (cur.includes(add)) return String(current || '');
  return cur ? `${cur}\n${add}` : add;
}

/** Fills only the boxes that are empty, so what the person typed is never overwritten. */
export function mergeDetails<T extends Record<string, string>>(mine: T, found: Partial<Record<keyof T, string>>): T {
  const out: Record<string, string> = { ...mine };
  for (const k of Object.keys(mine)) {
    if (!String(mine[k] || '').trim() && found[k as keyof T]) out[k] = String(found[k as keyof T]);
  }
  return out as T;
}

/** True when the server says a file had no printed text (current and earlier wording). */
export function isNoTextResult(message: string | undefined | null): boolean {
  return /No printed text was found|Nothing readable was found/i.test(String(message || ''));
}

/** A photo kept as a reference is shaped like anything chosen in the asset picker. */
export function referenceAssetFromFile(f: { name: string; dataUrl: string }) {
  return { id: '', name: f.name, imageUrl: f.dataUrl, dataUrl: f.dataUrl };
}

/** Offer reference buttons only for a picture that had no text, and only where the screen has somewhere to put it. */
export function referenceOfferFor(a: { file: { type?: string } | null | undefined; message: string | undefined | null; hasChoices: boolean }): boolean {
  return a.hasChoices && /^image\//i.test(String(a.file?.type || '')) && isNoTextResult(a.message);
}

export const referenceOfferText = (name: string) => `${name} is a photo with no text to read. Use it as a reference instead:`;
export const referenceAddedText = (label: string) => `Added as ${label.charAt(0).toLowerCase()}${label.slice(1)} reference`;
