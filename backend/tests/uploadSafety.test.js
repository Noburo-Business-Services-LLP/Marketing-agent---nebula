const test = require('node:test');
const assert = require('node:assert');
const { sniffType, checkUpload, checkDataUrl, rejectUnsafeImage } = require('../services/uploadSafety');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const GIF = Buffer.from('GIF89a....');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42')]);
const PDF = Buffer.from('%PDF-1.7\n');
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const SVG2 = Buffer.from('﻿  <svg><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>');
const IMG_TAG = Buffer.from('<img src=x onerror=alert(1)>');
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

test('the first bytes name the type', () => {
  assert.deepStrictEqual([PNG, JPG, WEBP, GIF, MP4, PDF, SVG, SVG2, HTML, IMG_TAG].map(sniffType), ['png', 'jpeg', 'webp', 'gif', 'mp4', 'pdf', 'svg', 'svg', 'html', 'html']);
  assert.strictEqual(sniffType(Buffer.from('hello')), 'unknown');
});

test('SVG and HTML are refused by mime, by name and by content', () => {
  assert.strictEqual(checkUpload({ mime: 'image/svg+xml', buffer: PNG }).ok, false, 'mime');
  assert.strictEqual(checkUpload({ mime: 'image/png', name: 'logo.svg', buffer: PNG }).ok, false, 'name');
  assert.strictEqual(checkUpload({ mime: 'image/png', name: 'logo.png', buffer: SVG }).ok, false, 'content');
  assert.strictEqual(checkUpload({ mime: 'image/png', buffer: HTML }).ok, false);
  assert.strictEqual(checkUpload({ mime: 'text/html', buffer: JPG }).ok, false);
  assert.strictEqual(checkUpload({ mime: 'image/jpeg', name: 'x.html', buffer: JPG }).ok, false);
});

test('real pictures pass; a picture labelled with another picture type passes under the type of its bytes', () => {
  assert.deepStrictEqual(checkUpload({ mime: 'image/png', name: 'a.png', buffer: PNG }), { ok: true, type: 'png', mime: 'image/png' });
  assert.strictEqual(checkUpload({ mime: 'image/jpeg', name: 'a.JPG', buffer: JPG }).ok, true);
  assert.strictEqual(checkUpload({ mime: 'image/webp', buffer: WEBP }).ok, true);
  assert.strictEqual(checkUpload({ mime: 'image/gif', buffer: GIF }).ok, true);
  assert.strictEqual(checkUpload({ mime: 'image/jpeg', buffer: PNG }).type, 'png');
  assert.strictEqual(checkUpload({ mime: '', name: '', buffer: JPG }).ok, true);
});

test('per-route allow lists: a video route takes mp4, a picture route does not; PDF only where allowed', () => {
  assert.strictEqual(checkUpload({ mime: 'video/mp4', name: 'clip.mp4', buffer: MP4, allow: ['mp4', 'webm', 'png', 'jpeg', 'webp', 'gif'] }).ok, true);
  assert.strictEqual(checkUpload({ mime: 'video/mp4', buffer: MP4 }).ok, false);
  assert.strictEqual(checkUpload({ mime: 'application/pdf', buffer: PDF }).ok, false);
  assert.strictEqual(checkUpload({ mime: 'application/pdf', buffer: PDF, allow: ['pdf'] }).ok, true);
  assert.strictEqual(checkUpload({ mime: 'image/png', buffer: Buffer.from('hello') }).ok, false, 'unknown bytes');
});

test('pictures sent as text: data URLs and bare base64', () => {
  assert.strictEqual(checkDataUrl(dataUrl('image/png', PNG)).ok, true);
  assert.strictEqual(checkDataUrl(PNG.toString('base64')).ok, true);
  assert.strictEqual(checkDataUrl(dataUrl('image/svg+xml', SVG)).ok, false);
  assert.strictEqual(checkDataUrl(dataUrl('image/png', SVG)).ok, false);
  assert.strictEqual(checkDataUrl(`data:image/svg+xml,${encodeURIComponent('<svg onload=alert(1)>')}`).ok, false);
  assert.strictEqual(checkDataUrl(dataUrl('image/png', IMG_TAG)).ok, false);
});

test('middleware: refuses an SVG with a plain 400, lets real pictures, stored links and empty fields through', () => {
  const mw = rejectUnsafeImage('imageData');
  const run = (body) => { let status = 0; let out = null; let passed = false; mw({ body }, { status(c) { status = c; return this; }, json(b) { out = b; return this; } }, () => { passed = true; }); return { status, out, passed }; };
  const bad = run({ imageData: dataUrl('image/svg+xml', SVG) });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.out.message, /PNG, JPG, WebP or GIF/);
  assert.strictEqual(run({ imageData: dataUrl('image/png', PNG) }).passed, true);
  assert.strictEqual(run({ imageData: 'https://res.cloudinary.com/x/image/upload/a.png' }).passed, true);
  assert.strictEqual(run({}).passed, true);
  assert.strictEqual(run({ imageData: { evil: true } }).status, 400);
});
