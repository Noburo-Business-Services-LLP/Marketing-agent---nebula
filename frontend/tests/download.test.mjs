import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadableUrl, fileSafeName } from '../utils/download.ts';

test('a hosted picture link becomes a download link with a clean file name', () => {
  const u = 'https://res.cloudinary.com/demo/image/upload/v1791/nebula-campaign-posts/abc.jpg';
  assert.equal(downloadableUrl(u, 'Diwali Offer: 30% off!'), 'https://res.cloudinary.com/demo/image/upload/fl_attachment:diwali-offer-30-off/v1791/nebula-campaign-posts/abc.jpg');
});

test('other links are left alone, and names fall back when nothing usable is left', () => {
  assert.equal(downloadableUrl('https://example.com/a.png', 'x'), 'https://example.com/a.png');
  assert.equal(fileSafeName('தீபாவளி'), 'post');
  assert.equal(fileSafeName('  Hello   World  '), 'hello-world');
});
