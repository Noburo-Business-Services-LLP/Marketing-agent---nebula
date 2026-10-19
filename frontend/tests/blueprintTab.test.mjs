import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintSummary } from '../utils/blueprintTab.ts';

const rows = [
  { id: 'a', status: 'completed' }, { id: 'b', status: 'processing' }, { id: 'c', status: 'awaiting_approval' }, { id: 'd', status: 'completed' },
];

test('status tiles count ready and waiting Blueprints and link to the first one', () => {
  const s = blueprintSummary(rows, { tier: 'starter', blueprintQuarks: 23, pdfQuarks: 30 });
  assert.equal(s.ready.status, '2 ready');
  assert.equal(s.ready.to, '/blueprint/a');
  assert.match(s.ready.line, /1 Blueprint being prepared/);
  assert.equal(s.waiting.status, '1 Blueprint');
  assert.equal(s.waiting.to, '/blueprint/c');
  assert.equal(s.price.status, '23 Quarks');
  assert.equal(s.pdf.status, '30 Quarks');
});

test('the free plan shows its first Blueprint as free; the PDF keeps its Quark price', () => {
  const s = blueprintSummary([], { tier: 'free', blueprintQuarks: 23, pdfQuarks: 30 });
  assert.equal(s.price.status, 'Free');
  assert.equal(s.pdf.status, '30 Quarks');
  assert.equal(s.ready.status, 'None yet');
  assert.equal(s.ready.to, '/blueprint/new');
  assert.equal(s.waiting.status, 'Nothing');
});

test('while the list loads nothing is claimed, and no price is typed into the page', () => {
  const s = blueprintSummary(null, {});
  assert.equal(s.ready.status, 'Checking');
  assert.equal(s.ready.state, 'unknown');
  assert.doesNotMatch(`${s.price.status} ${s.pdf.status}`, /\d/);
  for (const t of [s.intro, s.ready.line, s.waiting.line, s.price.line, s.pdf.line]) assert.doesNotMatch(t, /credit|trial|7 days|!|—/i);
});
