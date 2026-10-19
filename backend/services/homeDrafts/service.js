'use strict';
/**
 * Home drafts: "Make a post in response" (a caption and a short picture idea, text only) and "Draft a witty comment"
 * (a short comment the customer COPIES and posts themselves). Built from a stored competitor post of the caller's own
 * tracked competitors. Nebulaa never posts anything here: this file has no publishing, commenting or social call at all,
 * and a test reads it to keep it that way.
 *
 * One request, in order (every step that can fail ends with a plain message, and after the charge with a refund):
 *   1. switch (ENABLE_COMPETITOR_DRAFTS, default off), staff, entitlement (paid plan with the competitor add-on), input
 *   2. one request at a time per account (in this process, then a unique database lock), close lost requests (refund)
 *   3. idempotency: the same key again returns the same answer and is never charged again
 *   4. caps: per account per India day, refused drafts per day, per minute, all accounts per day
 *   5. spend guard (daily AI ceiling, the drafts switch and the Writing switch)
 *   6. the post is looked up on the server from stored snapshots of a competitor the account tracks (never client text)
 *   7. the ledger row is written (inFlight) BEFORE the charge and any model call; if it cannot be written, nothing happens
 *   8. one atomic charge from the wallet that pays (the agency pool for a client workspace)
 *   9. at most MAX_ATTEMPTS writing calls; each is counted on the row before it is made; the reply is read strictly,
 *      then the local filter, then the model check (counted before it is made). A check that fails or answers in the
 *      wrong shape stops everything (fail closed). A draft that is not decent gets one more try, then the plain refusal.
 *  10. a draft is shown only when it passed both checks; otherwise the Quarks go back, once.
 */
const caps = require('../../config/homeDrafts');
const { QUARK_COSTS } = require('../../config/apiCosts');
const { priceText, worthText } = require('../../config/quarkWording');
const { canUse } = require('../../config/entitlements');
const { trackedCompetitors, competitorsQuery, handleOf } = require('../competitors/tracked');
const { mergePosts, postKeyOf, whatWorked, bestOf } = require('../competitors/bestPosts');
const { languageLabel } = require('../languageSupport');
const { checkDraft } = require('./decency');
const { buildFacts, buildWritePrompt, buildCheckPrompt, languageOf, toneOf } = require('./prompt');
const { parseDraft, parseCheck } = require('./parse');

const ACTION = { response_post: 'home_response_post', witty_comment: 'home_witty_comment' };
const DAY = 864e5;
const KEEP_WEEKS = 4;

const MESSAGES = Object.freeze({
  off: 'Drafts from competitor posts are not switched on yet.',
  staff: 'Staff accounts cannot make drafts here. Open a client to make one for them.',
  upgrade: 'Drafts from competitor posts are part of the paid plans with the competitor add-on.',
  addon: 'Drafts from competitor posts need the competitor add-on.',
  input: 'Choose a competitor post to start from.',
  notFound: 'We could not find that post. Please reload the page and try again.',
  inProgress: 'A draft is already being written. Please wait for it to finish.',
  keyReused: 'That request was already used for another draft. Please reload the page and try again.',
  perMinute: 'Please wait a minute before asking for another draft.',
  perDay: `You have made today's ${caps.MAX_DRAFTS_PER_DAY} drafts. You can make more tomorrow.`,
  blockedDay: 'We could not write several drafts for you today. Please try again tomorrow.',
  busy: 'Making things is very busy right now. Please try again in a little while. Nothing was charged.',
  notHappy: 'We could not write a draft we are happy with. Nothing was charged.',
  failed: 'We could not write a draft just now. Nothing was charged. Please try again.',
  refundLate: 'We could not write a draft just now. We are returning your Quarks. Please try again later.',
  frozen: 'This client is paused, so nothing can be made for it right now.',
  ledger: 'We could not start the draft just now. Nothing was charged. Please try again.'
});

const IST_MS = 330 * 60000;
const istDay = (d) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const idOf = (user) => (!user ? '' : String(user._id || user.id || ''));
const isObjectId = (s) => /^[a-f0-9]{24}$/i.test(String(s || ''));
const REF_RE = /^([a-f0-9]{24})\.([pt]-[A-Za-z0-9_-]{1,64})$/;

function defaultDeps() {
  const m = (name) => require(`../../models/${name}`);
  const quarks = () => require('../quarkBuckets');
  const llm = () => require('../openAI');
  return {
    Draft: () => m('HomeDraft'),
    competitorsFor: (userId) => competitorsQuery(m('Competitor'), userId).limit(25).maxTimeMS(20000),
    snapshotsFor: (userId, competitorId) => m('CompetitorSnapshot').find({ userId, competitorId })
      .sort({ weekStart: -1 }).limit(KEEP_WEEKS).select('userId competitorId weekStart ok posts topPost topPostAt hashtags').maxTimeMS(20000).lean(),
    pillarsFor: async (userId) => {
      const run = await m('Blueprint').findOne({ userId, kind: 'plan', status: 'completed' }).sort({ createdAt: -1 }).select('result.plan.pillars.name').maxTimeMS(20000).lean();
      const list = run && run.result && run.result.plan && Array.isArray(run.result.plan.pillars) ? run.result.plan.pillars : [];
      return list.map((p) => String((p && p.name) || '').trim()).filter(Boolean).slice(0, 4);
    },
    productsFor: async (userId) => (await m('Product').find({ user: userId }).select('name').limit(5).maxTimeMS(20000).lean()).map((p) => p.name).filter(Boolean),
    // What Nebulaa learned, through the one shared prompt helper (services/brandMemory/prompt.js); [] when nothing.
    learnedFor: (userId) => require('../brandMemory/prompt').loadMemoryLines(userId, { maxLines: 4 }),
    spend: (userId, cost, opts) => quarks().spend(userId, cost, opts),
    settle: (userId) => quarks().settleWallet(userId).catch(() => null),
    refundTo: (userId, q, opts) => quarks().refundTo(userId, q, opts),
    // The Quark ledger rows of one draft (ref = the draft row id): its spend, and any refund already made.
    // Read through quarkBuckets.chargeProof: the ledger row first, else the credits.history entry written in the same
    // update as the balance change (the ledger row is written after it and may be missing).
    findSpend: async (ref, userId) => {
      const p = await quarks().chargeProof(ref, { userId });
      return p.spend ? { user: p.spend.payer, workspace: p.spend.workspace || undefined, quarks: -p.spend.quarks } : null;
    },
    findRefund: async (ref, userId) => ((await quarks().chargeProof(ref, { userId })).refunded ? { proof: true } : null),
    // One sweep at a time across all server processes (an OpsState lease, like the competitor tracker).
    lease: require('../competitors/lease').createLease({ key: 'home_drafts_sweep_lease', ttlMs: caps.SWEEP_LEASE_MS }),
    guard: (action) => require('../spendGuard').check(action),
    write: ({ system, user, language }) => {
      const { callTextLLM, textModelFor } = llm();
      return callTextLLM(user, { systemMessage: system, jsonMode: true, model: textModelFor(language), noFallback: true, maxTokens: caps.WRITE_MAX_TOKENS, timeout: caps.CALL_TIMEOUT_MS });
    },
    check: ({ system, user }) => require('../openAI').callTextLLM(user, { systemMessage: system, jsonMode: true, model: checkModel(), noFallback: true, maxTokens: caps.CHECK_MAX_TOKENS, timeout: caps.CALL_TIMEOUT_MS }),
    alert: (key, text) => { try { require('../opsAlerts').recordFailure(key, text); } catch (_) { /* best effort */ } },
    // A refund the sweep gave up on: a person must finish it, so one occurrence is enough to send the alert.
    alertNow: (key, text) => {
      try {
        const ops = require('../opsAlerts');
        ops.recordFailure(key, text);
        ops.notify({ key: `${key}:${text}`, subject: 'Nebulaa alert: a Home draft refund needs a person', text: `${text}\n\nSee docs/superpowers/ops/home-drafts.md (refunds that did not land).` });
      } catch (_) { /* best effort */ }
    },
    env: process.env,
    now: () => new Date()
  };
}

/** The model for the second check: the cheapest configured text model. DECENCY_CHECK_MODEL, else the comment-scoring
 *  model (LISTENING_MODEL), else the regional writing model, which is the cheaper of the two writers. */
function checkModel(env = process.env) {
  return String(env.DECENCY_CHECK_MODEL || env.LISTENING_MODEL || env.TEXT_MODEL_REGIONAL || 'gpt-6.1-sol').trim();
}

const switchOn = (env) => String((env && env[caps.SWITCH_ENV]) || '').trim().toLowerCase() === 'on';

function entitlement(user) {
  try {
    const r = canUse(user, 'competitors');
    if (r.allowed) return { ok: true };
    return { ok: false, reason: r.reason === 'upgrade' ? 'upgrade' : 'addon' };
  } catch (_) { return { ok: false, reason: 'addon' }; }
}

/** Price of each kind, read from config/apiCosts.js only. */
function prices() {
  const out = {};
  for (const kind of caps.KINDS) { const q = QUARK_COSTS[ACTION[kind]]; out[kind] = { quarks: q, price: priceText(q), worth: worthText(q) }; }
  return out;
}

const reply = (status, body) => ({ status, body: { success: status < 300, ...body } });

function createHomeDrafts(given = {}) {
  const deps = { ...defaultDeps(), ...given };
  const locks = new Set();
  const Draft = () => deps.Draft();

  /** The answer for a replayed key: the stored outcome, never a new charge. A key used for another kind or another post
   *  is refused, so a reused key never returns an earlier, unrelated draft. */
  function replayOf(row, kind, ref) {
    if (kind && (row.kind !== kind || (ref && `${String(row.competitorId || '')}.${row.postKey || ''}` !== ref))) return reply(409, { keyReused: true, message: MESSAGES.keyReused });
    if (row.status === 'done' && row.result) return reply(200, { replay: true, kind: row.kind, draft: draftOut(row.kind, row.result), quarks: row.quarks, price: priceText(row.quarks) });
    if (row.inFlight) return reply(409, { inProgress: true, message: MESSAGES.inProgress });
    if (row.status === 'blocked') return reply(422, { replay: true, blocked: true, refunded: true, message: MESSAGES.notHappy });
    if (row.status === 'refused') {
      return row.outcome === 'frozen'
        ? reply(403, { replay: true, message: MESSAGES.frozen })
        : reply(403, { replay: true, creditsExhausted: true, message: `This draft needs ${priceText(QUARK_COSTS[ACTION[row.kind]])}. Please top up or choose a plan.` });
    }
    return reply(502, { replay: true, refunded: true, message: MESSAGES.failed });
  }

  const draftOut = (kind, r) => (kind === 'response_post' ? { caption: r.caption, imageIdea: r.imageIdea } : { comment: r.comment });

  /** Returns the Quarks of a charged row once (the flag flips first, so two closers cannot both refund). A row whose
   *  charge was never confirmed (chargedConfirmed false: the process may have died between the charge and the mark) is
   *  settled from the Quark ledger spend row: exactly that amount, to that payer, only if it exists and was not refunded.
   *  `known` is the amount and payer of a charge that did return (used when only the mark could not be written). */
  async function refundRow(row, userId, action, known = null) {
    if (!row) return { ok: true, none: true };
    let amount; let payer; let filter = { _id: row._id, inFlight: true, refunded: false };
    if (known) { amount = known.amount; payer = known.payerId; }
    else if (row.chargedConfirmed === false) {
      let spent; let back;
      try { [spent, back] = [await deps.findSpend(String(row._id), userId), null]; if (spent) back = await deps.findRefund(String(row._id), userId); } catch (_) { return { ok: false, lookupFailed: true }; }
      const mine = spent && (String(spent.user) === userId || String(spent.workspace || '') === userId);
      if (!mine || !(Number(spent.quarks) < 0) || back) return { ok: true, none: true };
      amount = -Number(spent.quarks); payer = String(spent.user);
    } else {
      if (!(row.quarks > 0)) return { ok: true, none: true };
      amount = row.quarks; payer = row.payerId || '';
      filter = { ...filter, quarks: { $gt: 0 } };
    }
    if (row.quarks > 0) amount = Math.min(amount, row.quarks); // never more than was meant to be charged
    if (!(amount > 0)) return { ok: true, none: true };
    const claimed = await Draft().findOneAndUpdate(filter, { $set: { refunded: true, quarks: amount, payerId: payer } }, { new: true }).catch(() => null);
    if (!claimed) return { ok: true, none: true };
    let back = { ok: false };
    try { back = await deps.refundTo(userId, amount, { action: `${action}_refund`, ref: String(row._id), payerId: payer }); } catch (_) { back = { ok: false }; }
    if (!back || !back.ok) {
      await Draft().updateOne({ _id: row._id }, { $set: { refundFailed: true, refunded: false } }).catch(() => null);
      console.error(`[home drafts] refund of ${amount} Quarks did not land for draft ${String(row._id)}`);
      deps.alert('home_draft_refund', `Home draft ${String(row._id)}: the refund of ${amount} Quarks did not land.`);
      return { ok: false };
    }
    return { ok: true };
  }

  async function finish(row, set, { userId, action, refund, known = null }) {
    let refunded = { ok: true, none: true };
    if (refund) refunded = await refundRow(row, userId, action, known);
    if (refunded.lookupFailed) return refunded; // could not tell whether money moved: leave the row to be looked at again
    await Draft().updateOne({ _id: row._id, inFlight: true }, { $set: { ...set, finishedAt: deps.now() }, $unset: { inFlight: 1 } }).catch(() => null);
    return refunded;
  }

  /** Requests whose lease ran out (nothing touched the row for STALE_MS: a restart) are closed as failed and their Quarks
   *  returned. Rows from before the lease existed are judged by startedAt. With no userId: every account (the sweep). */
  async function recoverStale(userId, limit = 5) {
    const before = new Date(deps.now().getTime() - caps.STALE_MS);
    const who = userId ? { userId } : {};
    const [a, b] = await Promise.all([
      Draft().find({ ...who, inFlight: true, leaseAt: { $lt: before } }).limit(limit).lean().catch(() => []),
      Draft().find({ ...who, inFlight: true, leaseAt: { $exists: false }, startedAt: { $lt: before } }).limit(limit).lean().catch(() => [])
    ]);
    let closed = 0;
    for (const r of [...a, ...b].slice(0, limit)) {
      const out = await finish(r, { status: 'failed', outcome: 'stale' }, { userId: String(r.userId), action: ACTION[r.kind], refund: true });
      if (!out.lookupFailed) closed += 1;
    }
    return closed;
  }

  // A refund that did not land (refundFailed) and is due for another try. Never a row still running.
  const retryDue = (now) => ({
    refundFailed: true, refunded: false, inFlight: { $ne: true }, refundGaveUp: { $ne: true },
    $or: [{ refundRetryAt: { $exists: false } }, { refundRetryAt: { $lte: now } }]
  });

  /**
   * Tries the refunds that did not land again. Each row is claimed first (one conditional update moves its retry time
   * forward and counts the attempt), so two sweeps never both try it. Before paying, the proof is read: a refund that
   * landed but reported a failure is only marked, never paid twice. A failed try waits twice as long as the last one;
   * after REFUND_RETRY_MAX tries the row is left for a person and an alert is sent.
   */
  async function retryRefunds(limit = caps.SWEEP_BATCH) {
    const now = deps.now();
    const due = await Draft().find(retryDue(now)).limit(limit).lean().catch(() => []);
    let retried = 0;
    for (const r of due.slice(0, limit)) {
      const claimed = await Draft().findOneAndUpdate({ _id: r._id, ...retryDue(now) }, { $set: { refundRetryAt: new Date(now.getTime() + caps.REFUND_RETRY_HOLD_MS) }, $inc: { refundAttempts: 1 } }, { new: true }).catch(() => null);
      if (!claimed) continue;
      const ref = String(claimed._id); const userId = String(claimed.userId); const amount = Number(claimed.quarks) || 0;
      const done = () => Draft().updateOne({ _id: claimed._id, refundFailed: true }, { $set: { refunded: true }, $unset: { refundFailed: 1, refundRetryAt: 1 } }).catch(() => null);
      let landed;
      try { landed = Boolean(await deps.findRefund(ref, userId)); } catch (_) { continue; } // unknown: the hold runs out, tried later
      if (landed || !(amount > 0)) { await done(); continue; }
      let back = { ok: false };
      try { back = await deps.refundTo(userId, amount, { action: `${ACTION[claimed.kind]}_refund`, ref, payerId: claimed.payerId || '' }); } catch (_) { back = { ok: false }; }
      if (back && back.ok) { await done(); retried += 1; continue; }
      const tries = Number(claimed.refundAttempts) || 1;
      if (tries >= caps.REFUND_RETRY_MAX) {
        await Draft().updateOne({ _id: claimed._id }, { $set: { refundGaveUp: true }, $unset: { refundRetryAt: 1 } }).catch(() => null);
        console.error(`[home drafts] gave up refunding ${amount} Quarks for draft ${ref} after ${tries} tries`);
        deps.alertNow('home_draft_refund_gave_up', `Home draft ${ref}: the refund of ${amount} Quarks to ${claimed.payerId || userId} did not land after ${tries} tries. Return it by hand.`);
      } else {
        await Draft().updateOne({ _id: claimed._id }, { $set: { refundRetryAt: new Date(now.getTime() + caps.REFUND_RETRY_BASE_MS * 2 ** (tries - 1)) } }).catch(() => null);
      }
    }
    return retried;
  }

  /** The background sweep (every SWEEP_EVERY_MS, one server at a time): lost requests of every account, then refund retries. */
  async function sweep() {
    const token = await deps.lease.claim(deps.now());
    if (!token) return { skipped: true };
    try {
      const closed = await recoverStale(null, caps.SWEEP_BATCH);
      const retried = await retryRefunds(caps.SWEEP_BATCH);
      return { closed, retried };
    } finally {
      await deps.lease.release(token);
    }
  }

  async function capsProblem(userId, now) {
    const D = Draft();
    const day = istDay(now);
    const [minute, today, blocked, all] = await Promise.all([
      D.countDocuments({ userId, createdAt: { $gte: new Date(now.getTime() - 60000) } }),
      D.countDocuments({ userId, day, attempts: { $gt: 0 } }),
      D.countDocuments({ userId, day, status: 'blocked' }),
      D.countDocuments({ day, attempts: { $gt: 0 } })
    ]);
    if (minute >= caps.MAX_PER_MINUTE) return reply(429, { limit: 'minute', message: MESSAGES.perMinute });
    if (today >= caps.MAX_DRAFTS_PER_DAY) return reply(429, { limit: 'day', message: MESSAGES.perDay });
    if (blocked >= caps.MAX_BLOCKED_PER_DAY) return reply(429, { limit: 'blocked', message: MESSAGES.blockedDay });
    if (all >= caps.MAX_DRAFTS_ALL_ACCOUNTS_PER_DAY) return reply(503, { serviceBusy: true, message: MESSAGES.busy });
    return null;
  }

  /** The stored post behind a reference, only from a competitor the account tracks, only from its own snapshots. */
  async function resolvePost(userId, ref, now) {
    const m = REF_RE.exec(String(ref || ''));
    if (!m) return null;
    const [, competitorId, postKey] = m;
    const all = (await deps.competitorsFor(userId)) || [];
    const own = all.filter((c) => c && String(c.userId) === userId);
    const competitor = trackedCompetitors(own).find((c) => String(c._id) === competitorId);
    if (!competitor) return null;
    const snaps = ((await deps.snapshotsFor(userId, competitor._id)) || [])
      .filter((s) => s && String(s.userId) === userId && String(s.competitorId) === competitorId && s.ok !== false);
    if (!snaps.length) return null;
    const posts = mergePosts(snaps).filter((p) => p.at <= now);
    let post = posts.find((p) => postKeyOf(p) === postKey) || null;
    let source = '';
    const latest = snaps[0];
    if (!post && latest && !(latest.posts || []).length && latest.topPost) {
      const t = latest.topPost; const at = latest.topPostAt ? new Date(latest.topPostAt) : null;
      const candidate = { url: t.url || '', at, type: t.type, likes: t.likes, comments: t.comments };
      if (at && postKeyOf(candidate) === postKey) post = { ...candidate, type: /video|reel/i.test(String(t.type || '')) ? 'video' : /sidecar|carousel/i.test(String(t.type || '')) ? 'carousel' : 'image' };
    }
    if (!post) return null;
    // The stored caption is only used to find shared topic words and as the copy backstop; it is never sent anywhere.
    for (const s of snaps) {
      if (s.topPost && s.topPost.url && post.url && s.topPost.url === post.url) { source = [s.topPost.caption || '', ...(s.hashtags || [])].join(' '); break; }
    }
    const week = bestOf(posts, { now, period: 'week' });
    const period = week && postKeyOf(week) === postKey ? 'week' : 'month';
    const banned = own.flatMap((c) => [c.name, handleOf(c)]).filter(Boolean);
    return { competitorId, postKey, post: { type: post.type, period }, worked: whatWorked(posts, now), banned, source };
  }

  async function brandOf(user) {
    const bp = (user && user.businessProfile) || {};
    const userId = idOf(user);
    const [pillars, products, learned] = await Promise.all([
      Promise.resolve().then(() => deps.pillarsFor(userId)).catch(() => []),
      Promise.resolve().then(() => deps.productsFor(userId)).catch(() => []),
      Promise.resolve().then(() => (deps.learnedFor ? deps.learnedFor(userId) : [])).catch(() => [])
    ]);
    return { ...bp, name: bp.name || (user && user.companyName) || '', pillars, products, learned: Array.isArray(learned) ? learned : [] };
  }

  /** GET options: prices, switch, entitlement, languages, how many drafts are left today. */
  async function options(user, { pass = false } = {}) {
    if (user && (user.staffRole || user.isCsm) && !pass) return { staff: true };
    const ent = entitlement(user);
    const lang = languageOf('', user && user.businessProfile && user.businessProfile.contentLanguage);
    let left = null;
    try {
      const used = await Draft().countDocuments({ userId: idOf(user), day: istDay(deps.now()), attempts: { $gt: 0 } });
      left = Math.max(0, caps.MAX_DRAFTS_PER_DAY - used);
    } catch (_) { left = null; }
    // Agency owners and their client workspaces see posts and videos, never Quarks (the same rule as the agency screens).
    const tier = user && user.plan && user.plan.tier;
    const ag = (user && user.agency) || {};
    const postsOnly = tier === 'agency' || Boolean(ag.ownerId) || Number(ag.clientCount || 0) > 0;
    return {
      enabled: switchOn(deps.env), entitled: ent.ok, locked: ent.ok ? null : ent.reason, prices: prices(), postsOnly,
      tones: caps.TONES, languages: caps.LANGUAGES.map((key) => ({ key, label: languageLabel(key) })), language: lang.code,
      perDay: caps.MAX_DRAFTS_PER_DAY, left, maxComment: caps.COMMENT_MAX, maxCaption: caps.CAPTION_MAX
    };
  }

  /** POST: one draft. `kind` is response_post or witty_comment. Returns { status, body }. */
  async function make(user, kind, body = {}, { pass = false } = {}) {
    const userId = idOf(user);
    if (!userId || !isObjectId(userId)) return reply(401, { message: 'Please sign in to continue.' });
    if (!caps.KINDS.includes(kind)) return reply(400, { message: MESSAGES.input });
    if (!switchOn(deps.env)) return reply(503, { disabled: true, message: MESSAGES.off });
    if ((user.staffRole || user.isCsm) && !pass) return reply(403, { message: MESSAGES.staff });
    const ent = entitlement(user);
    if (!ent.ok) return reply(403, { locked: ent.reason, message: MESSAGES[ent.reason] });
    const b = body && typeof body === 'object' ? body : {};
    const key = String(b.key || '');
    if (!caps.KEY_RE.test(key) || typeof b.ref !== 'string' || !REF_RE.test(b.ref)) return reply(400, { message: MESSAGES.input });
    const tone = toneOf(b.tone);
    const language = languageOf(b.language, user.businessProfile && user.businessProfile.contentLanguage);
    const action = ACTION[kind];

    if (locks.has(userId)) {
      const same = await Draft().findOne({ userId, key }).lean().catch(() => null);
      return same && same.status === 'done' ? replayOf(same, kind, b.ref) : reply(409, { inProgress: true, message: MESSAGES.inProgress });
    }
    locks.add(userId);
    let row = null;
    try {
      const now = deps.now();
      await recoverStale(userId);
      const existing = await Draft().findOne({ userId, key }).lean();
      if (existing) return replayOf(existing, kind, b.ref);
      if (await Draft().findOne({ userId, inFlight: true }).select('_id').lean()) return reply(409, { inProgress: true, message: MESSAGES.inProgress });
      const capped = await capsProblem(userId, now);
      if (capped) return capped;
      for (const a of [action, 'campaign_text']) {
        let g; try { g = await deps.guard(a); } catch (_) { g = { ok: true }; }
        if (g && g.ok === false) return reply(503, { serviceBusy: true, message: MESSAGES.busy });
      }
      const found = await resolvePost(userId, b.ref, now);
      if (!found) return reply(404, { message: MESSAGES.notFound });

      // The ledger row comes first: no row, no charge and no call.
      try {
        row = await Draft().create({
          userId, key, kind, day: istDay(now), competitorId: found.competitorId, postKey: found.postKey, tone, language: language.code + (language.mix ? '_english_mix' : ''),
          status: 'started', inFlight: true, chargedConfirmed: false, startedAt: deps.now(), leaseAt: deps.now(), createdAt: now
        });
      } catch (e) {
        if (e && e.code === 11000) {
          const again = await Draft().findOne({ userId, key }).lean().catch(() => null);
          return again ? replayOf(again, kind, b.ref) : reply(409, { inProgress: true, message: MESSAGES.inProgress });
        }
        return reply(503, { message: MESSAGES.ledger });
      }

      const cost = QUARK_COSTS[action];
      await deps.settle(userId);
      // The intent goes on the row BEFORE the charge, so a crash right after it can still be settled from the ledger.
      const intent = await Draft().findOneAndUpdate({ _id: row._id, inFlight: true, refunded: false }, { $set: { quarks: cost, payerId: userId, leaseAt: deps.now() } }, { new: true }).catch(() => null);
      if (!intent) {
        await finish(row, { status: 'failed', outcome: 'ledger' }, { userId, action, refund: false });
        return reply(503, { message: MESSAGES.ledger });
      }
      let paid = null; let spendThrew = false;
      try { paid = await deps.spend(userId, cost, { action, description: kind === 'response_post' ? 'Post in response' : 'Witty comment draft', ref: String(row._id) }); } catch (_) { paid = null; spendThrew = true; }
      if (!paid || !paid.success) {
        if (spendThrew) {
          // The charge may or may not have landed: the ledger decides, and a spend row is refunded.
          const r = await finish(row, { status: 'failed', outcome: 'ledger', quarks: 0 }, { userId, action, refund: true });
          if (r.lookupFailed) return reply(503, { message: MESSAGES.refundLate });
          return reply(503, { refunded: r.ok, message: r.ok ? MESSAGES.ledger : MESSAGES.refundLate });
        }
        const frozen = Boolean(paid && paid.frozen);
        await finish(row, { status: 'refused', outcome: frozen ? 'frozen' : 'no_balance', quarks: 0 }, { userId, action, refund: false });
        return frozen ? reply(403, { message: MESSAGES.frozen }) : reply(403, { creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `This draft needs ${priceText(cost)}. Please top up or choose a plan.` });
      }
      const payerId = String(paid.payerId || userId);
      const charged = await Draft().findOneAndUpdate({ _id: row._id, inFlight: true, refunded: false }, { $set: { status: 'charged', chargedConfirmed: true, quarks: cost, payerId, leaseAt: deps.now() } }, { new: true }).catch(() => null);
      row = charged || { ...row.toObject(), quarks: cost, payerId };
      if (!charged) {
        // The charge is not marked on the row: do not call anything, give the Quarks straight back (once, and checked).
        const r = await finish(row, { status: 'failed', outcome: 'ledger' }, { userId, action, refund: true, known: { amount: cost, payerId } });
        return reply(503, { refunded: r.ok, message: r.ok ? MESSAGES.ledger : MESSAGES.refundLate });
      }

      const facts = buildFacts({ post: found.post, worked: found.worked, brand: await brandOf(user), banned: found.banned, source: found.source });
      const reasons = new Set();
      for (let attempt = 1; attempt <= caps.MAX_ATTEMPTS; attempt += 1) {
        const counted = await Draft().updateOne({ _id: row._id, inFlight: true, refunded: false }, { $inc: { attempts: 1 }, $set: { leaseAt: deps.now() } }).catch(() => null);
        if (!counted || counted.modifiedCount === 0) {
          const r = await finish(row, { status: 'failed', outcome: 'ledger' }, { userId, action, refund: true });
          return reply(503, { refunded: r.ok, message: r.ok ? MESSAGES.ledger : MESSAGES.refundLate });
        }
        let raw;
        try { raw = await deps.write({ ...buildWritePrompt({ kind, tone, language, facts }), language: language.code }); } catch (_) { raw = null; }
        if (raw === null) {
          const r = await finish(row, { status: 'failed', outcome: 'write_failed' }, { userId, action, refund: true });
          return reply(502, { refunded: r.ok, message: r.ok ? MESSAGES.failed : MESSAGES.refundLate });
        }
        const draft = parseDraft(kind, raw);
        if (!draft) { reasons.add('shape'); continue; }
        const local = checkDraft(kind, draft, { banned: found.banned, source: found.source });
        if (!local.ok) { for (const x of local.reasons) reasons.add(x); continue; }

        const checkCounted = await Draft().updateOne({ _id: row._id, inFlight: true, refunded: false }, { $inc: { checks: 1 }, $set: { leaseAt: deps.now() } }).catch(() => null);
        if (!checkCounted || checkCounted.modifiedCount === 0) {
          const r = await finish(row, { status: 'failed', outcome: 'ledger' }, { userId, action, refund: true });
          return reply(503, { refunded: r.ok, message: r.ok ? MESSAGES.ledger : MESSAGES.refundLate });
        }
        let verdict;
        try { verdict = parseCheck(await deps.check(buildCheckPrompt(kind, draft))); } catch (_) { verdict = { valid: false }; }
        if (!verdict.valid) {
          // Fail closed: the check could not be read, so no draft is shown at all.
          const r = await finish(row, { status: 'failed', outcome: 'check_unavailable', reasons: [...reasons, 'check'] }, { userId, action, refund: true });
          return reply(502, { refunded: r.ok, message: r.ok ? MESSAGES.failed : MESSAGES.refundLate });
        }
        if (!verdict.decent) { reasons.add('model'); continue; }

        // Only a row that is still running and not refunded may be delivered: a row closed by another process is never shown.
        const delivered = await Draft().findOneAndUpdate({ _id: row._id, inFlight: true, refunded: false }, { $set: { status: 'done', outcome: 'ok', result: draft, finishedAt: deps.now(), ...(reasons.size ? { reasons: [...reasons].sort() } : {}) }, $unset: { inFlight: 1 } }, { new: true });
        if (!delivered) {
          const now2 = await Draft().findOne({ _id: row._id }).lean().catch(() => null);
          const back = Boolean(now2 && now2.refunded);
          return reply(502, { refunded: back, message: back ? MESSAGES.failed : MESSAGES.refundLate });
        }
        return reply(200, { kind, draft: draftOut(kind, draft), quarks: cost, price: priceText(cost), language: language.code });
      }
      const outcome = reasons.has('model') && ![...reasons].some((x) => x !== 'model') ? 'blocked_model' : 'blocked_local';
      const r = await finish(row, { status: 'blocked', outcome, reasons: [...reasons].sort() }, { userId, action, refund: true });
      return reply(422, { blocked: true, refunded: r.ok, message: r.ok ? MESSAGES.notHappy : MESSAGES.refundLate });
    } catch (e) {
      console.error('[home drafts] request failed:', e && e.message);
      if (row) {
        const r = await finish(row, { status: 'failed', outcome: 'error' }, { userId, action, refund: true });
        return reply(500, { refunded: r.ok, message: r.ok ? MESSAGES.failed : MESSAGES.refundLate });
      }
      return reply(500, { message: MESSAGES.failed });
    } finally {
      locks.delete(userId);
    }
  }

  /** Counts per outcome for one India day (staff view; counts only, never text). */
  async function dailyCounts(day = istDay(deps.now())) {
    const rows = await Draft().aggregate([{ $match: { day } }, { $group: { _id: { kind: '$kind', outcome: '$outcome' }, n: { $sum: 1 } } }]);
    return rows.map((r) => ({ kind: r._id.kind, outcome: r._id.outcome || 'running', count: r.n }));
  }

  return { options, make, dailyCounts, recoverStale, retryRefunds, sweep, _locks: locks };
}

module.exports = { createHomeDrafts, checkModel, prices, istDay, MESSAGES, ACTION, REF_RE };
