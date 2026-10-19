import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_HEADER, PAGE_HEADER_CLASSES } from '../utils/pageHeader.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('components/pageHeader.css');
const tsx = read('components/PageHeader.tsx');

/** The declarations of the first rule for `selector` in the given block of CSS. */
const rule = (src, selector) => {
  const at = src.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return src.slice(at, src.indexOf('}', at));
};
const phone = css.slice(css.indexOf(`@media (max-width: ${PAGE_HEADER.phoneBreakpointPx}px)`));

test('the style sheet defines every class the header uses', () => {
  for (const c of PAGE_HEADER_CLASSES) {
    assert.ok(css.includes(`.${c} {`) || css.includes(`.${c},`), `.${c} in pageHeader.css`);
    assert.ok(tsx.includes(c), `${c} in PageHeader.tsx`);
  }
});

test('the title is the serif display at one size scale: 32 px, 26 px on a phone', () => {
  const t = rule(css, '.nb-page-title');
  assert.match(t, /font-family: 'Playfair Display'/);
  assert.match(t, new RegExp(`font-size: ${PAGE_HEADER.titleDesktopPx}px`));
  assert.match(t, new RegExp(`line-height: ${PAGE_HEADER.titleLineHeight}`));
  assert.match(t, new RegExp(`font-weight: ${PAGE_HEADER.titleWeight}`));
  assert.ok(phone.length > 0, 'a phone rule exists');
  assert.match(rule(phone, '.nb-page-title'), new RegExp(`font-size: ${PAGE_HEADER.titlePhonePx}px`));
});

test('eyebrow, description, emphasis and spacing follow the spec', () => {
  const e = rule(css, '.nb-page-eyebrow');
  assert.match(e, new RegExp(`font-size: ${PAGE_HEADER.eyebrowPx}px`));
  assert.match(e, /text-transform: uppercase/);
  const d = rule(css, '.nb-page-desc');
  assert.match(d, new RegExp(`font-size: ${PAGE_HEADER.descriptionPx}px`));
  assert.match(d, new RegExp(`max-width: ${PAGE_HEADER.descriptionMaxWidthPx}px`));
  assert.match(d, /color: var\(--gv-text-secondary\)/);
  assert.match(css, new RegExp(`\\.nb-page-title em, \\.nb-page-em \\{ font-style: italic; font-weight: inherit; color: ${PAGE_HEADER.emphasisColour}`));
  const h = rule(css, '.nb-page-head');
  assert.match(h, new RegExp(`margin: 0 0 ${PAGE_HEADER.gapBelowPx}px`), 'no top margin, the spec gap below');
  assert.match(rule(phone, '.nb-page-head'), new RegExp(`margin-bottom: ${PAGE_HEADER.gapBelowPhonePx}px`));
});

test('the component has the small API: eyebrow, title, emphasis, description, actions', () => {
  for (const p of ['eyebrow?:', 'title:', 'emphasis?:', 'description?:', 'actions?:', 'id?:', 'titleId?:', 'dataTour?:']) {
    assert.ok(tsx.includes(p), `prop ${p}`);
  }
  assert.match(tsx, /export const PageEmphasis/);
  assert.match(tsx, /import '\.\/pageHeader\.css'/);
  // No colour or size utility classes inside the component: the style sheet is the one source.
  assert.doesNotMatch(tsx, /text-\[\d+px\]/);
});
