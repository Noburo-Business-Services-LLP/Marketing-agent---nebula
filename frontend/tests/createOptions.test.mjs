import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOGO_POSITION, logoPositionFor, stepChoice } from '../utils/logoChoice.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('a logo with no saved position goes to the top right', () => {
  assert.equal(DEFAULT_LOGO_POSITION, 'top-right');
  for (const v of [undefined, null, '', 'center', 'somewhere', 3]) assert.equal(logoPositionFor(v), 'top-right');
});

test('a saved position is always kept, bottom right included', () => {
  for (const v of ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']) {
    assert.equal(logoPositionFor(v), v);
  }
});

test('Create content starts on the default and reads each logo through the helper', () => {
  const src = read('pages/GravityCreate.tsx');
  assert.match(src, /useState<LogoGridPosition>\(DEFAULT_LOGO_POSITION\)/);
  assert.doesNotMatch(src, /'bottom-right'/);
  assert.match(src, /logoPositionFor\(a\.defaultPosition\)/);
  assert.match(src, /logoPositionFor\(primary\.defaultPosition\)/);
});

test('arrow keys move through a row of choices and wrap', () => {
  assert.equal(stepChoice(4, 0, 'ArrowRight'), 1);
  assert.equal(stepChoice(4, 3, 'ArrowRight'), 0);
  assert.equal(stepChoice(4, 0, 'ArrowLeft'), 3);
  assert.equal(stepChoice(4, 2, 'ArrowUp'), 1);
  assert.equal(stepChoice(4, 2, 'Home'), 0);
  assert.equal(stepChoice(4, 0, 'End'), 3);
  assert.equal(stepChoice(4, 1, 'Tab'), 1);
  assert.equal(stepChoice(0, 0, 'ArrowRight'), -1);
});

test('the options row keeps every choice and the data it sends', () => {
  const src = read('pages/GravityCreate.tsx');
  for (const k of ["'4:5'", "'1:1'", "'9:16'", "'16:9'"]) assert.ok(src.includes(k), `aspect ${k}`);
  for (const k of ['clean', 'balanced', 'rich']) assert.ok(src.includes(`'${k}'`), `look ${k}`);
  assert.match(src, /logoPosition: selectedLogo \? logoPosition : undefined/);
  assert.match(src, /density,/);
  assert.match(src, /aspectRatio: backendAspect/);
});
