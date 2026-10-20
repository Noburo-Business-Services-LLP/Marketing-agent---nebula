'use strict';
// OAuth state in MongoDB (services/oauthState.js): random, single use, expiry, bound to the account and purpose.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createOAuthStates, hash } = require('../services/oauthState');

function fakeModel() {
  const rows = new Map();
  const matches = (r, f) => r && (!f.purpose || r.purpose === f.purpose) && (!f.expiresAt || r.expiresAt > f.expiresAt.$gt);
  return {
    rows,
    async create(doc) { if (rows.has(doc._id)) { const e = new Error('dup'); e.code = 11000; throw e; } rows.set(doc._id, { ...doc }); return doc; },
    findOneAndDelete(f) {
      return { lean: async () => { const r = rows.get(f._id); if (!matches(r, f)) return null; rows.delete(f._id); return r; } };
    }
  };
}

test('issue: 32 random bytes, stored only as a hash, with the account, purpose and a 10 minute expiry', async () => {
  const m = fakeModel();
  const s = createOAuthStates({ model: () => m, now: () => 1000 });
  const a = await s.issue({ userId: 'u1', purpose: 'youtube' });
  const b = await s.issue({ userId: 'u1', purpose: 'youtube' });
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notStrictEqual(a, b);
  assert.ok(!m.rows.has(a), 'the raw state is not stored');
  const row = m.rows.get(hash(a));
  assert.deepStrictEqual({ ...row, _id: undefined }, { _id: undefined, purpose: 'youtube', userId: 'u1', platform: '', expiresAt: new Date(1000 + 10 * 60 * 1000) });
  await assert.rejects(() => s.issue({ purpose: 'youtube' }));
});

test('consume: once only, then refused (a replayed callback finds nothing)', async () => {
  const m = fakeModel();
  const s = createOAuthStates({ model: () => m });
  const st = await s.issue({ userId: 'u7', purpose: 'google_calendar' });
  assert.deepStrictEqual(await s.consume(st, { purpose: 'google_calendar' }), { userId: 'u7', platform: '' });
  assert.strictEqual(await s.consume(st, { purpose: 'google_calendar' }), null);
});

test('consume: expired, other purpose, unknown and malformed states are refused', async () => {
  const m = fakeModel();
  let now = 0;
  const s = createOAuthStates({ model: () => m, now: () => now });
  const st = await s.issue({ userId: 'u1', purpose: 'youtube', platform: 'yt' });
  assert.strictEqual(await s.consume(st, { purpose: 'google_calendar' }), null, 'a YouTube state does not open Calendar');
  assert.ok(m.rows.size === 1, 'a wrong-purpose try does not burn it');
  now = 10 * 60 * 1000 + 1;
  assert.strictEqual(await s.consume(st, { purpose: 'youtube' }), null, 'expired');
  for (const bad of ['', 'x', 'a'.repeat(44), Buffer.from('{"userId":"u1"}').toString('base64'), null, undefined, ['a'], 'a'.repeat(42) + '!']) {
    assert.strictEqual(await s.consume(bad, { purpose: 'youtube' }), null, String(bad));
  }
  assert.strictEqual(await s.consume('A'.repeat(43), { purpose: 'youtube' }), null, 'unknown');
  assert.strictEqual(await s.consume('A'.repeat(43)), null, 'no purpose');
});

test('the callback is bound to the account that started it (the stored user, never one from the request)', async () => {
  const m = fakeModel();
  const s = createOAuthStates({ model: () => m });
  const st = await s.issue({ userId: 'owner-of-sign-in', purpose: 'social', platform: 'linkedin' });
  assert.deepStrictEqual(await s.consume(st, { purpose: 'social' }), { userId: 'owner-of-sign-in', platform: 'linkedin' });
});

test('routes use the shared store, no in-process state Map, no Math.random state', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['routes/googleCalendar.js', 'routes/social.js']) {
    const src = read(f);
    assert.ok(!/OAuthStates = new Map|pendingOAuthStates|pendingCalendarOAuthStates/.test(src), f);
    assert.ok(!/random: Math\.random/.test(src), f);
    assert.match(src, /require\('\.\.\/services\/oauthState'\)/, f);
  }
  const cal = read('routes/googleCalendar.js');
  assert.match(cal, /oauthStates\.issue\(\{ userId: req\.user\._id\.toString\(\), purpose: CALENDAR_PURPOSE \}\)/);
  assert.match(cal, /oauthStates\.consume\(String\(state\), \{ purpose: CALENDAR_PURPOSE \}\)/);
  const social = read('routes/social.js');
  assert.match(social, /oauthStates\.issue\(\{ userId: req\.user\._id\.toString\(\), purpose: YOUTUBE_PURPOSE \}\)/);
  assert.strictEqual((social.match(/oauthStates\.consume\(String\(state\), \{ purpose: SOCIAL_PURPOSE \}\)/g) || []).length, 4);
  assert.strictEqual((social.match(/oauthStates\.consume\(String\(state\), \{ purpose: YOUTUBE_PURPOSE \}\)/g) || []).length, 1);
});
