'use strict';
// Module C and D (model side): build the locked prompt, call the model, and turn what it returns into claims the
// document may carry. The model can never mint Verified: anything it calls verified is downgraded, and anything
// the QA scanner rejects is removed and counted.
const { FORMATS, CHANNELS, PHASES, LIMITS } = require('../../config/blueprint');
const { getPrompt, renderTemplate } = require('../promptRegistry');
const { scanClaimText, allowedNumbersOf } = require('./qa');

const GOAL_TEXT = { enquiries: 'more enquiries', sales: 'more sales', followers: 'more followers', launch: 'a launch' };
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const RAW_CAP = 20; // read at most this many raw items from any list, so every one can be scanned

// The model can never produce Verified. An inference with no real fact behind it becomes a proposal.
function toClaim(raw, ctx, forceProposed = false) {
  const o = isObj(raw) ? raw : { text: raw };
  const text = str(o.text, 320);
  if (!text) return null;
  const ids = arr(o.factIds, 6).map((x) => str(x, 12)).filter((id) => ctx.factIds.has(id));
  let tag = o.tag === 'proposed' || forceProposed ? 'proposed' : 'inference';
  if (tag === 'inference' && !ids.length) tag = 'proposed';
  const bad = scanClaimText(text, { allowedNumbers: ctx.allowedNumbers });
  if (bad.length) { ctx.dropped.push({ text, rules: bad.map((b) => b.rule) }); return null; }
  return tag === 'inference' ? { text, tag, factIds: ids } : { text, tag };
}

// A short label (pillar, territory, competitor name) goes through the same scanner.
function toLabel(raw, max, ctx) {
  const text = str(raw, max);
  if (!text) return '';
  const bad = scanClaimText(text, { allowedNumbers: ctx.allowedNumbers });
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
    channels: CHANNELS.join(', ')
  };
}

const ctxOf = (sheet) => ({ factIds: new Set(((sheet && sheet.facts) || []).map((f) => f.id)), allowedNumbers: allowedNumbersOf(sheet), dropped: [] });

function normalisePlan(parsed, sheet) {
  if (!isObj(parsed)) return null;
  const ctx = ctxOf(sheet);
  const typedOffers = new Set(((sheet && sheet.facts) || []).filter((f) => f.kind === 'typed' && f.field === 'Offer').map((f) => f.id));
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

  const roadmap = [];
  for (const ph of PHASES) {
    const r = arr(parsed.roadmap, 10).find((x) => isObj(x) && x.phase === ph.id);
    if (!r) continue;
    roadmap.push({ phase: ph.id, focus: toClaim(r.focus, ctx, true), actions: claims(r.actions, 4, ctx, true), measure: claims(r.measure, 3, ctx, true) });
  }

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
      roadmap,
      firstSteps: claims(parsed.firstSteps, 5, ctx, true)
    },
    dropped: ctx.dropped
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

async function ask(id, vars, { callLLM = lazy.callLLM, parseJSON = lazy.parseJSON } = {}) {
  // renderTemplate on the shipped text, never buildPrompt: no override can apply to a locked prompt.
  const prompt = renderTemplate(getPrompt(id).template, vars);
  const raw = await callLLM(prompt, { jsonMode: true, temperature: 0.4, maxTokens: 6500, skipCache: true });
  if (isObj(raw)) return raw;
  try { return parseJSON(String(raw || '')); } catch (_) { return null; }
}

async function runPlan({ sheet, input, direction, callLLM, parseJSON }) {
  const parsed = await ask('blueprint.plan', buildPlanVars(sheet, input, direction), { callLLM, parseJSON });
  return normalisePlan(parsed, sheet);
}

async function runDirections({ sheet, input, callLLM, parseJSON }) {
  const parsed = await ask('blueprint.directions', buildDirectionVars(sheet, input), { callLLM, parseJSON });
  return normaliseDirections(parsed, sheet);
}

module.exports = { buildPlanVars, buildDirectionVars, normalisePlan, normaliseDirections, runPlan, runDirections, toClaim };
