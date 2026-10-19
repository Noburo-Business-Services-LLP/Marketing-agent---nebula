import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../components/home/home.css'), 'utf8');

test('the Home greeting glow spans the whole scrolling area, not just the page column', () => {
  assert.ok(css.includes('main:has(> .nb-home) { container-type: inline-size;'), 'the area is a size container');
  assert.ok(/--nb-area-pad: 16px/.test(css) && /min-width: 768px\) \{ main:has\(> \.nb-home\) \{ --nb-area-pad: 32px; \}/.test(css), 'the area padding matches p-4 md:p-8 in Layout');
  assert.ok(css.includes('width: calc(100cqw + 2 * var(--nb-area-pad, 0px)); transform: translateX(-50%);'), 'the glow is as wide as the area');
  assert.ok(css.includes('overflow-x: hidden'), 'the page never scrolls sideways');
  const layout = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../components/Layout.tsx'), 'utf8');
  assert.ok(layout.includes('<main className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-8">'), 'Layout padding unchanged; update --nb-area-pad if it changes');
});
