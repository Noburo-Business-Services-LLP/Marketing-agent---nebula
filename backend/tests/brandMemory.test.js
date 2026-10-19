const test = require('node:test');
const assert = require('node:assert');
const C = require('../services/brandMemory/common');
const { learnFromPlan, learnFromBlueprint } = require('../services/brandMemory/fromPlan');
const { learnFromCustomers } = require('../services/brandMemory/fromCustomers');
const { learnFromProducts } = require('../services/brandMemory/fromProducts');
const { learnFromResults } = require('../services/brandMemory/fromResults');
const { learnFromCompetitors } = require('../services/brandMemory/fromCompetitors');
const { mergeItems, fingerprint, editedItem } = require('../services/brandMemory/merge');
const P = require('../services/brandMemory/prompt');
const { createBrandMemory, buildView, refreshSoon, startBrandMemoryJob, _triggers } = require('../services/brandMemory/runner');
const { createLearnedRouter } = require('../routes/aiMemoryLearned');
const { protect } = require('../middleware/auth');

const DAY = 864e5;
const NOW = new Date('2026-10-20T06:00:00Z');
const ago = (d, h = 0) => new Date(NOW.getTime() - d * DAY + h * 36e5);
const quiet = async (fn) => { const w = console.warn; const e = console.error; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.error = e; } };
const DIGIT = /\p{Nd}/u;

const planDoc = (over = {}) => ({
  blueprintId: 'bp1', completedAt: new Date('2026-10-12T06:00:00Z'),
  result: {
    plan: {
      pillars: [{ name: 'Festive looks' }, { name: 'Behind the loom' }, { name: 'Care tips' }],
      positioning: { territory: { name: 'The weaver next door' }, line: { text: 'Handwoven, close to home', tag: 'proposed' }, audience: [{ text: 'Working women who want festive wear' }] },
      channels: [{ channel: 'Facebook', priority: 2 }, { channel: 'Instagram', priority: 1 }, { channel: 'WhatsApp', priority: 3 }],
      calendar: Array.from({ length: 12 }, (_, i) => ({ day: i + 1, format: i < 7 ? 'reel' : 'carousel' })),
      icp: { who: [{ text: 'Women in the city who buy for festivals' }], pains: [{ text: 'Cannot tell real silk from fake' }], where: [{ text: 'Instagram reels' }], triggers: [{ text: 'A festival coming up' }] },
      competitors: [{ name: 'Rival Silks', observations: [] }],
      ...over
    }
  }
});

// ---- plan and Blueprint -------------------------------------------------------------------------------------------
test('plan: nothing without a completed plan, themes, position, channel order and format mix with evidence', () => {
  const none = learnFromPlan(null);
  assert.strictEqual(none.state, 'none');
  assert.match(none.reason, /no plan yet/);
  const r = learnFromPlan(planDoc());
  assert.strictEqual(r.state, 'learned');
  const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
  assert.match(by['plan-themes'].text, /3 themes: Festive looks, Behind the loom and Care tips/);
  assert.strictEqual(by['plan-themes'].evidenceText, 'from your plan of 12 October');
  assert.strictEqual(by['plan-themes'].confidence, 'strong');
  assert.match(by['plan-channels'].text, /puts Instagram first, then Facebook and WhatsApp/);
  assert.match(by['plan-position'].text, /The weaver next door/);
  assert.match(by['plan-format-mix'].text, /reels \(7 of 12 days\), then carousels \(5\)/);
  for (const i of r.items) assert.ok(!DIGIT.test(i.promptLine), i.promptLine);
  // The Blueprint's competitor block is never read.
  assert.ok(!JSON.stringify(r).includes('Rival Silks'));
});

test('plan: fewer than three themes or ten calendar days is not enough for those items', () => {
  const r = learnFromPlan(planDoc({ pillars: [{ name: 'One' }, { name: 'Two' }], calendar: [{ day: 1, format: 'reel' }] }));
  const keys = r.items.map((i) => i.key);
  assert.ok(!keys.includes('plan-themes'));
  assert.ok(!keys.includes('plan-format-mix'));
  const empty = learnFromPlan({ result: { plan: {} } });
  assert.strictEqual(empty.state, 'not_enough');
  assert.match(empty.reason, /not have enough parts/);
});

test('Blueprint: none without one; its themes, and the themes it shares with the plan', () => {
  assert.strictEqual(learnFromBlueprint(null).state, 'none');
  const bp = planDoc({ pillars: [{ name: 'Care tips' }, { name: 'Festive looks' }, { name: 'Wedding season' }] });
  const r = learnFromBlueprint(bp, planDoc());
  const shared = r.items.find((i) => i.key === 'blueprint-shared-themes');
  assert.match(shared.text, /2 themes are in both your Blueprint and your plan: Care tips and Festive looks/);
  assert.ok(!r.items.some((i) => i.key === 'plan-format-mix'));
  assert.ok(!learnFromBlueprint(bp, null).items.some((i) => i.key === 'blueprint-shared-themes'));
});

// ---- customers ----------------------------------------------------------------------------------------------------
test('customers: honest empty state; owner answers are strong, the plan reading is good; no gender guess', () => {
  const none = learnFromCustomers({ user: { businessProfile: {} } });
  assert.strictEqual(none.state, 'none');
  assert.match(none.reason, /Settings/);
  const r = learnFromCustomers({
    user: { businessProfile: { targetAudience: 'Young professionals', businessType: 'B2C', reachAreas: ['city', 'state'], pricePositioning: 'mid_range', keyDifferentiator: 'Hand finished', targetGender: 'mostly_women', industry: 'Textiles' } },
    planDoc: planDoc()
  });
  const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
  assert.strictEqual(by['customers-who'].confidence, 'strong');
  assert.match(by['customers-market'].text, /you sell to individual customers, your customers are in the city and the state, your prices are mid-range/);
  assert.match(by['customers-market'].promptLine, /^The market: the business sells to individual customers, its customers are in/);
  assert.strictEqual(by['customers-pains'].confidence, 'good');
  assert.match(by['customers-pains'].evidenceText, /from your plan of 12 October \(1 point\)/);
  assert.ok(!JSON.stringify(r).includes('mostly women'), 'a stored gender answer is not turned into a guess');
  // Without a profile answer the plan's own reading says who buys.
  const fromPlan = learnFromCustomers({ user: { businessProfile: {} }, planDoc: planDoc() });
  assert.strictEqual(fromPlan.items[0].key, 'customers-who-plan');
  assert.ok(fromPlan.items.length <= C.LIMITS.MAX_ITEMS_PER_SOURCE);
});

// ---- products -----------------------------------------------------------------------------------------------------
test('products: catalogue, missing photos, one-currency price range, a real main category only', () => {
  assert.strictEqual(learnFromProducts([]).state, 'none');
  const list = [
    { name: 'Silk saree', price: 2999, currency: 'INR', category: 'Sarees', imageUrl: 'https://x/a.jpg' },
    { name: 'Cotton saree', price: 1499, currency: 'INR', category: 'Sarees', images: ['https://x/b.jpg'] },
    { name: 'Dupatta', price: 499, currency: 'INR', category: 'Dupattas' },
    { name: 'Stitching', type: 'service', category: 'Sarees' }
  ];
  const r = learnFromProducts(list);
  const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
  assert.match(by['products-catalogue'].text, /3 products and 1 service on file, 2 with a photo/);
  assert.match(by['products-photos'].text, /2 items have no photo yet/);
  assert.match(by['products-prices'].text, /from Rs 499 to Rs 2,999/);
  assert.match(by['products-category'].text, /Most of what you sell is Sarees \(3 of 4\)/);
  assert.strictEqual(by['products-prices'].promptLine, '');
  const mixed = learnFromProducts([{ name: 'A', price: 10, currency: 'INR' }, { name: 'B', price: 20, currency: 'USD' }, { name: 'C', category: 'General' }]);
  assert.ok(!mixed.items.some((i) => i.key === 'products-prices'));
  assert.ok(!mixed.items.some((i) => i.key === 'products-category'));
});

// ---- results ------------------------------------------------------------------------------------------------------
let seq = 0;
const perfRow = (daysAgo, a, extra = {}) => ({
  _id: `r${++seq}`, campaignId: extra.campaignId || null, platform: extra.platform || 'instagram', postId: `p${seq}`, contentType: extra.type || 'post', caption: 'A caption',
  metrics: { likes: 0, comments: 0 }, rawAnalytics: a ? { status: 'success', [extra.platform || 'instagram']: { analytics: a } } : null,
  publishedAt: ago(daysAgo, extra.hour || 0), measuredAt: ago(Math.max(0, daysAgo - 1))
});

test('results: none, then not enough (old zero rows say so), then findings with confidence words', () => {
  assert.strictEqual(learnFromResults({ rows: [], now: NOW }).state, 'none');
  const few = learnFromResults({ rows: [perfRow(3, { likeCount: 10 }), perfRow(4, null), perfRow(5, null)], now: NOW });
  assert.strictEqual(few.state, 'not_enough');
  assert.match(few.reason, /numbers for 1 post from the last 90 days. It needs at least 5/);
  assert.match(few.reason, /3 posts were measured, but the platforms sent no numbers for 2 of them/);

  const camps = new Map();
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    const id = `c${i}`;
    camps.set(id, { _id: id, creative: { type: i < 6 ? 'video' : 'image', imageUrls: ['https://x/p.jpg'] }, publishedAt: ago(5 + i) });
    rows.push(perfRow(5 + i, { likeCount: i < 6 ? 90 : 20, commentsCount: 2 }, { campaignId: id }));
  }
  rows.push(perfRow(200, { likeCount: 999 })); // older than 90 days: never used
  const r = learnFromResults({ rows, campaigns: camps, now: NOW });
  assert.strictEqual(r.state, 'learned');
  const fmt = r.items.find((i) => i.kind === 'format');
  assert.match(fmt.text, /^Videos got 4\.5 times the likes of image posts in the last 90 days\.$/);
  assert.strictEqual(fmt.evidenceText, 'from 12 posts');
  assert.strictEqual(fmt.confidence, 'good');
  assert.strictEqual(fmt.promptLine, 'Videos have done better than image posts for this brand.');
  for (const i of r.items) assert.ok(!DIGIT.test(i.promptLine), i.promptLine);
  const flat = learnFromResults({ rows: rows.slice(0, 12).map((x) => ({ ...x, rawAnalytics: { status: 'success', instagram: { analytics: { likeCount: 30 } } } })), campaigns: camps, now: NOW });
  assert.strictEqual(flat.state, 'not_enough');
  assert.match(flat.reason, /No clear pattern yet in 12 measured posts/);
});

// ---- competitors --------------------------------------------------------------------------------------------------
const comp = (id, over = {}) => ({ _id: id, name: `Rival ${id}`, socialHandles: { instagram: `rival_${id}` }, isActive: true, createdAt: ago(30), ...over });
const snapOf = (competitorId, weekStart, posts, over = {}) => ({ competitorId, weekStart, takenAt: ago(3), ok: true, postsInWindow: 4, posts, topPost: { caption: 'Rival caption #rivalbrand', url: 'https://instagram.com/p/x' }, hashtags: ['#rivalbrand'], ...over });
const postsOf = (n, type, likes, daysBack = 2) => Array.from({ length: n }, (_, i) => ({ at: ago(daysBack + i), type, likes, comments: 1, url: `https://www.instagram.com/p/${type}${likes}${i}${daysBack}/` }));

test('competitors: add-on, none, not enough, then patterns that never carry a name, caption or hashtag', () => {
  assert.strictEqual(learnFromCompetitors({ entitled: false }).state, 'not_on_plan');
  assert.strictEqual(learnFromCompetitors({ competitors: [] }).state, 'none');
  const little = learnFromCompetitors({ competitors: [comp('a'), comp('b')], snapshots: [snapOf('a', '2026-10-13', postsOf(4, 'video', 50))], now: NOW });
  assert.strictEqual(little.state, 'not_enough');
  assert.match(little.reason, /read 4 posts with likes from 1 competitor. It needs at least 10, from two or more/);

  const snaps = [
    snapOf('a', '2026-10-13', [...postsOf(4, 'video', 100), ...postsOf(3, 'image', 30, 9)]),
    snapOf('a', '2026-10-06', postsOf(2, 'video', 100, 14)),
    snapOf('b', '2026-10-13', [...postsOf(3, 'video', 80, 3), ...postsOf(3, 'image', 20, 12)], { postsInWindow: 2 }),
    snapOf('b', '2026-10-06', [], { postsInWindow: 3 }),
    snapOf('z', '2026-10-13', postsOf(6, 'image', 5000)) // an ignored competitor: never read
  ];
  const r = learnFromCompetitors({ competitors: [comp('a'), comp('b'), comp('z', { isIgnored: true })], snapshots: snaps, now: NOW });
  const fmt = r.items.find((i) => i.kind === 'format');
  assert.match(fmt.text, /Across the 2 competitors you track, reels got .* photo posts in the last eight weeks\./);
  assert.strictEqual(fmt.promptLine, 'In this market, reels are getting more likes than photo posts.');
  const rhythm = r.items.find((i) => i.kind === 'rhythm');
  assert.match(rhythm.text, /The 2 competitors you track post about 3 times a week on Instagram\./);
  const all = JSON.stringify(r).toLowerCase();
  for (const bad of ['rival', 'caption', '#', 'instagram.com']) assert.ok(!all.includes(bad), bad);
});

// ---- merge and fingerprint ----------------------------------------------------------------------------------------
test('merge: first-learned date kept, owner edits kept even without evidence, deleted keys never return, failed source keeps its items', () => {
  const t0 = new Date('2026-10-01T00:00:00Z');
  const fresh = learnFromPlan(planDoc());
  const first = mergeItems({ previous: [], results: { plan: fresh }, now: t0 });
  assert.ok(first.every((i) => i.learnedAt === t0));
  const edited = first.map((i) => (i.key === 'plan-themes' ? editedItem(i, 'My own words about themes', t0) : i));
  const extra = { key: 'plan-old', source: 'plan', text: 'Owner kept this', promptLine: 'Owner kept this', userEdited: true, learnedAt: t0 };
  const second = mergeItems({ previous: [...edited, extra], results: { plan: fresh, results: { state: 'error', items: [] } }, hidden: ['plan-channels'], now: NOW });
  const by = Object.fromEntries(second.map((i) => [i.key, i]));
  assert.strictEqual(by['plan-themes'].text, 'My own words about themes');
  assert.strictEqual(by['plan-themes'].promptLine, 'My own words about themes');
  assert.strictEqual(by['plan-position'].learnedAt, t0);
  assert.strictEqual(by['plan-position'].updatedAt, t0, 'unchanged items keep their date');
  assert.ok(!by['plan-channels']);
  assert.ok(by['plan-old']);
  const kept = mergeItems({ previous: [{ key: 'results-x', source: 'results', text: 'Old', promptLine: 'Old' }], results: { results: { state: 'error', items: [] } }, now: NOW });
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(fingerprint(first, {}), fingerprint(first.map((i) => ({ ...i, learnedAt: NOW })), {}));
  assert.notStrictEqual(fingerprint(first, {}), fingerprint(first.slice(1), {}));
});

// ---- the one prompt helper ----------------------------------------------------------------------------------------
test('prompt: without new items the section is exactly the old one; empty memory gives nothing', () => {
  assert.deepStrictEqual(P.memorySectionLines(null), []);
  assert.deepStrictEqual(P.memorySectionLines({ learnedNotes: [], learnedItems: [] }), []);
  const notes = Array.from({ length: 12 }, (_, i) => ({ text: `Note ${i} with ${'words '.repeat(40)}`, updatedAt: new Date(2026, 0, i + 1) }));
  const lines = P.memorySectionLines({ learnedNotes: notes });
  assert.strictEqual(lines[0], "WHAT'S WORKED BEFORE (learned from published post performance)");
  assert.strictEqual(lines.length, 11);
  assert.strictEqual(lines[1], `- ${notes[11].text}`, 'newest first, uncut, as before');
});

test('prompt: capped at 10 lines and 900 characters (about 225 tokens), sources take turns, no digits, excludes', () => {
  const items = [];
  for (const s of C.SOURCES) for (let i = 0; i < 6; i += 1) items.push({ key: `${s}-${i}`, source: s, confidence: i ? 'good' : 'strong', promptLine: `${s} line number ${'x'.repeat(10)} ${'word '.repeat(20)}`.replace(/number/, 'nr') });
  const doc = { learnedItems: items, learnedNotes: [{ text: 'An old note', updatedAt: NOW }] };
  const section = P.memorySectionLines(doc);
  const text = section.join('\n');
  assert.ok(section.length <= C.PROMPT.MAX_LINES + 1);
  assert.ok(text.length <= C.PROMPT.MAX_CHARS + 30, `section is ${text.length} characters`);
  assert.ok(P.estimateTokens(text) <= 235);
  const lines = P.memoryPromptLines(doc);
  assert.strictEqual(lines[0], 'An old note', 'old notes count as results and come first');
  assert.ok(lines.some((l) => l.startsWith('plan')) && lines.some((l) => l.startsWith('customers')), 'each source gets a turn');
  assert.ok(!P.memoryPromptLines(doc, { exclude: ['plan'] }).some((l) => l.startsWith('plan')));
  // A line with a digit is never written by code (makeItem drops it).
  assert.strictEqual(C.makeItem({ key: 'k', source: 'plan', text: 'Shown 12', promptLine: 'Has 12 posts' }).promptLine, '');
  assert.strictEqual(C.promptSafe('See https://x.y'), '');
  assert.strictEqual(C.promptSafe('Hello @rival'), '');
});

test('prompt: buildBrandMemoryBlock carries the learned section through the shared helper', async () => {
  const src = require('fs').readFileSync(require.resolve('../services/brandMemory.js'), 'utf8');
  assert.match(src, /memorySectionLines\(learnedMemory\)/);
  assert.match(src, /select\('learnedNotes learnedItems'\)/);
  // No database connection: the loader never waits and gives nothing.
  assert.deepStrictEqual(await P.loadMemoryLines('507f1f77bcf86cd799439011'), []);
});

test('Home drafts: learned lines reach the data block through the decency filter; none means the same prompt', () => {
  const { buildFacts, buildWritePrompt } = require('../services/homeDrafts/prompt');
  const base = { post: { type: 'video', period: 'week' }, brand: { name: 'Weaves', industry: 'Textiles' }, banned: ['Rival Silks'] };
  const without = buildWritePrompt({ kind: 'response_post', tone: 'friendly', facts: buildFacts(base) });
  const empty = buildWritePrompt({ kind: 'response_post', tone: 'friendly', facts: buildFacts({ ...base, brand: { ...base.brand, learned: [] } }) });
  assert.strictEqual(empty.user, without.user);
  const withLines = buildWritePrompt({ kind: 'response_post', tone: 'friendly', facts: buildFacts({ ...base, brand: { ...base.brand, learned: ['Videos have done better than image posts for this brand.', 'Rival Silks posts a lot.'] } }) });
  assert.match(withLines.user, /What Nebulaa learned about this business: Videos have done better than image posts for this brand\./);
  assert.ok(!withLines.user.includes('Rival Silks'));
});

test('plan runs: learned lines become typed facts; the public Blueprint form cannot send them', () => {
  const { inputFromProfile } = require('../services/plan/profileInput');
  const { normaliseInput } = require('../services/blueprint/input');
  const { typedFacts } = require('../services/blueprint/discovery');
  const user = { businessProfile: { name: 'Weaves', website: 'https://weaves.example', description: 'Handwoven sarees from Kanchipuram', targetAudience: 'Women in Chennai' } };
  const input = inputFromProfile(user, { learned: ['Videos have done better than image posts for this brand.', 'Has 12 posts', 'x'.repeat(400)] });
  assert.strictEqual(input.learned.length, 3);
  const sys = normaliseInput(input, { allowGuided: true, allowLearned: true });
  assert.ok(sys.ok);
  assert.deepStrictEqual(sys.input.learned.length, 2, 'a line with a digit is dropped');
  assert.ok(sys.input.learned[1].length <= 160);
  const facts = typedFacts(sys.input).filter((f) => f.field === 'What Nebulaa learned');
  assert.strictEqual(facts.length, 2);
  const pub = normaliseInput(input, { allowGuided: true });
  assert.strictEqual(pub.input.learned, undefined);
  assert.strictEqual(inputFromProfile(user).learned, undefined, 'nothing learned: the input is as before');
});

// ---- the runner with fakes ----------------------------------------------------------------------------------------
function fakeWorld(over = {}) {
  const docs = new Map();
  const calls = [];
  let t = NOW.getTime();
  const store = {
    now: () => new Date(t),
    loadUser: async (id) => (over.users || { u1: { _id: 'u1', businessProfile: { targetAudience: 'Young professionals' }, plan: { tier: 'starter', addons: ['competitors'] } } })[id] || null,
    findDoc: async (id) => (docs.has(id) ? JSON.parse(JSON.stringify(docs.get(id)), (k, v) => (/At$|Until$/.test(k) && v ? new Date(v) : v)) : null),
    claimLock: async (id, now, { manual }) => {
      const d = docs.get(id) || {};
      if (d.learnedLockUntil && new Date(d.learnedLockUntil) > now) return false;
      if (manual && d.learnedManualAt && now - new Date(d.learnedManualAt) < C.TIMING.COOLDOWN_MS) return false;
      docs.set(id, { ...d, learnedLockUntil: new Date(now.getTime() + C.TIMING.LOCK_MS), ...(manual ? { learnedManualAt: now } : {}) });
      return true;
    },
    save: async (id, set) => { calls.push(['save', id, Object.keys(set)]); docs.set(id, { ...(docs.get(id) || {}), ...set, learnedLockUntil: null }); },
    release: async (id, set) => { calls.push(['release', id]); docs.set(id, { ...(docs.get(id) || {}), ...set, learnedLockUntil: null }); },
    touchChecked: async (id, now) => { calls.push(['touch', id]); docs.set(id, { ...(docs.get(id) || {}), learnedCheckedAt: now }); },
    editItem: async (id, key, item) => { const d = docs.get(id); d.learnedItems = d.learnedItems.map((i) => (i.key === key ? item : i)); },
    hideItem: async (id, key, hidden) => { const d = docs.get(id); d.learnedItems = d.learnedItems.filter((i) => i.key !== key); d.learnedHidden = hidden; },
    plan: async () => planDoc(),
    blueprint: async () => null,
    products: async () => [{ name: 'Silk saree', price: 2999, currency: 'INR' }],
    measured: async () => [],
    campaigns: async () => [],
    competitors: async () => [],
    snapshots: async () => [],
    trackedCount: async () => 0,
    latestChange: async () => null,
    dueAccounts: async () => [...docs.keys()].map((id) => ({ userId: id, ...docs.get(id) })),
    lease: { claim: async () => ({ value: 'x' }), release: async () => {} },
    canUseCompetitors: (u) => Boolean(u && u.plan && (u.plan.addons || []).includes('competitors')),
    ...over.deps
  };
  return { deps: store, docs, calls, advance: (ms) => { t += ms; } };
}

test('runner: learns from every source, idempotent, a failing source keeps the others', async () => {
  const w = fakeWorld();
  const mem = createBrandMemory(w.deps);
  const a = await mem.refreshAccount('u1');
  assert.deepStrictEqual(a, { ok: true, changed: true });
  const doc = w.docs.get('u1');
  const sources = new Set(doc.learnedItems.map((i) => i.source));
  for (const s of ['plan', 'customers', 'products']) assert.ok(sources.has(s), s);
  assert.strictEqual(doc.learnedSources.results.state, 'none');
  assert.strictEqual(doc.learnedSources.competitors.state, 'none');
  assert.strictEqual(doc.learnedSources.blueprint.state, 'none');
  w.advance(5000);
  const b = await mem.refreshAccount('u1');
  assert.deepStrictEqual(b, { ok: true, changed: false });
  assert.deepStrictEqual(w.calls[w.calls.length - 1][2].sort(), ['learnedCheckedAt', 'learnedRefreshedAt', 'learnedSources'].sort());

  const broken = fakeWorld({ deps: { products: async () => { throw new Error('db down'); } } });
  const m2 = createBrandMemory(broken.deps);
  await quiet(() => m2.refreshAccount('u1'));
  const d2 = broken.docs.get('u1');
  assert.strictEqual(d2.learnedSources.products.state, 'error');
  assert.match(d2.learnedSources.products.reason, /could not read this just now/);
  assert.ok(d2.learnedItems.some((i) => i.source === 'plan'));
});

test('runner: Refresh now cooldown, one at a time, staff, unknown account, time box', async () => {
  const w = fakeWorld({ users: { u1: { _id: 'u1', businessProfile: {} }, s1: { _id: 's1', staffRole: 'csm' } } });
  const mem = createBrandMemory(w.deps);
  assert.strictEqual((await mem.refreshAccount('u1', { manual: true })).ok, true);
  const again = await mem.refreshAccount('u1', { manual: true });
  assert.strictEqual(again.reason, 'cooldown');
  assert.ok(again.retryAfterMs > 0 && again.retryAfterMs <= C.TIMING.COOLDOWN_MS);
  w.advance(C.TIMING.COOLDOWN_MS + 1000);
  assert.strictEqual((await mem.refreshAccount('u1', { manual: true })).ok, true);
  w.docs.get('u1').learnedLockUntil = new Date(w.deps.now().getTime() + 30000);
  assert.strictEqual((await mem.refreshAccount('u1')).reason, 'busy');
  assert.strictEqual((await mem.refreshAccount('s1')).reason, 'staff');
  assert.strictEqual((await mem.refreshAccount('nobody')).reason, 'no_user');

  const slow = fakeWorld({ deps: { budgetMs: 30, plan: () => new Promise((r) => setTimeout(() => r(null), 200)) } });
  const m3 = createBrandMemory(slow.deps);
  slow.docs.set('u1', { learnedManualAt: null });
  const r = await m3.refreshAccount('u1', { manual: true });
  assert.strictEqual(r.reason, 'timeout');
  assert.strictEqual(slow.docs.get('u1').learnedLockUntil, null, 'lock released');
  assert.strictEqual(slow.docs.get('u1').learnedManualAt, null, 'a failed Refresh now does not start the cooldown');
});

test('runner: the view refreshes on the first visit and after a change; staff get an empty memory', async () => {
  let changed = null;
  const w = fakeWorld({ users: { u1: { _id: 'u1', businessProfile: {} }, s1: { _id: 's1', isCsm: true } }, deps: { latestChange: async () => changed, trackedCount: async () => 7 } });
  const mem = createBrandMemory(w.deps);
  const v1 = await mem.getView('u1');
  assert.strictEqual(v1.refreshed, true);
  assert.strictEqual(v1.tracked, 7);
  assert.deepStrictEqual(v1.sources.map((s) => s.key), C.SOURCES);
  assert.strictEqual(v1.sources.find((s) => s.key === 'plan').title, 'Learned from your plan');
  const v2 = await mem.getView('u1');
  assert.strictEqual(v2.refreshed, false);
  w.advance(1000);
  changed = new Date(w.deps.now().getTime());
  w.advance(1000);
  assert.strictEqual((await mem.getView('u1')).refreshed, true);
  const staff = await mem.getView('s1');
  assert.strictEqual(staff.staff, true);
  assert.strictEqual(staff.itemCount, 0);
});

test('runner: edit keeps the words, delete never comes back after a refresh', async () => {
  const w = fakeWorld();
  const mem = createBrandMemory(w.deps);
  await mem.refreshAccount('u1');
  assert.strictEqual((await mem.editItem('u1', 'plan-themes', 'Mostly festive looks')).ok, true);
  assert.strictEqual((await mem.hideItem('u1', 'plan-channels')).ok, true);
  assert.strictEqual((await mem.hideItem('u1', 'nope')).reason, 'not_found');
  w.advance(1000);
  await mem.refreshAccount('u1');
  const items = w.docs.get('u1').learnedItems;
  assert.strictEqual(items.find((i) => i.key === 'plan-themes').text, 'Mostly festive looks');
  assert.ok(!items.some((i) => i.key === 'plan-channels'));
  assert.deepStrictEqual(w.docs.get('u1').learnedHidden, ['plan-channels']);
});

test('daily job: one server at a time, bounded, skips unchanged accounts, recomputes changed ones', async () => {
  const none = fakeWorld({ deps: { lease: { claim: async () => null, release: async () => {} } } });
  assert.deepStrictEqual(await createBrandMemory(none.deps).runDailyOnce(), { ran: false, reason: 'lease' });
  const w = fakeWorld({ users: { u1: { _id: 'u1', businessProfile: {} }, u2: { _id: 'u2', businessProfile: {} }, s1: { _id: 's1', staffRole: 'admin' } } });
  const mem = createBrandMemory(w.deps);
  await mem.refreshAccount('u1');
  w.docs.set('u2', {});
  w.docs.set('s1', {});
  w.advance(1000);
  const r = await mem.runDailyOnce({ limit: 10 });
  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.unchanged, 1, 'u1 had no change');
  assert.strictEqual(r.refreshed, 1, 'u2 never learned');
  assert.strictEqual(r.skipped, 1, 'staff');
  let seen = 0;
  const capped = fakeWorld({ deps: { dueAccounts: async (_n, limit) => { seen = limit; return []; } } });
  await createBrandMemory(capped.deps).runDailyOnce();
  assert.strictEqual(seen, C.TIMING.JOB_BATCH);
});

test('job switch and triggers: on by default, off with ENABLE_MEMORY_REFRESH=off; triggers do nothing until started', () => {
  const logs = [];
  assert.strictEqual(startBrandMemoryJob({ env: { ENABLE_MEMORY_REFRESH: 'off' }, logger: { log: (m) => logs.push(m), warn() {} } }), null);
  assert.match(logs[0], /off/);
  _triggers.set(false);
  refreshSoon('u1', 'test');
  assert.strictEqual(_triggers.pending.size, 0);
  const timer = startBrandMemoryJob({ env: {}, logger: { log() {}, warn() {} }, memory: { runDailyOnce: async () => ({ ran: false }) } });
  assert.ok(timer);
  clearInterval(timer);
  refreshSoon('u1', 'test');
  refreshSoon('u1', 'test');
  assert.strictEqual(_triggers.pending.size, 1, 'debounced per account');
  for (const t of _triggers.pending.values()) clearTimeout(t);
  _triggers.pending.clear();
  _triggers.set(false);
});

test('view: old model notes show under your results with their strength; cooldown in seconds', () => {
  const v = buildView({
    learnedNotes: [{ _id: 'n1', text: 'Carousels about pricing do well', confidence: 0.8, sourceIds: ['a', 'b', 'c'] }],
    learnedItems: [{ key: 'plan-themes', source: 'plan', text: 'Themes', evidenceText: 'from your plan', confidence: 'strong' }],
    learnedSources: { products: { state: 'none', reason: 'No products', evidenceCount: 0 } },
    learnedManualAt: new Date(NOW.getTime() - 4 * 60000)
  }, { now: NOW });
  const results = v.sources.find((s) => s.key === 'results');
  assert.strictEqual(results.items[0].type, 'note');
  assert.strictEqual(results.items[0].confidence, 'strong');
  assert.strictEqual(results.items[0].evidenceText, 'from 3 published posts');
  assert.strictEqual(v.sources.find((s) => s.key === 'products').reason, 'No products');
  assert.strictEqual(v.cooldown.seconds, 360);
  assert.strictEqual(v.itemCount, 2);
});

// ---- routes -------------------------------------------------------------------------------------------------------
const mkRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } });
const handlerOf = (router, method, path) => {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  assert.strictEqual(layer.route.stack[0].handle, protect, `${method} ${path} signs in first`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

test('routes: own account only, cooldown 429 with minutes, busy 409, staff 403, edit and delete checks', async () => {
  const seen = [];
  let next = { ok: true, changed: true };
  const memory = {
    getView: async (id) => { seen.push(['view', id]); return { sources: [], itemCount: 0 }; },
    refreshAccount: async (id, o) => { seen.push(['refresh', id, o.manual]); return next; },
    editItem: async (id, key, text) => (key === 'plan-themes' ? { ok: true, item: { key, text } } : { ok: false }),
    hideItem: async (id, key) => (key === 'plan-themes' ? { ok: true } : { ok: false })
  };
  const router = createLearnedRouter({ memory });
  const call = async (method, path, req) => { const res = mkRes(); await handlerOf(router, method, path)({ params: {}, body: {}, query: {}, ...req }, res); return res; };
  const v = await call('get', '/learned', { user: { _id: 'u1' }, query: { userId: 'u9' } });
  assert.strictEqual(v.code, 200);
  assert.deepStrictEqual(seen[0], ['view', 'u1']);
  assert.strictEqual(v.headers['Cache-Control'], 'private, no-store');
  assert.strictEqual((await call('get', '/learned', { user: null })).code, 401);
  const ok = await call('post', '/learned/refresh', { user: { _id: 'u1' } });
  assert.strictEqual(ok.body.message, 'Nebulaa learned something new.');
  assert.deepStrictEqual(seen[1], ['refresh', 'u1', true]);
  next = { ok: false, reason: 'cooldown', retryAfterMs: 7 * 60000 - 5000 };
  const cool = await call('post', '/learned/refresh', { user: { _id: 'u1' } });
  assert.strictEqual(cool.code, 429);
  assert.match(cool.body.message, /refresh again in 7 minutes/);
  assert.strictEqual(cool.headers['Retry-After'], '415');
  next = { ok: false, reason: 'busy' };
  assert.strictEqual((await call('post', '/learned/refresh', { user: { _id: 'u1' } })).code, 409);
  next = { ok: false, reason: 'staff' };
  assert.strictEqual((await call('post', '/learned/refresh', { user: { _id: 's1' } })).code, 403);
  next = { ok: false, reason: 'timeout' };
  assert.strictEqual((await call('post', '/learned/refresh', { user: { _id: 'u1' } })).code, 503);
  assert.strictEqual((await call('patch', '/learned/:key', { user: { _id: 'u1' }, params: { key: 'plan-themes' }, body: { text: ' New words ' } })).body.item.text, 'New words');
  assert.strictEqual((await call('patch', '/learned/:key', { user: { _id: 'u1' }, params: { key: 'plan-themes' }, body: { text: '' } })).code, 400);
  assert.strictEqual((await call('patch', '/learned/:key', { user: { _id: 'u1' }, params: { key: 'BAD KEY!' }, body: { text: 'x' } })).code, 400);
  assert.strictEqual((await call('delete', '/learned/:key', { user: { _id: 'u1' }, params: { key: 'plan-themes' } })).code, 200);
  assert.strictEqual((await call('delete', '/learned/:key', { user: { _id: 'u1' }, params: { key: 'other' } })).code, 404);
  const boom = createLearnedRouter({ memory: { getView: async () => { throw new Error('x'); } } });
  const res = mkRes();
  await quiet(() => handlerOf(boom, 'get', '/learned')({ user: { _id: 'u1' } }, res));
  assert.strictEqual(res.code, 500);
});

test('deletion: the learned memory lives on the AIBrandMemory document, which account deletion erases', () => {
  const { erasable } = require('../services/dataRegistry');
  assert.ok(erasable().some((r) => r.model === 'AIBrandMemory' && r.field === 'userId'));
  const M = require('../models/AIBrandMemory');
  for (const f of ['learnedItems', 'learnedHidden', 'learnedSources', 'learnedRefreshedAt', 'learnedManualAt', 'learnedLockUntil']) assert.ok(M.schema.path(f), f);
  const item = M.schema.path('learnedItems').schema;
  assert.deepStrictEqual(item.path('confidence').enumValues, ['strong', 'good', 'early']);
  assert.deepStrictEqual(item.path('source').enumValues, C.SOURCES);
  // An old document without the new fields still validates (backwards compatible).
  const doc = new M({ organizationId: 'u1', userId: '507f1f77bcf86cd799439011', learnedNotes: [{ text: 'Old note' }] });
  assert.strictEqual(doc.validateSync(), undefined);
});

test('no model call: the brand memory modules never load a model client', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../services/brandMemory');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/openAI|geminiAI|claudeAI|llmRouter|callTextLLM|quarkBuckets|spend\(/.test(src), f);
  }
});
