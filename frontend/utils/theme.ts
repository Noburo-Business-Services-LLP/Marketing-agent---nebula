interface DocLike { documentElement: { classList: { remove(c: string): void } } }
interface StorageLike { removeItem(k: string): void }

/** Nebulaa is light only: strip any dark class and any stored dark preference. */
export function forceLightTheme(doc: DocLike, storage?: StorageLike | null): void {
  doc.documentElement.classList.remove('dark');
  try { storage?.removeItem('nebulaa-theme'); } catch { /* storage blocked: nothing to clear */ }
}
