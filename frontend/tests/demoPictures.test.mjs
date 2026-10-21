import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbSrc, avatarView } from '../utils/competitorsHome.ts';
import { stillFor } from '../utils/library.ts';

// The demo brand's pictures are drawn on the developer's computer (backend/scripts/demo-brand). They are accepted outside a
// production build only (import.meta.env.PROD), and nothing else that is not our own stored copy is ever loaded.
const THUMB = 'http://localhost:5000/demo-assets/zaya/competitors/kaya-veda-AbC123_-xyz.jpg';
const AVATAR = 'http://127.0.0.1:5000/demo-assets/zaya/competitors/kaya-veda-avatar.jpg';
const VIDEO = 'http://localhost:5000/demo-assets/zaya/videos/kumkumadi-glow-serum.mp4';

test('a local demo post picture and profile picture are accepted (not a production build)', () => {
  assert.equal(thumbSrc(THUMB), THUMB);
  assert.equal(avatarView('Kaya Veda', 'kayaveda.demo', AVATAR).src, AVATAR);
});

test('other links are still refused: other hosts, other folders, https look-alikes, Instagram links', () => {
  for (const bad of [
    'http://evil.example/demo-assets/zaya/competitors/a.jpg', 'http://localhost:5000/demo-assets/zaya/products/a.jpg', 'https://localhost:5000/demo-assets/zaya/competitors/a.jpg',
    'http://localhost:5000/demo-assets/zaya/competitors/../a.jpg', 'http://localhost:5000/demo-assets/zaya/competitors/a.png', 'https://www.instagram.com/p/abc/', '',
  ]) {
    assert.equal(thumbSrc(bad), null, bad);
    assert.equal(avatarView('X', 'x', bad).src, null, bad);
  }
});

test('a demo video has a poster of the same name; a hosted video still uses its frame; anything else has none', () => {
  assert.equal(stillFor(VIDEO), 'http://localhost:5000/demo-assets/zaya/videos/kumkumadi-glow-serum.jpg');
  assert.equal(stillFor('http://localhost:5000/demo-assets/zaya/videos/a.mov'), '');
  assert.equal(stillFor('http://evil.example/demo-assets/zaya/videos/a.mp4'), '');
  assert.match(stillFor('https://res.cloudinary.com/x/video/upload/v1/a.mp4'), /\.jpg$/);
});
