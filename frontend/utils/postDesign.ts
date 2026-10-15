/** The design styles a post can have, with the sample picture shown on each card. Mirrors backend/config/postStyles.js. */
export interface PostStyleOption { id: string; label: string; blurb: string; sample: string }

export const POST_STYLE_OPTIONS: PostStyleOption[] = [
  { id: 'plain', label: 'Plain photo', blurb: 'A clean, well lit photo with little or no text.', sample: '/assets/post-styles/plain.jpg' },
  { id: 'minimal', label: 'Minimal showcase', blurb: 'One product, lots of space, a short headline.', sample: '/assets/post-styles/minimal.jpg' },
  { id: 'offer', label: 'Offer poster', blurb: 'A bold offer, prices and a contact strip.', sample: '/assets/post-styles/offer.jpg' },
  { id: 'celebration', label: 'Festive celebration', blurb: 'Rich, warm and celebratory for festivals and sales.', sample: '/assets/post-styles/celebration.jpg' },
  { id: 'catalogue', label: 'Range catalogue', blurb: 'Everything you sell, with category icons.', sample: '/assets/post-styles/catalogue.jpg' },
  { id: 'announcement', label: 'Announcement', blurb: 'New arrival, opening or timing change.', sample: '/assets/post-styles/announcement.jpg' },
];

export interface PostDetails { headline: string; offer: string; items: string; phone: string; address: string; hours: string; tagline: string }
export const EMPTY_DETAILS: PostDetails = { headline: '', offer: '', items: '', phone: '', address: '', hours: '', tagline: '' };

export interface PostDesign {
  style: string;
  details: PostDetails;
  /** a picture to copy the look of (a data URL), or '' */
  referenceImage: string;
  /** saved header and footer chosen for this post ('' = none) */
  headerUrl: string;
  footerUrl: string;
}
export const DEFAULT_DESIGN: PostDesign = { style: 'plain', details: EMPTY_DETAILS, referenceImage: '', headerUrl: '', footerUrl: '' };

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
export function referenceFileProblem(file: { type?: string; size?: number } | undefined | null): string {
  if (!file) return 'Choose a picture.';
  if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) return 'Use a PNG, JPG or WebP picture.';
  if ((file.size || 0) > MAX_REFERENCE_BYTES) return 'Use a picture under 5 MB.';
  return '';
}

/** The fields to send with a request. Details and the reference only travel when they will be used. */
export function designRequestFields(d: PostDesign, opts: { reference: boolean } = { reference: true }): Record<string, any> {
  const out: Record<string, any> = {};
  // Styles are no longer chosen in the app (the model designs the post itself); an older saved style still works.
  if (d.style && d.style !== 'plain') out.postStyle = d.style;
  // The exact text goes with the request whenever something was typed.
  if (Object.values(d.details).some((v) => String(v || '').trim())) out.postDetails = d.details;
  if (opts.reference && d.referenceImage) out.referenceImage = d.referenceImage;
  if (d.headerUrl) out.headerUrl = d.headerUrl;
  if (d.footerUrl) out.footerUrl = d.footerUrl;
  return out;
}

/** Header and footer sizes at a 1080 pixel wide post. Mirrors backend/services/postFrames.js. */
export const FRAME_SPECS = { header: { width: 1080, height: 140 }, footer: { width: 1080, height: 200 } } as const;
const ASPECT_HEIGHT: Record<string, number> = { '1:1': 1080, '4:5': 1350, '9:16': 1920, '16:9': 608, '3:4': 1440 };

/** How much of the post's height a header or footer covers, as a percentage (never more than 30). */
export function frameSharePercent(kind: 'header' | 'footer', aspect: string): number {
  const h = ASPECT_HEIGHT[aspect] || 1080;
  return Math.min(30, Math.round((FRAME_SPECS[kind].height / h) * 1000) / 10);
}
