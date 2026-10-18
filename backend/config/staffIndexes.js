/**
 * The extra database indexes the staff Usage page needs. ONE list, used in two places:
 *  - the models declare them with `_autoIndex: false`, so the app NEVER builds them by itself at start-up
 *    (the production cluster is close to its disk limit; an index build there must be a deliberate step);
 *  - `scripts/create-staff-indexes.js` builds them on purpose, one at a time.
 *
 * Each one matches a real filter in `services/staff/usage.js`: a date range first (Usage counts the last 30 days of
 * each collection and groups by client), because the existing indexes all start with the client id and cannot narrow
 * a read by date.
 */
const DAY_FILTER = { $gt: new Date(0) };

const STAFF_INDEXES = Object.freeze([
  { model: 'Draft', collection: 'drafts', name: 'staff_createdAt', keys: { createdAt: -1 }, why: 'Usage: images and posts drafted in the last 30 days' },
  { model: 'Campaign', collection: 'campaigns', name: 'staff_publishedAt', keys: { publishedAt: -1 }, why: 'Usage: posts published in the last 30 days' },
  { model: 'VideoJob', collection: 'video_jobs', name: 'staff_status_createdAt', keys: { status: 1, createdAt: -1 }, why: 'Usage: finished videos in the last 30 days' },
  { model: 'HeroVideoJob', collection: 'hero_video_jobs', name: 'staff_status_createdAt', keys: { status: 1, createdAt: -1 }, why: 'Usage: finished hero videos in the last 30 days' },
  { model: 'Blueprint', collection: 'blueprints', name: 'staff_status_createdAt', keys: { status: 1, createdAt: -1 }, why: 'Usage: finished Blueprints in the last 30 days' },
  {
    model: 'SocialInboxMessage', collection: 'socialinboxmessages', name: 'staff_ai_generatedAt', keys: { 'ai.generatedAt': -1 },
    options: { partialFilterExpression: { 'ai.generatedAt': DAY_FILTER } }, // only messages that have a drafted reply: a small index
    why: 'Usage: replies drafted by the assistant in the last 30 days'
  }
]);

/** Adds this model's staff indexes to its schema, marked so Mongoose skips them when it builds indexes by itself. */
function declareStaffIndexes(schema, modelName) {
  for (const def of STAFF_INDEXES.filter((d) => d.model === modelName)) {
    schema.index(def.keys, { ...(def.options || {}), name: def.name, _autoIndex: false });
  }
}

module.exports = { STAFF_INDEXES, declareStaffIndexes };
