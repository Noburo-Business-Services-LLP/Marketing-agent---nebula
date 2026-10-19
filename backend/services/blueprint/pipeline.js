'use strict';
const { runPlan, runDirections } = require('./planner');
const { assembleBlueprint } = require('./assemble');
const { runQa, scanClaimText, allowedNumbersOf } = require('./qa');

// The customer and effort blocks live outside the nine pages, so the page QA never walks them. Each claim goes
// through the same scanner once more here: one it rejects never reaches the stored plan. Drops are returned apart
// from the shared Blueprint list, so they cannot push a paid Blueprint over its removed-items limit.
function scanPlanExtras(plan, sheet) {
  const allowedNumbers = allowedNumbersOf(sheet);
  const dropped = [];
  const keep = (list) => (Array.isArray(list) ? list : []).filter((c) => {
    const bad = c && typeof c.text === 'string' ? scanClaimText(c.text, { allowedNumbers }) : [{ rule: 'untagged' }];
    if (!bad.length && c.tag !== 'verified') return true;
    dropped.push({ text: String((c && c.text) || '').slice(0, 80), rules: bad.map((b) => b.rule) });
    return false;
  });
  const icp = plan.icp ? { who: keep(plan.icp.who), pains: keep(plan.icp.pains), where: keep(plan.icp.where), triggers: keep(plan.icp.triggers) } : null;
  const effort = (plan.effort || []).map((e) => ({ ...e, youDo: keep(e.youDo) }));
  const one = (c) => (c ? (keep([c])[0] || null) : null);
  // Offline rows need their reason; a metric keeps its fixed name and meaning even when its own line is removed.
  const offline = (plan.offline || []).map((o) => ({ ...o, reason: one(o.reason), youDo: keep(o.youDo) })).filter((o) => o.reason);
  const metrics = (plan.metrics || []).map((m) => ({ ...m, why: one(m.why), start: one(m.start) }));
  const out = { ...plan, icp: icp && (icp.who.length || icp.pains.length || icp.where.length || icp.triggers.length) ? icp : null, effort };
  if (plan.offline) out.offline = offline;
  if (plan.metrics) out.metrics = metrics;
  if (plan.mix && plan.offline && offline.length !== plan.offline.length) {
    const names = new Set(offline.map((o) => o.channel));
    out.mix = { ...plan.mix, channels: plan.mix.channels.filter((r) => r.mode !== 'offline' || names.has(r.channel)), offline: offline.length };
  }
  return { plan: out, dropped };
}

async function buildBlueprint({ input, sheet, direction, mode, now, sources, beforeCall }, deps = {}) {
  const planned = await runPlan({ sheet, input, direction, callLLM: deps.callLLM, parseJSON: deps.parseJSON, beforeCall });
  if (!planned) throw new Error('planner returned no usable plan');
  const extras = scanPlanExtras(planned.plan, sheet);
  const result = assembleBlueprint({ input, sheet, plan: extras.plan, direction, mode, now, sources });
  // The planner's cleaned answer, kept whole: My plan reads it. The Blueprint view and the designed PDF read pages only.
  result.plan = extras.plan;
  const qa = runQa({ blueprint: result, sheet, input, dropped: planned.dropped });
  const apart = extras.dropped.length + ((planned.droppedExtra || []).length);
  if (apart) qa.flags.push({ level: 'note', rule: 'removed_plan_items', where: 'plan', detail: `${apart} items were removed from the customer, effort, offline and metrics blocks.` });
  if (planned.repaired) qa.flags.push({ level: 'note', rule: 'plan_answer_cut', where: 'plan', detail: 'The answer was cut short and was repaired to its last complete part.' });
  return { result, qa };
}

// Fewer than two surviving directions is not a choice, so the caller gets [].
async function proposeDirections({ input, sheet }, deps = {}) {
  const list = await runDirections({ sheet, input, callLLM: deps.callLLM, parseJSON: deps.parseJSON });
  return list.length >= 2 ? list : [];
}

module.exports = { buildBlueprint, proposeDirections, scanPlanExtras };
