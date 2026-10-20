/**
 * Guard: every write route that calls a paid service (credits, models, generation, scrapers, social publishing, ad
 * spend, storage uploads) has a specific limiter: route-local, router-level or at its mount in server-main.js. The
 * general per-address limiter on all of /api does not count. A new paid route without one fails here: give it one of
 * middleware/limits.js (heavyAi, lightAi, upload, spend, scrape) or add it to ALLOWED with the reason.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scan } = require('./helpers/routeLimitScan');

// Reviewed exceptions: "file METHOD /path" -> why it has no shared limiter.
const ALLOWED = {
  'studioVideos POST /concept': 'own per-account limiter allowed() (40 an hour, per task); kept, not double-limited',
  'studioVideos POST /create': 'own per-account limiter allowed() (30 an hour, per task) plus 2 active videos per account',
  'studioVideos POST /cast': 'own per-account limiter allowed() (40 an hour, per task)',
  'studioVideos POST /reference': 'own per-account limiter allowed() (20 an hour, per task)',
  'studioVideos POST /:id/change': 'own per-account limiter allowed() (shares the 30 an hour of create, per task) plus 2 active'
};

test('every paid write route has a specific limiter (or a reviewed exception)', () => {
  const rows = scan();
  assert.ok(rows.length >= 60, `the scan found ${rows.length} paid write routes: the scanner itself broke`);
  const missing = rows.filter((r) => !r.covered && !ALLOWED[`${r.file} ${r.method} ${r.path}`]).map((r) => `${r.file} ${r.method} ${r.full}`);
  assert.deepStrictEqual(missing, [], `paid routes without a limiter:\n${missing.join('\n')}`);
});

test('every reviewed exception still exists (no stale allowlist entries)', () => {
  const keys = new Set(scan().map((r) => `${r.file} ${r.method} ${r.path}`));
  for (const k of Object.keys(ALLOWED)) assert.ok(keys.has(k), `stale exception: ${k}`);
});

// The tester's list (2026-10-20): each named route carries the named shared limiter in its own route file.
const NAMED = {
  dashboard: [['get', '/campaign-suggestions', 'lightAi'], ['get', '/campaign-suggestions-stream', 'lightAi'], ['post', '/refresh-competitor-posts', 'scrape'], ['post', '/synopsis', 'lightAi'], ['post', '/generate-rival-post', 'heavyAi'], ['get', '/strategic-advisor', 'lightAi'], ['post', '/strategic-advisor/generate-post', 'heavyAi'], ['post', '/strategic-advisor/refine-image', 'heavyAi'], ['post', '/generate-event-post', 'heavyAi'], ['get', '/content-strategy', 'lightAi']],
  drafts: [['post', '/:id/regenerate', 'heavyAi'], ['post', '/generate-linkedin-post', 'heavyAi'], ['post', '/generate-image-bg', 'heavyAi'], ['post', '/:id/retry-image', 'heavyAi'], ['post', '/:id/edit-image', 'heavyAi'], ['post', '/:id/apply-logo', 'lightAi'], ['post', '/upload-media', 'upload']],
  content: [['post', '/regenerate-image', 'heavyAi'], ['post', '/generate', 'heavyAi'], ['post', '/modify', 'heavyAi'], ['post', '/localize-campaign', 'heavyAi'], ['post', '/image-audio-to-video', 'heavyAi'], ['post', '/download-video', 'lightAi'], ['get', '/download-video', 'lightAi']],
  contentCalendar: [['post', '/generate-next', 'heavyAi'], ['post', '/regenerate', 'heavyAi'], ['post', '/cover', 'heavyAi'], ['post', '/items/:itemId/auto-generate', 'heavyAi'], ['post', '/:id/auto-generate-week', 'heavyAi']],
  // read-files and transcribe keep their own per-account limits (within(): 20 and 40 an hour, per task).
  createAssist: [['post', '/suggest-details', 'lightAi']],
  carousels: [['post', '/generate-stream', 'heavyAi']],
  competitors: [['post', '/auto-discover', 'scrape'], ['post', '/scrape-by-type', 'scrape']],
  products: [['post', '/upload-image', 'upload'], ['post', '/bulk-import', 'upload'], ['post', '/:id/generate-ad-image', 'heavyAi']],
  brandAssets: [['post', '/upload', 'upload'], ['post', '/intelligence-profile/analyze', 'heavyAi'], ['post', '/colors-from-logo', 'lightAi'], ['post', '/refresh', 'scrape']],
  ads: [['post', '/boost', 'spend']],
  adCampaigns: [['post', '/', 'spend'], ['post', '/:id/retry', 'spend']],
  socialInboxRoutes: [['get', '/webhooks/:platform', 'webhook'], ['post', '/webhooks/:platform', 'webhook'], ['post', '/webhooks/comments/:platform', 'webhook']]
};

test("the tester's named routes carry the named limiter", () => {
  for (const [file, routes] of Object.entries(NAMED)) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', `${file}.js`), 'utf8');
    for (const [m, p, lim] of routes) {
      const esc = p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      const re = new RegExp(`router\\.${m}\\('${esc}',[^\\n]*\\bL\\.${lim}\\b`);
      assert.match(src, re, `${file} ${m.toUpperCase()} ${p} should use L.${lim}`);
    }
  }
});

test('the inbox mount gets the social limiter (it is mounted before /api/social), webhooks excepted', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  const inbox = src.indexOf("app.use('/api/social/inbox'");
  const social = src.indexOf("app.use('/api/social', limits.social");
  assert.ok(inbox > 0 && social > inbox, 'inbox is still mounted first');
  assert.match(src.slice(inbox, src.indexOf('\n', inbox)), /limits\.social/);
});
