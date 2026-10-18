import test from 'node:test';
import assert from 'node:assert/strict';
import { groupHasPath } from '../utils/navMenu.ts';

test('the folded group opens on its own pages and not on others', () => {
  const paths = ['/blueprint', '/brand-assets', '/connect-socials', '/ai-memory', '/idea-inbox', '/upload'];
  assert.equal(groupHasPath('/blueprint', paths), true);
  assert.equal(groupHasPath('/blueprint/new', paths), true);
  assert.equal(groupHasPath('/upload', paths), true);
  assert.equal(groupHasPath('/dashboard', paths), false);
  assert.equal(groupHasPath('/reels/hero', paths), false);
  assert.equal(groupHasPath('/upload-extra', paths), false);
});

import { showsCompetitorsEntry } from '../utils/navMenu.ts';

const acct = (tier, extra = {}) => ({ plan: { tier }, ...extra });

test('Competitors entry: shown to every paid plan so the add-on can be found', () => {
  for (const tier of ['starter', 'professional', 'agency']) {
    assert.equal(showsCompetitorsEntry(acct(tier), false), true, tier);
  }
  // A managed account has no tier on the app side.
  assert.equal(showsCompetitorsEntry(acct(null), false), true);
});

test('Competitors entry: hidden for free accounts and signed-out', () => {
  assert.equal(showsCompetitorsEntry(acct('free'), false), false);
  assert.equal(showsCompetitorsEntry(null, false), false);
  assert.equal(showsCompetitorsEntry(undefined, false), false);
});

test('Competitors entry: never in staff-only navigation', () => {
  assert.equal(showsCompetitorsEntry(acct('agency', { staffRole: 'owner' }), false), false);
  assert.equal(showsCompetitorsEntry(acct(null, { isCsm: true }), false), false);
});

test('Competitors entry: inside an agency client, or a client opened by staff with a return pass', () => {
  assert.equal(showsCompetitorsEntry(acct('agency', { actingAgency: { id: 'a' } }), true), true);
  assert.equal(showsCompetitorsEntry(acct(null, { isCsm: true }), true), true);
  assert.equal(showsCompetitorsEntry(acct('free', { actingAgency: { id: 'a' } }), true), false);
});
