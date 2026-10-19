/** One-shot hand-over from the plan to the create screens. Stored briefly, read once, then gone. */

/** `source: 'home'` marks an idea typed on Home (the screen then does not say it came from the plan). */
export type PrefillSource = 'plan' | 'home';
/** `photo`: a Photoshoot photo to feature, picked as the post's product picture (the existing product reference path). */
export interface CarouselPrefill { mode?: 'carousel' | 'single' | 'campaign' | 'linkedin'; topic?: string; platform?: string; language?: string; weekItemId?: string; weekId?: string; source?: PrefillSource; photo?: { name: string; imageUrl: string } }
export interface VideoPrefill { idea?: string; language?: string; weekItemId?: string; weekId?: string; source?: PrefillSource }
export interface PrefillMap { carousel: CarouselPrefill; video: VideoPrefill }
export type PrefillTarget = keyof PrefillMap;

interface StoreLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const MAX_AGE_MS = 15 * 60 * 1000;
const key = (t: PrefillTarget) => `nebulaa:prefill:${t}`;
const defaultStore = (): StoreLike | null => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };

export function setPrefill<T extends PrefillTarget>(target: T, data: PrefillMap[T], storage: StoreLike | null = defaultStore(), now: number = Date.now()): void {
  try { storage?.setItem(key(target), JSON.stringify({ at: now, data })); } catch { /* no storage: the screen opens as usual */ }
}

export function takePrefill<T extends PrefillTarget>(target: T, storage: StoreLike | null = defaultStore(), now: number = Date.now()): PrefillMap[T] | null {
  try {
    const raw = storage?.getItem(key(target));
    if (!raw) return null;
    storage?.removeItem(key(target));
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.at !== 'number' || now - parsed.at > MAX_AGE_MS) return null;
    return parsed.data && typeof parsed.data === 'object' ? (parsed.data as PrefillMap[T]) : null;
  } catch { return null; }
}

/** Map a plan's language wording ("Tamil", "Tamil + English mix") to one of the ids the screen offers. */
export function nearestLanguage(planLanguage: string | undefined | null, available: string[], fallback: string): string {
  const s = String(planLanguage || '').trim().toLowerCase();
  if (!s) return fallback;
  const id = s.replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  if (available.includes(id)) return id;
  const mixed = /mix|\+|and|&/.test(s) && /english/.test(s);
  const base = ['tamil', 'telugu', 'hindi', 'kannada', 'malayalam', 'marathi', 'bengali', 'gujarati', 'punjabi', 'odia', 'urdu'].find((l) => s.includes(l));
  if (base) {
    if (mixed && available.includes(`${base}_english_mix`)) return `${base}_english_mix`;
    if (available.includes(base)) return base;
    return fallback;
  }
  return s.includes('english') && available.includes('english') ? 'english' : fallback;
}
