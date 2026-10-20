'use strict';
// Background readers of Campaign and Draft must select their fields (D104): a campaign averaged 1.62 MB on the dev
// database (pictures and stored provider answers), and every scheduler tick or sweep that reads whole documents pays it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FILES = ['campaignScheduler.js', 'campaignStatusSync.js', 'performanceTracker.js', 'notificationScheduler.js', 'staleDrafts.js', 'homeSummary.js',
  'performance/service.js', 'brandMemory/runner.js', 'snapshotScheduler.js', 'ayrshareProfileWatch.js', 'billingScheduler.js'];
// Reads that need the whole document on purpose, with the reason.
const ALLOWED = [
  { file: 'notificationScheduler.js', match: /Campaign\.findById\(campaignId\)/, why: 'one campaign by id, to send its reminder' }
];

/** Every `(m('X')|X).find|findOne(` call with the text of its chain up to the end of the statement. */
function findCalls(src) {
  const out = [];
  const re = /(?:\bm\('(?:Campaign|Draft)'\)|\b(?:Campaign|Draft))\.(find|findOne|findById)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0; let i = m.index; let end = src.length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') { depth--; if (depth < 0) { end = i; break; } }
      else if (ch === ';' && depth === 0) { end = i; break; }
    }
    out.push(src.slice(m.index, end));
  }
  return out;
}

test('the scanner finds a chain and sees its projection', () => {
  const calls = findCalls("const a = await Campaign.find({ s: 1 }).select('x').limit(2);\nconst b = await Draft.findOne({ _id }).lean();");
  assert.strictEqual(calls.length, 2);
  assert.ok(/\.select\(/.test(calls[0]));
  assert.ok(!/\.select\(/.test(calls[1]));
});

test('every Campaign/Draft read in the background services has a projection', () => {
  const missing = [];
  for (const f of FILES) {
    const p = path.join(__dirname, '..', 'services', f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const call of findCalls(src)) {
      if (/\.select\(/.test(call)) continue;
      if (ALLOWED.some((a) => a.file === f && a.match.test(call))) continue;
      missing.push(`${f}: ${call.split('\n')[0].slice(0, 120)}`);
    }
  }
  assert.deepStrictEqual(missing, [], `add a .select(...) to: \n${missing.join('\n')}`);
});

test('the scheduler and the status sync leave out the stored provider answers but keep what they read', () => {
  const sched = fs.readFileSync(path.join(__dirname, '..', 'services', 'campaignScheduler.js'), 'utf8');
  assert.match(sched, /SCHEDULER_PROJECTION = '-publishResult -lastPublishError'/);
  const sync = fs.readFileSync(path.join(__dirname, '..', 'services', 'campaignStatusSync.js'), 'utf8');
  const proj = /SYNC_PROJECTION = '([^']+)'/.exec(sync)[1].split(' ');
  assert.ok(proj.every((p) => p.startsWith('-')));
  assert.ok(!proj.includes('-publishResult'), 'retryCount and retryRequestedAt are read');
  assert.ok(proj.includes('-publishResult.error') && proj.includes('-publishResult.instagramFix') && proj.includes('-lastPublishError'));
});

test('the status sync passes its projection to the query', async () => {
  const { runCampaignStatusSyncOnce } = require('../services/campaignStatusSync');
  let selected = null;
  const Campaign = { find() { return { select(p) { selected = p; return this; }, sort() { return this; }, limit: async () => [] }; }, updateOne: async () => ({}) };
  await runCampaignStatusSyncOnce({ deps: { Campaign }, lease: { claim: async () => 'tok', release: async () => {} }, blockedIds: async () => [], log: { log() {}, warn() {}, error() {} } });
  assert.match(String(selected), /-publishResult\.error/);
});
