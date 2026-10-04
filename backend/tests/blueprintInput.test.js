'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseInput, normaliseWebsite, normaliseInstagram, emailKey, businessKeysOf } = require('../services/blueprint/input');

const base = { businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries' };
const png = (bytes) => `data:image/png;base64,${Buffer.alloc(bytes, 1).toString('base64')}`;

test('valid minimal form', () => {
  const r = normaliseInput(base);
  assert.equal(r.ok, true);
  assert.equal(r.input.websiteUrl, 'https://sweetco.in/');
  assert.equal(r.input.websiteHost, 'sweetco.in');
  assert.equal(r.mode, 'auto');
});

test('input has only the defined fields', () => {
  const r = normaliseInput({ ...base, evil: 'x' });
  assert.deepEqual(Object.keys(r.input).sort(), ['businessName', 'websiteUrl', 'websiteHost', 'instagramHandle', 'instagramUrl', 'whatYouSell', 'whoItsFor', 'goal', 'city', 'competitors', 'offers', 'colours', 'logoUrl'].sort());
});

test('website normalisation', () => {
  assert.equal(normaliseWebsite('Example.com/Shop/').url, 'https://example.com/Shop');
  assert.equal(normaliseWebsite('https://www.Foo.in').host, 'foo.in');
  for (const bad of ['http://localhost', '10.0.0.1', 'exa mple.com', 'https://user:pw@example.com', 'https://example.com:8080', 'javascript:alert(1)']) {
    assert.equal(normaliseWebsite(bad).error, true, bad);
  }
});

test('instagram normalisation', () => {
  assert.equal(normaliseInstagram('@Foo.Bar').handle, 'foo.bar');
  assert.equal(normaliseInstagram('https://www.instagram.com/foo.bar/?hl=en').handle, 'foo.bar');
  assert.equal(normaliseInstagram('instagram.com/p/abc').error, true);
  assert.equal(normaliseInstagram('a b').error, true);
});

test('website or instagram is required; instagram alone is valid', () => {
  const { website, ...rest } = base;
  const r = normaliseInput(rest);
  assert.equal(r.ok, false);
  assert.equal(r.errors.website, 'Enter your website address or your Instagram page, or both.');
  assert.equal(normaliseInput({ ...rest, instagram: '@sweetco' }).ok, true);
});

test('required text fields and goal', () => {
  assert.ok(normaliseInput({ ...base, whatYouSell: '123456789' }).errors.whatYouSell);
  assert.ok(normaliseInput({ ...base, goal: 'fame' }).errors.goal);
});

test('competitors', () => {
  const four = [1, 2, 3, 4].map((i) => ({ name: `C${i}`, url: `c${i}.com` }));
  assert.equal(normaliseInput({ ...base, competitors: four }).input.competitors.length, 3);
  assert.ok(normaliseInput({ ...base, competitors: [{ name: 'X', url: 'http://localhost' }] }).errors.competitors);
  assert.equal(normaliseInput({ ...base, competitors: [{ name: 'Name Only' }] }).input.competitors[0].url, '');
});

test('offers', () => {
  const four = [1, 2, 3, 4].map((i) => ({ name: `O${i}`, price: '1' }));
  assert.equal(normaliseInput({ ...base, offers: four }).input.offers.length, 3);
  assert.equal(normaliseInput({ ...base, offers: [{ name: 'Plan', price: '₹499 per month' }] }).input.offers[0].price, '₹499 per month');
  assert.ok(normaliseInput({ ...base, offers: [{ price: '₹5' }] }).errors.offers);
});

test('colours', () => {
  const r = normaliseInput({ ...base, colours: ['#ABC', 'red', '#112233', '#445566', '#778899'] });
  assert.deepEqual(r.input.colours, ['#aabbcc', '#112233', '#445566']);
});

test('logo', () => {
  assert.ok(normaliseInput({ ...base, logoUrl: 'https://x.com/logo.svg' }).errors.logo);
  const ok = normaliseInput({ ...base, logoDataUrl: png(100) });
  assert.equal(ok.ok, true);
  assert.ok(ok.logoDataUrl.startsWith('data:image/png'));
  assert.equal(ok.input.logoUrl, '');
  assert.ok(normaliseInput({ ...base, logoDataUrl: 'data:image/gif;base64,AAAA' }).errors.logo);
  assert.ok(normaliseInput({ ...base, logoDataUrl: png(2 * 1024 * 1024 + 10) }).errors.logo);
});

test('guided mode needs allowGuided', () => {
  assert.equal(normaliseInput({ ...base, mode: 'guided' }).mode, 'auto');
  assert.equal(normaliseInput({ ...base, mode: 'guided' }, { allowGuided: true }).mode, 'guided');
});

test('email and business keys', () => {
  assert.equal(emailKey('Dinesh.K+blue@Gmail.com'), 'dineshk@gmail.com');
  assert.equal(emailKey('x@googlemail.com'), 'x@gmail.com');
  assert.equal(emailKey('A.B+c@Corp.in'), 'a.b@corp.in');
  assert.deepEqual(businessKeysOf({ websiteHost: 'sweetco.in', instagramHandle: 'sweetco' }), ['host:sweetco.in', 'ig:sweetco']);
});
