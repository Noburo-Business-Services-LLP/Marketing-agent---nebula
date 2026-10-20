'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { summarise, sizeStages } = require('../scripts/doc-size-report');

test('summarise ranks fields by bytes and counts data URIs', () => {
  const out = summarise([
    { total: 1000, fields: [{ k: 'imageUrl', v: 900, d: true }, { k: 'caption', v: 50 }] },
    { total: 200, fields: [{ k: 'imageUrl', v: 100, d: false }, { k: 'caption', v: 60 }] }
  ]);
  assert.strictEqual(out.docs, 2);
  assert.strictEqual(out.avg, 600);
  assert.strictEqual(out.fields[0].field, 'imageUrl');
  assert.strictEqual(out.fields[0].bytes, 1000);
  assert.strictEqual(out.fields[0].max, 900);
  assert.strictEqual(out.fields[0].dataUris, 1);
  assert.ok(Math.abs(out.fields[0].share - 1000 / 1200) < 1e-9);
});

test('summarise of nothing is empty', () => {
  assert.deepStrictEqual(summarise([]), { docs: 0, avg: 0, total: 0, fields: [] });
});

test('the size pipeline only projects (no $match, $group or write stage)', () => {
  const stages = sizeStages();
  assert.ok(stages.every((s) => Object.keys(s).length === 1 && Object.keys(s)[0] === '$project'));
});
