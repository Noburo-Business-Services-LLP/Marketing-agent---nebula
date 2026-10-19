/**
 * The one mapping from the server's Quark cost keys (backend/config/apiCosts.js, sent by GET /api/credits as
 * `costs`, `units` and `pricing`) to the price list in Settings > Billing. Plain names grouped by what the customer
 * does; no price is typed here, every number comes from the server.
 *
 * Every key the server prices is either used by a row below (COST_GROUPS) or listed in HIDDEN_COST_KEYS with the
 * reason it is not shown. tests/quarkCostList.test.mjs reads the backend config and fails on a key that is neither,
 * so a new paid action cannot reach customers without a name on this list.
 */

export type CostMap = Record<string, number>;

/** The extras the price list needs besides the cost map (backend/services/costList.js). */
export interface CostPricing {
  videoPartSeconds?: number;
  videoMaxParts?: number;
  photoshootPacks?: Array<{ key: string; title: string; photos: number; counts?: number[] }>;
}

/** One row as the definition describes it: the key it is priced by, how many units, its name and one line. */
interface RowDef { key: string; times?: number; label: string; detail: string }

interface GroupDef {
  id: string;
  title: string;
  blurb: string;
  /** The small coloured dot next to the group title (brand accent map, docs/superpowers/ops/tile-system.md). */
  accent: string;
  rows: (costs: CostMap, pricing: CostPricing) => RowDef[];
  note?: (costs: CostMap, pricing: CostPricing) => string;
}

export interface CostRow { label: string; detail: string; quarks: number }
export interface CostGroup { id: string; title: string; blurb: string; accent: string; rows: CostRow[]; note: string }

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const q = (v: number) => `${v.toLocaleString('en-IN')} Quarks`;

/** Typical sizes for the worked examples. Sizes only, never prices. */
const CAROUSEL_EXAMPLES = [5, 10];
const CAMPAIGN_EXAMPLE = 5;
const VIDEO_LENGTHS = [10, 20, 30];

export const COST_GROUPS: GroupDef[] = [
  {
    id: 'posts', title: 'Posts and images', accent: '#F5A623',
    blurb: 'A single post with its picture and caption.',
    rows: () => [
      { key: 'image_generated', label: 'Image post', detail: 'One picture and its caption' },
      { key: 'image_generated', label: 'Post from your plan', detail: 'Each post made for a week of your plan' },
      { key: 'campaign_text', label: 'LinkedIn text post', detail: 'A written post without a picture' },
      { key: 'campaign_text', label: 'Caption for your own photo', detail: 'Written when you upload a photo' },
    ],
  },
  {
    id: 'carousels', title: 'Carousels', accent: '#7B5CC4',
    blurb: 'Priced per slide, so a longer carousel costs more.',
    rows: () => [
      { key: 'carousel_generated', label: 'One slide', detail: 'Each slide of a carousel' },
      ...CAROUSEL_EXAMPLES.map((s) => ({ key: 'carousel_generated', times: s, label: `${s}-slide carousel`, detail: `${s} slides` })),
    ],
  },
  {
    id: 'campaigns', title: 'Campaigns', accent: '#1F9D9A',
    blurb: 'A set of posts around one goal, priced per post.',
    rows: () => [
      { key: 'campaign_full', label: 'Campaign post', detail: 'Each post of a campaign' },
      { key: 'campaign_full', times: CAMPAIGN_EXAMPLE, label: `Campaign of ${CAMPAIGN_EXAMPLE} posts`, detail: `${CAMPAIGN_EXAMPLE} posts` },
    ],
  },
  {
    id: 'videos', title: 'Videos', accent: '#5B6BDC',
    blurb: 'Priced by length. Writing the video plan before you make it is free.',
    rows: (_c, p) => {
      const part = n(p.videoPartSeconds);
      const max = n(p.videoMaxParts);
      if (!(part > 0)) return [];
      const rows: RowDef[] = VIDEO_LENGTHS
        .filter((s) => s % part === 0 && (!(max > 0) || s / part <= max))
        .map((s) => ({ key: 'studio_video', times: s / part, label: `${s} second video`, detail: s / part === 1 ? 'One part' : `${s / part} parts` }));
      rows.push({ key: 'studio_reference', label: 'A person or place for your videos', detail: 'Each one you add' });
      return rows;
    },
    note: (c, p) => {
      const part = n(p.videoPartSeconds); const max = n(p.videoMaxParts); const per = n(c.studio_video);
      if (!(part > 0) || !(max > 0) || !(per > 0) || part * max <= VIDEO_LENGTHS[VIDEO_LENGTHS.length - 1]) return '';
      return `Longer videos, up to ${part * max} seconds, add ${q(per)} for every ${part} seconds. Parts that cannot be made are not charged.`;
    },
  },
  {
    id: 'photoshoot', title: 'Photoshoot', accent: '#A63EBB',
    blurb: 'Styled product photos, priced per photo.',
    rows: (_c, p) => [
      { key: 'photoshoot_image', label: 'One photo', detail: 'Each photo of a photoshoot' },
      ...(p.photoshootPacks || [])
        .filter((pk) => pk && pk.title && n(pk.photos) > 0)
        .map((pk) => ({ key: 'photoshoot_image', times: pk.photos, label: pk.title, detail: `${pk.photos} photos` })),
    ],
  },
  {
    id: 'competitors', title: 'Competitor drafts', accent: '#EE6330',
    blurb: "Drafts written from a competitor's post on your Home page.",
    rows: () => [
      { key: 'home_response_post', label: 'Post in response', detail: 'A post of your own that answers theirs' },
      { key: 'home_witty_comment', label: 'Witty comment', detail: 'A short comment to leave on their post' },
    ],
  },
  {
    id: 'blueprint', title: 'Growth Blueprint', accent: '#D8527A',
    blurb: 'Your plan for growing the business, written from your details.',
    rows: () => [
      { key: 'blueprint', label: 'Growth Blueprint', detail: 'Your first one on the free plan is free' },
      { key: 'blueprint_pdf', label: 'Designed Blueprint PDF', detail: 'A designed copy to share' },
    ],
  },
  {
    id: 'edits', title: 'Edits', accent: '#3E8B5A',
    blurb: 'Changing something you already made.',
    rows: () => [
      { key: 'image_edit', label: 'Change a picture', detail: 'Describe the change in your words' },
    ],
  },
];

/**
 * Keys the server prices that are not on the customer's list, and why. A key here must not also be used by a row.
 * Free internal work and actions only reachable from older screens that customers no longer open from the menu.
 */
export const HIDDEN_COST_KEYS: Record<string, string> = {
  competitor_scrape: 'Free: reading competitors is covered by the "what is free" line',
  listening_score: 'Free internal work: sorting comments',
  studio_transcription: 'Free internal work: timing the subtitles of a video',
  refine_image: 'Only on the older post screens, not in the menu',
  chat_message: 'Only on the older campaign screen, not in the menu',
  rival_post: 'Only on the older home screen, not in the menu',
  strategic_post: 'Only on the older home screen, not in the menu',
  event_post: 'Only on the older home screen, not in the menu',
  video_base: 'Older step-by-step videos: only finishing an old draft, new videos are made on Create video',
  video_generated: 'Older step-by-step videos: only finishing an old draft',
  video_scene_image: 'Older step-by-step videos: only finishing an old draft',
  video_scene_clip: 'Older step-by-step videos: only finishing an old draft',
  video_character_portrait: 'Older step-by-step videos: only finishing an old draft',
  hero_video_clip: 'Hero video is hidden everywhere (owner decision 2026-10-19)',
};

/** Every cost key a row of the list can use (for the mapping test). */
export function mappedCostKeys(): string[] {
  const all = { videoPartSeconds: 10, videoMaxParts: 6, photoshootPacks: [{ key: 'x', title: 'x', photos: 1 }] };
  return Array.from(new Set(COST_GROUPS.flatMap((g) => g.rows({}, all).map((r) => r.key))));
}

/** What is free of Quarks. Only statements that are true of the product now (see the impact notes in the ledger). */
export const FREE_LINES: string[] = [
  'Making your monthly plan and changing it',
  'Writing a video plan before you make the video',
  'Downloading, scheduling and posting what you made',
  "Reading your competitors' posts",
  'Messages, comments and reviews in the Inbox',
  'Refreshing your brand details from your website',
];

/**
 * The list to draw: each group with its rows priced from the server's map. A row whose price the server did not send
 * is left out, and a group with no rows left is left out, so nothing shows a made-up number.
 */
export function buildCostList(costs: CostMap | null | undefined, pricing: CostPricing | null | undefined): CostGroup[] {
  const c = costs || {};
  const p = pricing || {};
  return COST_GROUPS.map((g) => {
    const rows = g.rows(c, p)
      .filter((r) => n(c[r.key]) > 0)
      .map((r) => ({ label: r.label, detail: r.detail, quarks: Math.round(n(c[r.key]) * (r.times || 1)) }));
    return { id: g.id, title: g.title, blurb: g.blurb, accent: g.accent, rows, note: rows.length && g.note ? g.note(c, p) : '' };
  }).filter((g) => g.rows.length > 0);
}

export const quarksText = q;
