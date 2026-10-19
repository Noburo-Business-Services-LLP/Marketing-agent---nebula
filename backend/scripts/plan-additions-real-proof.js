/**
 * ONE owner-approved real planner run, to prove the planner additions (products, place and business details in;
 * offline activity, numbers to watch and the marketing mix out) on the real model. About USD 0.19, at most about
 * USD 0.37 if the planner needs its one second try. Card: docs/superpowers/ops/plan-additions-real-proof.md
 *
 *   I_APPROVED_ONE_PLAN_RUN=yes OPENAI_API_KEY=... node scripts/plan-additions-real-proof.js
 *
 * What it does, with made-up sample data (no database, no .env, no wallet, no website fetched, nothing charged): builds
 * the input exactly as a plan run does (services/plan/profileInput.js, the input check, the typed facts), then runs the
 * real planner, its QA and the extras scan (services/blueprint/pipeline.js) with the real writing model. At most two
 * model calls (the planner's own second try); a third is blocked, and the call is pinned so no other provider is tried.
 * It prints what the plan chose (offline rows with reasons, numbers to watch, the mix), what was removed and why, whether
 * the answer was cut, and the measured tokens and cost against the estimate in config/apiCosts.js. The key comes only
 * from this one command (the card reads it at a hidden prompt) and is never printed. It refuses to run without
 * I_APPROVED_ONE_PLAN_RUN=yes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_CALLS = 2;

function sampleAccount() {
  const user = {
    _id: '6d0000000000000000000002', companyName: 'Anu Sweets and Bakes', connectedSocials: [],
    businessProfile: {
      name: 'Anu Sweets and Bakes', website: 'anusweets.example.com', industry: 'Sweet shop and home bakery',
      description: 'Family sweet shop making ghee sweets, halwa and eggless cakes to order.', targetAudience: 'Families and office teams in Madurai',
      marketingGoals: ['Get more enquiries'], businessLocation: 'K K Nagar, Madurai 625020', businessType: 'Both', reachAreas: ['neighbourhood', 'city'],
      pricePositioning: 'premium', keyDifferentiator: 'Pure ghee sweets made fresh every morning in small batches.', contentLanguage: 'tamil_english_mix'
    }
  };
  const products = [
    { name: 'Ghee mysore pak', type: 'product', price: 640, description: 'Soft ghee mysore pak, sold by the half kilo.' },
    { name: 'Badam halwa', type: 'product', priceNote: 'From Rs 380 for 250 g', description: 'Almond halwa slow cooked in ghee.' },
    { name: 'Eggless celebration cake', type: 'product', price: 950, description: 'Made to order for birthdays, one day notice.' },
    { name: 'Office sweet boxes', type: 'service', description: 'Festival sweet boxes for office teams, packed and delivered.' }
  ];
  return { user, products };
}

async function main(argv = [], deps = {}) {
  const env = deps.env || process.env;
  const out = deps.log || ((...a) => console.log(...a));
  const err = deps.err || ((...a) => console.error(...a));
  if (env.I_APPROVED_ONE_PLAN_RUN !== 'yes') {
    err('Refusing to run: this makes one real, paid planner call (about USD 0.19, at most about USD 0.37). Start it with I_APPROVED_ONE_PLAN_RUN=yes');
    return 2;
  }
  if (!env.OPENAI_API_KEY) { err('OPENAI_API_KEY is not set for this command: no call was made.'); return 3; }

  const costs = require('../config/apiCosts');
  const { PLAN_MAX_TOKENS } = require('../config/blueprint');
  const { inputFromProfile } = require('../services/plan/profileInput');
  const { normaliseInput } = require('../services/blueprint/input');
  const { typedFacts, verifyFacts, evaluateStop } = require('../services/blueprint/discovery');
  const { buildBlueprint } = require('../services/blueprint/pipeline');
  const textModel = deps.model || require('../services/openAI').textModelFor('');

  const { user, products } = sampleAccount();
  const n = normaliseInput(inputFromProfile(user, { products }), { allowGuided: true });
  if (!n.ok) { err(`The sample input did not pass the input check (${Object.keys(n.errors).join(', ')}). No call was made.`); return 4; }
  const input = n.input;
  const raw = typedFacts(input).map((f, i) => ({ id: `F${i + 1}`, tag: 'verified', subject: null, ...f }));
  const { facts } = verifyFacts(raw, new Map(), input);
  const sheet = { version: 1, client: { name: input.businessName, website: '', instagram: '', city: input.city || '' }, facts, unverified: [], assets: { logo: null, colours: [] }, missing: ['logo'], basis: 'limited', stop: null, warnings: [] };
  Object.assign(sheet, evaluateStop(sheet, input, { websiteRead: false, instagramRead: false }));
  if (sheet.stop) { err('The sample would stop before the planner. No call was made.'); return 4; }

  const T = costs.TOKENS.blueprint_plan;
  out(`About to run the planner once with the real model ${textModel}: estimated USD ${costs.ACTION_USD.blueprint.toFixed(3)} a call (${T.in} in, ${T.out} out), at most ${MAX_CALLS} calls. Answer budget ${PLAN_MAX_TOKENS} tokens.`);
  out(`Input: ${input.products.length} products, place "${input.city}", ${facts.length} typed facts.`);

  let calls = 0;
  const usage = [];
  const real = deps.llm || ((prompt, opts) => require('../services/openAI').callTextLLM(prompt, opts));
  const once = async (prompt, opts) => {
    calls += 1;
    if (calls > MAX_CALLS) throw new Error('CALL LIMIT REACHED');
    return real(prompt, { ...opts, noFallback: true, onUsage: (u) => usage.push(u) });
  };

  let built;
  try {
    built = await buildBlueprint({ input, sheet, mode: 'auto', now: Date.now(), sources: [] }, { callLLM: once, parseJSON: (t) => JSON.parse(t) });
  } catch (e) {
    err(`The planner did not return a usable plan after ${calls} call${calls === 1 ? '' : 's'} (${String(e && e.message).slice(0, 80)}). Send this output back.`);
    return 5;
  }
  const p = built.result.plan;
  const flags = built.qa.flags || [];
  const tokensIn = usage.reduce((a, u) => a + (Number(u.prompt_tokens) || 0), 0);
  const tokensOut = usage.reduce((a, u) => a + (Number(u.completion_tokens) || 0), 0);
  const usd = (tokensIn * costs.PROVIDER_RATES.gpt4o_input_per_mtok + tokensOut * costs.PROVIDER_RATES.gpt4o_output_per_mtok) / 1e6;

  out(`Calls: ${calls}. QA passed: ${built.qa.passed}. Answer cut and repaired: ${flags.some((f) => f.rule === 'plan_answer_cut') ? 'yes' : 'no'}.`);
  out(`Measured tokens: ${tokensIn} in, ${tokensOut} out (estimate ${T.in} and ${T.out} a call). Measured cost: USD ${usd.toFixed(4)}.`);
  if (tokensOut > T.out * calls) out(`NOTE: the answer used more output tokens than the estimate. Raise TOKENS.blueprint_plan.out in config/apiCosts.js to about ${Math.ceil(tokensOut / calls / 100) * 100}.`);
  const named = input.products.filter((x) => JSON.stringify(p).toLowerCase().includes(x.name.toLowerCase())).map((x) => x.name);
  out(`Products named in the plan: ${named.length ? named.join(', ') : 'none'}.`);
  out(`Offline (${p.offline.length}):`);
  p.offline.forEach((o) => out(`  ${o.channel} [${o.spend}]: ${o.reason.text}${o.youDo.length ? ` You do: ${o.youDo.map((y) => y.text).join(' ')}` : ''}`));
  out(`Numbers to watch (${p.metrics.length}):`);
  p.metrics.forEach((m) => out(`  ${m.name} (${m.where})${m.why ? `: ${m.why.text}` : ''}${m.start ? ` Start: ${m.start.text}` : ''}${m.auto ? ' [added by code]' : ''}`));
  out(`Mix: ${p.mix.channels.map((r) => `${r.channel} ${r.mode}${r.organicPct === null ? '' : ` ${r.organicPct}/${r.paidPct}`}`).join('; ')}.`);
  out(`Removed by the checks: ${flags.filter((f) => f.rule === 'removed_plan_items' || f.level === 'block').map((f) => f.detail || f.rule).join(' | ') || 'nothing'}.`);

  const result = { model: textModel, calls, qaPassed: built.qa.passed, flags, tokens: { in: tokensIn, out: tokensOut }, usd: Math.round(usd * 1e4) / 1e4, estimateUsdPerCall: costs.ACTION_USD.blueprint, productsNamed: named, plan: p };
  const file = path.join(os.tmpdir(), `plan-additions-real-proof-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  out(`Saved the result (the sample plan, counts and cost; no key): ${file}`);
  out(`Done. ${calls} call${calls === 1 ? '' : 's'} made.`);
  return 0;
}

module.exports = { main, sampleAccount, MAX_CALLS };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('The proof stopped:', String(e && e.message).slice(0, 80)); process.exit(1); });
}
