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

test('the options sit in two full-width rows: Language and Platforms, then Aspect ratio, Logo and Look', () => {
  const src = read('pages/GravityCreate.tsx');
  const rows = src.indexOf('className="nb-opt-rows"');
  const r1 = src.indexOf('className="nb-opt-row" data-row="1"');
  const r2 = src.indexOf('className="nb-opt-row" data-row="2"');
  assert.ok(rows > 0 && rows < r1 && r1 < r2, 'a rows wrapper, then row 1, then row 2');
  const at = (label) => src.indexOf(`label="${label}"`, rows);
  assert.ok(r1 < at('Language') && at('Language') < at('Platforms') && at('Platforms') < r2, 'row 1: Language, Platforms');
  assert.ok(r2 < at('Aspect ratio') && at('Aspect ratio') < at('Logo') && at('Logo') < at('Look'), 'row 2: Aspect ratio, Logo, Look');
});

test('the options style sheet uses the page classes, not a :has() guess at the wrapper, and fills each row', () => {
  const css = read('components/createOptions.css');
  assert.doesNotMatch(css, /div:has\(> \.nb-opt-group\)/);
  assert.match(css, /\.nb-opt-rows \{ display: flex; flex-direction: column;/);
  assert.match(css, /\.nb-opt-row \{ display: flex; flex-wrap: wrap; align-items: stretch;/);
  assert.match(css, /\.nb-opt-group \{ --w: 2; flex: var\(--w\) 1 calc\(var\(--w\) \* 64px\); \}/, 'groups grow to fill the row');
  assert.match(css, /grid-auto-columns: minmax\(0, 1fr\)/, 'equal tiles across a group');
  assert.match(css, /@media \(max-width: 639px\) \{\n  \.nb-opt-group \{ flex-basis: 100%; \}/, 'a phone gives each group a full line');
});

test('option tiles are larger and their names are not shrunk to 10 px', () => {
  const tsx = read('components/CreateOptions.tsx');
  assert.match(tsx, /const TILE = 'relative flex h-\[88px\]/);
  assert.match(tsx, /const NAME = '[^']*text-\[12px\]/);
  assert.doesNotMatch(read('components/createOptions.css'), /font-size: 10px/);
  assert.match(tsx, /nb-opt-tiles nb-opt-platforms/);
});
