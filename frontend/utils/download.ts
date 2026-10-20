import { safeSrc, openSafe } from './safeHref.ts';
/**
 * Saving a finished picture to the computer. Cloudinary links are turned into "download" links so the browser
 * saves the file instead of opening it; other links are fetched and saved from memory.
 */
export function fileSafeName(title: string, fallback = 'post'): string {
  const base = String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return base || fallback;
}

/** A hosted (Cloudinary) picture link that forces a download under a given name; any other link is returned as it is. */
export function downloadableUrl(url: string, name: string): string {
  const m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/.exec(String(url || ''));
  if (!m) return String(url || '');
  return `${m[1]}fl_attachment:${fileSafeName(name)}/${m[2]}`;
}

function clickLink(href: string, name?: string) {
  const safe = safeSrc(href);
  if (!safe) return;
  const a = document.createElement('a');
  a.href = safe;
  if (name) a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Save one picture. Never throws: if it cannot be saved from here it opens in a new tab so it can be saved by hand. */
export async function downloadImage(url: string, name: string): Promise<void> {
  const link = downloadableUrl(url, name);
  if (link !== url) { clickLink(link); return; }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const objectUrl = URL.createObjectURL(blob);
    clickLink(objectUrl, `${fileSafeName(name)}.${ext}`);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  } catch {
    openSafe(url);
  }
}

/** Save several pictures one after another (browsers allow a short series of downloads from one click). */
export async function downloadAll(urls: string[], baseName: string): Promise<void> {
  for (let i = 0; i < urls.length; i++) {
    await downloadImage(urls[i], `${fileSafeName(baseName)}-${i + 1}`);
    await new Promise((r) => setTimeout(r, 450));
  }
}
