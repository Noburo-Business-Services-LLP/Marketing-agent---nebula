import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOUR_STEPS } from '../utils/tour.ts';

// Guard: a renamed or removed element must not silently break the tour. Every data-tour name a step points at
// has to appear as an attribute in the component sources.
const sources = ['components/Layout.tsx', 'components/ThisWeekCard.tsx', 'components/SetupCard.tsx', 'components/HelpMenu.tsx']
  .map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');

test('every tour target is an attribute in the sources', () => {
  for (const s of TOUR_STEPS) {
    const name = /data-tour="([^"]+)"/.exec(s.target)?.[1];
    assert.ok(name, `${s.id} has a data-tour selector`);
    // Layout assigns the nav names through a map ('nav-create'), the others as data-tour="name".
    const present = sources.includes(`data-tour="${name}"`) || sources.includes(`'${name}'`);
    assert.ok(present, `${s.id}: "${name}" is not in the sources`);
  }
});

test('the setup card, which the help menu scrolls to, carries its attribute', () => {
  assert.match(sources, /data-tour="setup"/);
});
