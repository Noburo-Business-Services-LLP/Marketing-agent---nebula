/** Status tiles for Brand assets, the Blueprint form and the finished Blueprint. Every status word comes from stored
 *  rows (or, on the form, from what the customer has typed): "Added", "Missing", "N added". A source that failed to load
 *  says "Could not check", never "Missing". See docs/superpowers/impact-maps/performance-brand.md. */
import { isPlaceholderColorPair, normalizeHexColor } from './brandColors.ts';
import { GOALS } from './blueprint.ts';
import { fillRows } from './rowSpans.ts';

export type TileState = 'added' | 'missing' | 'partly' | 'unknown';
export type BrandTab = 'brand' | 'products' | 'environment' | 'frames' | 'voice';
export interface StatusTile {
  key: string;
  title: string;
  status: string;
  state: TileState;
  line: string;
  thumbs: string[];
  swatches?: string[];
  font?: string;
  tab?: BrandTab;
  to?: string;
}

const UNKNOWN = 'Could not check';
const count = (n: number) => `${n} added`;
const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

export interface BrandInput {
  /** null when the call failed. */
  logos: any[] | null;
  profile: any | null;
  profileFailed?: boolean;
  /** Every brand asset row (all types); null when the call failed. */
  assets: any[] | null;
  products: any[] | null;
  /** Learned notes and tracked posts from Brand memory; null when the call failed. */
  memory: { notes: number; tracked: number } | null;
}

const ofType = (assets: any[], type: string) => assets.filter((a) => a && a.type === type);
const thumbsOf = (rows: any[], pick: (r: any) => unknown, max = 3) => rows.map(pick).filter(isHttp).slice(0, max) as string[];

/** The seven tiles of "Your brand at a glance", in reading order. */
export function brandTiles(input: BrandInput): StatusTile[] {
  const tiles: StatusTile[] = [];

  // Logo
  if (input.logos === null) tiles.push({ key: 'logo', title: 'Logo', status: UNKNOWN, state: 'unknown', line: 'Open to see your logos', thumbs: [], tab: 'brand' });
  else {
    const n = input.logos.length;
    const primary = input.logos.find((l) => l && l.isPrimary) || input.logos[0];
    tiles.push({
      key: 'logo', title: 'Logo', status: n === 0 ? 'Missing' : n === 1 ? 'Added' : count(n), state: n ? 'added' : 'missing',
      line: n ? 'Placed on your posts' : 'Add it once, it goes on every post', thumbs: primary && isHttp(primary.url) ? [primary.url] : [], tab: 'brand',
    });
  }

  // Colours and fonts come from the brand profile.
  const assets = input.profile && input.profile.assets ? input.profile.assets : null;
  if (input.profileFailed) {
    tiles.push({ key: 'colours', title: 'Colours', status: UNKNOWN, state: 'unknown', line: 'Open to see your colours', thumbs: [], tab: 'brand' });
    tiles.push({ key: 'fonts', title: 'Fonts', status: UNKNOWN, state: 'unknown', line: 'Open to see your font', thumbs: [], tab: 'brand' });
  } else {
    const p = assets ? normalizeHexColor(assets.primaryColor) : null;
    const s = assets ? normalizeHexColor(assets.secondaryColor) : null;
    const placeholder = isPlaceholderColorPair(assets && assets.primaryColor, assets && assets.secondaryColor);
    const swatches = placeholder ? [] : ([p, s].filter(Boolean) as string[]);
    tiles.push({
      key: 'colours', title: 'Colours', status: swatches.length === 0 ? 'Missing' : swatches.length === 1 ? 'Added' : count(swatches.length),
      state: swatches.length ? 'added' : 'missing', line: swatches.length ? 'Used on your post designs' : 'Pick them from your logo', thumbs: [], swatches, tab: 'brand',
    });
    const font = assets && typeof assets.fontType === 'string' ? assets.fontType.trim() : '';
    tiles.push({
      key: 'fonts', title: 'Fonts', status: font ? 'Added' : 'Missing', state: font ? 'added' : 'missing',
      line: font ? fontLabel(font) : 'Choose the style of your lettering', thumbs: [], font: font || undefined, tab: 'brand',
    });
  }

  // People and places are brand asset rows of type character and environment.
  if (input.assets === null) {
    tiles.push({ key: 'people', title: 'People', status: UNKNOWN, state: 'unknown', line: 'Open Videos to see them', thumbs: [], to: '/reels' });
    tiles.push({ key: 'places', title: 'Places', status: UNKNOWN, state: 'unknown', line: 'Open to see your places', thumbs: [], tab: 'environment' });
  } else {
    const people = ofType(input.assets, 'character');
    const places = ofType(input.assets, 'environment');
    tiles.push({
      key: 'people', title: 'People', status: people.length ? count(people.length) : 'Missing', state: people.length ? 'added' : 'missing',
      line: people.length ? 'Ready for your videos' : 'Add a face for your videos', thumbs: thumbsOf(people, (r) => r.url), to: '/reels',
    });
    tiles.push({
      key: 'places', title: 'Places', status: places.length ? count(places.length) : 'Missing', state: places.length ? 'added' : 'missing',
      line: places.length ? 'Your shop or workplace' : 'Add photos of your shop', thumbs: thumbsOf(places, (r) => r.url), tab: 'environment',
    });
  }

  // Products and services
  if (input.products === null) tiles.push({ key: 'products', title: 'Products', status: UNKNOWN, state: 'unknown', line: 'Open to see your products', thumbs: [], tab: 'products' });
  else {
    const n = input.products.length;
    const withPhoto = input.products.filter((p) => p && (isHttp(p.imageUrl) || (Array.isArray(p.images) && p.images.some(isHttp))));
    tiles.push({
      key: 'products', title: 'Products', status: n ? count(n) : 'Missing', state: n ? (withPhoto.length < n ? 'partly' : 'added') : 'missing',
      line: !n ? 'Add what you sell' : withPhoto.length < n ? `${n - withPhoto.length} without a photo` : 'All with photos',
      thumbs: thumbsOf(withPhoto, (p) => (isHttp(p.imageUrl) ? p.imageUrl : (p.images || []).find(isHttp))), tab: 'products',
    });
  }

  // Brand memory (its own page)
  if (input.memory === null) tiles.push({ key: 'memory', title: 'Brand memory', status: UNKNOWN, state: 'unknown', line: 'What Nebulaa has learned', thumbs: [], to: '/ai-memory' });
  else {
    const { notes, tracked } = input.memory;
    tiles.push({
      key: 'memory', title: 'Brand memory', status: notes ? `${notes} learned` : tracked ? 'Learning' : 'Not started', state: notes ? 'added' : tracked ? 'partly' : 'missing',
      line: notes ? 'Patterns from your published posts' : tracked ? `Watching ${tracked} ${tracked === 1 ? 'post' : 'posts'}` : 'Starts when your posts are published',
      thumbs: [], to: '/ai-memory',
    });
  }
  return tiles;
}

/** The saved font family as the customer chose it ("Playfair Display"). */
export function fontLabel(font: string): string {
  return String(font || '').trim();
}

/** How many brand tiles say "Added" (or partly), for the header line. */
export function brandProgress(tiles: StatusTile[]): { done: number; total: number; unknown: number; text: string } {
  const known = tiles.filter((t) => t.key !== 'memory');
  const done = known.filter((t) => t.state === 'added' || t.state === 'partly').length;
  const unknown = known.filter((t) => t.state === 'unknown').length;
  const total = known.length;
  const text = unknown === total
    ? 'We could not check your brand just now. Please refresh in a moment.'
    : unknown > 0
      ? `${done} of ${total} set up. ${unknown} could not be checked just now.`
      : `${done} of ${total} set up. Open a tile to add or change it.`;
  return { done, total, unknown, text };
}

/** Column spans that fill every row (owner's symmetry rule). */
export function tileSpans(n: number, cols: number): number[] {
  return fillRows(Array.from({ length: Math.max(0, n) }, () => 1), cols);
}

// ---------- Blueprint form ----------

export interface FormLike {
  businessName?: string; website?: string; instagram?: string; whatYouSell?: string; whoItsFor?: string; goal?: string;
  competitors?: Array<{ name?: string; url?: string }>; offers?: Array<{ name?: string; price?: string }>; colours?: string[];
  logoDataUrl?: string; logoUrl?: string;
}
export interface FormTile extends StatusTile { field: string }

const filled = (v: unknown, min = 1) => String(v || '').trim().length >= min;

/** Four compact tiles above the Blueprint form; `field` is the id of the first thing to fill in. */
export function blueprintFormTiles(form: FormLike): FormTile[] {
  const f = form || {};
  const basics = [
    ['bp-name', filled(f.businessName, 2)], ['bp-sell', filled(f.whatYouSell, 10)], ['bp-for', filled(f.whoItsFor, 5)],
  ] as Array<[string, boolean]>;
  const nBasics = basics.filter((b) => b[1]).length;
  const web = filled(f.website);
  const ig = filled(f.instagram);
  const goal = GOALS.find((g) => g.value === f.goal);
  const extras = [
    ['bp-competitors', (f.competitors || []).some((c) => filled(c && c.name) || filled(c && c.url))],
    ['bp-offers', (f.offers || []).some((o) => filled(o && o.name))],
    ['bp-colours', (f.colours || []).length > 0],
    ['bp-logo', filled(f.logoDataUrl) || filled(f.logoUrl)],
  ] as Array<[string, boolean]>;
  const nExtras = extras.filter((e) => e[1]).length;
  return [
    {
      key: 'business', title: 'Your business', field: (basics.find((b) => !b[1]) || basics[0])[0], thumbs: [],
      status: nBasics === 3 ? 'Added' : nBasics === 0 ? 'Missing' : `${nBasics} of 3 added`, state: nBasics === 3 ? 'added' : nBasics ? 'partly' : 'missing',
      line: 'Name, what you sell, who it is for',
    },
    {
      key: 'online', title: 'Where you are online', field: web || !ig ? 'bp-web' : 'bp-ig', thumbs: [],
      status: web || ig ? 'Added' : 'Missing', state: web || ig ? 'added' : 'missing',
      line: web && ig ? 'Website and Instagram' : web ? 'Website' : ig ? 'Instagram' : 'Website or Instagram',
    },
    {
      key: 'goal', title: 'Your goal', field: 'bp-goal', thumbs: [],
      status: goal ? 'Added' : 'Missing', state: goal ? 'added' : 'missing', line: goal ? goal.label : 'Choose one goal',
    },
    {
      key: 'extras', title: 'Extras', field: (extras.find((e) => !e[1]) || extras[0])[0], thumbs: [],
      status: nExtras ? `${nExtras} of 4 added` : 'Optional', state: nExtras === 4 ? 'added' : nExtras ? 'partly' : 'missing',
      line: 'Competitors, offers, colours, logo',
    },
  ];
}

// ---------- finished Blueprint ----------

export interface PartTile { id: string; n: number; title: string; line: string; status: string; state: TileState }

const UNITS: Record<string, [string, string]> = {
  'where-today': ['fact confirmed', 'facts confirmed'],
  'content-pillars': ['pillar', 'pillars'],
  'calendar-preview': ['day planned', 'days planned'],
  'channel-plan': ['channel', 'channels'],
  'roadmap-90': ['phase', 'phases'],
  'first-steps': ['step', 'steps'],
};

/** One tile per page of the stored Blueprint, with a status from what the page holds. */
export function blueprintPartTiles(result: any): PartTile[] {
  const pages = result && Array.isArray(result.pages) ? result.pages : [];
  return pages.filter((p: any) => p && typeof p.id === 'string').map((p: any, i: number) => {
    const sections = Array.isArray(p.sections) ? p.sections : [];
    const total = sections.reduce((n: number, s: any) => n + (Array.isArray(s && s.items) ? s.items.length : 0), 0);
    const first = sections[0] && Array.isArray(sections[0].items) ? sections[0].items.length : 0;
    const unit = UNITS[p.id];
    const status = total === 0 ? 'Nothing listed' : unit && first > 0 ? `${first} ${first === 1 ? unit[0] : unit[1]}` : 'Ready';
    return {
      id: p.id, n: typeof p.n === 'number' ? p.n : i + 1, title: String(p.title || `Page ${i + 1}`),
      line: typeof p.purpose === 'string' ? p.purpose : '', status, state: total === 0 ? 'missing' : 'added',
    };
  });
}
