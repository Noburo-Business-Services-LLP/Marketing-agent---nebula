'use strict';
// Module C and D (model side): build the locked prompt, call the model, and turn what it returns into claims the
// document may carry. The model can never mint Verified: anything it calls verified is downgraded, and anything
// the QA scanner rejects is removed and counted.
const { FORMATS, CHANNELS, PHASES, LIMITS, PLAN_NEBULAA_CAN, OFFLINE_CHANNELS, PLAN_METRICS, PLAN_LIMITS, PLAN_MAX_TOKENS } = require('../../config/blueprint');
const { getPrompt, renderTemplate } = require('../promptRegistry');
const { scanClaimText, scanPlanWording, allowedNumbersOf } = require('./qa');
const { readPlanAnswer } = require('./planJson');

const GOAL_TEXT = { enquiries: 'more enquiries', sales: 'more sales', followers: 'more followers', launch: 'a launch' };
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const RAW_CAP = 20; // read at most this many raw items from any list, so every one can be scanned

// Tag laundering guard: every digit-bearing token and every capitalised proper noun (not the first word of a
// sentence) in an inference must also appear in the text of the facts it cites (or be the business's own name). Plain token containment.
function supported(text, ids, ctx) {
  const basis = [ctx.brand || '', ...ids.map((id) => (ctx.factText && ctx.factText.get(id)) || '')].join(' ').toLowerCase();
  const tokens = text.split(/\s+/).map((w, i, all) => ({ w: w.replace(/^[^\p{L}\p{Nd}]+|[^\p{L}\p{Nd}]+$/gu, ''), start: i === 0 || /[.!?]$/.test(all[i - 1]) })).filter((t) => t.w);
  return tokens.every((t) => !(/\p{Nd}/u.test(t.w) || (!t.start && /^\p{Lu}/u.test(t.w))) || basis.includes(t.w.toLowerCase()));
}

// The model can never produce Verified. An inference with no real fact behind it becomes a proposal.
function toClaim(raw, ctx, forceProposed = false, max = 320) {
  const o = isObj(raw) ? raw : { text: raw };
  const text = str(o.text, max);
  if (!text) return null;
  const ids = arr(o.factIds, 6).map((x) => str(x, 12)).filter((id) => ctx.factIds.has(id));
  let tag = o.tag === 'proposed' || forceProposed ? 'proposed' : 'inference';
  if (tag === 'inference' && !ids.length) tag = 'proposed';
  const bad = [...scanClaimText(text, { allowedNumbers: ctx.allowedNumbers }), ...scanPlanWording(text, ctx.basisText)];
  if (!bad.length && tag === 'inference' && !supported(text, ids, ctx)) bad.push({ rule: 'unsupported_by_facts' });
  if (bad.length) { ctx.dropped.push({ text, rules: bad.map((b) => b.rule) }); return null; }
  return tag === 'inference' ? { text, tag, factIds: ids } : { text, tag };
}

// A short label (pillar, territory, competitor name) goes through the same scanner.
function toLabel(raw, max, ctx) {
  const text = str(raw, max);
  if (!text) return '';
  const bad = [...scanClaimText(text, { allowedNumbers: ctx.allowedNumbers }), ...scanPlanWording(text, ctx.basisText)];
  if (bad.length) { ctx.dropped.push({ text, rules: bad.map((b) => b.rule) }); return ''; }
  return text;
}

const claims = (list, max, ctx, force = false) => arr(list, RAW_CAP).map((x) => toClaim(x, ctx, force)).filter(Boolean).slice(0, max);

function factLine(f) {
  const where = f.kind === 'typed' ? `typed: ${String(f.field).toLowerCase()}` : `${f.kind}: ${String(f.field).toLowerCase()}`;
  return `${f.id} [${where}] ${f.text}`;
}

const factsBlock = (sheet) => ((sheet && sheet.facts) || []).filter((f) => f.kind !== 'competitor_page').map(factLine).join('\n') || 'None.';
const unverifiedBlock = (sheet) => ((sheet && sheet.unverified) || []).map((u) => `${u.id} ${u.text}: ${u.reason}`).join('\n') || 'None.';

function buildDirectionVars(sheet, input) {
  return { facts: factsBlock(sheet), unverified: unverifiedBlock(sheet), goal: GOAL_TEXT[input && input.goal] || 'not stated' };
}

function buildPlanVars(sheet, input, direction) {
  const comp = ((sheet && sheet.facts) || []).filter((f) => f.kind === 'competitor_page').map((f) => `${f.id} [competitor: ${f.subject}] ${f.text}`).join('\n');
  return {
    ...buildDirectionVars(sheet, input),
    basis: (sheet && sheet.basis) || 'limited',
    territory: direction && direction.name ? `${direction.name} (chosen by the visitor; do not replace it)` : 'Not chosen. Propose one territory.',
    competitors: comp || 'None given.',
    formats: FORMATS.join(', '),
    channels: CHANNELS.join(', '),
    nebulaaCan: PLAN_NEBULAA_CAN.join(', '),
    offlineChannels: OFFLINE_CHANNELS.map((o) => `${o.id} (${o.name})`).join(', '),
    metricIds: PLAN_METRICS.map((m) => `${m.id} (${m.name}${m.needs ? `, only with ${m.needs.channel || m.needs.offline}` : ''})`).join(', ')
  };
}

const ctxOf = (sheet) => ({ brand: String((sheet && sheet.client && sheet.client.name) || ''), basisText: [String((sheet && sheet.client && sheet.client.name) || ''), ...((sheet && sheet.facts) || []).map((f) => String(f.text || ''))].join(' '), factText: new Map(((sheet && sheet.facts) || []).map((f) => [f.id, String(f.text || '')])), factIds: new Set(((sheet && sheet.facts) || []).map((f) => f.id)), allowedNumbers: allowedNumbersOf(sheet), dropped: [] });

// Offline rows: ids from the fixed list only, at most three, each with a reason. Everything is a suggestion (tag
// proposed) and the owner does it: a line that says Nebulaa does anything offline is removed.
const OFFLINE_BY_ID = new Map(OFFLINE_CHANNELS.map((o) => [o.id, o]));
const NAMES_NEBULAA = /\bnebulaa\b/i;
function offlineClaim(raw, ctx) {
  const c = toClaim(raw, ctx, true, PLAN_LIMITS.ROW_TEXT);
  if (c && NAMES_NEBULAA.test(c.text)) { ctx.dropped.push({ text: c.text, rules: ['offline_nebulaa'] }); return null; }
  return c;
}
function offlineOf(parsed, ctx) {
  const out = [];
  for (const o of arr(parsed.offline, RAW_CAP)) {
    if (!isObj(o)) continue;
    const id = str(o.id || o.channel, 40).toLowerCase();
    const def = OFFLINE_BY_ID.get(id);
    if (!def || out.some((x) => x.id === id)) continue;
    const reason = offlineClaim(o.reason, ctx);
    if (!reason) continue;
    const youDo = arr(o.youDo, RAW_CAP).map((y) => offlineClaim(y, ctx)).filter(Boolean).slice(0, PLAN_LIMITS.MAX_YOU_DO);
    out.push({ id, channel: def.name, mode: 'offline', spend: def.spend, reason, youDo, nebulaaDoes: [] });
    if (out.length >= PLAN_LIMITS.MAX_OFFLINE) break;
  }
  return out;
}

// Numbers to watch: ids from the fixed list only, tied to a chosen channel or offline row where the list says so.
// Name, meaning, where it is seen and who counts it come from the list, never from the model.
const METRIC_BY_ID = new Map(PLAN_METRICS.map((m) => [m.id, m]));
const METRIC_TOP_UP = { enquiries: ['enquiries', 'reach', 'posts_published'], sales: ['enquiries', 'engagement', 'posts_published'], followers: ['followers', 'reach', 'engagement'], launch: ['reach', 'engagement', 'enquiries'] };
function goalOf(sheet) {
  const f = ((sheet && sheet.facts) || []).find((x) => x.kind === 'typed' && x.field === 'Main goal');
  const g = f ? String(f.quote || f.text || '').toLowerCase().replace(/^main goal:\s*/, '') : '';
  return METRIC_TOP_UP[g] ? g : 'enquiries';
}
function metricRow(def, why, start) {
  return { id: def.id, name: def.name, meaning: def.meaning, where: def.where, count: def.count, why, start };
}
function metricsOf(parsed, ctx, { channels, offline, goal }) {
  const fits = (def) => !def.needs || (def.needs.channel ? channels.has(def.needs.channel) : offline.has(def.needs.offline));
  const out = [];
  for (const m of arr(parsed.metrics, RAW_CAP)) {
    if (!isObj(m)) continue;
    const def = METRIC_BY_ID.get(str(m.id, 40).toLowerCase());
    if (!def || !fits(def) || out.some((x) => x.id === def.id)) continue;
    out.push(metricRow(def, toClaim(m.why, ctx, true, PLAN_LIMITS.ROW_TEXT), toClaim(m.start, ctx, true, PLAN_LIMITS.ROW_TEXT)));
    if (out.length >= PLAN_LIMITS.MAX_METRICS) break;
  }
  // A block that came back short is filled to three from a fixed list for the goal. Nothing is added when the
  // answer had no metrics at all (an older answer or a cut one): the page then says the block is not in the plan yet.
  if (out.length && out.length < PLAN_LIMITS.MIN_METRICS) {
    for (const id of METRIC_TOP_UP[goal]) {
      if (out.length >= PLAN_LIMITS.MIN_METRICS) break;
      if (!out.some((x) => x.id === id)) out.push({ ...metricRow(METRIC_BY_ID.get(id), null, null), auto: true });
    }
  }
  return out;
}

// The marketing mix the page draws, worked out in code from the rows above: online and offline, organic and paid.
// Paid is only ever a suggestion the owner runs and pays for himself; Nebulaa does not run paid ads.
function mixOf(channels, effort, offline) {
  const rows = channels.map((c) => {
    const e = effort.find((x) => x.channel === c.channel);
    return { channel: c.channel, mode: 'online', organicPct: e ? e.organicPct : null, paidPct: e ? e.paidPct : null };
  });
  offline.forEach((o) => rows.push({ channel: o.channel, mode: 'offline', organicPct: o.spend === 'paid' ? 0 : 100, paidPct: o.spend === 'paid' ? 100 : 0 }));
  return { channels: rows, online: channels.length, offline: offline.length, paidTag: 'proposed', paidBy: 'you' };
}

function normalisePlan(parsed, sheet) {
  if (!isObj(parsed)) return null;
  const ctx = ctxOf(sheet);
  // An offer cites a typed offer or one of the account's own products.
  const typedOffers = new Set(((sheet && sheet.facts) || []).filter((f) => f.kind === 'typed' && (f.field === 'Offer' || f.field === 'Product')).map((f) => f.id));
  const pos = isObj(parsed.positioning) ? parsed.positioning : {};
  const t = isObj(pos.territory) ? pos.territory : {};
  const tName = toLabel(t.name, 60, ctx);

  const pillars = [];
  for (const p of arr(parsed.pillars, RAW_CAP)) {
    if (!isObj(p)) continue;
    const name = toLabel(p.name, 40, ctx);
    if (!name || pillars.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    pillars.push({ name, why: toClaim(p.why, ctx), example: toClaim(p.example, ctx, true) });
  }
  pillars.splice(5);
  const byName = new Map(pillars.map((p) => [p.name.toLowerCase(), p.name]));

  const calendar = [];
  const days = new Set();
  for (const c of arr(parsed.calendar, 60)) {
    if (!isObj(c)) continue;
    const day = Number(c.day);
    const pillar = byName.get(str(c.pillar, 40).toLowerCase());
    const format = str(c.format, 20).toLowerCase();
    if (!Number.isInteger(day) || day < 1 || day > 30 || days.has(day) || !pillar || !FORMATS.includes(format)) continue;
    const hook = toClaim(c.hook, ctx, true);
    if (!hook) continue;
    days.add(day);
    calendar.push({ day, pillar, format, hook });
  }
  calendar.sort((a, b) => a.day - b.day);
  if (pillars.length < 3 || calendar.length < LIMITS.MIN_CALENDAR_DAYS) return null;

  const competitors = [];
  for (const c of arr(parsed.competitors, 6)) {
    if (!isObj(c)) continue;
    const name = toLabel(c.name, 80, ctx);
    if (!name) continue;
    competitors.push({ name, observations: claims(c.observations, 4, ctx) });
  }

  const offers = [];
  for (const o of arr(parsed.offers, RAW_CAP)) {
    if (!isObj(o) || !typedOffers.has(o.factId) || offers.some((x) => x.factId === o.factId)) continue;
    offers.push({ factId: o.factId, hook: toClaim(o.hook, ctx, true), cta: toClaim(o.cta, ctx, true) });
  }
  offers.splice(LIMITS.MAX_OFFERS);

  const channels = [];
  for (const c of arr(parsed.channels, RAW_CAP)) {
    if (!isObj(c) || !CHANNELS.includes(c.channel) || channels.some((x) => x.channel === c.channel)) continue;
    const role = toClaim(c.role, ctx, true);
    if (!role) continue;
    channels.push({ channel: c.channel, priority: Number.isInteger(c.priority) ? c.priority : channels.length + 1, role });
  }
  channels.sort((a, b) => a.priority - b.priority);
  channels.splice(5);

  // The customer and effort blocks are newer than the shared Blueprint: what is dropped from them is counted apart,
  // so it can never make a customer-paid Blueprint fail the removed-items limit.
  const xctx = { ...ctx, dropped: [] };
  const icpRaw = isObj(parsed.icp) ? parsed.icp : null;
  const icpBlock = icpRaw ? {
    who: claims(icpRaw.who, 4, xctx),
    pains: claims(icpRaw.pains, 4, xctx),
    where: claims(icpRaw.where, 4, xctx),
    triggers: claims(icpRaw.triggers, 4, xctx)
  } : null;
  const icp = icpBlock && (icpBlock.who.length || icpBlock.pains.length || icpBlock.where.length || icpBlock.triggers.length) ? icpBlock : null;

  const channelNames = new Set(channels.map((c) => c.channel));
  const effort = [];
  for (const e of arr(parsed.effort, RAW_CAP)) {
    if (!isObj(e) || !channelNames.has(e.channel) || effort.some((x) => x.channel === e.channel)) continue;
    const organic = Math.round(Number(e.organicPct));
    let paid = Math.round(Number(e.paidPct));
    if (!Number.isFinite(organic) || organic < 0 || organic > 100) continue;
    if (!Number.isFinite(paid) || paid < 0 || paid > 100 || organic + paid !== 100) paid = 100 - organic; // repaired: organic leads
    const does = arr(e.nebulaaDoes, RAW_CAP).map((a) => str(a, 40).toLowerCase()).filter((a) => PLAN_NEBULAA_CAN.includes(a));
    effort.push({ channel: e.channel, mode: 'online', organicPct: organic, paidPct: paid, nebulaaDoes: [...new Set(does)], youDo: claims(e.youDo, 4, xctx, true) });
  }

  const roadmap = [];
  // The three phases come back in order. A newer model sometimes names a phase in its own words ("content system"
  // for "storytelling"), so when exactly three phases arrive and an id does not match, they are taken by position.
  const given = arr(parsed.roadmap, 10).filter(isObj);
  for (let i = 0; i < PHASES.length; i += 1) {
    const ph = PHASES[i];
    const r = given.find((x) => x.phase === ph.id) || (given.length === PHASES.length && !PHASES.some((p) => p.id === given[i].phase && p.id !== ph.id) ? given[i] : null);
    if (!r) continue;
    roadmap.push({ phase: ph.id, focus: toClaim(r.focus, ctx, true), actions: claims(r.actions, 4, ctx, true), measure: claims(r.measure, 3, ctx, true) });
  }

  const offline = offlineOf(parsed, xctx);
  const metrics = metricsOf(parsed, xctx, { channels: channelNames, offline: new Set(offline.map((o) => o.id)), goal: goalOf(sheet) });

  return {
    plan: {
      promise: toClaim(parsed.promise, ctx, true),
      positioning: {
        audience: claims(pos.audience, 4, ctx),
        territory: tName ? { name: tName, rationale: toClaim(t.rationale, ctx, true), risk: toClaim(t.risk, ctx, true) } : null,
        line: toClaim(pos.line, ctx, true)
      },
      whereToday: claims(parsed.whereToday, 6, ctx),
      competitors,
      pillars,
      calendar,
      offers,
      channels,
      icp,
      effort,
      roadmap,
      firstSteps: claims(parsed.firstSteps, 5, ctx, true),
      offline,
      metrics,
      mix: mixOf(channels, effort, offline)
    },
    dropped: ctx.dropped,
    droppedExtra: xctx.dropped
  };
}

function normaliseDirections(parsed, sheet) {
  if (!isObj(parsed)) return [];
  const ctx = ctxOf(sheet);
  const out = [];
  for (const d of arr(parsed.directions, 8)) {
    if (!isObj(d)) continue;
    const name = toLabel(d.name, 60, ctx);
    const rationale = toClaim(d.rationale, ctx, true);
    if (!name || !rationale || out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, rationale, risk: toClaim(d.risk, ctx, true) });
  }
  return out.slice(0, 4);
}

const lazy = {
  callLLM: (...a) => require('../openAI').callTextLLM(...a),
  parseJSON: (...a) => require('../geminiAI').parseGeminiJSON(...a)
};

// One model call. The answer is read strictly first; a cut answer is repaired to its last complete value.
async function askRaw(id, vars, { callLLM = lazy.callLLM, parseJSON = lazy.parseJSON } = {}) {
  // renderTemplate on the shipped text, never buildPrompt: no override can apply to a locked prompt.
  const prompt = renderTemplate(getPrompt(id).template, vars);
  const raw = await callLLM(prompt, { jsonMode: true, temperature: 0.4, maxTokens: PLAN_MAX_TOKENS, skipCache: true });
  return readPlanAnswer(raw, parseJSON);
}
const ask = async (...a) => (await askRaw(...a)).parsed;

// What came back, in a form safe to log: shapes and counts only, never the text of the answer.
function describeAnswer(parsed) {
  if (!isObj(parsed)) return 'no JSON object';
  return `keys=[${Object.keys(parsed).slice(0, 12).join(',')}] pillars=${arr(parsed.pillars, RAW_CAP).length} calendar=${arr(parsed.calendar, 60).length}`;
}

// The AI sometimes returns a plan the checks reject (too few themes, or ideas that fail the claim checks).
// One more try usually gives a usable one; if not, the run fails and the Quarks are returned.
// A cut answer (the model ran out of room) is repaired to what was complete. When everything up to the first steps
// survived, only the optional offline and metrics blocks can be missing, so it is used as it is. A cut that lost
// more is asked for once more; if that also fails, the best repaired plan is used rather than failing the run.
// `beforeCall` runs before every model call (the spend ledger for plan runs), so a second call is counted too.
async function runPlan({ sheet, input, direction, callLLM, parseJSON, beforeCall }) {
  let best = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (typeof beforeCall === 'function') { try { await beforeCall(attempt); } catch (_) { /* the ledger is best effort */ } }
    const { parsed, repaired } = await askRaw('blueprint.plan', buildPlanVars(sheet, input, direction), { callLLM, parseJSON });
    const plan = normalisePlan(parsed, sheet);
    if (plan && !repaired) return plan;
    if (plan && repaired) {
      plan.repaired = true;
      if (plan.plan.firstSteps.length) return plan;
      if (!best) best = plan;
      console.warn(`[blueprint] plan attempt ${attempt} was cut short and lost more than the optional blocks: ${describeAnswer(parsed)}`);
      continue;
    }
    console.warn(`[blueprint] plan attempt ${attempt} rejected: ${describeAnswer(parsed)}`);
  }
  return best;
}

async function runDirections({ sheet, input, callLLM, parseJSON }) {
  const parsed = await ask('blueprint.directions', buildDirectionVars(sheet, input), { callLLM, parseJSON });
  return normaliseDirections(parsed, sheet);
}

module.exports = { ctxOf, buildPlanVars, buildDirectionVars, normalisePlan, normaliseDirections, runPlan, runDirections, toClaim };
