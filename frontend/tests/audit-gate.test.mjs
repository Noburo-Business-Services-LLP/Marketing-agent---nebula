import test from 'node:test';
import assert from 'node:assert/strict';
import { rowStatus, gateVerdict, missingWidths, parseSince } from '../scripts/visual-audit/gate-logic.mjs';

const spec = { label: 'settings', path: '/settings' };
const good = { finalHash: '#/settings', checked: 12, at: '2026-10-04T10:00:00.000Z' };

test('a rendered route with checked elements is ok', () => {
  assert.equal(rowStatus(spec, good), 'ok');
});

test('a route that checked 0 elements is EMPTY, never a pass', () => {
  assert.equal(rowStatus(spec, { ...good, checked: 0 }), 'EMPTY');
  assert.equal(rowStatus(spec, { ...good, checked: undefined }), 'EMPTY');
  const rows = [{ scope: 'in', status: 'EMPTY', pass: false }];
  assert.equal(gateVerdict(rows, [1280, 375]).gate, 'FAIL');
});

test('missing, error, blank, redirect and tab-not-found keep their status', () => {
  assert.equal(rowStatus(spec, undefined), 'MISSING');
  assert.equal(rowStatus(spec, { ...good, error: 'boom' }), 'ERROR');
  assert.equal(rowStatus(spec, { ...good, blank: true }), 'BLANK');
  assert.equal(rowStatus(spec, { ...good, finalHash: '#/dashboard' }), 'REDIRECT');
  assert.equal(rowStatus({ ...spec, click: 'Billing' }, { ...good, clicked: false }), 'TAB-NOT-FOUND');
});

test('results older than --since are STALE', () => {
  const since = parseSince('2026-10-04T11:00:00Z');
  assert.equal(rowStatus(spec, good, { since }), 'STALE');
  assert.equal(rowStatus(spec, { ...good, at: '2026-10-04T12:00:00Z' }, { since }), 'ok');
  assert.equal(rowStatus(spec, { ...good, at: undefined }, { since }), 'STALE');
  assert.equal(parseSince(undefined), null);
  assert.equal(parseSince('1700000000000'), 1700000000000);
  assert.throws(() => parseSince('not a date'));
});

test('a run narrowed to one width is PARTIAL and exits non-zero even when everything passes', () => {
  const rows = [{ scope: 'in', status: 'ok', pass: true }];
  assert.deepEqual(missingWidths([1280]), [375]);
  const v = gateVerdict(rows, [1280]);
  assert.equal(v.gate, 'PARTIAL (widths: 1280)');
  assert.equal(v.exitCode, 1);
  assert.deepEqual(gateVerdict(rows, [1280, 375]), { gate: 'PASS', exitCode: 0 });
});

test('other-session routes do not affect the gate', () => {
  const rows = [{ scope: 'in', status: 'ok', pass: true }, { scope: 'other', status: 'MISSING', pass: false }];
  assert.equal(gateVerdict(rows, [1280, 375]).gate, 'PASS');
});

test('a static audit page (spec.url) is matched by its URL path, not the hash', () => {
  const fx = { label: 'layer-fixtures', url: '/__layer-fixtures' };
  assert.equal(rowStatus(fx, { url: 'http://127.0.0.1:3100/__layer-fixtures?audit=fixture', checked: 40 }), 'ok');
  assert.equal(rowStatus(fx, { url: 'http://127.0.0.1:3100/?audit=normal#/dashboard', checked: 40 }), 'REDIRECT');
  assert.equal(rowStatus(fx, { url: 'http://127.0.0.1:3100/__layer-fixtures', checked: 0 }), 'EMPTY');
});
