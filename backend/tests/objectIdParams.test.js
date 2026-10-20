const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { applyObjectIdParams } = require('../middleware/validateObjectId');
const { queryGuard } = require('../middleware/queryGuard');
const { errorHandler } = require('../middleware/errorHandler');

const OK_ID = 'a'.repeat(24);
async function call(app, url) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch (_) { return null; } })() };
  } finally { server.close(); }
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('applyObjectIdParams: a non-24-hex value is a 400 Invalid id; a valid id passes; other names are untouched', async () => {
  const router = express.Router();
  applyObjectIdParams(router, ['id', 'noteId']);
  router.get('/things/:id', (req, res) => res.json({ ok: true, id: req.params.id }));
  router.get('/slug/:slug', (req, res) => res.json({ ok: true, slug: req.params.slug }));
  const app = express(); app.use('/api', router);
  for (const bad of ['123', 'not-an-id', '%7B%24ne%3A1%7D', 'g'.repeat(24), 'a'.repeat(25), '12charstring']) {
    const r = await call(app, `/api/things/${bad}`);
    assert.strictEqual(r.status, 400, bad);
    assert.strictEqual(r.json.message, 'Invalid id');
    assert.ok(!/Cast to/i.test(r.text));
  }
  assert.strictEqual((await call(app, `/api/things/${OK_ID}`)).status, 200);
  assert.strictEqual((await call(app, '/api/slug/my-slug')).status, 200, 'a name that is not listed is not validated');
});

test('queryGuard: ?status[$ne]=x is a 400, plain values and harmless nested values pass', async () => {
  const app = express();
  app.use(queryGuard);
  app.get('/api/list', (req, res) => res.json({ ok: true, status: req.query.status }));
  let r = await call(app, '/api/list?status[$ne]=x');
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.errorCode, 'INVALID_QUERY');
  r = await call(app, '/api/list?filter[a][$gt]=1');
  assert.strictEqual(r.status, 400);
  r = await call(app, '/api/list?status=draft&platform=a&platform=b');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.status, 'draft');
  r = await call(app, '/api/list?filters[kind]=x');
  assert.strictEqual(r.status, 200);
});

test('the real campaigns router: GET /api/campaigns/123 is a 400 Invalid id with no "Cast to" text, before any query', async () => {
  // protect needs a signed token and a database; replace it with a pass-through for this check only.
  const authPath = require.resolve('../middleware/auth');
  const real = require(authPath);
  require.cache[authPath].exports = { ...real, protect: (req, res, next) => { req.user = { _id: OK_ID, id: OK_ID, userId: OK_ID }; next(); } };
  delete require.cache[require.resolve('../routes/campaigns')];
  const router = require('../routes/campaigns');
  require.cache[authPath].exports = real;
  const app = express();
  app.use(queryGuard);
  app.use('/api/campaigns', router);
  app.use(errorHandler);
  let r = await quiet(() => call(app, '/api/campaigns/123'));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.message, 'Invalid id');
  assert.ok(!/Cast to/i.test(r.text));
  r = await quiet(() => call(app, '/api/campaigns?status[$ne]=x'));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.message, 'Invalid query');
  assert.ok(router.params.id && !router.params.jobId, 'image job ids are strings, so only :id is validated in this router');
});

// Every router file with `:id`-style parameters is either validated (and says which names) or is in the reviewed list
// below with the reason its parameter is not a Mongo ObjectId.
const NOT_OBJECT_IDS = {
  'ads.js': ':adId is the Ayrshare ad id',
  'aiMemoryLearned.js': ':key is a memory key',
  'blueprint.js': ':id is the blueprintId string, not _id',
  'competitorHandle.js': 'validates the id itself and answers 404 (tested in competitorHandleRoute.test.js)',
  'createAssist.js': 'validates the id itself with its own message',
  'draftLocalize.js': 'the service answers 404 for a bad id (draftLocalization.test.js)',
  'heroVideo.js': ':jobId is a generated job id string',
  'prompts.js': ':id is a prompt key',
  'videoGeneration.js': ':jobId is a queue job id string',
  'week.js': ':id is the week item id, a generated string'
};

test('every router with :param routes is validated or reviewed as not an ObjectId', () => {
  const dir = path.join(__dirname, '..', 'routes');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    if (f === 'auth.js') continue; // edited by another change, listed in the hardening docs for later
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const hasIdRoutes = /\.(get|post|put|patch|delete)\(\s*['"`][^'"`]*:(id|campaignId|draftId|itemId|postId|jobId|userId|noteId|adId)\b/.test(src);
    if (!hasIdRoutes) continue;
    const validated = /applyObjectIdParams\(router/.test(src);
    if (!validated && !NOT_OBJECT_IDS[f]) bad.push(f);
    if (validated && NOT_OBJECT_IDS[f]) bad.push(`${f} is both validated and listed as skipped`);
  }
  assert.deepStrictEqual(bad, []);
});
