import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateForm, emptyForm, isTerminal, shouldPoll, progressText, statusHeading, pollDelayMs, quarksNote,
  intentFromSearch, postAuthTarget, buildStartBody, canChooseMode, logoFileProblem, startFailureOf,
  stepIndex, GOALS, BLUEPRINT_SIGNUP_PATH,
  claimLabel, calendarTiles, calendarFocusFrom, coverStyle, documentFileName, documentOutline, factTextMap,
} from '../utils/blueprint.ts';
import { readFileSync } from 'node:fs';
import { BLUEPRINT_COPY } from '../constants/blueprintCopy.ts';

const valid = () => ({
  ...emptyForm(),
  businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.',
  whoItsFor: 'Families in Chennai', goal: 'enquiries',
});

test('empty form lists every required error', () => {
  const { ok, errors } = validateForm(emptyForm());
  assert.equal(ok, false);
  assert.deepEqual(Object.keys(errors).sort(), ['businessName', 'goal', 'website', 'whatYouSell', 'whoItsFor']);
  assert.equal(errors.website, 'Enter your website address or your Instagram page, or both.');
  assert.equal(errors.goal, 'Choose your main goal.');
});

test('a minimal valid form passes; Instagram alone is enough', () => {
  assert.equal(validateForm(valid()).ok, true);
  assert.equal(validateForm({ ...valid(), website: '', instagram: '@sweet.co' }).ok, true);
  assert.equal(validateForm({ ...valid(), website: 'https://www.sweetco.in/menu', instagram: 'https://www.instagram.com/sweet.co/?hl=en' }).ok, true);
});

test('bad addresses are rejected with the plain sentences', () => {
  for (const w of ['http://localhost', '10.0.0.1', 'exa mple.com', 'https://user:pw@example.com', 'https://example.com:8080', 'javascript:alert(1)', 'http://example.com']) {
    assert.equal(validateForm({ ...valid(), website: w }).errors.website, 'Enter your website as example.com or as a full address that starts with https://.', w);
  }
  assert.equal(validateForm({ ...valid(), instagram: 'a b' }).errors.instagram, 'Enter your Instagram page as @name or as its web address.');
  assert.ok(validateForm({ ...valid(), instagram: 'instagram.com/p/abc' }).errors.instagram);
});

test('what you sell needs ten characters and who it is for five', () => {
  assert.ok(validateForm({ ...valid(), whatYouSell: '123456789' }).errors.whatYouSell);
  assert.equal(validateForm({ ...valid(), whatYouSell: '1234567890' }).errors.whatYouSell, undefined);
  assert.ok(validateForm({ ...valid(), whoItsFor: 'abcd' }).errors.whoItsFor);
  assert.ok(validateForm({ ...valid(), goal: 'fame' }).errors.goal);
});

test('competitors and offers follow the backend rules', () => {
  assert.ok(validateForm({ ...valid(), competitors: [{ name: 'Rival', url: 'not a site' }] }).errors.competitors);
  assert.equal(validateForm({ ...valid(), competitors: [{ name: 'Rival', url: '' }] }).ok, true);
  assert.equal(validateForm({ ...valid(), competitors: [{ name: '', url: '' }] }).ok, true);
  const four = [1, 2, 3, 4].map((n) => ({ name: `R${n}`, url: '' }));
  assert.ok(validateForm({ ...valid(), competitors: four }).errors.competitors);
  assert.ok(validateForm({ ...valid(), offers: [{ name: '', price: '₹499' }] }).errors.offers);
  assert.equal(validateForm({ ...valid(), offers: [{ name: 'Cake', price: '₹499 per month' }] }).ok, true);
  const offers = [1, 2, 3, 4].map((n) => ({ name: `O${n}`, price: '' }));
  assert.ok(validateForm({ ...valid(), offers }).errors.offers);
});

test('the request body is trimmed, drops empty rows and never sends guided to a free account', () => {
  const f = { ...valid(), businessName: '  Sweet Co ', city: ' ', offers: [{ name: 'Cake', price: ' ₹499 ' }, { name: '', price: '' }], mode: 'guided', colours: ['#aabbcc'] };
  const body = buildStartBody(f, false);
  assert.equal(body.businessName, 'Sweet Co');
  assert.equal(body.mode, 'auto');
  assert.equal('city' in body, false);
  assert.deepEqual(body.offers, [{ name: 'Cake', price: '₹499' }]);
  assert.deepEqual(body.colours, ['#aabbcc']);
  assert.equal(buildStartBody(f, true).mode, 'guided');
});

test('guided mode is offered to every account except a free one', () => {
  assert.equal(canChooseMode({ plan: { tier: 'free' } }), false);
  assert.equal(canChooseMode({ plan: { tier: 'starter' } }), true);
  assert.equal(canChooseMode({}), true);
  assert.equal(canChooseMode(null), true);
});

test('logo file checks', () => {
  assert.equal(logoFileProblem({ type: 'image/png', size: 1000 }), null);
  assert.ok(logoFileProblem({ type: 'image/gif', size: 1000 }));
  assert.ok(logoFileProblem({ type: 'image/png', size: 3 * 1024 * 1024 }));
});

test('start failures map to the right screen', () => {
  const e = (status, data) => Object.assign(new Error(data.message || 'x'), { status, data });
  assert.deepEqual(startFailureOf(e(409, { alreadyUsed: true, id: 'abc', message: 'Used.' })), { kind: 'already', id: 'abc', message: 'Used.' });
  assert.equal(startFailureOf(e(403, { upgradeRequired: true, reason: 'quarks' })).kind, 'upgrade');
  assert.equal(startFailureOf(e(403, { verificationRequired: true, message: 'Verify your email.' })).kind, 'message');
  const f = startFailureOf(e(400, { errors: { website: 'Bad.' }, message: 'Please correct the highlighted fields.' }));
  assert.equal(f.kind, 'fields');
  assert.deepEqual(f.errors, { website: 'Bad.' });
  assert.equal(startFailureOf(e(429, { message: 'Daily limit.' })).message, 'Daily limit.');
});

test('status text gives the exact sentences', () => {
  assert.equal(progressText({ status: 'queued' }), 'Your Blueprint is in the queue. This usually takes a few minutes.');
  assert.equal(progressText({ status: 'processing', step: 'reading' }), 'Nebulaa is reading the pages you pointed to.');
  assert.equal(progressText({ status: 'processing', step: 'checking' }), 'Nebulaa is checking what it found.');
  assert.equal(progressText({ status: 'processing', step: 'planning' }), 'Nebulaa is writing your plan.');
  assert.equal(progressText({ status: 'awaiting_approval', checkpoint: 0 }), 'Please check what Nebulaa found before it writes your plan.');
  assert.equal(progressText({ status: 'awaiting_approval', checkpoint: 1 }), 'Please choose the direction for your plan.');
  assert.equal(progressText({ status: 'completed' }), 'Your Blueprint is ready.');
});

test('stopped and failed views show the server message and the refund line only when refunded', () => {
  const stop = { reason: 'thin', message: 'We could not find enough about your business to build a reliable Blueprint.' };
  assert.equal(progressText({ status: 'stopped', stop, refunded: true }), `${stop.message} Your Quarks were returned.`);
  assert.equal(progressText({ status: 'stopped', stop, refunded: false }), stop.message);
  assert.equal(progressText({ status: 'failed', error: 'Something went wrong', refunded: true }), 'Something went wrong. Your Quarks were returned.');
  assert.equal(progressText({ status: 'failed', error: 'Something went wrong.', refunded: false }), 'Something went wrong.');
});

test('status text never uses banned wording', () => {
  const states = [
    { status: 'queued' }, { status: 'processing', step: 'reading' }, { status: 'processing', step: 'checking' },
    { status: 'processing', step: 'planning' }, { status: 'processing' }, { status: 'awaiting_approval', checkpoint: 0 },
    { status: 'awaiting_approval', checkpoint: 1 }, { status: 'completed' },
    { status: 'stopped', stop: { message: 'We could not read your website.' }, refunded: true },
    { status: 'failed', error: 'This Blueprint took too long, so we stopped it. Please try again.', refunded: true },
  ];
  for (const s of states) {
    for (const t of [progressText(s), statusHeading(s)]) {
      assert.doesNotMatch(t, /\b(credits?|trial|7 days?)\b/i, t);
      assert.ok(!t.includes('!') && !t.includes('—'), t);
    }
  }
});

test('polling pace and terminal states', () => {
  assert.equal(pollDelayMs(0), 3000);
  assert.equal(pollDelayMs(19), 3000);
  assert.equal(pollDelayMs(20), 6000);
  assert.equal(pollDelayMs(25), 6000);
  for (const s of ['completed', 'stopped', 'failed']) assert.equal(isTerminal(s), true);
  for (const s of ['queued', 'processing', 'awaiting_approval']) assert.equal(isTerminal(s), false);
  assert.equal(shouldPoll({ status: 'processing' }), true);
  assert.equal(shouldPoll({ status: 'awaiting_approval' }), false);
  assert.equal(shouldPoll({ status: 'completed' }), false);
  assert.equal(shouldPoll(null), true);
});

test('stepper position follows the step', () => {
  assert.equal(stepIndex({ status: 'processing', step: 'reading' }), 0);
  assert.equal(stepIndex({ status: 'processing', step: 'checking' }), 1);
  assert.equal(stepIndex({ status: 'awaiting_approval', step: 'approval', checkpoint: 0 }), 1);
  assert.equal(stepIndex({ status: 'awaiting_approval', step: 'approval', checkpoint: 1 }), 2);
  assert.equal(stepIndex({ status: 'processing', step: 'planning' }), 2);
  assert.equal(stepIndex({ status: 'completed', step: 'done' }), 3);
});

test('deep link handling', () => {
  assert.equal(intentFromSearch('?mode=signup&intent=blueprint'), 'blueprint');
  assert.equal(intentFromSearch('mode=signup&intent=blueprint'), 'blueprint');
  assert.equal(intentFromSearch('?mode=signup'), null);
  assert.equal(intentFromSearch('?intent=other'), null);
  assert.equal(intentFromSearch(''), null);
  assert.equal(intentFromSearch(undefined), null);
  assert.equal(postAuthTarget('?mode=signup&intent=blueprint'), '/blueprint/new');
  assert.equal(postAuthTarget('?mode=signup'), '/dashboard');
  assert.equal(BLUEPRINT_SIGNUP_PATH, '/login?mode=signup&intent=blueprint');
});

test('quarks note', () => {
  assert.equal(quarksNote(7), 'This uses 7 of your Quarks.');
  assert.equal(quarksNote(), 'This uses a small number of your Quarks.');
  assert.equal(quarksNote(0), 'This uses a small number of your Quarks.');
});

function strings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => strings(x, out));
  else if (o && typeof o === 'object') Object.values(o).forEach((x) => strings(x, out));
  return out;
}

test('every copy string follows the voice and Quarks wording rules', () => {
  const all = [...strings(BLUEPRINT_COPY), ...GOALS.map((g) => g.label)];
  assert.ok(all.length > 40);
  for (const s of all) {
    assert.ok(!s.includes('!'), s);
    assert.ok(!s.includes('—') && !s.includes('–'), s);
    assert.doesNotMatch(s, /[\p{Extended_Pictographic}\u{FE0F}]/u, s);
    assert.doesNotMatch(s, /\b(unlock|amazing|magic|game-changer|supercharge|seamless|hey)\b/i, s);
    assert.doesNotMatch(s, /\b(credits?|trial|7 days?)\b/i, s);
  }
});

test('landing copy is Option A and the legend carries the four exact tags', () => {
  const l = BLUEPRINT_COPY.landing;
  assert.equal(l.eyebrow, 'Get your Brand Growth Blueprint, free');
  assert.equal(l.button, 'Get my free Blueprint');
  assert.equal(l.receive.length, 3);
  assert.deepEqual(l.legend.map((x) => x.label), ['[Verified]', '[Inference]', '[Proposed]', '[Unverified]']);
});

// ---------- Task 6: the document ----------

const fixture = JSON.parse(readFileSync(new URL('../scripts/visual-audit/blueprint-fixture.json', import.meta.url), 'utf8'));
const result = fixture.result;

test('claimLabel spells out each tag', () => {
  assert.equal(claimLabel('verified'), '[Verified]');
  assert.equal(claimLabel('inference'), '[Inference]');
  assert.equal(claimLabel('proposed'), '[Proposed]');
  assert.equal(claimLabel('unverified'), '[Unverified]');
});

test('calendarTiles always returns 30 days in order, with null for an open day', () => {
  const items = result.pages[4].sections[0].items.filter((i) => i.day !== 3 && i.day !== 30);
  const tiles = calendarTiles(items);
  assert.equal(tiles.length, 30);
  assert.deepEqual(tiles.map((t) => t.day), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(tiles[2].item, null);
  assert.equal(tiles[29].item, null);
  assert.equal(tiles[0].item.day, 1);
  assert.equal(calendarTiles([]).every((t) => t.item === null), true);
  assert.equal(calendarTiles(undefined).length, 30);
});

test('calendarFocusFrom builds the focus text from names and goal only', () => {
  const f = calendarFocusFrom(result);
  assert.ok(f.startsWith('Plan this month around these content pillars:'));
  const pillars = result.pages[3].sections[0].items;
  for (const p of pillars) assert.ok(f.includes(p.name), p.name);
  assert.ok(f.length <= 600);
  assert.match(f, /Territory: Baked for your table\./);
  assert.match(f, /Main goal: /);
  const names = [...pillars.map((p) => p.name), 'Baked for your table'].join(' ');
  const digits = (t) => (t.match(/\d/g) || []).join('');
  assert.equal(digits(f), digits(names));
  assert.equal(calendarFocusFrom({ pages: [{ sections: [] }] }), '');
  assert.equal(calendarFocusFrom(null), '');
  const long = { pages: [{ sections: [] }, { sections: [] }, { sections: [] }, { sections: [{ kind: 'pillars', items: Array.from({ length: 5 }, (_, i) => ({ name: 'P'.repeat(200) + i })) }] }] };
  assert.ok(calendarFocusFrom(long).length <= 600);
});

test('coverStyle uses the first two colours when given, else the tokens', () => {
  const s = coverStyle({ colours: [{ hex: '#c2185b' }, { hex: '#fbe3ec' }, { hex: '#000000' }] });
  assert.ok(s.background.includes('#c2185b') && s.background.includes('#fbe3ec') && !s.background.includes('#000000'));
  assert.ok(typeof s.color === 'string' && s.color.length > 0);
  const one = coverStyle({ colours: [{ hex: '#ffffff' }] });
  assert.ok(one.background.includes('#ffffff'));
  assert.notEqual(coverStyle({ colours: [{ hex: '#ffffff' }] }).color, coverStyle({ colours: [{ hex: '#000000' }] }).color);
  for (const none of [{ colours: [] }, {}, null, undefined]) {
    const t = coverStyle(none);
    assert.match(t.background, /var\(--gv-/);
    assert.match(t.color, /var\(--gv-/);
  }
  assert.match(coverStyle({ colours: [{ hex: 'red;background:url(x)' }] }).background, /var\(--gv-/);
});

test('documentFileName is ASCII safe and ends in .pdf', () => {
  const n = documentFileName('Sweet & Co/Cakes');
  assert.ok(!/[\/&:]/.test(n), n);
  assert.ok(n.endsWith('.pdf'));
  assert.ok(n.startsWith('Brand Growth Blueprint - '));
  assert.equal(documentFileName('Sweet Co'), 'Brand Growth Blueprint - Sweet Co.pdf');
  assert.match(documentFileName('Caf\u00e9 \u2615 \u0b87\u0ba9\u0bbf\u0baf\u0bb5\u0bb3\u0bcd'), /^[\x20-\x7e]+$/);
  assert.equal(documentFileName(''), 'Brand Growth Blueprint.pdf');
});

test('the page outline is cover, nine pages in order, then closing', () => {
  assert.deepEqual(documentOutline(result), [
    'cover', 'where-today', 'audience-positioning', 'competitor-read', 'content-pillars', 'calendar-preview',
    'offers-hooks', 'channel-plan', 'roadmap-90', 'first-steps', 'closing',
  ]);
  assert.equal(documentOutline(null).length, 2);
});

test('factTextMap lets an inference show the facts it rests on', () => {
  const map = factTextMap(result);
  const inference = result.pages[0].sections[1].items[0];
  assert.equal(inference.tag, 'inference');
  assert.ok(inference.factIds.every((id) => typeof map[id] === 'string' && map[id].length > 0));
});

test('the document source carries the print rules and no remapped classes', () => {
  const src = readFileSync(new URL('../components/blueprint/BlueprintDocument.tsx', import.meta.url), 'utf8');
  for (const needle of ['@page', 'break-after: page', 'print-color-adjust', '.bp-noprint', 'claimLabel', 'documentFileName', 'calendarFocusFrom']) {
    assert.ok(src.includes(needle), needle);
  }
  assert.ok(!src.includes('bg-white/') && !src.includes('text-white/'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/`@media print[\s\S]*?`/, '').replace(/html, body \{ background: #fff !important; \}/, '')), 'no hard-coded hex');
  assert.ok(!/filter\s*:/.test(src.replace(/-webkit-print-color-adjust/g, '')), 'no filter on the logo');
  assert.match(src, /objectFit: 'contain'/);
});

import { prefillFromProfile } from '../utils/blueprint.ts';

test('the Blueprint form starts from the saved business profile, and the profile name beats the sign-up name', () => {
  const out = prefillFromProfile({
    companyName: 'StratSchool',
    businessProfile: { name: 'Nebulaa', website: 'www.nebulaa.ai', description: 'Marketing for small businesses', targetAudience: 'Shop owners', businessLocation: 'Chennai' }
  });
  assert.deepStrictEqual(out, { businessName: 'Nebulaa', website: 'www.nebulaa.ai', whatYouSell: 'Marketing for small businesses', whoItsFor: 'Shop owners', city: 'Chennai' });
});

test('with no profile the sign-up name is used and nothing else is invented', () => {
  assert.deepStrictEqual(prefillFromProfile({ companyName: 'Acme' }), { businessName: 'Acme' });
  assert.deepStrictEqual(prefillFromProfile(null), {});
});
