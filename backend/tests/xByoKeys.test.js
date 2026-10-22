const test = require('node:test');
const assert = require('node:assert/strict');
const x = require('../services/xByoKeys');
const { REDACT_PATHS } = require('../utils/logger');

const both = { AYRSHARE_X_API_KEY: ' ck ', AYRSHARE_X_API_SECRET: 'cs' };

test('keys need both, trimmed', () => {
  assert.deepEqual(x.xKeys(both), { key: 'ck', secret: 'cs' });
  assert.equal(x.xKeys({ AYRSHARE_X_API_KEY: 'a' }), null);
  assert.equal(x.xKeys({ AYRSHARE_X_API_SECRET: 'a', AYRSHARE_X_API_KEY: '  ' }), null);
  assert.deepEqual(x.xHeaders({}), {});
  assert.equal(x.hasXKeys(both), true);
  assert.deepEqual(Object.keys(x.xHeaders(both)), ['X-Twitter-OAuth1-Api-Key', 'X-Twitter-OAuth1-Api-Secret']);
});

test('link body fields only with keys and X in allowedSocial (or no restriction)', () => {
  assert.deepEqual(x.xLinkFields(['twitter'], both), { twitterApiKey: 'ck', twitterApiSecret: 'cs' });
  assert.deepEqual(x.xLinkFields(['x'], both), { twitterApiKey: 'ck', twitterApiSecret: 'cs' });
  assert.deepEqual(x.xLinkFields(undefined, both), { twitterApiKey: 'ck', twitterApiSecret: 'cs' });
  assert.deepEqual(x.xLinkFields(['instagram'], both), {});
  assert.deepEqual(x.xLinkFields(['twitter'], {}), {});
  assert.deepEqual(x.xLinkFields(['twitter'], { AYRSHARE_X_API_KEY: 'a' }), {});
});

test('headers only when both keys set and the call targets X or cannot be told', () => {
  const post = (platforms) => ({ method: 'POST', body: { platforms } });
  assert.equal(Object.keys(x.xHeadersFor('https://api.ayrshare.com/api/post', post(['twitter', 'instagram']), both)).length, 2);
  assert.deepEqual(x.xHeadersFor('https://api.ayrshare.com/api/post', post(['instagram']), both), {});
  assert.equal(Object.keys(x.xHeadersFor('https://api.ayrshare.com/api/history', {}, both)).length, 2);
  assert.equal(Object.keys(x.xHeadersFor('https://api.ayrshare.com/api/analytics/social?platforms=facebook,x', {}, both)).length, 2);
  assert.deepEqual(x.xHeadersFor('https://api.ayrshare.com/api/analytics/social?platforms=facebook', {}, both), {});
  assert.deepEqual(x.xHeadersFor('https://api.ayrshare.com/api/messages/instagram', {}, both), {});
  assert.equal(Object.keys(x.xHeadersFor('https://api.ayrshare.com/api/messages/twitter', {}, both)).length, 2);
  assert.deepEqual(x.xHeadersFor('https://api.ayrshare.com/api/profiles/generateJWT', {}, both), {});
  assert.deepEqual(x.xHeadersFor('https://example.com/api/post', post(['twitter']), both), {});
  assert.deepEqual(x.xHeadersFor('https://api.ayrshare.com/api/post', post(['twitter']), { AYRSHARE_X_API_KEY: 'a' }), {});
});

test('error mapping is plain and carries no secrets', () => {
  const m402 = x.mapXError(402, { message: 'CreditsDepleted for ck' });
  assert.equal(m402.code, 'credits'); assert.equal(m402.staff, 'X credits are used up.');
  assert.equal(x.mapXError(403, { message: 'Callback URL not approved' }).code, 'callback');
  assert.equal(x.mapXError(403, { message: 'not configured with the appropriate OAuth1 app permissions' }).code, 'permissions');
  assert.equal(x.mapXError(400, { message: 'Twitter API key and secret required' }).code, 'keys');
  assert.equal(x.mapXError(419, { message: 'bad X-Twitter-OAuth1 key' }).code, 'keys');
  assert.equal(x.mapXError(500, { message: 'boom' }), null);
  assert.equal(x.mapXError(403, { message: 'other' }), null);
  for (const m of [m402, x.mapXError(403, { message: 'Callback URL not approved' })]) {
    assert.equal(m.customer, 'Connecting X is not available right now. Our team has been notified.');
    assert.ok(!/ayrshare|plan|\bck\b/i.test(m.customer + m.staff + m.internal));
  }
});

test('logging prints only the reason', () => {
  const lines = []; const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
  try { x.logXFailure('generateJWT', x.mapXError(402, { message: 'CreditsDepleted ck cs' })); } finally { console.error = orig; }
  assert.equal(lines.length, 1); assert.ok(!/ck|cs\b/.test(lines[0].replace('credits', '')));
});

test('logger redacts the key names', () => {
  for (const n of ['AYRSHARE_X_API_KEY', 'AYRSHARE_X_API_SECRET', 'twitterApiSecret']) assert.ok(REDACT_PATHS.includes(n));
});
