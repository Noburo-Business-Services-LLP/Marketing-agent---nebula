const test = require('node:test');
const assert = require('node:assert');
const { safeUrl, isSafeUrl, safeUrlOrEmpty, isDangerousUrl } = require('../services/safeUrl');

test('http and https addresses pass unchanged; empty stays empty', () => {
  assert.strictEqual(safeUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
  assert.strictEqual(safeUrl('  http://example.com  '), 'http://example.com');
  assert.strictEqual(safeUrl(''), '');
  assert.strictEqual(safeUrl(null), '');
});

test('script, data, file and other schemes, credentials, spaces and long values are refused', () => {
  for (const v of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', 'https://user:pw@example.com', 'https://exa mple.com', 'https://example.com/\u0000', `https://example.com/${'a'.repeat(2100)}`, '<img src=x onerror=alert(1)>', 'example.com', 'ftp://example.com']) {
    assert.strictEqual(safeUrl(v), null, v);
    assert.strictEqual(safeUrlOrEmpty(v), '', v);
  }
  assert.strictEqual(safeUrl({ toString: () => 'https://x.com' }), null);
});

test('a website may be typed without https://; a picture may be a data URL only where allowed', () => {
  assert.strictEqual(safeUrl('example.com', { allowBareDomain: true }), 'example.com');
  assert.strictEqual(safeUrl('www.shop.co.in/about', { allowBareDomain: true }), 'www.shop.co.in/about');
  assert.strictEqual(safeUrl('javascript:alert(1)', { allowBareDomain: true }), null);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.strictEqual(safeUrl(png, { allowDataImage: true }), png);
  assert.strictEqual(safeUrl(png), null);
  assert.strictEqual(safeUrl('data:image/svg+xml;base64,PHN2Zz4=', { allowDataImage: true }), null);
  assert.strictEqual(safeUrl('data:text/html;base64,PHNjcmlwdD4=', { allowDataImage: true }), null);
  assert.ok(isSafeUrl('https://a.b'));
});

test('dangerous (400) versus merely not an address (stored as empty)', () => {
  for (const v of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', '<img src=x onerror=alert(1)>', 'https://u:p@x.com', '"onmouseover=alert(1)']) assert.ok(isDangerousUrl(v), v);
  for (const v of ['', 'example.com', 'https://example.com', 'not yet', 'N/A', 'localhost:3000']) assert.ok(!isDangerousUrl(v), v);
});

test('models store a refused address as empty: competitor, brand profile, user website, product picture, inbox link', () => {
  const Competitor = require('../models/Competitor');
  const c = new Competitor({ userId: '507f1f77bcf86cd799439011', name: 'Rival', website: 'javascript:alert(1)', posts: [{ platform: 'instagram', postUrl: 'javascript:alert(1)', imageUrl: '<img src=x onerror=alert(1)>' }], avatarUrl: 'data:text/html,x' });
  assert.strictEqual(c.website, '');
  assert.strictEqual(c.posts[0].postUrl, '');
  assert.strictEqual(c.posts[0].imageUrl, '');
  assert.strictEqual(c.avatarUrl, '');
  const ok = new Competitor({ userId: '507f1f77bcf86cd799439011', name: 'Rival', website: 'rival.in' });
  assert.strictEqual(ok.website, 'rival.in');
  const BrandProfile = require('../models/BrandProfile');
  const b = new BrandProfile({ websiteUrl: 'javascript:alert(1)' });
  assert.strictEqual(b.websiteUrl, '');
  assert.ok(b.validateSync() && b.validateSync().errors.websiteUrl, 'required: a refused address is never stored');
  const User = require('../models/User');
  const u = new User({ email: 'zz@x.test', businessProfile: { website: 'javascript:alert(1)' } });
  assert.strictEqual(u.businessProfile.website, '');
  const Product = require('../models/Product');
  assert.strictEqual(new Product({ imageUrl: 'javascript:alert(1)' }).imageUrl, '');
  assert.strictEqual(new Product({ imageUrl: 'data:image/png;base64,iVBORw0KGgo=' }).imageUrl, 'data:image/png;base64,iVBORw0KGgo=');
  const Msg = require('../models/SocialInboxMessage');
  assert.strictEqual(new Msg({ permalink: 'javascript:alert(1)' }).permalink, '');
});

test('updates go through the same setters (findByIdAndUpdate on the profile routes)', () => {
  const User = require('../models/User');
  const q = User.findByIdAndUpdate('507f1f77bcf86cd799439011', { businessProfile: { website: 'javascript:alert(1)', name: 'X' } });
  const cast = q._castUpdate(q.getUpdate());
  const site = (cast.$set && (cast.$set.businessProfile ? cast.$set.businessProfile.website : cast.$set['businessProfile.website'])) ?? (cast.businessProfile && cast.businessProfile.website);
  assert.strictEqual(site, '');
});

test('the profile routes answer 400 for a dangerous website', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  assert.strictEqual((src.match(/isDangerousUrl\(/g) || []).length, 2);
});
