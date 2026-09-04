/**
 * Human labels for the backend's Quark actions (backend/config/apiCosts.js).
 * Shared by the header dropdown, Settings' cost table, and the cost badges on
 * generate buttons — one list, so an action never shows a name in one place
 * and its raw snake_case key in another.
 */
export const ACTION_LABELS: Record<string, { label: string; icon: string }> = {
  image_generated: { label: 'Image Generation', icon: '🖼️' },
  image_edit: { label: 'Image Edit', icon: '✏️' },
  campaign_text: { label: 'Campaign Ideas', icon: '💡' },
  campaign_full: { label: 'Campaign Post', icon: '📣' },
  chat_message: { label: 'Chat Message', icon: '💬' },
  competitor_scrape: { label: 'Competitor Intel', icon: '🔍' },
  rival_post: { label: 'Rival Post', icon: '🥊' },
  strategic_post: { label: 'Strategic Post', icon: '🧭' },
  event_post: { label: 'Event Post', icon: '🎉' },
  refine_image: { label: 'Refine Image', icon: '🎨' },
  video_base: { label: 'Video Setup', icon: '🎬' },
  video_generated: { label: 'Video Scene', icon: '🎞️' },
  carousel_generated: { label: 'Carousel', icon: '🖼️' },
};

/**
 * The cost table grouped the way someone actually thinks about their work —
 * "what does a post cost, what does a reel cost" — rather than as one flat
 * list of twelve keys in whatever order the API returned them.
 *
 * `example` is the part that earns its space: a carousel priced "19 per slide"
 * and a video split across a setup fee and a per-scene rate are the two places
 * a bare number misleads, so each shows what a real one actually costs.
 */
export interface QuarkGroup {
  title: string;
  blurb: string;
  actions: string[];
  example?: (costs: Record<string, number>) => string;
}

export const QUARK_GROUPS: QuarkGroup[] = [
  {
    title: 'Posts',
    blurb: 'One image and its caption.',
    actions: ['image_generated', 'campaign_full', 'rival_post', 'strategic_post', 'event_post'],
  },
  {
    title: 'Carousels',
    blurb: 'Charged per slide, so a longer deck costs more.',
    actions: ['carousel_generated'],
    example: (c) => `A 8-slide carousel costs ${(c.carousel_generated || 0) * 8}`,
  },
  {
    title: 'Video',
    blurb: 'A setup fee once, then every scene. Setup covers the character sheet, music and thumbnail.',
    actions: ['video_base', 'video_generated'],
    example: (c) =>
      `A 5-scene reel costs ${(c.video_base || 0) + (c.video_generated || 0) * 5}`,
  },
  {
    title: 'Edits & extras',
    blurb: 'Reworking something you already made, and the small stuff.',
    actions: ['image_edit', 'refine_image', 'campaign_text', 'chat_message'],
  },
];
