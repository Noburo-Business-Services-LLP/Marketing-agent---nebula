const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { createDesignedService, publicDesigned } = require('../services/blueprint/designedService');
const { QUARK_COSTS, ACTION_USD, PROVIDER_RATES, BLUEPRINT_PDF_PAGES } = require('../config/apiCosts');
const { PAGES } = require('../config/blueprint');

// A tiny in-memory Blueprint collection: just the calls the service makes.
function makeStore(doc) {
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
  const set = (path, v) => { const ks = path.split('.'); let o = doc; ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[ks.indexOf(k) + 1] || '') ? [] : {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  const matches = (q) => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some(matches);
    const cur = get(k);
    if (v && typeof v === 'object' && '$exists' in v) return (cur !== undefined) === v.$exists;
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(cur);
    if (v && typeof v === 'object' && '$lt' in v) return cur != null && new Date(cur).getTime() < new Date(v.$lt).getTime();
    return cur === v || (v === null && cur == null);
  });
  return {
    findOne: async (q) => (matches(q) ? doc : null),
    find: (q) => { const rows = matches(q) ? [doc] : []; const c = { limit: () => c, lean: async () => rows }; return c; },
    findOneAndUpdate: async (q, u) => { if (!matches(q)) return null; Object.entries(u.$set || {}).forEach(([k, v]) => set(k, v)); return doc; },
    updateOne: async (q, u) => { if (!matches(q)) return; Object.entries(u.$set || {}).forEach(([k, v]) => set(k, v)); Object.keys(u.$unset || {}).forEach((k) => { delete doc[k]; }); },
  };
}

const claim = (text) => ({ text, tag: 'proposed' });
function completedDoc() {
  const pages = PAGES.map((p) => ({ n: p.n, id: p.id, title: p.title, purpose: p.purpose, sections: [{ heading: 'x', kind: 'claims', items: [claim(`A planned line for ${p.title}`)] }] }));
  return { blueprintId: 'b1', userId: 'u1', status: 'completed', input: { whatYouSell: 'coffee' }, result: { cover: { businessName: 'Bean Co', promise: 'A steady rhythm of stories', colours: [{ hex: '#1f7a7a' }], logo: null }, pages, closing: { contact: { email: 'support@nebulaa.ai' } } } };
}

async function img() { return sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: 30, g: 90, b: 90 } } }).png().toBuffer(); }

function makeDeps(doc, over = {}) {
  const calls = { deduct: 0, refund: 0, generate: 0, uploads: 0 };
  const queue = [];
  const deps = {
    Blueprint: makeStore(doc),
    deduct: async () => { calls.deduct += 1; return { success: true }; },
    refund: async () => { calls.refund += 1; return { success: true }; },
    generateImage: async () => { calls.generate += 1; return { success: true, buffer: await img() }; },
    // The reader echoes every planned line, so every page passes at the first try.
    readText: async () => doc.__echo || '',
    uploadPage: async () => { calls.uploads += 1; return `https://cdn/page-${calls.uploads}.jpg`; },
    uploadPdf: async () => 'https://cdn/blueprint.pdf',
    fetchLogo: async () => null,
    enqueue: (task) => queue.push(task),
    now: () => Date.now(),
    ...over,
  };
  return { deps, calls, queue };
}

// Each generated picture carries its page number in its colour, so the fake reader can return that page's own text.
function pagedFakes(deck, calls, readFor) {
  return {
    generateImage: async (prompt) => {
      calls.generate += 1;
      const n = deck.find((p) => prompt.includes(`The page heading is "${p.title}"`) || (p.kind === 'cover' && prompt.includes('COVER PAGE')) || (p.kind === 'closing' && prompt.includes('CLOSING PAGE')))?.n || 1;
      return { success: true, buffer: await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: n * 15, g: 60, b: 60 } } }).png().toBuffer() };
    },
    readText: async (jpeg) => {
      const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
      const n = Math.round(data[0] / 15);
      const page = deck.find((p) => p.n === n);
      return readFor(page, n);
    },
  };
}
const honest = (page) => [page.title, page.kicker, ...page.lines].join('\n');

test('the price is derived from the verified image rate, not typed in', () => {
  const rate = PROVIDER_RATES.openai_image_high_portrait_per_image['gpt-image-1'];
  assert.equal(rate, 0.25);
  const minimum = BLUEPRINT_PDF_PAGES * rate * 1.4;
  assert.ok(ACTION_USD.blueprint_pdf > minimum);
  assert.equal(QUARK_COSTS.blueprint_pdf, Math.max(1, Math.round((ACTION_USD.blueprint_pdf * 2.5) / require('../config/apiCosts').USD_PER_QUARK)));
});

test('start charges once, queues the run, and refuses a second start while one is live', async () => {
  const doc = completedDoc();
  const { deps, calls, queue } = makeDeps(doc);
  const svc = createDesignedService(deps);
  const first = await svc.start({ userId: 'u1', id: 'b1' });
  assert.equal(first.status, 202);
  assert.equal(calls.deduct, 1);
  assert.equal(doc.designed.charge.state, 'charged');
  assert.equal(doc.designed.pages.length, 11);
  assert.equal(queue.length, 1);
  const second = await svc.start({ userId: 'u1', id: 'b1' });
  assert.equal(second.status, 409);
  assert.equal(calls.deduct, 1);
});

test('a Blueprint that is not finished, or not yours, cannot start', async () => {
  const doc = completedDoc(); doc.status = 'processing';
  const svc = createDesignedService(makeDeps(doc).deps);
  assert.equal((await svc.start({ userId: 'u1', id: 'b1' })).status, 409);
  assert.equal((await svc.start({ userId: 'someone-else', id: 'b1' })).status, 404);
});

test('no Quarks: nothing is queued and the edition is removed', async () => {
  const doc = completedDoc();
  const { deps, queue } = makeDeps(doc, { deduct: async () => ({ success: false }) });
  const out = await createDesignedService(deps).start({ userId: 'u1', id: 'b1' });
  assert.equal(out.status, 403); assert.equal(queue.length, 0); assert.equal(doc.designed, undefined);
});

test('a full run makes eleven pages and a PDF and keeps the single charge', async () => {
  const doc = completedDoc();
  const { buildDeck } = require('../services/blueprint/designedDeck');
  const deck = buildDeck(doc.result);
  const calls0 = { generate: 0 };
  const { deps, calls, queue } = makeDeps(doc);
  Object.assign(deps, pagedFakes(deck, calls, honest));
  const svc = createDesignedService(deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  await queue[0]();
  assert.equal(doc.designed.status, 'completed');
  assert.equal(doc.designed.pdfUrl, 'https://cdn/blueprint.pdf');
  assert.ok(doc.designed.pages.every((p) => p.status === 'ok'));
  assert.equal(calls.generate, 11);
  assert.equal(calls.refund, 0);
  const view = publicDesigned(doc.designed);
  assert.equal(view.done, 11); assert.equal(view.pdfUrl, 'https://cdn/blueprint.pdf');
  void calls0;
});

test('a page that keeps adding words that are not in the Blueprint becomes a plain page with a note', async () => {
  const doc = completedDoc();
  const { buildDeck } = require('../services/blueprint/designedDeck');
  const deck = buildDeck(doc.result);
  const { deps, calls, queue } = makeDeps(doc);
  Object.assign(deps, pagedFakes(deck, calls, (page, n) => (n === 4 ? `${honest(page)}\nAFFLUENT AUDIENCE\nTRUSTED BRAND` : honest(page))));
  const svc = createDesignedService(deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  await queue[0]();
  assert.equal(doc.designed.status, 'completed');
  const bad = doc.designed.pages.find((p) => p.n === 4);
  assert.equal(bad.status, 'fallback'); assert.equal(bad.attempts, 3);
  assert.match(bad.note, /Words that are not in your Blueprint/);
  assert.equal(doc.designed.pages.filter((p) => p.status === 'ok').length, 10);
});

test('a page that prints a line twice is tried again and then becomes a plain page', async () => {
  const doc = completedDoc();
  const { buildDeck } = require('../services/blueprint/designedDeck');
  const deck = buildDeck(doc.result);
  const { deps, calls, queue } = makeDeps(doc);
  Object.assign(deps, pagedFakes(deck, calls, (page, n) => (n === 3 ? `${honest(page)}\n${page.lines[0]}` : honest(page))));
  const svc = createDesignedService(deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  await queue[0]();
  const bad = doc.designed.pages.find((p) => p.n === 3);
  assert.equal(bad.status, 'fallback'); assert.match(bad.note, /twice/);
});

test('a page that keeps failing the check becomes a plain page and the PDF still completes', async () => {
  const doc = completedDoc();
  const { buildDeck } = require('../services/blueprint/designedDeck');
  const deck = buildDeck(doc.result);
  // Page 3 never reads back correctly; all others do. Each generated picture carries its page number in its colour.
  const pageOf = (prompt) => deck.findIndex((p) => prompt.includes(`"${p.title}"`) && (p.kind !== 'content' || prompt.includes('CONTENT PAGE'))) + 1;
  const { deps, calls, queue } = makeDeps(doc, {
    generateImage: async (prompt) => {
      calls.generate += 1;
      const n = deck.find((p) => prompt.includes(`The page heading is "${p.title}"`) || (p.kind === 'cover' && prompt.includes('COVER PAGE')) || (p.kind === 'closing' && prompt.includes('CLOSING PAGE')))?.n || 1;
      return { success: true, buffer: await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: n * 15, g: 60, b: 60 } } }).png().toBuffer() };
    },
    readText: async (jpeg) => {
      const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
      const n = Math.round(data[0] / 15);
      return n === 3 ? 'unreadable' : deck.find((p) => p.n === n).lines.concat([deck.find((p) => p.n === n).title, deck.find((p) => p.n === n).kicker]).join('\n');
    },
  });
  const svc = createDesignedService(deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  await queue[0]();
  assert.equal(doc.designed.status, 'completed');
  const bad = doc.designed.pages.find((p) => p.n === 3);
  assert.equal(bad.status, 'fallback'); assert.equal(bad.attempts, 3);
  assert.equal(doc.designed.pages.filter((p) => p.status === 'ok').length, 10);
  assert.equal(calls.refund, 0);
});

test('if almost nothing could be made, the edition fails and the Quarks are returned once', async () => {
  const doc = completedDoc();
  const { deps, calls, queue } = makeDeps(doc, { generateImage: async () => ({ success: false }) });
  const svc = createDesignedService(deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  await queue[0]();
  assert.equal(doc.designed.status, 'failed');
  assert.equal(doc.designed.charge.state, 'refunded');
  assert.equal(calls.refund, 1);
  await svc.reconcile(doc);
  assert.equal(calls.refund, 1, 'a second look never refunds again');
  assert.match(publicDesigned(doc.designed).error, /Your Quarks were returned/);
});

test('a run that stopped reporting is ended and refunded', async () => {
  const doc = completedDoc();
  const { deps, calls } = makeDeps(doc);
  doc.designed = { status: 'processing', heartbeatAt: new Date(Date.now() - 60 * 60 * 1000), charge: { state: 'charged', quarks: 499 }, pages: [] };
  const svc = createDesignedService(deps);
  await svc.reconcile(doc);
  assert.equal(doc.designed.status, 'failed'); assert.equal(calls.refund, 1);
});

// ---- claim-then-pay refund (D17 / D19 class) ----

function ledgerDeps(doc, over = {}) {
  const clock = { t: Date.now() };
  const spends = new Map(); const refunds = new Set(); const paid = []; const alerts = [];
  const { deps, calls, queue } = makeDeps(doc, {
    now: () => clock.t,
    deduct: async (u, a, n, d, o) => { calls.deduct += 1; if (o && o.ref) spends.set(o.ref, { payer: 'agency9', quarks: QUARK_COSTS.blueprint_pdf }); return { success: true, payerId: 'agency9', workspaceId: 'ws1' }; },
    refund: async (u, a, n, d, o) => { calls.refund += 1; paid.push({ u, o }); if (o && o.ref) refunds.add(o.ref); return { success: true }; },
    chargeProof: async (ref) => ({ spend: spends.get(ref) || null, refunded: refunds.has(ref) }),
    alertOwner: async (x) => { alerts.push(x); },
    ...over,
  });
  return { deps, calls, queue, clock, spends, refunds, paid, alerts };
}

test('the charge carries a ref and records the payer; the refund goes to that payer with that ref', async () => {
  const doc = completedDoc();
  const t = ledgerDeps(doc, { generateImage: async () => ({ success: false }) });
  const svc = createDesignedService(t.deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  assert.match(doc.designed.charge.ref, /^b1:pdf:\d+$/);
  assert.equal(doc.designed.charge.payerId, 'agency9');
  await t.queue[0]();
  assert.equal(doc.designed.charge.state, 'refunded');
  assert.deepEqual(t.paid[0].o, { ref: doc.designed.charge.ref, payerId: 'agency9' });
});

test('crash between claim and pay: the sweep pays once to the recorded payer, a second sweep changes nothing', async () => {
  const doc = completedDoc();
  let die = true;
  const t = ledgerDeps(doc, { generateImage: async () => ({ success: false }) });
  const realRefund = t.deps.refund;
  t.deps.refund = async (...a) => { if (die) throw new Error('process died'); return realRefund(...a); };
  const svc = createDesignedService(t.deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  await quietly(() => t.queue[0]());
  assert.equal(doc.designed.charge.state, 'refunding');
  assert.equal(doc.designed.charge.refundPayer, 'agency9');
  die = false;
  assert.equal(await svc.sweepUnsettled(), 0, 'inside two minutes nothing happens');
  t.clock.t += 3 * 60 * 1000;
  assert.equal(await svc.sweepUnsettled(), 1);
  assert.equal(doc.designed.charge.state, 'refunded');
  assert.equal(t.calls.refund, 1);
  await svc.sweepUnsettled(); await svc.reconcile(doc);
  assert.equal(t.calls.refund, 1);
});

test('no refund without proof: the sweep flags it unproven and alerts', async () => {
  const doc = completedDoc();
  const t = ledgerDeps(doc, { generateImage: async () => ({ success: false }) });
  const real = t.deps.refund;
  t.deps.refund = async () => { throw new Error('process died'); };
  const svc = createDesignedService(t.deps);
  await svc.start({ userId: 'u1', id: 'b1' });
  await quietly(() => t.queue[0]());
  t.spends.clear(); t.deps.refund = real;
  t.clock.t += 3 * 60 * 1000;
  await quietly(() => svc.sweepUnsettled());
  assert.equal(t.calls.refund, 0);
  assert.equal(doc.designed.charge.state, 'unproven');
  assert.equal(t.alerts.length, 1);
});

test('crash between the debit and the record: the stale edition is refunded from the proof, once', async () => {
  const doc = completedDoc();
  const t = ledgerDeps(doc);
  const svc = createDesignedService(t.deps);
  doc.designed = { status: 'queued', startedAt: new Date(t.clock.t), heartbeatAt: new Date(t.clock.t), charge: { state: 'pending', quarks: QUARK_COSTS.blueprint_pdf, ref: 'b1:pdf:1' }, pages: [] };
  t.spends.set('b1:pdf:1', { payer: 'agency9', quarks: QUARK_COSTS.blueprint_pdf });
  t.clock.t += 60 * 60 * 1000;
  await svc.reconcile(doc);
  assert.equal(doc.designed.status, 'failed');
  assert.equal(doc.designed.charge.state, 'refunded');
  assert.equal(t.calls.refund, 1);
  assert.deepEqual(t.paid[0].o, { ref: 'b1:pdf:1', payerId: 'agency9' });
  await svc.reconcile(doc);
  assert.equal(t.calls.refund, 1);
});

test('crash before the debit landed: the stale pending edition owes nothing and flags nothing', async () => {
  const doc = completedDoc();
  const t = ledgerDeps(doc);
  const svc = createDesignedService(t.deps);
  doc.designed = { status: 'queued', startedAt: new Date(t.clock.t), heartbeatAt: new Date(t.clock.t), charge: { state: 'pending', quarks: QUARK_COSTS.blueprint_pdf, ref: 'b1:pdf:2' }, pages: [] };
  t.clock.t += 60 * 60 * 1000;
  await svc.reconcile(doc);
  assert.equal(t.calls.refund, 0);
  assert.equal(doc.designed.charge.state, 'none');
  assert.equal(t.alerts.length, 0);
});

async function quietly(fn) { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } }
