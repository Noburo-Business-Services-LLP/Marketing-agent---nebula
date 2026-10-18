const test = require('node:test');
const assert = require('node:assert');
const costs = require('../config/apiCosts');
const spend = require('../services/spendGuard');

test('the transcription cost is derived from the Whisper rate per minute, never hard-coded', () => {
  assert.strictEqual(costs.PROVIDER_RATES.whisper_per_minute, 0.006);
  assert.strictEqual(costs.STUDIO_TRANSCRIBE_BLOCK_SECONDS, 6);
  assert.ok(Math.abs(costs.ACTION_USD.studio_transcription - (0.006 * 6) / 60) < 1e-12);
});

test('transcription is an internal cost: never charged in Quarks, listed for the units text', () => {
  assert.strictEqual(costs.QUARK_COSTS.studio_transcription, 0);
  assert.ok(costs.ACTION_UNITS.studio_transcription);
});

test('transcription has its own staff switch and daily ceiling accounting', async () => {
  assert.strictEqual(spend.providerOf('studio_transcription'), 'studio_transcription');
  assert.ok(spend.PROVIDERS.includes('studio_transcription'));
  assert.strictEqual(spend.LABELS.studio_transcription, 'Subtitle timing');
  const incs = [];
  const Spend = () => ({ findOne: () => ({ lean: async () => null }), findOneAndUpdate: async (f, u) => { incs.push(u.$inc.totalUsd); return { totalUsd: 1, alerted100: true, alerted70: true }; } });
  const g = spend.createSpendGuard({ Spend, Switch: () => ({ find: () => ({ lean: async () => [] }) }), alert: async () => {}, env: {}, now: () => new Date('2026-10-18T00:00:00Z') });
  await g.record('studio_transcription', 5);
  assert.ok(Math.abs(incs[0] - costs.ACTION_USD.studio_transcription * 5) < 1e-12);
});

test('estimated units are the video seconds rounded UP to the next 6 seconds', () => {
  const { transcriptionUnits } = require('../services/studioVideoFinish');
  assert.deepStrictEqual([0.2, 6, 6.01, 10, 30, 59.9].map(transcriptionUnits), [1, 1, 2, 2, 5, 10]);
  assert.strictEqual(transcriptionUnits(NaN), 1);
});
