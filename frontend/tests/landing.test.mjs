// Guards for the public landing page (pages/LandingPage.tsx, components/landing/*, constants/landingCopy.ts,
// utils/landingPlans.ts): plain, true words only; an honest Inbox; prices only from the plans answer or its checked
// snapshot; the seven steps; plan order; AA contrast over the landing's glows; no new raster or third-party script.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findVoiceViolations } from '../scripts/voice-audit.mjs';
import { parseColor, composite, ratio } from '../scripts/visual-audit/contrast-math.mjs';
import * as C from '../constants/landingCopy.ts';
import { PLANS_SNAPSHOT, PLAN_ORDER, factsFrom, bestValueId, planOf } from '../utils/landingPlans.ts';
import { CREATE_PHOTO_SLOTS } from '../utils/samplePhotos.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LANDING_DIR = 'components/landing';
const TSX = ['pages/LandingPage.tsx', ...fs.readdirSync(path.join(ROOT, LANDING_DIR)).filter((f) => f.endsWith('.tsx')).map((f) => `${LANDING_DIR}/${f}`)];
const FILES = [...TSX, 'constants/landingCopy.ts', 'utils/landingPlans.ts'];
const CSS = read(`${LANDING_DIR}/landing.css`);
const COPY_SRC = read('constants/landingCopy.ts');

/** Every customer-facing string of the copy file, with functions called on the snapshot figures. */
function allCopy(facts = PLANS_SNAPSHOT) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') { try { walk(v(facts)); } catch { walk(v('Example')); } }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const [name, value] of Object.entries(C)) if (name !== 'LANDING_ROUTES') walk(value);
  walk(C.faqItems(facts));
  return out;
}
const TEXT = allCopy().join('\n');

test('the landing words: no credits, trial, 7 days, worth, exclamation marks, em dashes or vendor names', () => {
  for (const re of [/\bcredits?\b/i, /\btrials?\b/i, /7[- ]days?/i, /\bworth\b/i, /!/, /—/, /\b(gemini|openai|ayrshare|fal(\.ai)?|gpt|whisper|razorpay|anthropic|claude|seedance|kling|omni)\b/i]) {
    assert.ok(!re.test(TEXT), `landing copy contains ${re}`);
  }
  for (const f of FILES) assert.ok(!/—/.test(read(f)), `${f} has an em dash`);
});

test('no invented proof: no testimonials, ratings, customer counts beyond the owner-confirmed line, or "most popular"', () => {
  assert.ok(!/testimonial|rated|stars?\b|reviews? from|trusted by|customers love|most popular/i.test(TEXT));
  const numbers = TEXT.match(/\b\d[\d,]*\+/g) || [];
  assert.deepEqual(numbers, ['2,000+'], 'the only "N+" claim is the owner-confirmed MSME line');
  assert.match(C.HERO.experience, /2,000\+ MSMEs/);
});

test('the voice audit is clean over every landing file', () => {
  assert.deepEqual(findVoiceViolations(ROOT, FILES), []);
});

test('the Inbox stays honest: drafted for approval, never automatic, every line marked and switchable', () => {
  assert.ok(!/automatic/i.test(TEXT), 'no automatic replies or sending on the landing');
  const sentences = TEXT.split(/(?<=[.?])\s+|\n/);
  for (const s of sentences.filter((t) => /\brepl(y|ies)\b/i.test(t) && /\.$/.test(t.trim()))) {
    assert.ok(/drafted/.test(s) && /approve/.test(s), `a reply sentence without "drafted ... approve": ${s}`);
  }
  // Each Inbox-dependent entry carries the marker comment on the line above it.
  const lines = COPY_SRC.split('\n');
  const inboxEntries = lines.map((l, i) => [l, i]).filter(([l]) => /inbox: true|inboxNote:/.test(l) && !/inboxNote\?:/.test(l) && !/^\s*\/\//.test(l));
  assert.ok(inboxEntries.length >= 3, 'the approval point, the workflow step and the FAQ note');
  for (const [, i] of inboxEntries) assert.match(lines[i - 1], /\/\/ CONFIRM AFTER INBOX TEST/, `line ${i + 1} needs the marker above it`);
  // One switch hides them all.
  assert.equal(typeof C.INBOX_LINES_VISIBLE, 'boolean');
  const used = TSX.map(read).join('\n');
  assert.equal((used.match(/INBOX_LINES_VISIBLE/g) || []).length >= 3, true, 'approval points, steps and FAQ all read the switch');
  assert.equal(C.HOW.steps.filter((s) => !s.inbox).length, 6);
});

test('the workflow shows the seven real steps; the Inbox step is drafted for approval and an add-on', () => {
  assert.equal(C.HOW.steps.length, 7);
  const inbox = C.HOW.steps.find((s) => /Reply from one inbox/.test(s.title));
  assert.ok(inbox && inbox.addon && inbox.inbox && /drafted/.test(inbox.text) && /approve/.test(inbox.text));
  assert.ok(C.HOW.steps.find((s) => s.title === 'Publish and schedule').addon);
  assert.match(C.APPROVAL.title + ' ' + C.APPROVAL.emphasis, /Nothing goes out until you approve it\./);
});

test('plan cards run Starter, Growth, Agency in three columns, every figure from the plans answer or the snapshot', () => {
  assert.deepEqual(PLAN_ORDER, ['starter', 'professional', 'agency']);
  const plans = read(`${LANDING_DIR}/PlansAndFaq.tsx`);
  assert.match(plans, /PLAN_ORDER\.map/);
  assert.match(CSS, /\.nb-land-plans \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  // No rupee figure or Quark amount is typed in the copy or the components (only the snapshot holds them).
  for (const f of [...TSX, 'constants/landingCopy.ts']) {
    assert.ok(!/₹\s?\d|\b(999|1,?999|6,?999|1,?499|600|2,?000|6,?000)\b(?! MSMEs)/.test(read(f).replace(/2,000\+ MSMEs/g, '')), `${f} types a price or a Quark amount`);
  }
  assert.match(read('pages/LandingPage.tsx'), /apiService\.getPlans\(\)/);
  assert.equal(bestValueId(PLANS_SNAPSHOT), 'professional', '"Best value" goes to the lowest price per Quark');
});

test('the snapshot equals the backend catalogue (prices, Quarks, feature lines, add-ons, agency)', () => {
  const require = createRequire(import.meta.url);
  const { PLANS, outputsFor, ADDONS, AGENCY } = require(path.resolve(ROOT, '../backend/config/apiCosts.js'));
  const { PLAN_PRESENTATION } = require(path.resolve(ROOT, '../backend/config/plans.js'));
  const fmt = (n) => n.toLocaleString('en-IN');
  for (const id of PLAN_ORDER) {
    const o = outputsFor(PLANS[id].quarks);
    const features = [`Up to ${fmt(o.posts)} posts a month, or`, `up to ${fmt(o.videos)} short videos with voice and music`, 'Spend it on posts or videos, in any mix', 'Top up any time', ...PLAN_PRESENTATION[id].extraFeatures];
    assert.deepEqual(planOf(PLANS_SNAPSHOT, id), { id, name: PLAN_PRESENTATION[id].name, description: PLAN_PRESENTATION[id].description, inr: PLANS[id].inr, quarks: PLANS[id].quarks, features });
  }
  for (const id of ['publish', 'competitors', 'inbox', 'bundle']) assert.equal(PLANS_SNAPSHOT.addons[id], ADDONS[id].inr, id);
  assert.deepEqual(PLANS_SNAPSHOT.agency, { includedClients: AGENCY.includedClients, slotInr: AGENCY.slot.inr });
});

test('the server answer replaces the snapshot only when it is complete; add-on names are the landing\'s own', () => {
  const price = (inr) => ({ inr, gstPaise: 0, chargePaise: 0 });
  const answer = {
    plans: [{ id: 'agency', name: 'Agency', description: 'd', quarks: 7000, features: ['x'], ...price(7999) }, { id: 'starter', name: 'Starter', description: 'd', quarks: 700, features: ['a', ''], ...price(1099) }, { id: 'professional', name: 'Growth', description: 'd', quarks: 2100, features: [], ...price(2099) }],
    addons: [{ id: 'publish', label: 'P', ...price(1100) }, { id: 'competitors', label: 'C', ...price(600) }, { id: 'inbox', label: 'Inbox and automatic replies', ...price(600) }, { id: 'bundle', label: 'B', ...price(1900) }],
    agency: { includedClients: 6, maxClients: 25, slotInr: 1599 },
  };
  const f = factsFrom(answer);
  assert.deepEqual(f.plans.map((p) => p.id), PLAN_ORDER);
  assert.deepEqual(planOf(f, 'starter').features, ['a']);
  assert.equal(C.startLabel(f), 'Start for ₹1,099');
  assert.ok(!/automatic/i.test(C.PLANS_COPY.addons(f)), 'the server label for the Inbox add-on is never shown');
  assert.match(C.PLANS_COPY.addons(f), /Inbox ₹600/);
  assert.match(C.faqItems(f)[0].a, /700 on Starter, 2,100 on Growth and 7,000 on Agency/);
  assert.equal(factsFrom({ ...answer, addons: answer.addons.slice(1) }), null);
  assert.equal(factsFrom({ ...answer, plans: answer.plans.slice(1) }), null);
  assert.equal(factsFrom({ ...answer, agency: undefined }), null);
  assert.equal(factsFrom(null), null);
});

test('FAQ: eight truthful answers; Quarks written as plain amounts; platforms and languages match the app', async () => {
  const items = C.faqItems(PLANS_SNAPSHOT);
  assert.equal(items.length, 8);
  assert.match(items[0].a, /600 on Starter, 2,000 on Growth and 6,000 on Agency/);
  const { PLATFORM_CHOICES } = await import('../utils/platforms.ts');
  const where = items.find((i) => /Where can my posts go/.test(i.q)).a;
  for (const p of PLATFORM_CHOICES.filter((x) => !x.soon)) assert.ok(where.includes(p.label), `platform ${p.label} named`);
  const langs = items.find((i) => /languages/.test(i.q)).a;
  assert.match(langs, /^English and Tamil today/);
  assert.ok(!/Hindi|Telugu|Kannada|Malayalam/.test(langs), 'only languages offered today');
  assert.match(items.find((i) => /cancel/.test(i.q)).a, /Settings, then Billing, and choose Cancel plan/);
  assert.match(read('pages/RefundPolicy.tsx'), /Settings, then Billing, and choose Cancel plan/);
});

test('"What you can make" uses the six Create photo slots and the app cover tiles; Photoshoot says Coming soon', () => {
  assert.deepEqual(C.MAKE.tiles.map((t) => t.key).sort(), Object.keys(CREATE_PHOTO_SLOTS).sort());
  assert.deepEqual(C.MAKE.tiles.map((t) => t.title), ['Posts', 'Carousels', 'Campaigns', 'Videos', 'Photoshoot', 'LinkedIn']);
  assert.equal(C.MAKE.tiles.find((t) => t.key === 'photoshoot').chip, 'Coming soon');
  const make = read(`${LANDING_DIR}/MakeSection.tsx`);
  assert.match(make, /image=\{createPhoto\(t\.key\)\}/);
  assert.match(make, /<CoverTile/);
});

test('routes and legal links are kept; the page is a lazy route', () => {
  assert.equal(C.LANDING_ROUTES.signUp, '/login?mode=signup');
  assert.equal(C.LANDING_ROUTES.signIn, '/login');
  const page = read('pages/LandingPage.tsx');
  assert.match(page, /BLUEPRINT_SIGNUP_PATH/);
  assert.match(read(`${LANDING_DIR}/ClosingAndFooter.tsx`), /<LegalLinks/);
  assert.match(read('utils/routeChunks.ts'), /LandingPage: \(\) => import\('\.\.\/pages\/LandingPage'\)/);
});

test('speed: no third-party script, no external address, no new raster; images are lazy with a size', () => {
  for (const f of [...FILES, `${LANDING_DIR}/landing.css`]) {
    const src = read(f);
    assert.ok(!/<script|https?:\/\//.test(src.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), `${f} loads something from outside`);
  }
  const imgs = TSX.map(read).join('\n').match(/<img [^>]*>/g) || [];
  for (const tag of imgs) {
    assert.match(tag, /width=\{\d+\}/, tag);
    assert.match(tag, /height=\{\d+\}/, tag);
    const src = /src=(?:"([^"]+)"|\{([^}]+)\})/.exec(tag);
    assert.ok(src && (/^\/assets\/(logo-nebulaa\.png|showcase\/)/.test(src[1] || '') || src[2] === 's.src'), `unexpected picture: ${tag}`);
  }
  assert.match(read(`${LANDING_DIR}/ExamplesSection.tsx`), /loading="lazy" decoding="async"/);
});

test('landing styles are scoped and motion waits for no-preference', () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|\})\s*([^{}@]+)\{/g) || [];
  for (const r of rules) {
    const sel = r.replace(/^\}?\s*/, '').replace(/\{$/, '').trim();
    if (/^(from|to|\d+%)/.test(sel)) continue;
    for (const part of sel.split(',')) assert.match(part.trim(), /^\.nb-(land|phone|float)/, `unscoped selector: ${part.trim()}`);
  }
  for (const block of CSS.split('@media').slice(1)) {
    if (/animation:\s*nb-/.test(block.split(/\n\}/)[0])) assert.match(block, /^\s*\(prefers-reduced-motion: no-preference\)/);
  }
});

// Text colours over the worst point of each landing surface (the glows composited at full strength).
const hex = (s) => parseColor(s);
const over = (layers, base) => layers.reduce((bg, l) => composite(parseColor(l), bg), hex(base));
const SURFACES = {
  cream: hex('#FBF5EA'),
  sand: hex('#F6ECDA'),
  heroWorst: over(['rgb(255 224 160 / 0.55)', 'rgb(255 203 46 / 0.55)', 'rgb(238 99 48 / 0.24)'], '#FFF0DA'),
  goldWorst: over(['rgb(255 203 46 / 0.45)', 'rgb(238 99 48 / 0.14)'], '#FFF1D2'),
  pointOnGold: over(['rgb(255 255 255 / 0.78)'], '#FFE07A'),
};

test('AA contrast: body text 4.5 to 1 and headings 3 to 1 over every landing surface, at the worst point of each glow', () => {
  const body = { ink: '#2B1D0E', ink2: '#5E4A31', muted: '#634E35', eyebrow: '#7E4300' };
  for (const [sName, bg] of Object.entries(SURFACES)) {
    for (const [tName, fg] of Object.entries(body)) {
      const r = ratio(hex(fg), bg);
      assert.ok(r >= 4.5, `${tName} on ${sName}: ${r.toFixed(2)}`);
    }
    const em = ratio(hex('#A35A00'), bg);
    assert.ok(em >= 3, `gold italic heading on ${sName}: ${em.toFixed(2)}`);
  }
  for (const [fg, bg, label] of [['#1A1208', '#F5A623', 'gold button'], ['#6B3F00', '#FFE2A1', 'step number and phone chip'], ['#2B1D0E', '#FFFFFF', 'example chip'], ['#5E4A31', '#FFF1D2', 'waiting line'], ['#7A4A00', '#FFFDF8', 'FAQ link'], ['#8A4A00', '#FFFFFF', 'phone tags'], ['#5E4A31', '#F6ECDA', 'add-on chip']]) {
    const r = ratio(hex(fg), hex(bg));
    assert.ok(r >= 4.5, `${label}: ${r.toFixed(2)}`);
  }
  for (const v of Object.values({ ink: '#2B1D0E', ink2: '#5E4A31', muted: '#634E35', eyebrow: '#7E4300', emph: '#A35A00' })) {
    assert.ok(CSS.includes(v), `the CSS still uses ${v}`);
  }
});
