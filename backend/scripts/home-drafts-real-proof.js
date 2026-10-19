/**
 * ONE owner-approved real run of the Home drafts pipeline (the writer and the decency check), in Tamil and Hindi.
 * About USD 0.13, at most about USD 0.19 (both drafts needing their second try). Card: docs/superpowers/ops/home-drafts-real-proof.md
 *
 *   I_APPROVED_HOME_DRAFT_CALLS=yes OPENAI_API_KEY=... node scripts/home-drafts-real-proof.js
 *
 * What it does, with made-up sample data (no database, no .env, no wallet, nothing posted anywhere):
 *   1. a witty comment in Tamil and a post in response in Hindi, through the real service: the real prompts, the local
 *      filter, the real writing model and the real check model, with at most one more try each, exactly as customers get it;
 *   2. two deliberately unkind sample comments (one Tamil, one Hindi) sent to the check alone, which must answer "not decent".
 * It prints each draft in full (so the owner can judge it), the outcome and rule codes, the check's answers, and the number
 * of calls. At most 10 model calls in total; an 11th is blocked. The key comes only from this one command (the card reads
 * it at a hidden prompt) and is never printed. It refuses to run without I_APPROVED_HOME_DRAFT_CALLS=yes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_CALLS = 10;
const C1 = '6c0000000000000000000001';
const U1 = '6d0000000000000000000001';
const UNKIND = [
  { language: 'tamil', comment: 'இவங்க கேக் ரொம்ப கேவலம், உண்மையான சுவைக்கு எங்க கடைக்கு வாங்க.' },
  { language: 'hindi', comment: 'इनका केक बकवास है, असली स्वाद के लिए हमारी दुकान पर आइए।' }
];

function sampleWorld(now) {
  const competitor = { _id: C1, userId: U1, name: 'Sample Rival Sweets', socialHandles: { instagram: 'sample_rival_sweets' }, isActive: true, handleStatus: 'confirmed', createdAt: new Date(now - 90 * 864e5) };
  const snapshot = {
    userId: U1, competitorId: C1, weekStart: '2026-10-19', ok: true,
    posts: [
      { at: new Date(now - 5 * 36e5), type: 'video', likes: 420, comments: 31, url: 'https://www.instagram.com/p/SampleReel1/' },
      { at: new Date(now - 30 * 36e5), type: 'image', likes: 120, comments: 4, url: 'https://www.instagram.com/p/SamplePhoto2/' }
    ],
    topPost: { url: 'https://www.instagram.com/p/SampleReel1/', likes: 420, comments: 31, type: 'Video', caption: 'Sample Rival Sweets: our new ghee mysore pak and badam halwa for the festive week' },
    hashtags: ['sweets', 'festive']
  };
  const user = {
    _id: U1, plan: { tier: 'professional', addons: ['competitors'] },
    businessProfile: { name: 'Anu Sweets and Bakes', industry: 'Sweet shop and home bakery', description: 'Family sweet shop making ghee sweets, halwa and eggless cakes with care.', keyDifferentiator: 'Pure ghee, made fresh every morning', heroProduct: 'Ghee mysore pak', businessLocation: 'Madurai', brandVoice: ['Warm', 'Friendly'], contentLanguage: 'tamil' }
  };
  return { competitor, snapshot, user, ref: `${C1}.p-SampleReel1` };
}

async function main(argv = [], deps = {}) {
  const env = deps.env || process.env;
  const out = deps.log || ((...a) => console.log(...a));
  const err = deps.err || ((...a) => console.error(...a));
  if (env.I_APPROVED_HOME_DRAFT_CALLS !== 'yes') {
    err('Refusing to run: this makes real, paid model calls (about USD 0.13, at most about USD 0.19). Start it with I_APPROVED_HOME_DRAFT_CALLS=yes');
    return 2;
  }
  if (!env.OPENAI_API_KEY) { err('OPENAI_API_KEY is not set for this command: no call was made.'); return 3; }

  const caps = require('../config/homeDrafts');
  const costs = require('../config/apiCosts');
  const { createHomeDrafts, checkModel } = require('../services/homeDrafts/service');
  const { buildCheckPrompt } = require('../services/homeDrafts/prompt');
  const { parseCheck } = require('../services/homeDrafts/parse');
  const { createFakeDraftModel } = require('../tests/helpers/fakeHomeDraftDb');

  let calls = 0;
  const real = deps.llm || ((prompt, opts) => require('../services/openAI').callTextLLM(prompt, opts));
  const once = async (prompt, opts) => {
    calls += 1;
    if (calls > MAX_CALLS) throw new Error('CALL LIMIT REACHED');
    return real(prompt, opts);
  };
  const textModelFor = (language) => require('../services/openAI').textModelFor(language);
  const write = ({ system, user, language }) => once(user, { systemMessage: system, jsonMode: true, model: textModelFor(language), noFallback: true, maxTokens: caps.WRITE_MAX_TOKENS, timeout: caps.CALL_TIMEOUT_MS });
  const check = ({ system, user }) => once(user, { systemMessage: system, jsonMode: true, model: checkModel(env), noFallback: true, maxTokens: caps.CHECK_MAX_TOKENS, timeout: caps.CALL_TIMEOUT_MS });

  const now = Date.now();
  const w = sampleWorld(now);
  const estimate = costs.ACTION_USD.home_witty_comment + costs.ACTION_USD.home_response_post + UNKIND.length * costs.regionalCost(costs.TOKENS.decency_check);
  out(`About to run the drafts pipeline with real models: estimated USD ${estimate.toFixed(3)}, at most ${MAX_CALLS} calls. Writer: ${textModelFor('tamil')} for Tamil and Hindi. Check: ${checkModel(env)}.`);

  const service = createHomeDrafts({
    Draft: (() => { const M = createFakeDraftModel(); return () => M; })(),
    competitorsFor: async () => [w.competitor],
    snapshotsFor: async () => [w.snapshot],
    pillarsFor: async () => ['Fresh ghee sweets', 'Behind the counter'],
    productsFor: async () => ['Ghee mysore pak', 'Badam halwa'],
    settle: async () => null,
    spend: async () => ({ success: true, payerId: U1 }),
    refundTo: async () => ({ ok: true, payerId: U1 }),
    guard: async () => ({ ok: true }),
    alert: () => {},
    write, check,
    env: { [caps.SWITCH_ENV]: 'on' },
    now: () => new Date(now)
  });

  const result = { estimatedUsd: Math.round(estimate * 1e4) / 1e4, writer: textModelFor('tamil'), checker: checkModel(env), runs: [], unkind: [], calls: 0 };
  const runs = [
    { kind: 'witty_comment', language: 'tamil', tone: 'witty' },
    { kind: 'response_post', language: 'hindi', tone: 'friendly' }
  ];
  let n = 0;
  for (const r of runs) {
    const before = calls;
    const res = await service.make(w.user, r.kind, { ref: w.ref, key: `proof-${now.toString(36)}-${++n}`, tone: r.tone, language: r.language });
    const row = { ...r, status: res.status, message: res.body.message || '', draft: res.body.draft || null, calls: calls - before };
    result.runs.push(row);
    out(`\n${r.kind} in ${r.language} (${r.tone}): ${res.status === 200 ? 'shown' : `not shown (${res.status})`}, ${row.calls} calls.`);
    if (res.body.draft) for (const [k, v] of Object.entries(res.body.draft)) out(`  ${k}: ${v}`);
    else out(`  message: ${row.message}`);
  }
  out('\nThe check on two deliberately unkind comments (it must say not decent):');
  for (const u of UNKIND) {
    let verdict;
    try { verdict = parseCheck(await check(buildCheckPrompt('witty_comment', { comment: u.comment }))); } catch (e) { verdict = { valid: false, decent: false, reasons: [], error: String(e && e.message).slice(0, 60) }; }
    result.unkind.push({ language: u.language, valid: verdict.valid, decent: verdict.decent, reasons: verdict.reasons || [] });
    out(`  ${u.language}: ${!verdict.valid ? 'no readable answer (counts as not decent)' : verdict.decent ? 'DECENT (this would be a problem)' : `not decent (${(verdict.reasons || []).join('; ')})`}`);
  }
  result.calls = calls;
  const file = path.join(os.tmpdir(), `home-drafts-real-proof-${now}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  out(`\nCalls made: ${calls}. Saved the result (drafts, outcomes and the check's answers; no key): ${file}`);
  const good = result.unkind.every((u) => !u.decent);
  out(good ? 'Done. The check refused both unkind samples.' : 'Done. WARNING: the check passed an unkind sample. Do not switch the feature on.');
  return good ? 0 : 5;
}

module.exports = { main, MAX_CALLS, UNKIND, sampleWorld };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('The proof stopped:', String(e && e.message).slice(0, 80)); process.exit(1); });
}
