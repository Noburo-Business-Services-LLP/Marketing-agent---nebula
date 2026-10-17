const test = require('node:test');
const assert = require('node:assert');

// The text step throws: the draft made at the start must be marked failed, not left processing.
const openai = require('../services/openAI');
openai.callTextLLM = async () => { throw new Error('llm down'); };
const Draft = require('../models/Draft');
const saved = []; const updates = [];
Draft.prototype.save = async function save() { this._id = this._id || 'dr1'; saved.push(this.status); return this; };
Draft.updateOne = async (q, u) => { updates.push([q, u]); };
const { generateSingleCalendarItem } = require('../services/backgroundQueue');

test('a generation that throws leaves its draft failed, not processing', async () => {
  await assert.rejects(generateSingleCalendarItem({ userId: '507f1f77bcf86cd799439011', _id: null }, { day: 1, headline: 'x' }, 1), /llm down/);
  assert.deepStrictEqual(saved[0], 'processing');
  assert.strictEqual(updates.length, 1);
  assert.deepStrictEqual(updates[0][1], { $set: { status: 'failed' } });
});
