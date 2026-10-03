import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor, composite, luminance, ratio, isLargeText, requiredRatio,
} from '../scripts/visual-audit/contrast-math.mjs';

const close = (actual, expected, eps, msg) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${msg}: ${actual} vs ${expected} (+/- ${eps})`);

test('parseColor reads hex, rgb(), rgba(), modern space syntax and transparent', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#FBF5EA'), { r: 251, g: 245, b: 234, a: 1 });
  assert.deepEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(parseColor('rgb(20, 32, 58)'), { r: 20, g: 32, b: 58, a: 1 });
  assert.deepEqual(parseColor('rgba(255, 255, 255, 0.45)'), { r: 255, g: 255, b: 255, a: 0.45 });
  assert.deepEqual(parseColor('rgb(255 255 255 / 0.1)'), { r: 255, g: 255, b: 255, a: 0.1 });
  assert.deepEqual(parseColor('rgb(255 255 255 / 10%)'), { r: 255, g: 255, b: 255, a: 0.1 });
  assert.deepEqual(parseColor('color(srgb 1 0.5 0 / 0.5)'), { r: 255, g: 127.5, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(parseColor('oklch(0.5 0.1 200)'), null);
  assert.equal(parseColor(''), null);
});

test('luminance of black and white', () => {
  assert.equal(luminance({ r: 0, g: 0, b: 0 }), 0);
  close(luminance({ r: 255, g: 255, b: 255 }), 1, 1e-9, 'white');
});

test('#000 on #fff is 21:1 and the order of arguments does not matter', () => {
  close(ratio(parseColor('#000'), parseColor('#fff')), 21, 1e-9, 'black/white');
  close(ratio(parseColor('#fff'), parseColor('#000')), 21, 1e-9, 'white/black');
});

test('#777777 on white is about 4.48 and fails 4.5', () => {
  const r = ratio(parseColor('#777777'), parseColor('#ffffff'));
  close(r, 4.48, 0.01, '#777 on #fff');
  assert.ok(r < requiredRatio(16, 400));
});

test('white on cream #FBF5EA is about 1.1', () => {
  close(ratio(parseColor('#ffffff'), parseColor('#FBF5EA')), 1.1, 0.05, 'white on cream');
});

test('composite: opaque fg wins, transparent fg gives bg, 50% black over white is mid grey', () => {
  assert.deepEqual(composite(parseColor('#123456'), parseColor('#ffffff')), { r: 0x12, g: 0x34, b: 0x56 });
  assert.deepEqual(composite(parseColor('transparent'), parseColor('#FBF5EA')), { r: 251, g: 245, b: 234 });
  assert.deepEqual(composite(parseColor('rgba(0,0,0,0.5)'), parseColor('#ffffff')), { r: 127.5, g: 127.5, b: 127.5 });
});

test('rgba(255,255,255,0.45) over cream composites to near-cream and fails', () => {
  const cream = parseColor('#FBF5EA');
  const c = composite(parseColor('rgba(255,255,255,0.45)'), cream);
  assert.ok(c.r >= 251 && c.g >= 245 && c.b >= 234, 'lighter than or equal to cream');
  assert.ok(c.r <= 255 && c.g <= 250 && c.b <= 245, "still near cream");
  const r = ratio(c, cream);
  assert.ok(r < 1.1, `ratio ${r}`);
  assert.ok(r < requiredRatio(14, 400));
  assert.ok(r < requiredRatio(32, 700));
});

test('large-text rule: 24px normal, 18.66px bold', () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(23.9, 400), false);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.67, 'bold'), true);
  assert.equal(isLargeText(18.5, 700), false);
  assert.equal(isLargeText(20, 600), false);
  assert.equal(isLargeText(20, '400'), false);
  assert.equal(requiredRatio(24, 400), 3);
  assert.equal(requiredRatio(18.66, 700), 3);
  assert.equal(requiredRatio(16, 700), 4.5);
  assert.equal(requiredRatio(14, 400), 4.5);
});

// Gradient helpers used to sample a background gradient where the text actually sits.
import { splitTopLevel, parseBackgroundImage, gradientColorAt, gradientT } from '../scripts/visual-audit/contrast-math.mjs';

test('splitTopLevel splits on commas outside parentheses', () => {
  assert.deepEqual(splitTopLevel('a, rgb(1, 2, 3) 10%, b(c, d)'), ['a', 'rgb(1, 2, 3) 10%', 'b(c, d)']);
});

test('parseBackgroundImage reads linear gradients, radial gradients and url() layers', () => {
  const layers = parseBackgroundImage('linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0) 100%), url("x.png"), radial-gradient(circle, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)');
  assert.equal(layers.length, 3);
  assert.equal(layers[0].type, 'linear');
  assert.equal(layers[0].angle, 0);
  assert.deepEqual(layers[0].stops.map((s) => s.pos), [0, 1]);
  assert.deepEqual(layers[0].stops[0].color, { r: 0, g: 0, b: 0, a: 0.7 });
  assert.equal(layers[1].type, 'url');
  assert.equal(layers[2].type, 'other');
  assert.equal(layers[2].stops.length, 2);
  assert.equal(parseBackgroundImage('linear-gradient(90deg, #fff, #000)')[0].angle, 90);
  assert.equal(parseBackgroundImage('linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))')[0].angle, 180);
  assert.deepEqual(parseBackgroundImage('linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(0, 0, 0) 20%, rgb(1, 1, 1))')[0].stops.map((s) => s.pos), [0, 0.2, 1]);
  assert.deepEqual(parseBackgroundImage('none'), []);
});

test('gradientColorAt interpolates between stops (premultiplied alpha)', () => {
  const g = parseBackgroundImage('linear-gradient(to bottom, rgb(0, 0, 0), rgb(255, 255, 255))')[0];
  assert.deepEqual(gradientColorAt(g, 0), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(gradientColorAt(g, 1), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(gradientColorAt(g, 0.5), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  const fade = parseBackgroundImage('linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0))')[0];
  const mid = gradientColorAt(fade, 0.5);
  assert.ok(Math.abs(mid.a - 0.35) < 1e-9);
  assert.equal(mid.r, 0);
});

test('gradientT maps a point to the gradient line', () => {
  const box = { left: 0, top: 0, width: 100, height: 200 };
  assert.equal(gradientT(180, box, { x: 50, y: 0 }), 0);
  assert.equal(gradientT(180, box, { x: 50, y: 200 }), 1);
  assert.equal(gradientT(0, box, { x: 50, y: 150 }), 0.25);
  assert.equal(gradientT(90, box, { x: 25, y: 10 }), 0.25);
  assert.equal(gradientT(90, box, { x: -50, y: 10 }), 0);
});
