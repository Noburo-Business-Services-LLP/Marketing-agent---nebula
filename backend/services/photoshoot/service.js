'use strict';
/**
 * The Photoshoot studio: ready-made packs of product photos made from the customer's own product photos (and their own
 * place photo when they choose one). Product only: no person appears in any photo. How it works, and every rule below
 * in plain words: docs/superpowers/ops/photoshoot.md
 *
 * One Create, in order (every step that can fail ends with a plain message, and after the charge with a refund):
 *   1. switch (ENABLE_PHOTOSHOOT, default off), staff, entitlement (paid plans, agency clients, managed), input from
 *      fixed lists only, the products and the place are the caller's own and have a photo
 *   2. one request at a time in this process; lost runners are resumed
 *   3. idempotency: the same key returns the same job and is never charged again
 *   4. one job in flight per account (a unique database index), caps (per minute, photos per India day, all accounts)
 *   5. spend guard (the Photoshoots switch, the Pictures switch, the daily AI ceiling)
 *   6. the job row is written (queued, every photo pending) BEFORE the charge; no row, no charge
 *   7. one atomic charge of the whole price from the wallet that pays (the agency pool for a client workspace)
 *   8. the row is marked charged; if that fails, the Quarks go straight back and nothing is called
 *   9. the runner takes a lease and makes the photos, CONCURRENCY at a time; each photo is marked calling with its
 *      attempt counted BEFORE the call; a failed photo has one more call; the switch is checked before every batch
 *  10. when every photo is finished: the failed photos are refunded (all of it when none was made), once, to the payer
 * A lost runner (restart) is found by its expired lease and taken over; a photo it left calling is tried again only if
 * it has a call left. A job older than MAX_AGE_MS is closed and its unfinished photos refunded.
 */
const os = require('os');
const caps = require('../../config/photoshoot');
const { PACKS, BACKGROUNDS, ASPECT_LABELS, packOf } = require('../../config/photoshootPacks');
const { QUARK_COSTS, ACTION_USD } = require('../../config/apiCosts');
const { priceText, worthText } = require('../../config/quarkWording');
const { canUse } = require('../../config/entitlements');
const { buildPhotoPrompt, cleanName } = require('./prompt');
const { readDataUrl, loadRef } = require('./refs');

const ACTION = 'photoshoot_image';
const STALE_QUEUED_MS = 3 * 60000;
const BUSY = 'Making things is very busy right now. Please try again in a little while. Nothing was charged.';

const MESSAGES = Object.freeze({
  off: 'Photoshoots open soon. Nothing was charged.',
  staff: 'Staff accounts cannot make photoshoots here. Open a client to make one for them.',
  upgrade: 'Photoshoots are part of the paid plans. Choose a plan to start one.',
  input: 'Choose a pack, a shape and at least one product with a photo.',
  products: 'Choose your own products that have a photo.',
  place: 'That place photo could not be found. Choose another one or leave it out.',
  tooMany: `A photoshoot can make at most ${caps.MAX_PHOTOS_PER_JOB} photos. Choose fewer products or photos.`,
  inProgress: 'A photoshoot is already being made. Please wait for it to finish.',
  perMinute: 'Please wait a minute before starting another photoshoot.',
  perDay: `You have made today's ${caps.MAX_PHOTOS_PER_DAY} photos. You can make more tomorrow.`,
  busy: BUSY,
  frozen: 'This client is paused, so nothing can be made for it right now.',
  ledger: 'We could not start the photoshoot just now. Nothing was charged. Please try again.',
  failed: 'We could not start the photoshoot just now. Please try again.',
  chargeUnsure: 'We could not start the photoshoot just now. If any Quarks were taken, they come back by themselves in a few minutes. Please try again shortly.',
  keyReused: 'That request was already used for something else. Please reload the page and try again.',
  notFound: 'That photoshoot was not found.',
  photoNotFound: 'That photo was not found.',
  deleteRunning: 'This photoshoot is still being made. You can delete its photos once it has finished.',
  redoNotReady: 'This photo can be made again once the photoshoot has finished.',
  upload: 'Please add a PNG, JPEG or WEBP photo of up to 6 MB.',
  uploadName: 'Please give the product a name.',
  uploadFailed: 'We could not save that photo just now. Please try again.',
  uploadsPerHour: 'You have added a lot of photos in the last hour. Please try again a little later.'
});

const IST_MS = 330 * 60000;
const istDay = (d) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const idOf = (user) => (!user ? '' : String(user._id || user.id || ''));
const isObjectId = (s) => /^[a-f0-9]{24}$/i.test(String(s || ''));
const reply = (status, body) => ({ status, body: { success: status < 300, ...body } });

const perPhoto = () => QUARK_COSTS[ACTION];
const minutesFor = (photos) => Math.max(1, Math.ceil((Math.ceil(photos / caps.CONCURRENCY) * caps.PHOTO_SECONDS) / 60));
const switchOn = (env) => String((env && env[caps.SWITCH_ENV]) || '').trim().toLowerCase() === 'on';

/** Agency owners and their client workspaces see posts' worth, never Quarks (the same rule as the agency screens). */
function postsOnlyOf(user) {
  const tier = user && user.plan && user.plan.tier;
  const ag = (user && user.agency) || {};
  return tier === 'agency' || Boolean(ag.ownerId) || Number(ag.clientCount || 0) > 0;
}

/** One pack as the page shows it, with its price from config/apiCosts.js. */
function packView(pack) {
  const q = perPhoto();
  return {
    key: pack.key, title: pack.title, subtitle: pack.subtitle,
    counts: pack.counts, defaultCount: pack.defaultCount,
    aspectRatios: pack.aspectRatios.map((key) => ({ key, label: ASPECT_LABELS[key] || key })),
    backgrounds: pack.backgrounds.map((key) => ({ key, label: BACKGROUNDS[key].label })),
    place: Boolean(pack.place),
    scenes: pack.scenes.map((s) => ({ key: s.key, label: s.label })),
    quarks: q * pack.defaultCount, price: priceText(q * pack.defaultCount), worth: worthText(q * pack.defaultCount),
    minutes: minutesFor(pack.defaultCount)
  };
}

function catalogue() {
  const q = perPhoto();
  return {
    perPhoto: { quarks: q, price: priceText(q), worth: worthText(q) }, packs: PACKS.map(packView), maxProducts: caps.MAX_PRODUCTS, maxPhotos: caps.MAX_PHOTOS_PER_JOB,
    // What the page needs to write any total in posts' worth with the shared wording (all from config/apiCosts.js).
    costs: { photoshoot_image: q, image_generated: QUARK_COSTS.image_generated, studio_video: QUARK_COSTS.studio_video }
  };
}

/** The photos of a job: count per product, scenes in the pack's order. Pure. */
function planPhotos({ pack, products, count, background, aspectRatio, placeChosen }) {
  const photos = [];
  products.forEach((p, productIndex) => {
    for (let i = 0; i < count; i += 1) {
      const scene = pack.scenes[i % pack.scenes.length];
      const inPlace = Boolean(placeChosen && pack.place && scene.place);
      photos.push({
        index: photos.length, productIndex, scene: scene.key, sceneLabel: scene.label, inPlace,
        prompt: buildPhotoPrompt({ scene, background, productName: p.name, inPlace, aspectRatio }),
        status: 'pending', attempts: 0, inLibrary: true
      });
    }
  });
  return photos;
}

/** A job as the page sees it: never the prompt, the payer or the lease. */
function jobView(job, versions = []) {
  if (!job) return null;
  const photos = (job.photos || []).filter((p) => !p.deleted).map((p) => ({
    index: p.index, scene: p.scene, sceneLabel: p.sceneLabel || '',
    product: ((job.products || [])[p.productIndex] || {}).name || '',
    status: p.status === 'done' ? 'done' : p.status === 'failed' ? 'failed' : p.status === 'calling' ? 'making' : 'waiting',
    url: p.status === 'done' ? p.url || '' : '', inLibrary: p.status === 'done' ? p.inLibrary !== false : false
  }));
  const done = photos.filter((p) => p.status === 'done').length;
  const failed = photos.filter((p) => p.status === 'failed').length;
  const finished = ['done', 'partial', 'failed'].includes(job.status);
  let notice = '';
  if (job.status === 'partial') notice = `${failed} of ${photos.length} photos could not be made. You were not charged for ${failed === 1 ? 'it' : 'them'}.`;
  if (job.status === 'failed') notice = job.outcome === 'switched_off'
    ? 'Photoshoots were paused while this one was being made. You were not charged for the photos that were not made.'
    : 'The photos could not be made this time. You were not charged. Please try again.';
  if (finished && job.refundFailed) notice = `${notice} We are returning your Quarks; this can take a little while.`.trim();
  const pack = packOf(job.pack);
  return {
    id: String(job._id), kind: job.kind || 'pack', pack: job.pack, packTitle: pack ? pack.title : '',
    parent: job.parent ? String(job.parent) : null, parentIndex: Number.isInteger(job.parentIndex) ? job.parentIndex : null,
    status: job.status === 'queued' ? 'running' : job.status, aspectRatio: job.aspectRatio, background: job.background || '',
    products: (job.products || []).map((p) => ({ id: p.productId ? String(p.productId) : '', name: p.name || '' })),
    place: job.place ? { name: job.place.name || '' } : null,
    photoCount: photos.length, done, failed, photos,
    quarks: job.quarks || 0, refundedQuarks: job.refundedQuarks || 0,
    minutes: minutesFor(photos.length), notice,
    versions: versions.filter((v) => !((v.photos || [])[0] || {}).deleted).map((v) => {
      const p = (v.photos || [])[0] || {};
      return { id: String(v._id), index: v.parentIndex, status: v.status === 'queued' ? 'running' : v.status, url: p.status === 'done' ? p.url || '' : '', inLibrary: p.status === 'done' ? p.inLibrary !== false : false };
    }),
    createdAt: job.createdAt, finishedAt: job.finishedAt || null
  };
}

/**
 * The image host's id of one of our stored pictures, from its https link (".../image/upload/[v123/]folder/name.png"
 * gives "folder/name"). '' for any other link, so nothing else can ever be deleted from here. Pure.
 */
function publicIdOf(url) {
  const m = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?([^?#]+?)(?:\.[a-z0-9]{2,5})?(?:[?#].*)?$/i.exec(String(url || ''));
  if (!m) return '';
  const id = m[1];
  return /^[A-Za-z0-9_\-\/]+$/.test(id) && !id.includes('..') ? id : '';
}

function defaultDeps() {
  const m = (name) => require(`../../models/${name}`);
  const quarks = () => require('../quarkBuckets');
  return {
    repo: require('./repo').createPhotoshootRepo(),
    productsOf: (userId, ids) => m('Product').find({ user: userId, ...(ids ? { _id: { $in: ids } } : {}) }).select('user name imageUrl images').sort({ createdAt: -1 }).limit(ids ? ids.length : 60).maxTimeMS(20000).lean(),
    placesOf: (userId, ids) => m('BrandAsset').find({ user: userId, type: 'environment', ...(ids ? { _id: { $in: ids } } : {}) }).select('user name url').sort({ createdAt: -1 }).limit(ids ? ids.length : 30).maxTimeMS(20000).lean(),
    createProduct: async (doc) => (await m('Product').create(doc)).toObject(),
    countUploadsSince: (userId, since) => m('Product').countDocuments({ user: userId, tags: 'photoshoot-upload', createdAt: { $gte: since } }),
    // Best effort: the stored picture is removed from the image host; a failure never blocks or undoes the delete.
    deleteImage: async (url) => { const id = publicIdOf(url); if (!id) return { success: false }; return require('../imageUploader').deleteImage(id); },
    upload: (dataUrl) => require('../imageUploader').uploadBase64Image(dataUrl, 'nebula-product-images'),
    spend: (userId, cost, opts) => quarks().spend(userId, cost, opts),
    settle: (userId) => quarks().settleWallet(userId).catch(() => null),
    refundTo: (userId, q, opts) => quarks().refundTo(userId, q, opts),
    guard: (action) => require('../spendGuard').check(action),
    recordSpend: (action, units) => require('../spendGuard').record(action, units),
    generate: (args) => require('./generator').createGenerator().make(args),
    loadRef: (src) => loadRef(src),
    /** Whether one job was charged (and by which wallet) and whether a refund exists: the Quark ledger rows, else the
     *  credits.history entries written in the same update as the balance change (quarkBuckets.chargeProof). */
    ledgerFor: async (jobId, userId) => {
      const p = await quarks().chargeProof(String(jobId), { userId: userId ? String(userId) : '' });
      return { spend: p.spend ? { payer: p.spend.payer, quarks: p.spend.quarks } : null, refunded: p.refunded };
    },
    alert: (key, text) => { try { require('../opsAlerts').recordFailure(key, text); } catch (_) { /* best effort */ } },
    // A refund the loop gave up on: a person must finish it, so one occurrence is enough to send the alert.
    alertNow: (key, text) => {
      try {
        const ops = require('../opsAlerts');
        ops.recordFailure(key, text);
        ops.notify({ key: `${key}:${text}`, subject: 'Nebulaa alert: a Photoshoot refund needs a person', text: `${text}\n\nSee docs/superpowers/ops/photoshoot.md (refunds that did not land).` });
      } catch (_) { /* best effort */ }
    },
    schedule: (fn) => setImmediate(fn),
    env: process.env,
    now: () => new Date(),
    runnerId: `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`
  };
}

function createPhotoshoot(given = {}) {
  const deps = { ...defaultDeps(), ...given };
  const repo = deps.repo;
  const locks = new Set();
  const running = new Set(); // jobs this process is running now

  function entitlement(user) {
    try {
      const r = canUse(user, 'photoshoot');
      return r.allowed ? { ok: true } : { ok: false, reason: 'upgrade' };
    } catch (_) { return { ok: false, reason: 'upgrade' }; }
  }

  async function guardProblem() {
    for (const a of [ACTION, 'image_generated']) {
      let g; try { g = await deps.guard(a); } catch (_) { g = { ok: true }; }
      if (g && g.ok === false) return g;
    }
    return null;
  }

  async function capsProblem(userId, now, photos) {
    const [minute, today, all] = await Promise.all([
      repo.countStartsSince(userId, new Date(now.getTime() - 60000)),
      repo.photosToday(userId, istDay(now)),
      repo.runningAll()
    ]);
    if (minute >= caps.MAX_STARTS_PER_MINUTE) return reply(429, { limit: 'minute', message: MESSAGES.perMinute });
    if (today + photos > caps.MAX_PHOTOS_PER_DAY) return reply(429, { limit: 'day', left: Math.max(0, caps.MAX_PHOTOS_PER_DAY - today), message: MESSAGES.perDay });
    if (all >= caps.MAX_RUNNING_ALL_ACCOUNTS) return reply(503, { serviceBusy: true, message: BUSY });
    return null;
  }

  const productPhoto = (p) => String((p && (p.imageUrl || (Array.isArray(p.images) && p.images[0]))) || '');

  /** GET /packs: the catalogue with prices (no database). */
  function packs() { return catalogue(); }

  /** GET /options: catalogue, switch, entitlement, the caller's products and places, photos left today. */
  async function options(user, { pass = false } = {}) {
    if (user && (user.staffRole || user.isCsm) && !pass) return { staff: true, ...catalogue() };
    const userId = idOf(user);
    const ent = entitlement(user);
    const [products, places, today] = await Promise.all([
      Promise.resolve().then(() => deps.productsOf(userId)).catch(() => []),
      Promise.resolve().then(() => deps.placesOf(userId)).catch(() => []),
      Promise.resolve().then(() => repo.photosToday(userId, istDay(deps.now()))).catch(() => null)
    ]);
    return {
      ...catalogue(), enabled: switchOn(deps.env), entitled: ent.ok, locked: ent.ok ? null : ent.reason, postsOnly: postsOnlyOf(user), pass,
      products: (products || []).map((p) => {
        const photo = productPhoto(p);
        // A stored data URL is not sent back as a thumbnail (it can be megabytes); the page shows a plain tile instead.
        return { id: String(p._id), name: p.name || '', hasPhoto: Boolean(photo), thumbnail: /^https:\/\//i.test(photo) ? photo : '' };
      }),
      places: (places || []).filter((p) => /^https:\/\//i.test(String(p.url || ''))).map((p) => ({ id: String(p._id), name: p.name || '', thumbnail: p.url })),
      perDay: caps.MAX_PHOTOS_PER_DAY, left: today === null ? null : Math.max(0, caps.MAX_PHOTOS_PER_DAY - today)
    };
  }

  /** Validates the choices against the pack and resolves the caller's own products and place. */
  async function resolveInput(userId, b) {
    const pack = packOf(String(b.pack || ''));
    if (!pack) return { error: reply(400, { message: MESSAGES.input }) };
    const aspectRatio = b.aspectRatio === undefined ? pack.aspectRatios[0] : String(b.aspectRatio);
    if (!pack.aspectRatios.includes(aspectRatio)) return { error: reply(400, { message: MESSAGES.input }) };
    const count = b.count === undefined ? pack.defaultCount : Number(b.count);
    if (!pack.counts.includes(count)) return { error: reply(400, { message: MESSAGES.input }) };
    let background = '';
    if (pack.backgrounds.length) {
      background = b.background === undefined || b.background === '' ? pack.backgrounds[0] : String(b.background);
      if (!pack.backgrounds.includes(background)) return { error: reply(400, { message: MESSAGES.input }) };
    }
    const ids = Array.isArray(b.productIds) ? [...new Set(b.productIds.map(String))] : [];
    if (!ids.length || ids.length > caps.MAX_PRODUCTS || !ids.every(isObjectId)) return { error: reply(400, { message: ids.length > caps.MAX_PRODUCTS ? MESSAGES.tooMany : MESSAGES.input }) };
    if (ids.length * count > caps.MAX_PHOTOS_PER_JOB) return { error: reply(400, { message: MESSAGES.tooMany }) };
    const found = (await deps.productsOf(userId, ids)) || [];
    const byId = new Map(found.filter((p) => String(p.user || userId) === userId).map((p) => [String(p._id), p]));
    const products = ids.map((id) => byId.get(id)).filter(Boolean);
    if (products.length !== ids.length || products.some((p) => !productPhoto(p))) return { error: reply(400, { message: MESSAGES.products }) };
    let place;
    if (b.placeId) {
      if (!pack.place || !isObjectId(b.placeId)) return { error: reply(400, { message: MESSAGES.place }) };
      const pl = ((await deps.placesOf(userId, [String(b.placeId)])) || []).find((x) => String(x._id) === String(b.placeId) && String(x.user || userId) === userId);
      if (!pl || !/^https:\/\//i.test(String(pl.url || ''))) return { error: reply(400, { message: MESSAGES.place }) };
      place = { assetId: pl._id, name: String(pl.name || '').slice(0, 100), url: pl.url };
    }
    const snaps = products.map((p) => ({
      productId: p._id, name: String(p.name || '').slice(0, 100), imageUrl: productPhoto(p),
      extraUrl: (Array.isArray(p.images) ? p.images : []).map(String).find((u) => u && u !== productPhoto(p)) || undefined
    }));
    return { pack, aspectRatio, count, background, products: snaps, place };
  }

  function noBalanceMessage(user, cost) {
    if (postsOnlyOf(user)) return `This photoshoot needs ${worthText(cost)}. The agency balance is too low for it right now.`;
    return `This photoshoot needs ${priceText(cost)}. Please top up or choose a plan.`;
  }

  /** The common money path for a pack and a redo: row first, one charge, mark charged, start the runner. */
  async function startJob(user, doc, { userId, cost, description }) {
    let row;
    try {
      row = await repo.insert(doc);
    } catch (e) {
      if (e && e.code === 11000) {
        const again = await repo.findByKey(userId, doc.key).catch(() => null);
        if (again) return reply(200, { replay: true, job: jobView(again) });
        return reply(409, { inProgress: true, message: MESSAGES.inProgress });
      }
      return reply(503, { message: MESSAGES.ledger });
    }
    const now = deps.now();
    await deps.settle(userId);
    let paid = null; let spendThrew = false;
    try { paid = await deps.spend(userId, cost, { action: ACTION, description, ref: String(row._id), units: doc.photoCount }); } catch (_) { paid = null; spendThrew = true; }
    if (spendThrew) return settleUnsureCharge(row, userId);
    if (!paid || !paid.success) {
      const frozen = Boolean(paid && paid.frozen);
      await repo.closeRefused(row._id, frozen ? 'frozen' : 'no_balance', deps.now()).catch(() => null);
      return frozen
        ? reply(403, { message: MESSAGES.frozen })
        : reply(403, { creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: noBalanceMessage(user, cost) });
    }
    const payerId = String(paid.payerId || userId);
    let marked = false;
    try { marked = await repo.markCharged(row._id, { quarks: cost, payerId, now }); } catch (_) { marked = false; }
    if (!marked) {
      // The charge is not on the job: nothing is called and the Quarks go straight back, but only after this caller won
      // the refund claim (the stale sweep may have closed and refunded the row already while the charge was slow).
      const claimed = await repo.closeLedger(row._id, { refundedQuarks: cost, payerId, now: deps.now() }).catch(() => null);
      if (!claimed) return reply(503, { message: MESSAGES.chargeUnsure }); // the stale sweep settles it from the ledger
      let back = null;
      try { back = await deps.refundTo(userId, cost, { action: `${ACTION}_refund`, ref: String(row._id), payerId }); } catch (_) { back = null; }
      if (!back || !back.ok) {
        await repo.setRefundFailed(row._id).catch(() => null);
        deps.alert('photoshoot_refund', `Photoshoot ${String(row._id)}: the charge could not be recorded and the refund of ${cost} Quarks did not land.`);
      }
      return reply(503, { message: MESSAGES.ledger });
    }
    const job = { ...row, status: 'running', quarks: cost, payerId, chargedAt: now };
    deps.schedule(() => runJob(row._id).catch((e) => console.error('[photoshoot] runner failed:', e && e.message)));
    return reply(202, { job: jobView(job) });
  }

  /**
   * The charge threw: it may or may not have landed. The proof decides at once when it can: a charge that landed is
   * refunded once (the close claims the refund); with no sign of a charge, or when the lookup fails, the row stays queued
   * and the stale sweep decides later from the same proof (a debit still in flight has landed by then). Never "refused".
   */
  async function settleUnsureCharge(row, userId) {
    let led = null;
    try { led = await deps.ledgerFor(String(row._id), userId); } catch (_) { led = null; }
    if (!led || !led.spend) return reply(503, { message: MESSAGES.chargeUnsure });
    const refund = led.refunded ? 0 : Math.max(0, led.spend.quarks);
    const closed = await repo.closeStale(row._id, { refundedQuarks: refund, payerId: led.spend.payer, outcome: 'ledger', now: deps.now() }).catch(() => null);
    if (!closed) return reply(503, { message: MESSAGES.chargeUnsure });
    if (refund > 0) {
      let back = null;
      try { back = await deps.refundTo(userId, refund, { action: `${ACTION}_refund`, ref: String(row._id), payerId: led.spend.payer }); } catch (_) { back = null; }
      if (!back || !back.ok) {
        await repo.setRefundFailed(row._id).catch(() => null);
        deps.alert('photoshoot_refund', `Photoshoot ${String(row._id)}: the charge failed half-way and the refund of ${refund} Quarks did not land.`);
        return reply(503, { refunded: false, message: MESSAGES.chargeUnsure });
      }
    }
    return reply(503, { refunded: refund > 0, message: MESSAGES.ledger });
  }

  /** The stored job for a reused key, only when it was the same request; another kind of request is refused. */
  function replayFor(existing, same) {
    return same(existing) ? reply(200, { replay: true, job: jobView(existing) }) : reply(409, { keyReused: true, message: MESSAGES.keyReused });
  }

  /** The checks shared by Create and Make this one again, before anything is written. */
  async function precheck(user, body, pass) {
    const userId = idOf(user);
    if (!userId || !isObjectId(userId)) return { error: reply(401, { message: 'Please sign in to continue.' }) };
    if ((user.staffRole || user.isCsm) && !pass) return { error: reply(403, { message: MESSAGES.staff }) };
    const ent = entitlement(user);
    if (!ent.ok) return { error: reply(403, { locked: ent.reason, upgradeRequired: true, message: MESSAGES.upgrade }) };
    if (!switchOn(deps.env)) return { error: reply(503, { disabled: true, message: MESSAGES.off }) };
    const b = body && typeof body === 'object' ? body : {};
    const key = String(b.key || '');
    if (!caps.KEY_RE.test(key)) return { error: reply(400, { message: MESSAGES.input }) };
    return { userId, key, b };
  }

  /** POST /jobs: one pack. */
  async function create(user, body = {}, { pass = false } = {}) {
    const pre = await precheck(user, body, pass);
    if (pre.error) return pre.error;
    const { userId, key, b } = pre;
    const samePack = (j) => (j.kind || 'pack') === 'pack';
    if (locks.has(userId)) {
      const same = await repo.findByKey(userId, key).catch(() => null);
      return same ? replayFor(same, samePack) : reply(409, { inProgress: true, message: MESSAGES.inProgress });
    }
    locks.add(userId);
    try {
      const now = deps.now();
      const existing = await repo.findByKey(userId, key);
      if (existing) return replayFor(existing, samePack);
      await resumeLost().catch(() => null);
      if (await repo.anyInFlight(userId)) return reply(409, { inProgress: true, message: MESSAGES.inProgress });
      const input = await resolveInput(userId, b);
      if (input.error) return input.error;
      const photoCount = input.products.length * input.count;
      const capped = await capsProblem(userId, now, photoCount);
      if (capped) return capped;
      if (await guardProblem()) return reply(503, { serviceBusy: true, message: BUSY });
      const photos = planPhotos({ pack: input.pack, products: input.products, count: input.count, background: input.background, aspectRatio: input.aspectRatio, placeChosen: Boolean(input.place) });
      const q = perPhoto();
      const cost = q * photos.length;
      return await startJob(user, {
        user: userId, key, kind: 'pack', pack: input.pack.key, day: istDay(now), aspectRatio: input.aspectRatio, background: input.background,
        count: input.count, products: input.products, place: input.place, photos, status: 'queued', inFlight: true,
        photoCount: photos.length, quarksPerPhoto: q, quarks: 0, createdAt: now
      }, { userId, cost, description: `${input.pack.title} (${photos.length} photos)` });
    } catch (e) {
      console.error('[photoshoot] create failed:', e && e.message);
      return reply(500, { message: MESSAGES.failed });
    } finally {
      locks.delete(userId);
    }
  }

  /** POST /jobs/:id/photos/:index/redo: the same photo made again, priced as one photo. */
  async function redo(user, jobId, index, body = {}, { pass = false } = {}) {
    const pre = await precheck(user, body, pass);
    if (pre.error) return pre.error;
    const { userId, key } = pre;
    const i = Number(index);
    if (!isObjectId(jobId) || !Number.isInteger(i) || i < 0) return reply(400, { message: MESSAGES.input });
    const sameRedo = (j) => j.kind === 'redo' && String(j.parent) === String(jobId) && j.parentIndex === i;
    if (locks.has(userId)) {
      const same = await repo.findByKey(userId, key).catch(() => null);
      return same ? replayFor(same, sameRedo) : reply(409, { inProgress: true, message: MESSAGES.inProgress });
    }
    locks.add(userId);
    try {
      const now = deps.now();
      const existing = await repo.findByKey(userId, key);
      if (existing) return replayFor(existing, sameRedo);
      const parent = await repo.findOwn(userId, jobId);
      if (!parent || parent.kind !== 'pack') return reply(404, { message: MESSAGES.notFound });
      if (!['done', 'partial', 'failed'].includes(parent.status)) return reply(409, { message: MESSAGES.redoNotReady });
      const photo = (parent.photos || []).find((p) => p.index === i);
      if (!photo || photo.deleted) return reply(404, { message: MESSAGES.notFound });
      await resumeLost().catch(() => null);
      if (await repo.anyInFlight(userId)) return reply(409, { inProgress: true, message: MESSAGES.inProgress });
      // The product and the place must still be the caller's own, with a photo.
      const product = (parent.products || [])[photo.productIndex];
      const input = await resolveInput(userId, {
        pack: parent.pack, aspectRatio: parent.aspectRatio, background: parent.background || undefined,
        count: packOf(parent.pack) ? packOf(parent.pack).counts[0] : 0, productIds: product && product.productId ? [String(product.productId)] : [],
        placeId: photo.inPlace && parent.place && parent.place.assetId ? String(parent.place.assetId) : undefined
      });
      if (input.error) return input.error;
      const capped = await capsProblem(userId, now, 1);
      if (capped) return capped;
      if (await guardProblem()) return reply(503, { serviceBusy: true, message: BUSY });
      const scene = input.pack.scenes.find((s) => s.key === photo.scene) || input.pack.scenes[0];
      const inPlace = Boolean(input.place && input.pack.place && scene.place);
      const q = perPhoto();
      return await startJob(user, {
        user: userId, key, kind: 'redo', parent: parent._id, parentIndex: i, pack: parent.pack, day: istDay(now), aspectRatio: input.aspectRatio,
        background: input.background, count: 1, products: input.products, place: inPlace ? input.place : undefined,
        photos: [{ index: 0, productIndex: 0, scene: scene.key, sceneLabel: scene.label, inPlace, prompt: buildPhotoPrompt({ scene, background: input.background, productName: input.products[0].name, inPlace, aspectRatio: input.aspectRatio }), status: 'pending', attempts: 0, inLibrary: true }],
        status: 'queued', inFlight: true, photoCount: 1, quarksPerPhoto: q, quarks: 0, createdAt: now
      }, { userId, cost: q, description: `${input.pack.title} (one photo again)` });
    } catch (e) {
      console.error('[photoshoot] redo failed:', e && e.message);
      return reply(500, { message: MESSAGES.failed });
    } finally {
      locks.delete(userId);
    }
  }

  // ---- the runner ---------------------------------------------------------------------------------------------------

  async function referencesFor(job, photo) {
    const product = (job.products || [])[photo.productIndex] || {};
    const main = await deps.loadRef(product.imageUrl);
    if (!main) return null; // without the product's own photo the model would invent a product: the photo fails
    const refs = [main];
    if (photo.inPlace && job.place && job.place.url) {
      const place = await deps.loadRef(job.place.url);
      if (place) refs.push(place);
    }
    if (product.extraUrl) {
      const extra = await deps.loadRef(product.extraUrl);
      if (extra) refs.push(extra);
    }
    return refs;
  }

  async function makePhoto(job, photo) {
    const me = deps.runnerId;
    const started = await repo.startPhoto(job._id, me, photo.index, deps.now()).catch(() => false);
    if (!started) return;
    // The call is counted on the job (above) before it is made. A second call for a photo is extra spend for us.
    if ((photo.attempts || 0) >= 1) { try { deps.recordSpend(ACTION, 1); } catch (_) { /* cost tracking is best effort */ } }
    const callsSoFar = (photo.attempts || 0) + 1;
    let out = { ok: false, reason: 'provider' };
    const refs = await referencesFor(job, photo).catch(() => null);
    if (!refs) out = { ok: false, reason: 'no_reference' };
    else {
      try { out = await deps.generate({ prompt: photo.prompt, references: refs, aspectRatio: job.aspectRatio }); } catch (_) { out = { ok: false, reason: 'provider' }; }
    }
    const now = deps.now();
    if (out && out.ok && /^https:\/\//i.test(String(out.url || ''))) {
      await repo.finishPhoto(job._id, photo.index, { status: 'done', url: String(out.url).slice(0, 600), now }).catch(() => false);
      return;
    }
    const reason = String((out && out.reason) || 'provider').slice(0, 40);
    // A missing reference will not appear on a second call, so it is not tried again.
    const again = reason !== 'no_reference' && callsSoFar < caps.MAX_CALLS_PER_PHOTO;
    await repo.finishPhoto(job._id, photo.index, { status: again ? 'pending' : 'failed', reason, now }).catch(() => false);
  }

  /** Finishes a job whose photos are all done or failed: status, and the refund of the failed photos, once. */
  async function finalize(jobId) {
    const job = await repo.findById(jobId);
    if (!job || job.status !== 'running') return;
    const photos = job.photos || [];
    if (photos.some((p) => p.status !== 'done' && p.status !== 'failed')) return;
    const done = photos.filter((p) => p.status === 'done').length;
    const failed = photos.length - done;
    const status = done === photos.length ? 'done' : done > 0 ? 'partial' : 'failed';
    const switchedOff = photos.some((p) => p.reason === 'switched_off');
    const stale = photos.some((p) => p.reason === 'stale');
    const outcome = status === 'done' ? 'ok' : switchedOff ? 'switched_off' : stale ? 'stale' : status === 'partial' ? 'partial' : 'none';
    const refund = done === 0 ? (job.quarks || 0) : Math.min(job.quarks || 0, failed * (job.quarksPerPhoto || 0));
    const before = await repo.finalize(job._id, { status, outcome, refundedQuarks: refund, now: deps.now() });
    if (!before || refund <= 0) return;
    let back = null;
    try { back = await deps.refundTo(String(job.user), refund, { action: `${ACTION}_refund`, ref: String(job._id), payerId: job.payerId || '' }); } catch (_) { back = null; }
    if (!back || !back.ok) {
      await repo.setRefundFailed(job._id).catch(() => null);
      deps.alert('photoshoot_refund', `Photoshoot ${String(job._id)}: the refund of ${refund} Quarks did not land.`);
    }
  }

  /** Runs (or takes over) one job until every photo is finished. Safe to call more than once: the lease decides. */
  async function runJob(jobId) {
    const key = String(jobId);
    if (running.has(key)) return;
    running.add(key);
    const me = deps.runnerId;
    try {
      const t = deps.now();
      const claimed = await repo.claimLease(jobId, me, t, new Date(t.getTime() + caps.LEASE_MS));
      if (!claimed) return;
      await repo.releaseCalling(jobId, caps.MAX_CALLS_PER_PHOTO, t);
      for (let round = 0; round < caps.MAX_PHOTOS_PER_JOB * caps.MAX_CALLS_PER_PHOTO + 2; round += 1) {
        const job = await repo.findById(jobId);
        if (!job || job.status !== 'running' || job.leaseOwner !== me) return;
        const now = deps.now();
        if (job.chargedAt && now.getTime() - new Date(job.chargedAt).getTime() > caps.MAX_AGE_MS) {
          await repo.failOpen(jobId, 'stale', now);
          break;
        }
        const pending = (job.photos || []).filter((p) => p.status === 'pending');
        if (!pending.length) break;
        // A staff switch (Photoshoots or Pictures) stops the rest of the job; the daily ceiling does not (the job's
        // spend was already counted when it was charged).
        const g = await guardProblem();
        if (g && g.reason === 'switched_off') { await repo.failOpen(jobId, 'switched_off', now); break; }
        await Promise.all(pending.slice(0, caps.CONCURRENCY).map((p) => makePhoto(job, p)));
        const t2 = deps.now();
        if (!(await repo.renewLease(jobId, me, new Date(t2.getTime() + caps.LEASE_MS)).catch(() => false))) return;
      }
      await finalize(jobId);
    } finally {
      running.delete(key);
    }
  }

  /**
   * A row still queued after STALE_QUEUED_MS was left behind (the process died between the insert and marking the charge,
   * or a close failed). It would lock the account out (one job in flight) and, if the spend landed, keep the Quarks.
   * The ledger decides: a spend row for the job with no refund is refunded once, to the account that paid, never more than
   * was charged; then the row is closed. The close claims the refund flag atomically, so concurrent sweeps cannot refund twice.
   */
  async function sweepStale() {
    const before = new Date(deps.now().getTime() - STALE_QUEUED_MS);
    const stuck = (await repo.staleQueued(before, 10)) || [];
    let closed = 0;
    for (const j of stuck) {
      try {
        const led = (await deps.ledgerFor(String(j._id), String(j.user))) || {};
        const refund = led.spend && !led.refunded ? Math.max(0, led.spend.quarks) : 0;
        const row = await repo.closeStale(j._id, { refundedQuarks: refund, payerId: refund > 0 ? led.spend.payer : undefined, now: deps.now() });
        if (!row) continue;
        closed += 1;
        if (refund <= 0) continue;
        let back = null;
        try { back = await deps.refundTo(String(row.user), refund, { action: `${ACTION}_refund`, ref: String(row._id), payerId: led.spend.payer }); } catch (_) { back = null; }
        if (!back || !back.ok) {
          await repo.setRefundFailed(row._id).catch(() => null);
          deps.alert('photoshoot_refund', `Photoshoot ${String(row._id)}: the refund of ${refund} Quarks for a stuck job did not land.`);
        }
      } catch (e) { console.error('[photoshoot] stale sweep failed:', e && e.message); }
    }
    return closed;
  }

  /**
   * Tries the refunds that did not land again (refundFailed). Each row is claimed first (one conditional update moves its
   * retry time forward and counts the attempt), so two processes never both try it. Before paying, the proof is read: a
   * refund that landed but reported a failure is only marked, never paid twice. A failed try waits twice as long as the
   * last one; after REFUND_RETRY_MAX tries the row is left for a person and an alert is sent.
   */
  async function retryRefunds(limit = caps.REFUND_RETRY_BATCH) {
    const now = deps.now();
    const due = (await repo.refundsDue(now, limit).catch(() => [])) || [];
    let retried = 0;
    for (const d of due) {
      try {
        const job = await repo.claimRefundRetry(d._id, now, new Date(now.getTime() + caps.REFUND_RETRY_HOLD_MS)).catch(() => null);
        if (!job) continue;
        const amount = Number(job.refundedQuarks) || 0;
        let led;
        try { led = (await deps.ledgerFor(String(job._id), String(job.user))) || {}; } catch (_) { continue; } // unknown: tried after the hold
        if (led.refunded || !(amount > 0)) { await repo.refundRetried(job._id); continue; }
        let back = null;
        try { back = await deps.refundTo(String(job.user), amount, { action: `${ACTION}_refund`, ref: String(job._id), payerId: job.payerId || (led.spend && led.spend.payer) || '' }); } catch (_) { back = null; }
        if (back && back.ok) { await repo.refundRetried(job._id); retried += 1; continue; }
        const tries = Number(job.refundAttempts) || 1;
        if (tries >= caps.REFUND_RETRY_MAX) {
          await repo.refundGaveUp(job._id).catch(() => null);
          console.error(`[photoshoot] gave up refunding ${amount} Quarks for job ${String(job._id)} after ${tries} tries`);
          deps.alertNow('photoshoot_refund_gave_up', `Photoshoot ${String(job._id)}: the refund of ${amount} Quarks to ${job.payerId || String(job.user)} did not land after ${tries} tries. Return it by hand.`);
        } else {
          await repo.refundRetryLater(job._id, new Date(now.getTime() + caps.REFUND_RETRY_BASE_MS * 2 ** (tries - 1))).catch(() => null);
        }
      } catch (e) { console.error('[photoshoot] refund retry failed:', e && e.message); }
    }
    return retried;
  }

  /** Takes over jobs whose runner was lost (a restart): run by the loop, at start, and before a new job. */
  async function resumeLost() {
    await sweepStale().catch(() => null);
    await retryRefunds().catch(() => null);
    const lost = (await repo.lostJobs(deps.now(), 10)) || [];
    for (const j of lost) {
      if (running.has(String(j._id))) continue;
      deps.schedule(() => runJob(j._id).catch((e) => console.error('[photoshoot] resume failed:', e && e.message)));
    }
    return lost.length;
  }

  // ---- reading ------------------------------------------------------------------------------------------------------

  async function get(user, id) {
    const userId = idOf(user);
    if (!isObjectId(id)) return reply(404, { message: MESSAGES.notFound });
    const job = await repo.findOwn(userId, id);
    if (!job) return reply(404, { message: MESSAGES.notFound });
    // A job whose runner was lost is picked up again when it is looked at.
    if (job.status === 'running' && (!job.leaseUntil || new Date(job.leaseUntil) < deps.now()) && !running.has(String(job._id))) {
      deps.schedule(() => runJob(job._id).catch(() => null));
    }
    const versions = job.kind === 'pack' ? ((await repo.childrenOf(userId, [job._id])) || []).filter((v) => v.status !== 'refused') : [];
    return reply(200, { job: jobView(job, versions) });
  }

  async function list(user) {
    const userId = idOf(user);
    const jobs = (await repo.listOwn(userId, 20)) || [];
    const kids = jobs.length ? (await repo.childrenOf(userId, jobs.map((j) => j._id))) || [] : [];
    return reply(200, { jobs: jobs.map((j) => jobView(j, kids.filter((k) => String(k.parent) === String(j._id) && k.status !== 'refused'))) });
  }

  /** Every finished photo the customer keeps in their Library, newest first. */
  async function library(user) {
    const userId = idOf(user);
    const jobs = (await repo.libraryOwn(userId, 200)) || [];
    const photos = [];
    for (const j of jobs) {
      const pack = packOf(j.pack);
      for (const p of j.photos || []) {
        if (p.status !== 'done' || p.deleted || p.inLibrary === false || !p.url) continue;
        photos.push({
          jobId: String(j._id), index: p.index, url: p.url, kind: j.kind || 'pack', pack: j.pack, packTitle: pack ? pack.title : '',
          scene: p.sceneLabel || '', product: ((j.products || [])[p.productIndex] || {}).name || '', aspectRatio: j.aspectRatio, createdAt: p.finishedAt || j.createdAt
        });
      }
    }
    return reply(200, { photos: photos.slice(0, 300) });
  }

  async function setInLibrary(user, id, index, on) {
    const userId = idOf(user);
    const i = Number(index);
    if (!isObjectId(id) || !Number.isInteger(i) || i < 0 || typeof on !== 'boolean') return reply(400, { message: MESSAGES.input });
    const ok = await repo.setInLibrary(userId, id, i, on);
    return ok ? reply(200, { inLibrary: on }) : reply(404, { message: MESSAGES.notFound });
  }

  /**
   * DELETE /jobs/:id/photos/:index: deletes ONE finished photo of the caller's own finished photoshoot. It leaves the job,
   * the Library and the page, and its stored picture is removed from the image host (best effort). It never touches the
   * charge, the refund or the ledger: what was spent stays spent. A photoshoot still being made cannot lose photos.
   */
  async function deletePhoto(user, id, index) {
    const userId = idOf(user);
    const i = Number(index);
    if (!isObjectId(id) || !Number.isInteger(i) || i < 0) return reply(400, { message: MESSAGES.input });
    const job = await repo.findOwn(userId, id);
    if (!job) return reply(404, { message: MESSAGES.notFound });
    if (!['done', 'partial', 'failed'].includes(job.status)) return reply(409, { message: MESSAGES.deleteRunning });
    const before = await repo.deletePhoto(userId, id, i);
    if (!before) return reply(404, { message: MESSAGES.photoNotFound });
    const gone = (before.photos || []).find((p) => p.index === i);
    if (gone && gone.url && deps.deleteImage) {
      try { await deps.deleteImage(gone.url); } catch (e) { console.warn('[photoshoot] stored picture was not removed:', e && e.message); }
    }
    return reply(200, { deleted: true });
  }

  /** POST /upload: one product photo, saved as a new product of the caller. Free. */
  async function upload(user, body = {}, { pass = false } = {}) {
    const userId = idOf(user);
    if (!userId || !isObjectId(userId)) return reply(401, { message: 'Please sign in to continue.' });
    if ((user.staffRole || user.isCsm) && !pass) return reply(403, { message: MESSAGES.staff });
    // The same gates as Create: a free plan cannot store photos here, and nothing is stored while the studio is off.
    const ent = entitlement(user);
    if (!ent.ok) return reply(403, { locked: ent.reason, upgradeRequired: true, message: MESSAGES.upgrade });
    if (!switchOn(deps.env)) return reply(503, { disabled: true, message: MESSAGES.off });
    const b = body && typeof body === 'object' ? body : {};
    const name = String(b.name || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name || Array.from(name).length > caps.NAME_MAX || !cleanName(name)) return reply(400, { message: MESSAGES.uploadName });
    const file = readDataUrl(b.imageData, caps.UPLOAD_MAX_BYTES);
    if (!file.ok) return reply(400, { reason: file.reason, message: MESSAGES.upload });
    const since = new Date(deps.now().getTime() - 3600000);
    if ((await deps.countUploadsSince(userId, since).catch(() => 0)) >= caps.UPLOADS_PER_HOUR) return reply(429, { message: MESSAGES.uploadsPerHour });
    // Stored under the type read from the bytes, never the type the page claimed.
    let up = null;
    try { up = await deps.upload(`data:${file.mime};base64,${file.buffer.toString('base64')}`); } catch (_) { up = null; }
    if (!up || !up.success || !/^https:\/\//i.test(String(up.url || ''))) return reply(502, { message: MESSAGES.uploadFailed });
    const p = await deps.createProduct({ user: userId, name, type: 'product', imageUrl: up.url, images: [], tags: ['photoshoot-upload'], createdAt: deps.now() });
    return reply(201, { product: { id: String(p._id), name: p.name, hasPhoto: true, thumbnail: up.url } });
  }

  async function dailyCounts(day = istDay(deps.now())) {
    const rows = (await repo.countsByOutcome(day)) || [];
    return rows.map((r) => ({ kind: r._id.kind, outcome: r._id.outcome || 'running', jobs: r.n, photos: r.photos }));
  }

  return { packs, options, create, redo, get, list, library, setInLibrary, deletePhoto, upload, runJob, resumeLost, finalize, sweepStale, retryRefunds, dailyCounts, _locks: locks, _running: running };
}

module.exports = { createPhotoshoot, publicIdOf, catalogue, packView, planPhotos, jobView, minutesFor, istDay, MESSAGES, ACTION, ACTION_USD_PER_PHOTO: () => ACTION_USD[ACTION] };
