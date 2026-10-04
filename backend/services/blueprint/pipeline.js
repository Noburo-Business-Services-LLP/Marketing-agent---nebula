'use strict';
const { runPlan, runDirections } = require('./planner');
const { assembleBlueprint } = require('./assemble');
const { runQa } = require('./qa');

async function buildBlueprint({ input, sheet, direction, mode, now, sources }, deps = {}) {
  const planned = await runPlan({ sheet, input, direction, callLLM: deps.callLLM, parseJSON: deps.parseJSON });
  if (!planned) throw new Error('planner returned no usable plan');
  const result = assembleBlueprint({ input, sheet, plan: planned.plan, direction, mode, now, sources });
  const qa = runQa({ blueprint: result, sheet, input, dropped: planned.dropped });
  return { result, qa };
}

// Fewer than two surviving directions is not a choice, so the caller gets [].
async function proposeDirections({ input, sheet }, deps = {}) {
  const list = await runDirections({ sheet, input, callLLM: deps.callLLM, parseJSON: deps.parseJSON });
  return list.length >= 2 ? list : [];
}

module.exports = { buildBlueprint, proposeDirections };
