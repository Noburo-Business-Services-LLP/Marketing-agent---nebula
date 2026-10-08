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
