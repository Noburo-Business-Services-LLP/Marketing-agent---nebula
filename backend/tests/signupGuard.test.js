const test = require('node:test');
const assert = require('node:assert');
const { isDisposableEmail, canonicalEmail, publicConfig, signupGuard, verifyBotCheck } = require('../services/signupGuard');

function run(guard, body, ip = '1.2.3.4') {
  return new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    guard({ body, ip }, res, () => resolve({ next: true }));
  });
}

test('throwaway mail domains are refused, real ones are not', () => {
  assert.ok(isDisposableEmail('x@mailinator.com'));
  assert.ok(isDisposableEmail('x@sub.yopmail.com'));
  assert.ok(isDisposableEmail('X@GuerrillaMail.com'));
  assert.ok(!isDisposableEmail('a@gmail.com'));
  assert.ok(!isDisposableEmail('a@bosch.com'));
  assert.ok(!isDisposableEmail('nonsense'));
});

test('one mailbox written differently is one account', () => {
  assert.equal(canonicalEmail('A.B.c+promo@gmail.com'), 'abc@gmail.com');
  assert.equal(canonicalEmail('abc@googlemail.com'), 'abc@gmail.com');
  assert.equal(canonicalEmail('first.last+x@company.com'), 'first.last@company.com');
});

test('the signup screen config never carries secrets or codes', () => {
  const c = publicConfig({ SIGNUP_MODE: 'invite', SIGNUP_INVITE_CODES: 'secretcode', TURNSTILE_SECRET_KEY: 'sek', TURNSTILE_SITE_KEY: 'site' });
  assert.deepEqual(c, { inviteRequired: true, botCheckSiteKey: 'site' });
  assert.deepEqual(publicConfig({}), { inviteRequired: false, botCheckSiteKey: '' });
});

test('guard: open mode lets a normal signup through', async () => {
  const r = await run(signupGuard({ env: {}, countRecent: async () => 3 }), { email: 'a@gmail.com' });
  assert.equal(r.next, true);
});

test('guard: disposable mail refused', async () => {
  const r = await run(signupGuard({ env: {}, countRecent: async () => 0 }), { email: 'a@mailinator.com' });
  assert.equal(r.code, 400);
});

test('guard: invitation-only needs a listed code (any case)', async () => {
  const g = signupGuard({ env: { SIGNUP_MODE: 'invite', SIGNUP_INVITE_CODES: 'Alpha1, beta2' }, countRecent: async () => 0 });
  assert.equal((await run(g, { email: 'a@gmail.com' })).code, 403);
  assert.equal((await run(g, { email: 'a@gmail.com', inviteCode: 'nope' })).code, 403);
  assert.equal((await run(g, { email: 'a@gmail.com', inviteCode: 'ALPHA1' })).next, true);
});

test('guard: the daily cap stops new accounts, and 0 turns it off', async () => {
  assert.equal((await run(signupGuard({ env: { SIGNUPS_PER_DAY: '10' }, countRecent: async () => 10 }), { email: 'a@gmail.com' })).code, 503);
  assert.equal((await run(signupGuard({ env: { SIGNUPS_PER_DAY: '10' }, countRecent: async () => 9 }), { email: 'a@gmail.com' })).next, true);
  assert.equal((await run(signupGuard({ env: { SIGNUPS_PER_DAY: '0' }, countRecent: async () => 99999 }), { email: 'a@gmail.com' })).next, true);
});

test('guard: bot check is required only when configured, and a failed check never passes', async () => {
  const env = { TURNSTILE_SECRET_KEY: 's' };
  assert.equal((await run(signupGuard({ env, countRecent: async () => 0, verifyBotCheck: async () => false }), { email: 'a@gmail.com', botCheckToken: 'x' })).code, 400);
  assert.equal((await run(signupGuard({ env, countRecent: async () => 0, verifyBotCheck: async () => true }), { email: 'a@gmail.com', botCheckToken: 'x' })).next, true);
  assert.equal(await verifyBotCheck('', '1.1.1.1', 's'), false);
  assert.equal(await verifyBotCheck('tok', '1.1.1.1', 's', async () => { throw new Error('network'); }), false);
  assert.equal(await verifyBotCheck('tok', '1.1.1.1', 's', async () => ({ json: async () => ({ success: true }) })), true);
});
