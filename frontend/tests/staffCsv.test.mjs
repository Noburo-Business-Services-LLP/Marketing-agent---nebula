import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv as rawCsv, csvCell } from '../utils/staffCsv.ts';
import { TIER_LABEL } from '../pages/staff/staffLabels.ts';
import { platformLabel } from '../utils/platforms.ts';

const toCsv = (rows) => rawCsv(rows, { tier: TIER_LABEL, platform: platformLabel });

const row = (o = {}) => ({ id: '1', name: 'Demo Sweets', email: 'a@example.test', tier: 'starter', paying: true, quarks: 120, platforms: ['x', 'gmb', 'linkedin'], csm: { id: 'c', name: 'Chitra' }, lastActiveAt: '2026-10-07T05:00:00.000Z', status: 'active', ...o });

test('a cell that starts with = + - @ is stored as text so a spreadsheet never runs it', () => {
  for (const evil of ['=HYPERLINK("http://bad.example","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1']) {
    const cell = csvCell(evil);
    assert.ok(cell.startsWith(`"'`), `${JSON.stringify(evil)} -> ${cell}`);
  }
});

test('ordinary text, numbers and quotes are written as before', () => {
  assert.equal(csvCell('Demo Sweets'), '"Demo Sweets"');
  assert.equal(csvCell(120), '"120"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell(null), '""');
});

test('a client called by a formula is neutralised in the whole file, and networks use plain names', () => {
  const csv = toCsv([row({ name: '=cmd|\' /C calc\'!A0' }), row()]);
  const lines = csv.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith(`"'=cmd`));
  assert.match(lines[2], /"X, Google Business, LinkedIn"/);
  assert.match(lines[0], /^"Name","Email","Plan","Paying","Quarks","Connected accounts","CSM","Last active","Status"$/);
});
