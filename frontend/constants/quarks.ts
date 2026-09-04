/**
 * Human labels for the backend's credit actions (backend/middleware/trialGuard.js
 * CREDIT_COSTS). Shared by the header dropdown's "what does this cost" link
 * target, Settings' full cost table, and the small cost badges on generate
 * buttons — one list, so an action never shows a name in one place and its
 * raw snake_case key in another.
 */
export const ACTION_LABELS: Record<string, { label: string; icon: string }> = {
  image_generated: { label: 'Image Generation', icon: '🖼️' },
  image_edit: { label: 'Image Edit', icon: '✏️' },
  campaign_text: { label: 'Campaign Ideas', icon: '💡' },
  campaign_full: { label: 'Full Campaign', icon: '📣' },
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
