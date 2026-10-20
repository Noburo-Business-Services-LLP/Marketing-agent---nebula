const test = require('node:test');
const assert = require('node:assert');
const { createBlueprintService } = require('../services/blueprint/service');
const runner = require('../services/blueprint/runner');
const { QUARK_COSTS } = require('../config/apiCosts');
const { LIMITS } = require('../config/blueprint');
const { makeDeps } = require('./blueprintFakes');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const HOUR = 3600 * 1000;

const user = (id = 'u1', email = 'owner@example.com', isVerified = true) => ({ _id: id, email, isVerified });
const form = (over = {}) => ({
  businessName: 'Sweet Co', website: 'https://sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', ...over
});
function setup(over) {
  const deps = makeDeps(over);
  const svc = createBlueprintService(deps);
  const begin = (u, body, tier = 'free', ip = '1.1.1.1') => svc.start({ user: u, tier, body, ip });
  return { deps, svc, begin, doc: (id) => deps.Blueprint.docs.find((d) => d.blueprintId === id) };
}

test('validation failure: 400, no document, no charge', async () => {
  const { deps, begin } = setup();
  const r = await begin(user(), form({ businessName: '' }));
  assert.strictEqual(r.status, 400);
  assert.ok(r.json.errors.businessName);
  assert.strictEqual(r.json.message, 'Please correct the highlighted fields.');
  assert.strictEqual(deps.Blueprint.docs.length, 0);
  assert.strictEqual(deps.calls.deduct.length, 0);
});

test('free unverified user: 403 verificationRequired', async () => {
  const { deps, begin } = setup();
  const r = await begin(user('u1', 'a@b.com', false), form());
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.verificationRequired, true);
  assert.strictEqual(deps.Blueprint.docs.length, 0);
});

test('successful free start: 202, queued, slot held, charged once; run completes without refund', async () => {
  const { deps, begin, doc } = setup();
  const r = await begin(user(), form());
  assert.strictEqual(r.status, 202);
  assert.deepStrictEqual(r.json, { success: true, id: 'bp-1', status: 'queued' });
  const d = doc('bp-1');
  assert.strictEqual(d.status, 'queued');
  assert.strictEqual(d.freeSlot, true);
  assert.strictEqual(d.charge.state, 'charged');
  assert.strictEqual(d.charge.quarks, QUARK_COSTS.blueprint);
  assert.strictEqual(d.ipHash, 'h:1.1.1.1');
  assert.strictEqual(deps.calls.deduct.length, 1);
  assert.strictEqual(deps.calls.deduct[0][0], 'u1');
  assert.strictEqual(deps.calls.deduct[0][1], 'blueprint');
  assert.strictEqual(deps.calls.deduct[0][2], 1);
  await deps.drain();
  const e = doc('bp-1');
  assert.strictEqual(e.status, 'completed');
  assert.strictEqual(e.progress, 100);
  assert.ok(e.result && e.result.cover);
  assert.strictEqual(deps.calls.refund.length, 0);
  assert.strictEqual(e.freeSlot, true);
});

test('same user, same business: 409 with the first id and no second charge', async () => {
  const { deps, begin } = setup();
  await begin(user(), form());
  const r = await begin(user(), form());
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.alreadyUsed, true);
  assert.strictEqual(r.json.id, 'bp-1');
  assert.strictEqual(deps.calls.deduct.length, 1);
});

test('Gmail alias of the same person: 409', async () => {
  const { begin } = setup();
  assert.strictEqual((await begin(user('u1', 'a.b@gmail.com'), form())).status, 202);
  const r = await begin(user('u2', 'ab+x@gmail.com'), form({ businessName: 'Other', website: 'https://other.in' }));
  assert.strictEqual(r.status, 409);
});

test('same business through www or the Instagram handle: 409', async () => {
  const { begin } = setup();
  assert.strictEqual((await begin(user('u1', 'a@x.com'), form({ website: 'https://www.sweetco.in' }))).status, 202);
  assert.strictEqual((await begin(user('u2', 'b@x.com'), form({ website: 'sweetco.in' }))).status, 409);
  const ig = await begin(user('u3', 'c@x.com'), form({ website: '', instagram: '@sweetco_ig' }));
  assert.strictEqual(ig.status, 202);
  assert.strictEqual((await begin(user('u4', 'd@x.com'), form({ website: '', instagram: 'https://www.instagram.com/sweetco_ig/' }))).status, 409);
});

test('two concurrent starts for one business: one 202, one 409, one charge', async () => {
  const { deps, begin } = setup();
  const [a, b] = await Promise.all([begin(user('u1', 'a@x.com'), form()), begin(user('u2', 'b@x.com'), form())]);
  assert.deepStrictEqual([a.status, b.status].sort(), [202, 409]);
  assert.strictEqual(deps.calls.deduct.length, 1);
  assert.strictEqual(deps.Blueprint.docs.length, 1);
});

test('planner throws: failed, slot released, one refund; the user can start again', async () => {
  const { deps, begin, doc } = setup();
  deps.plan.build = async () => { throw new Error('model down: secret detail'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  const d = doc('bp-1');
  assert.strictEqual(d.status, 'failed');
  assert.strictEqual(d.freeSlot, false);
  assert.strictEqual(d.charge.state, 'refunded');
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.deepStrictEqual(deps.calls.refund[0].slice(0, 3), ['u1', 'blueprint', 1]);
  assert.ok(!JSON.stringify(d.error).includes('secret'));
  const again = await begin(user(), form());
  assert.strictEqual(again.status, 202);
});

test('stop from discovery: stopped, slot released, refunded', async () => {
  const { deps, begin, doc } = setup();
  const base = deps.discover;
  deps.discover = async (a) => { const o = await base(a); o.sheet.stop = { reason: 'thin', message: 'We could not find enough about your business to build a reliable Blueprint.' }; return o; };
  await begin(user(), form());
  await deps.drain();
  const d = doc('bp-1');
  assert.strictEqual(d.status, 'stopped');
  assert.strictEqual(d.stop.reason, 'thin');
  assert.strictEqual(d.freeSlot, false);
  assert.strictEqual(d.charge.state, 'refunded');
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.strictEqual(deps.calls.build, 0);
});

test('QA failure: failed, one refund, flags stored', async () => {
  const { deps, begin, doc } = setup();
  deps.plan.build = async () => ({ result: {}, qa: { passed: false, flags: [{ level: 'block', rule: 'too_many_removed' }] } });
  await begin(user(), form());
  await deps.drain();
  const d = doc('bp-1');
  assert.strictEqual(d.status, 'failed');
  assert.strictEqual(d.error.message, 'We could not check this Blueprint well enough to share it. Please try again.');
  assert.strictEqual(d.qaFlags[0].rule, 'too_many_removed');
  assert.strictEqual(d.result, undefined);
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.strictEqual(d.freeSlot, false);
});

test('replayed run is a no-op; refundOnce twice refunds once', async () => {
  const { deps, svc, begin, doc } = setup();
  let attempts = 0;
  deps.plan.build = async () => { attempts += 1; throw new Error('x'); };
  await begin(user(), form());
  const task = deps.queued[0];
  await quiet(async () => { await deps.drain(); await task(); await svc.run('bp-1'); });
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.strictEqual(attempts, 1);
  assert.strictEqual(await svc.refundOnce(doc('bp-1')), false);
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('a refund that throws leaves the claim in refunding; a poll inside two minutes does not pay, one after it pays once', async () => {
  const { deps, svc, begin, doc } = setup();
  let fail = true;
  deps.refund = async (...a) => { deps.calls.refund.push(a); if (fail) throw new Error('db down'); deps.ledger.refund(a[4] && a[4].ref); return { success: true }; };
  deps.plan.build = async () => { throw new Error('x'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  assert.strictEqual(doc('bp-1').status, 'failed');
  assert.strictEqual(doc('bp-1').charge.state, 'refunding');
  assert.strictEqual(doc('bp-1').charge.refundQuarks, QUARK_COSTS.blueprint, 'amount recorded in the claim');
  fail = false;
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(doc('bp-1').charge.state, 'refunding', 'too soon: left for the sweep');
  deps.clock.t += 3 * 60 * 1000;
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(doc('bp-1').charge.state, 'refunded');
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(deps.calls.refund.length, 2); // one failed attempt, one success, none after
  assert.strictEqual(deps.calls.refund[1][4].ref, 'bp-1', 'the refund carries the blueprint id as ref');
});

test('refund returning success false stays claimed (refunding) for the sweep', async () => {
  const { deps, begin, doc } = setup();
  deps.refund = async (...a) => { deps.calls.refund.push(a); return { success: false, error: 'nope' }; };
  deps.plan.build = async () => { throw new Error('x'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  assert.strictEqual(doc('bp-1').charge.state, 'refunding');
});

test('not enough Quarks: 403, document failed, slot free, no refund; a later start works', async () => {
  const { deps, begin, doc } = setup();
  let ok = false;
  deps.deduct = async (...a) => { deps.calls.deduct.push(a); return ok ? { success: true } : { success: false, error: 'Insufficient Quarks' }; };
  const r = await begin(user(), form());
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.creditsExhausted, true);
  assert.strictEqual(r.json.upgradeRequired, true);
  assert.strictEqual(r.json.reason, 'quarks');
  const d = doc('bp-1');
  assert.strictEqual(d.status, 'failed');
  assert.strictEqual(d.freeSlot, false);
  assert.strictEqual(d.charge.state, 'none');
  assert.strictEqual(deps.calls.refund.length, 0);
  assert.strictEqual(deps.queued.length, 0);
  ok = true;
  assert.strictEqual((await begin(user(), form())).status, 202);
  const view = await createBlueprintService(deps).get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(view.json.error, null);
});

test('deduct throwing is treated as not charged', async () => {
  const { deps, begin, doc } = setup();
  deps.deduct = async () => { throw new Error('boom'); };
  const r = await quiet(() => begin(user(), form()));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(doc('bp-1').charge.state, 'none');
  assert.strictEqual(deps.calls.refund.length, 0);
});

test('free IP limit: three per day, the fourth is 429, 25 hours later it works; failures count', async () => {
  const { deps, begin } = setup();
  deps.deduct = async (...a) => { deps.calls.deduct.push(a); return { success: true }; };
  for (let i = 1; i <= 3; i += 1) {
    assert.strictEqual((await begin(user(`u${i}`, `p${i}@x.com`), form({ businessName: `Biz ${i}`, website: `https://biz${i}.in` }))).status, 202);
  }
  const r = await begin(user('u4', 'p4@x.com'), form({ businessName: 'Biz 4', website: 'https://biz4.in' }));
  assert.strictEqual(r.status, 429);
  assert.strictEqual(r.json.message, 'You have reached the daily limit for Blueprints. Please try again tomorrow.');
  deps.clock.t += 25 * HOUR;
  assert.strictEqual((await begin(user('u4', 'p4@x.com'), form({ businessName: 'Biz 4', website: 'https://biz4.in' }))).status, 202);
});

test('failed attempts count toward the IP limit', async () => {
  const { deps, begin } = setup();
  deps.deduct = async () => ({ success: false });
  for (let i = 1; i <= 3; i += 1) await begin(user(`u${i}`, `p${i}@x.com`), form({ website: `https://biz${i}.in` }));
  deps.deduct = async () => ({ success: true });
  assert.strictEqual((await begin(user('u9', 'p9@x.com'), form({ website: 'https://biz9.in' }))).status, 429);
});

test('paid tier: 5 per account per day, 10 per IP per day', async () => {
  const { begin } = setup();
  for (let i = 1; i <= 5; i += 1) assert.strictEqual((await begin(user('p1', 'p@x.com'), form({ website: `https://shop${i}.in` }), 'starter')).status, 202);
  assert.strictEqual((await begin(user('p1', 'p@x.com'), form({ website: 'https://shop6.in' }), 'starter')).status, 429);
  for (let j = 1; j <= 5; j += 1) {
    assert.strictEqual((await begin(user('p2', 'p2@x.com'), form({ website: `https://s2${j}.in` }), 'professional')).status, 202);
  }
  // ten Blueprints from this address by now
  const over = await begin(user('p4', 'p4@x.com'), form({ website: 'https://s4.in' }), 'managed');
  assert.strictEqual(over.status, 429);
  const elsewhere = await begin(user('p4', 'p4@x.com'), form({ website: 'https://s4.in' }), 'managed', '9.9.9.9');
  assert.strictEqual(elsewhere.status, 202);
});

test('paid accounts do not take the free slot and can repeat a business', async () => {
  const { deps, begin, doc } = setup();
  assert.strictEqual((await begin(user('p1', 'p@x.com'), form(), 'starter')).status, 202);
  assert.strictEqual(doc('bp-1').freeSlot, false);
  assert.strictEqual((await begin(user('p1', 'p@x.com'), form(), 'starter')).status, 202);
  assert.strictEqual(deps.calls.deduct.length, 2);
});

test('get: other user is 404; no internals leak', async () => {
  const { deps, svc, begin } = setup();
  await begin(user(), form());
  await deps.drain();
  assert.strictEqual((await svc.get({ userId: 'someone-else', id: 'bp-1' })).status, 404);
  assert.strictEqual((await svc.get({ userId: 'u1', id: 'nope' })).status, 404);
  const r = await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.businessName, 'Sweet Co');
  assert.ok(r.json.result);
  const s = JSON.stringify(r.json);
  for (const k of ['ipHash', 'emailKey', 'charge', 'businessKeys', 'sheet', 'sources', 'freeSlot']) assert.ok(!s.includes(`"${k}"`), k);
  assert.ok(!s.includes('h:1.1.1.1'));
});

test('get: a stale processing job is failed and refunded, a fresh one is untouched', async () => {
  const { deps, svc, begin, doc } = setup();
  await begin(user(), form());
  await deps.Blueprint.updateOne({ blueprintId: 'bp-1' }, { $set: { status: 'processing', heartbeatAt: new Date(deps.clock.t) } });
  deps.clock.t += 7 * 60 * 1000;
  assert.strictEqual((await svc.get({ userId: 'u1', id: 'bp-1' })).json.status, 'processing');
  assert.strictEqual(deps.calls.refund.length, 0);
  deps.clock.t += 2 * 60 * 1000;
  const r = await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(r.json.error, 'This Blueprint took too long, so we stopped it. Please try again.');
  assert.strictEqual(r.json.refunded, true);
  assert.strictEqual(doc('bp-1').freeSlot, false);
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('get: a stale queued job that was never charged is failed with no refund', async () => {
  const { deps, svc, begin, doc } = setup();
  await begin(user(), form());
  deps.ledger.rows.spend.clear(); // the debit never landed
  await deps.Blueprint.updateOne({ blueprintId: 'bp-1' }, { $set: { 'charge.state': 'pending' } });
  deps.clock.t += 9 * 60 * 1000;
  const r = await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(deps.calls.refund.length, 0);
  assert.strictEqual(doc('bp-1').charge.state, 'none', 'no proof of a debit: nothing is owed and nothing is flagged');
  assert.strictEqual(deps.alerts.length, 0);
  assert.strictEqual(r.json.refunded, false);
});

test('a run that finishes after the job was failed by a stale poll does not complete or refund twice', async () => {
  const { deps, svc, begin, doc } = setup();
  let release;
  const gate = new Promise((res) => { release = res; });
  const base = deps.plan.build;
  deps.plan.build = async (a) => { await gate; return base(a); };
  await begin(user(), form());
  const running = deps.drain();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(doc('bp-1').status, 'processing');
  deps.clock.t += 9 * 60 * 1000;
  await svc.get({ userId: 'u1', id: 'bp-1' });
  release();
  await running;
  assert.strictEqual(doc('bp-1').status, 'failed');
  assert.strictEqual(doc('bp-1').result, undefined);
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('list: the owner only, latest first, minimal fields', async () => {
  const { deps, svc, begin } = setup();
  await begin(user('u1', 'a@x.com'), form());
  deps.clock.t += 1000;
  await begin(user('u2', 'b@x.com'), form({ website: 'https://other.in' }));
  const r = await svc.list({ userId: 'u1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.blueprints.length, 1);
  assert.deepStrictEqual(Object.keys(r.json.blueprints[0]).sort(), ['businessName', 'createdAt', 'id', 'status']);
});

test('guided mode: checkpoint 0, then checkpoint 1, then completes with the chosen direction; discovery runs once', async () => {
  const { deps, svc, begin, doc } = setup();
  const r = await begin(user('p1', 'p@x.com'), form({ mode: 'guided' }), 'starter');
  assert.strictEqual(r.status, 202);
  assert.strictEqual(doc('bp-1').mode, 'guided');
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'awaiting_approval');
  assert.strictEqual(doc('bp-1').checkpoint, 0);
  let v = (await svc.get({ userId: 'p1', id: 'bp-1' })).json;
  assert.strictEqual(v.checkpoint, 0);
  assert.ok(v.discovery && Array.isArray(v.discovery.facts) && v.discovery.facts[0].id && v.discovery.facts[0].text);
  assert.ok(Array.isArray(v.discovery.unverified));
  assert.ok(Array.isArray(v.discovery.missing));
  assert.ok(v.discovery.basis);
  assert.strictEqual(v.result, undefined);
  assert.strictEqual(v.directions, undefined);

  assert.strictEqual((await svc.continueRun({ userId: 'other', id: 'bp-1', body: {} })).status, 404);
  assert.strictEqual((await svc.continueRun({ userId: 'p1', id: 'bp-1', body: {} })).status, 202);
  assert.strictEqual((await svc.continueRun({ userId: 'p1', id: 'bp-1', body: {} })).status, 409);
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'awaiting_approval');
  assert.strictEqual(doc('bp-1').checkpoint, 1);
  v = (await svc.get({ userId: 'p1', id: 'bp-1' })).json;
  assert.ok(v.directions.length >= 2 && v.directions.length <= 4);
  assert.deepStrictEqual(Object.keys(v.directions[0]).sort(), ['id', 'name', 'rationale', 'risk']);
  assert.strictEqual(v.discovery, undefined);

  for (const body of [{}, { directionId: 'x' }, { directionId: 1.5 }, { directionId: 9 }, { directionId: -1 }]) {
    assert.strictEqual((await svc.continueRun({ userId: 'p1', id: 'bp-1', body })).status, 400, JSON.stringify(body));
  }
  assert.strictEqual((await svc.continueRun({ userId: 'p1', id: 'bp-1', body: { directionId: 1 } })).status, 202);
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'completed');
  assert.strictEqual(deps.calls.build, 1);
  assert.strictEqual(deps.calls.buildArgs[0].direction.name, 'Direction 1');
  assert.strictEqual(deps.calls.buildArgs[0].mode, 'guided');
  assert.strictEqual(deps.calls.discover, 1);
  assert.strictEqual(deps.calls.directions, 1);
  assert.strictEqual(deps.calls.deduct.length, 1);
  assert.strictEqual(doc('bp-1').approvals.length, 2);
  assert.strictEqual(deps.calls.refund.length, 0);
});

test('guided mode with fewer than two directions skips checkpoint 1 with a note', async () => {
  const { deps, svc, begin, doc } = setup();
  deps.plan.directions = async () => [];
  await begin(user('p1', 'p@x.com'), form({ mode: 'guided' }), 'starter');
  await deps.drain();
  await svc.continueRun({ userId: 'p1', id: 'bp-1', body: {} });
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'completed');
  assert.ok(doc('bp-1').qaFlags.some((f) => f.rule === 'directions_skipped' && f.level === 'note'));
  assert.strictEqual(deps.calls.buildArgs[0].direction, null);
});

test('guided stop at discovery refunds before any checkpoint', async () => {
  const { deps, begin, doc } = setup();
  const base = deps.discover;
  deps.discover = async (a) => { const o = await base(a); o.sheet.stop = { reason: 'unreachable', message: 'We could not read your website.' }; return o; };
  await begin(user('p1', 'p@x.com'), form({ mode: 'guided' }), 'starter');
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'stopped');
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('a free user asking for guided mode is run as auto', async () => {
  const { deps, begin, doc } = setup();
  await begin(user(), form({ mode: 'guided' }));
  assert.strictEqual(doc('bp-1').mode, 'auto');
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'completed');
});

test('logo upload: only when a data URL is sent; failure is a 400 with no document; success sets the sheet logo', async () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const a = setup();
  await a.begin(user(), form());
  assert.strictEqual(a.deps.calls.upload.length, 0);

  const b = setup();
  b.deps.uploadLogo = async () => { throw new Error('cloud down'); };
  const r = await b.begin(user(), form({ logoDataUrl: dataUrl }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.errors.logo, 'The logo could not be uploaded. Try again, or continue without it.');
  assert.strictEqual(b.deps.Blueprint.docs.length, 0);
  assert.strictEqual(b.deps.calls.deduct.length, 0);

  const c = setup();
  await c.begin(user(), form({ logoDataUrl: dataUrl }));
  assert.strictEqual(c.deps.calls.upload.length, 1);
  const stored = c.doc('bp-1');
  assert.strictEqual(stored.input.logoUrl, 'https://res.cloudinary.com/demo/image/upload/logo.png');
  assert.ok(!JSON.stringify(stored).includes('base64'));
  // The fake discover does not see the upload (like the real one for data URLs), so the run must set the sheet logo.
  const base = c.deps.discover;
  c.deps.discover = async (x) => { const o = await base(x); o.sheet.assets.logo = null; o.sheet.missing = ['logo', 'colours']; o.sheet.unverified = [{ id: 'U1', text: 'Logo', reason: 'No logo was provided or found on the page.' }]; return o; };
  await c.deps.drain();
  const sheetArg = c.deps.calls.buildArgs[0].sheet;
  assert.deepStrictEqual(sheetArg.assets.logo, { url: 'https://res.cloudinary.com/demo/image/upload/logo.png', source: 'typed' });
  assert.ok(!sheetArg.missing.includes('logo'));
  assert.ok(sheetArg.missing.includes('colours'));
  assert.ok(!sheetArg.unverified.some((u) => u.text === 'Logo'));
});

test('build receives the discovery sources, the input and a Date', async () => {
  const { deps, begin } = setup();
  await begin(user(), form());
  await deps.drain();
  const a = deps.calls.buildArgs[0];
  assert.strictEqual(a.sources[0].id, 'S1');
  assert.strictEqual(a.input.businessName, 'Sweet Co');
  assert.ok(a.now instanceof Date);
  assert.strictEqual(a.mode, 'auto');
});

test('a missing logo and a name warning never stop the run', async () => {
  const { deps, begin, doc } = setup();
  const base = deps.discover;
  deps.discover = async (a) => { const o = await base(a); o.sheet.assets.logo = null; o.sheet.warnings = [{ reason: 'identity_mismatch', message: 'x' }]; return o; };
  await begin(user(), form());
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'completed');
});

test('the runner honours the cap and returns to idle', async () => {
  const order = [];
  const task = (name) => async () => { order.push(`start ${name}`); await new Promise((r) => setImmediate(r)); order.push(`end ${name}`); };
  let done;
  const last = new Promise((r) => { done = r; });
  runner.enqueue(task('a'), 1);
  runner.enqueue(task('b'), 1);
  runner.enqueue(async () => { order.push('c'); done(); }, 1);
  await last;
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(order, ['start a', 'end a', 'start b', 'end b', 'c']);
  assert.deepStrictEqual(runner._state(), { active: 0, queued: 0 });
});

test('the runner logs a failing task and keeps going', async () => {
  let ran = false;
  await quiet(async () => {
    runner.enqueue(async () => { throw new Error('boom'); }, 1);
    runner.enqueue(async () => { ran = true; }, 1);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  });
  assert.strictEqual(ran, true);
  assert.deepStrictEqual(runner._state(), { active: 0, queued: 0 });
});

test('LIMITS used are the configured ones', () => {
  assert.strictEqual(LIMITS.FREE_PER_IP_PER_DAY, 3);
  assert.strictEqual(LIMITS.PAID_PER_IP_PER_DAY, 10);
  assert.strictEqual(LIMITS.PAID_PER_ACCOUNT_PER_DAY, 5);
});

// Makes the first `n` writes that set charge.state to 'charged' throw.
function failChargeWrite(deps, n) {
  const orig = deps.Blueprint.findOneAndUpdate.bind(deps.Blueprint);
  let left = n;
  deps.Blueprint.findOneAndUpdate = async (f, u) => {
    if (u && u.$set && u.$set['charge.state'] === 'charged' && left > 0) { left -= 1; throw new Error('db down'); }
    return orig(f, u);
  };
}

test('charge write fails once: retried, one charge, no refund, job enqueued', async () => {
  const { deps, begin, doc } = setup();
  failChargeWrite(deps, 1);
  const r = await quiet(() => begin(user(), form()));
  assert.strictEqual(r.status, 202);
  assert.strictEqual(doc('bp-1').charge.state, 'charged');
  assert.strictEqual(deps.calls.deduct.length, 1);
  assert.strictEqual(deps.calls.refund.length, 0);
  assert.strictEqual(deps.queued.length, 1);
});

test('charge write fails twice: exactly one refund, slot released, failed; a stale poll does not refund again', async () => {
  const { deps, svc, begin, doc } = setup();
  failChargeWrite(deps, 2);
  const r = await quiet(() => begin(user(), form()));
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.json.message, 'We could not start your Blueprint. Your Quarks were returned.');
  const d = doc('bp-1');
  assert.strictEqual(d.status, 'failed');
  assert.strictEqual(d.freeSlot, false);
  assert.strictEqual(d.charge.state, 'refunded');
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.strictEqual(deps.queued.length, 0);
  deps.clock.t += LIMITS.STALE_MS + HOUR;
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('already used by another account: 409 with no id; the owner still gets the id', async () => {
  const { begin } = setup();
  await begin(user('u1', 'a@x.com'), form());
  const other = await begin(user('u2', 'b@x.com'), form());
  assert.strictEqual(other.status, 409);
  assert.strictEqual(other.json.alreadyUsed, true);
  assert.ok(!('id' in other.json));
  assert.strictEqual(other.json.message, 'This business has already used its free Blueprint.');
  assert.strictEqual((await begin(user('u1', 'a@x.com'), form())).json.id, 'bp-1');
});

test('the free Blueprint takes no Quarks: 202, no charge, no refund path, slot held', async () => {
  const { deps, begin, doc } = setup({ freeBlueprintIsFree: true });
  const r = await begin(user(), form());
  assert.strictEqual(r.status, 202);
  assert.strictEqual(deps.calls.deduct.length, 0);
  const d = doc(r.json.id);
  assert.strictEqual(d.freeSlot, true);
  assert.strictEqual(d.charge.state, 'none');
  assert.strictEqual(d.charge.quarks, 0);
  assert.strictEqual(deps.queued.length, 1);
});

test('a paid tier is still charged for a Blueprint', async () => {
  const { deps, begin } = setup({ freeBlueprintIsFree: true });
  const r = await begin(user(), form(), 'starter');
  assert.strictEqual(r.status, 202);
  assert.strictEqual(deps.calls.deduct.length, 1);
});

test('an email that belonged to a deleted account does not get another free Blueprint, but a paid one is fine', async () => {
  const { deps, begin } = setup({ deletedBefore: async (email) => email === 'back@example.com' });
  const r = await begin(user('u9', 'back@example.com'), form());
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.alreadyUsed, true);
  assert.strictEqual(deps.Blueprint.docs.length, 0);
  assert.strictEqual(deps.calls.deduct.length, 0);
  const paid = await begin(user('u9', 'back@example.com'), form(), 'starter');
  assert.strictEqual(paid.status, 202);
});

test('startSystem: a plan run is never charged, takes no free slot, is queued once and kind plan', async () => {
  const { deps, svc, doc } = setup();
  const r = await svc.startSystem({ user: { _id: 'u1', email: 'owner@example.com', plan: { tier: 'starter' } }, input: form(), kind: 'plan' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.id, 'bp-1');
  const d = doc('bp-1');
  assert.strictEqual(d.kind, 'plan');
  assert.strictEqual(d.status, 'queued');
  assert.strictEqual(d.freeSlot, false);
  assert.strictEqual(d.tierAtStart, 'starter');
  assert.deepStrictEqual(d.charge, { state: 'none', quarks: 0 });
  assert.strictEqual(deps.calls.deduct.length, 0);
  assert.strictEqual(deps.queued.length, 1);
  await deps.drain();
  assert.strictEqual(doc('bp-1').status, 'completed');
  assert.strictEqual(deps.calls.refund.length, 0);
});

test('startSystem: spend is recorded for the daily ceiling, and invalid input starts nothing', async () => {
  const spent = [];
  const { deps, svc } = setup({ recordSpend: async (a, n) => { spent.push([a, n]); } });
  const bad = await svc.startSystem({ user: { _id: 'u1', email: 'o@example.com' }, input: form({ businessName: '' }), kind: 'plan' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(deps.Blueprint.docs.length, 0);
  await svc.startSystem({ user: { _id: 'u1', email: 'o@example.com' }, input: form(), kind: 'plan' });
  await deps.drain(); // recorded when the planner is called
  assert.deepStrictEqual(spent, [['blueprint', 1]]);
});

test('startSystem: a failed plan run stays uncharged and refunds nothing; two plan runs do not clash on the free slot', async () => {
  const { deps, svc, doc } = setup({ plan: { build: async () => { throw new Error('model down'); }, directions: async () => [] } });
  const u = { _id: 'u1', email: 'owner@example.com' };
  await svc.startSystem({ user: u, input: form(), kind: 'plan' });
  await quiet(() => deps.drain());
  assert.strictEqual(doc('bp-1').status, 'failed');
  assert.strictEqual(doc('bp-1').charge.state, 'none');
  assert.strictEqual(deps.calls.refund.length, 0);
  const again = await svc.startSystem({ user: u, input: form(), kind: 'plan' });
  assert.strictEqual(again.ok, true);
});

test('a customer Blueprint list does not show plan runs', async () => {
  const { svc, begin } = setup();
  await begin(user(), form(), 'starter');
  await svc.startSystem({ user: user(), input: form(), kind: 'plan' });
  const l = await svc.list({ userId: 'u1' });
  assert.strictEqual(l.json.blueprints.length, 1);
  assert.strictEqual(l.json.blueprints[0].id, 'bp-1');
});

// ---- claim-then-pay refunds: a crash between the claim and the payment (D17 / D19 class) ----

async function failedWithClaim(over = {}) {
  const ctx = setup(over);
  ctx.deps.plan.build = async () => { throw new Error('x'); };
  await ctx.begin(user(), form());
  return ctx;
}

test('crash between claim and pay: the sweep pays once, to the recorded payer, with the ref; a second sweep changes nothing', async () => {
  const { deps, svc, begin, doc } = setup({ deduct: null });
  deps.deduct = async (...a) => { deps.calls.deduct.push(a); deps.ledger.spend(a[4].ref, 'agency9', QUARK_COSTS.blueprint); return { success: true, workspaceId: 'ws1', payerId: 'agency9' }; };
  deps.plan.build = async () => { throw new Error('x'); };
  const realRefund = deps.refund;
  deps.refund = async () => { throw new Error('process died'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  assert.strictEqual(doc('bp-1').charge.state, 'refunding');
  assert.strictEqual(doc('bp-1').charge.refundPayer, 'agency9', 'the payer is recorded in the claim');
  deps.refund = realRefund;
  assert.strictEqual(await svc.sweepUnsettled(), 0, 'inside two minutes nothing is touched');
  deps.clock.t += 3 * 60 * 1000;
  await svc.sweepUnsettled();
  assert.strictEqual(doc('bp-1').charge.state, 'refunded');
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.deepStrictEqual(deps.calls.refund[0][4], { ref: 'bp-1', payerId: 'agency9' });
  await svc.sweepUnsettled();
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('a refund that landed but reported failure is only marked by the sweep, never paid twice', async () => {
  const { deps, svc, begin, doc } = setup();
  deps.refund = async (...a) => { deps.calls.refund.push(a); deps.ledger.refund(a[4].ref); throw new Error('timeout after the credit'); };
  deps.plan.build = async () => { throw new Error('x'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  deps.clock.t += 3 * 60 * 1000;
  await svc.sweepUnsettled();
  assert.strictEqual(doc('bp-1').charge.state, 'refunded');
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('no refund without proof of the charge: the sweep pays nothing, flags it unproven and alerts', async () => {
  const { deps, svc, begin, doc } = setup();
  deps.refund = async (...a) => { deps.calls.refund.push(a); throw new Error('process died'); };
  deps.plan.build = async () => { throw new Error('x'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  deps.ledger.rows.spend.clear();
  deps.refund = async (...a) => { deps.calls.refund.push(a); return { success: true }; };
  deps.clock.t += 3 * 60 * 1000;
  await quiet(() => svc.sweepUnsettled());
  assert.strictEqual(deps.calls.refund.length, 1, 'only the first, crashed attempt');
  assert.strictEqual(doc('bp-1').charge.state, 'unproven');
  assert.strictEqual(deps.alerts.length, 1);
});

test('never more than the proven spend', async () => {
  const { deps, svc, begin, doc } = setup();
  deps.refund = async (...a) => { deps.calls.refund.push(a); throw new Error('process died'); };
  deps.plan.build = async () => { throw new Error('x'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  deps.ledger.rows.spend.set('bp-1', { payer: 'u1', quarks: 1 });
  deps.refund = async (...a) => { deps.calls.refund.push(a); return { success: true }; };
  deps.clock.t += 3 * 60 * 1000;
  await quiet(() => svc.sweepUnsettled());
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.strictEqual(doc('bp-1').charge.state, 'unproven');
});

test('a sweep whose refund fails again alerts and leaves it claimed, held for another two minutes', async () => {
  const { deps, svc, begin, doc } = setup();
  deps.refund = async (...a) => { deps.calls.refund.push(a); throw new Error('down'); };
  deps.plan.build = async () => { throw new Error('x'); };
  await begin(user(), form());
  await quiet(() => deps.drain());
  deps.clock.t += 3 * 60 * 1000;
  await quiet(() => svc.sweepUnsettled());
  assert.strictEqual(doc('bp-1').charge.state, 'refunding');
  assert.strictEqual(deps.alerts.length, 1);
  assert.strictEqual(deps.calls.refund.length, 2);
  await quiet(() => svc.sweepUnsettled());
  assert.strictEqual(deps.calls.refund.length, 2, 'held: not retried inside two minutes');
});

// ---- crash between the charge and the mark (item 5) ----

test('start charges WITH the blueprint id as ref', async () => {
  const { deps, begin } = setup();
  await begin(user(), form());
  assert.deepStrictEqual(deps.calls.deduct[0][4], { ref: 'bp-1' });
});

test('crash between charge and mark: the stale poll refunds once because the proof shows a spend and no refund', async () => {
  const { deps, svc, begin, doc } = setup();
  const real = deps.Blueprint.findOneAndUpdate;
  deps.Blueprint.findOneAndUpdate = (filter, update) => (filter['charge.state'] === 'pending' && update.$set['charge.state'] === 'charged' ? new Promise(() => {}) : real(filter, update)); // the process dies here
  begin(user(), form()); // never settles
  await new Promise((r) => setImmediate(r));
  deps.Blueprint.findOneAndUpdate = real;
  assert.strictEqual(doc('bp-1').status, 'queued');
  assert.strictEqual(doc('bp-1').charge.state, 'pending');
  assert.strictEqual(deps.calls.deduct.length, 1);
  deps.clock.t += 10 * 60 * 1000;
  const r = await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(doc('bp-1').charge.state, 'refunded');
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.strictEqual(deps.calls.refund[0][4].ref, 'bp-1');
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('crash between charge and mark, found by the sweep without anyone polling', async () => {
  const { deps, svc, begin, doc } = setup();
  const real = deps.Blueprint.findOneAndUpdate;
  deps.Blueprint.findOneAndUpdate = (filter, update) => (filter['charge.state'] === 'pending' && update.$set['charge.state'] === 'charged' ? new Promise(() => {}) : real(filter, update));
  begin(user(), form());
  await new Promise((r) => setImmediate(r));
  deps.Blueprint.findOneAndUpdate = real;
  deps.clock.t += 10 * 60 * 1000;
  await svc.sweepUnsettled();
  assert.strictEqual(doc('bp-1').charge.state, 'refunded');
  assert.strictEqual(deps.calls.refund.length, 1);
});

test('a pending charge whose spend was already refunded is not refunded again', async () => {
  const { deps, svc, begin, doc } = setup();
  await begin(user(), form());
  await deps.Blueprint.updateOne({ blueprintId: 'bp-1' }, { $set: { 'charge.state': 'pending', status: 'failed' } });
  deps.ledger.refund('bp-1');
  await svc.get({ userId: 'u1', id: 'bp-1' });
  assert.strictEqual(deps.calls.refund.length, 0);
  assert.strictEqual(doc('bp-1').charge.state, 'refunded');
});
