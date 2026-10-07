/**
 * Seeds made-up data so the staff screens (Home, Clients, client page, Team) can be tried against the
 * real routes. Every name is fake and every email ends in @example.test.
 *
 * SAFETY: refuses to run unless MONGODB_URI points at a LOCAL host and a database whose name starts
 * with `nebulaa_seed_`. It empties the users, drafts, featureevents, staffactions, campaigns, video, hero video, blueprint and inbox-message collections of
 * that database first. Never point it at a real database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27018/nebulaa_seed_staff node scripts/seed-staff-demo.js
 *
 * Sign-in for the seeded team: the emails and password printed at the end (password below, invented).
 * The data is deterministic (fixed random seed) except that dates are relative to the moment you run it.
 */
const { PLANS, ADDONS, TOPUP_PACKS, QUARK_COSTS, gstPaise, chargePaise } = require('../config/apiCosts');
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'SeedDemo-Staff-2026';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const DB_PREFIX = 'nebulaa_seed_';

/** Throws (with a plain reason) unless the address is a single local host and a nebulaa_seed_ database. */
function assertSafeTarget(uri) {
  if (!uri || typeof uri !== 'string') throw new Error('Set MONGODB_URI to a local throwaway database, for example mongodb://127.0.0.1:27018/nebulaa_seed_staff');
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?(?:\?.*)?$/.exec(uri.trim());
  if (!m) throw new Error('MONGODB_URI is not a plain mongodb:// address; the seed only runs against a local host (no SRV, no lists)');
  const hostPort = m[1];
  if (hostPort.includes(',')) throw new Error('MONGODB_URI lists more than one host; the seed only runs against one local host');
  const host = hostPort.startsWith('[') ? hostPort.replace(/\]:\d+$/, ']') : hostPort.replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`Host "${host}" is not local; the seed only runs against localhost or 127.0.0.1`);
  const db = decodeURIComponent(m[2] || '');
  if (!db.startsWith(DB_PREFIX)) throw new Error(`The database name must start with ${DB_PREFIX} (got "${db}")`);
  return { host, db };
}

// ---- deterministic random numbers -------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const BUSINESS_WORDS = ['Annapurna', 'Lakshmi', 'Kaveri', 'Madurai', 'Saraswati', 'Gokul', 'Ganga', 'Vijaya', 'Chola', 'Meenakshi', 'Surya', 'Nandi', 'Hampi', 'Jaipur', 'Konark', 'Malabar', 'Ajanta', 'Rangoli', 'Tulsi', 'Bharat'];
const BUSINESS_TYPES = ['Sweets', 'Textiles', 'Bakery', 'Tutors', 'Clinic', 'Boutique', 'Salon', 'Hardware', 'Organics', 'Studio', 'Travels', 'Jewellers', 'Dental Care', 'Fitness', 'Florists'];
const FIRST = ['Arun', 'Bala', 'Charu', 'Deepa', 'Farhan', 'Gita', 'Hari', 'Indu', 'Jai', 'Kavya', 'Lata', 'Mohan', 'Nisha', 'Om', 'Preeti', 'Qadir', 'Ravi', 'Sana', 'Tara', 'Uday'];
const LAST = ['Demo', 'Sample', 'Test', 'Fake'];
const INDUSTRIES = ['Food and drink', 'Fashion', 'Health', 'Education', 'Retail', 'Travel', 'Beauty'];
const CITIES = ['Chennai', 'Pune', 'Jaipur', 'Kochi', 'Indore', 'Surat'];
const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'twitter', 'gmb', 'youtube'];
const FEATURES = ['create_post', 'generate_image', 'schedule_post', 'video', 'blueprint', 'caption'];

const set = (...n) => new Set(n);
// Which of the 60 clients (index 0..59) have each trait. Kept explicit so counts are easy to reason about.
const TRAITS = {
  inactive: set(3, 6, 9, 12, 17, 19, 21, 23, 26, 28, 33, 36, 39, 42, 47, 50, 53, 56, 58),
  disabled: set(14, 28, 39, 56),
  lowQuarks: { 2: 0, 7: 45, 13: 80, 18: 99, 25: 12, 31: 60, 41: 99, 44: 5, 52: 0 },
  exactly100: set(40),
  draftsWaiting: set(1, 4, 8, 11, 16, 22, 27, 30, 35, 43, 45, 48),
  noSocial: set(5, 10, 20, 24, 29, 34, 43, 46, 49, 55, 57, 59),
  failedRecent: set(0, 2, 5, 9, 15, 21, 32, 38, 46, 51),
  failedOld: set(3, 12),
  unfinished: set(8, 13, 19, 26, 31, 37, 42, 48, 54),
  expiredTrial: set(20, 21, 22, 23, 24),
  failedPaymentOnly: set(15),
  refundedOnly: set(16)
};

function planFor(i) {
  if (i < 5) return { plan: undefined, tier: 'managed' }; // older accounts have no plan.tier
  if (i < 15) return { plan: { tier: 'managed', addons: [] }, tier: 'managed' };
  if (i < 30) return { plan: { tier: 'free', addons: [] }, tier: 'free' };
  if (i < 45) return { plan: { tier: 'starter', addons: i % 3 === 0 ? ['publish'] : i % 3 === 1 ? ['publish', 'inbox'] : [] }, tier: 'starter' };
  return { plan: { tier: 'professional', addons: i % 2 === 0 ? ['bundle', 'publish', 'competitors', 'inbox'] : ['publish'] }, tier: 'professional' };
}

// Actions the app really charges for, in a mix: mostly posts and images, some captions and video, a little of the rest.
const SPEND_ACTIONS = ['campaign_full', 'image_generated', 'campaign_text', 'campaign_full', 'video_generated', 'carousel_generated', 'image_edit', 'campaign_text', 'blueprint', 'chat_message', 'hero_video_clip', 'video_base'];

const PAYING = (i) => (i >= 0 && i <= 9) || (i >= 30 && i <= 37) || (i >= 45 && i <= 54);
const ACTIVE_SUB = (i) => (i >= 30 && i <= 34) || (i >= 45 && i <= 54);

/** Builds every document in memory (no database), so the plan can be inspected or tested. */
function buildData(now = Date.now(), passwordHash = 'x'.repeat(60)) {
  const rand = rng(20261007);
  const rand2 = rng(777); // a second stream for the usage data, so adding it never changes the numbers drawn above
  const between = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const ago = (days) => new Date(now - days * DAY);

  const staff = [
    { key: 'owner', email: 'aarav.owner@example.test', firstName: 'Aarav', lastName: 'Demo', staffRole: 'owner' },
    { key: 'admin', email: 'bhavna.admin@example.test', firstName: 'Bhavna', lastName: 'Demo', staffRole: 'admin' },
    { key: 'csm1', email: 'chitra.csm@example.test', firstName: 'Chitra', lastName: 'Demo', staffRole: 'csm', isCsm: true },
    { key: 'csm2', email: 'dev.csm@example.test', firstName: 'Dev', lastName: 'Demo', staffRole: 'csm', isCsm: true },
    { key: 'csm3', email: 'esha.csm@example.test', firstName: 'Esha', lastName: 'Demo', staffRole: 'csm', isCsm: true }
  ].map((s, n) => ({
    ...s, password: passwordHash, companyName: 'Nebulaa', isVerified: true, isActive: true, isHidden: true,
    onboardingCompleted: true, lastLoginAt: ago(n * 0.3), createdAt: ago(200), updatedAt: ago(1)
  }));

  // Who gets which CSM: a fixed shuffle so the loads are 18 / 9 / 3 and 30 clients have none.
  const order = Array.from({ length: 60 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const csmOf = {};
  order.slice(0, 18).forEach((i) => { csmOf[i] = 'csm1'; });
  order.slice(18, 27).forEach((i) => { csmOf[i] = 'csm2'; });
  order.slice(27, 30).forEach((i) => { csmOf[i] = 'csm3'; });

  const clients = [];
  const events = []; // { client index, feature, at }
  const drafts = []; // { client index, status, createdAt, updatedAt, imageUrl?, slides?, variant? }
  const campaigns = []; // posts that reached a social account
  const videoJobs = []; const heroJobs = []; const blueprints = []; const inbox = [];

  for (let i = 0; i < 62; i++) {
    const hiddenTest = i >= 60;
    const idx = hiddenTest ? i : i;
    const word = BUSINESS_WORDS[i % BUSINESS_WORDS.length];
    const type = BUSINESS_TYPES[(i * 7 + 3) % BUSINESS_TYPES.length];
    const business = hiddenTest ? `Demo Hidden Test ${i - 59}` : `Demo ${word} ${type}`;
    const inactive = TRAITS.inactive.has(i);

    // Sign-up date: most in the last 30 days (a few today and yesterday), some in the 30 days before.
    let ageDays;
    if (i % 20 === 4) ageDays = between(0.05, 0.9); // today
    else if (i % 20 === 11) ageDays = between(1.1, 1.9); // yesterday
    else if (i % 6 === 0 || inactive) ageDays = between(inactive ? 12 : 31, inactive ? 29 : 75);
    else ageDays = between(2, 29.5);
    const createdAt = ago(ageDays);

    // Last sign-in: active clients within 6 days, inactive ones 8+ days ago (after sign-up).
    const lastLoginAt = inactive
      ? new Date(createdAt.getTime() + rand() * Math.max(0, (now - 8 * DAY) - createdAt.getTime()))
      : new Date(Math.max(createdAt.getTime(), now - between(0.05, 6) * DAY));

    const { plan, tier } = planFor(i);
    const paid = PAYING(i);
    const payments = [];
    const subs = [];
    let subscription;
    const rupees = (inr) => chargePaise(inr) / 100; // what the card is charged, including GST
    const sub = (kind, key, active) => ({ subscriptionId: `sub_demo_${i}_${kind === 'plan' ? 'p' : key}`, kind, key, razorpayPlanId: `plan_demo_${kind}_${key}`, active, createdAt });
    const charge = (record, at, over = {}) => payments.push({
      razorpayOrderId: record.subscriptionId, razorpayPaymentId: `pay_demo_${i}_${payments.length}`,
      amount: rupees(record.kind === 'plan' ? PLANS[record.key].inr : ADDONS[record.key].inr), currency: 'INR',
      credits: record.kind === 'plan' ? PLANS[record.key].quarks : 0, status: 'paid',
      item: record.kind === 'plan' ? 'Nebulaa subscription' : 'Nebulaa add-on',
      exGstAmount: record.kind === 'plan' ? PLANS[record.key].inr : ADDONS[record.key].inr, paidAt: at, ...over
    });
    const safeAge = Math.max(0.6, ageDays - 0.2);
    let planDoc = plan ? { ...plan } : undefined;
    if (paid && i <= 9) {
      // Older managed accounts paid by hand before GST was split out: no ex-GST amount stored for the first five.
      for (let k = 0; k < 1 + (i % 3); k++) payments.push({ razorpayOrderId: `order_demo_${i}_${k}`, razorpayPaymentId: `pay_demo_${i}_${k}`, amount: 11800, currency: 'INR', credits: 0, status: 'paid', item: 'Nebulaa subscription', ...(i > 4 ? { exGstAmount: 10000 } : {}), paidAt: new Date(Math.min(now - 3600000, Math.max(createdAt.getTime() + DAY / 2, now - (k * 30 + between(1, 20)) * DAY))) });
    } else if (paid && (tier === 'starter' || tier === 'professional')) {
      const planRec = sub('plan', tier, ACTIVE_SUB(i));
      subs.push(planRec);
      const lastCharge = Math.min(((i * 2) % 28) + 1, safeAge / 2); // days ago
      const nCharges = Math.max(1, Math.min(1 + (i % 3), Math.floor(safeAge / 30) + 1));
      for (let k = nCharges - 1; k >= 0; k--) charge(planRec, ago(lastCharge + k * 30));
      const addonKeys = tier === 'starter' ? (i % 3 === 0 ? ['publish'] : i % 3 === 1 ? ['publish', 'inbox'] : []) : (i % 2 === 0 ? ['bundle'] : ['publish']);
      if (ACTIVE_SUB(i)) {
        addonKeys.forEach((key) => { const rec = sub('addon', key, true); subs.push(rec); charge(rec, ago(Math.min(lastCharge, safeAge / 2))); });
        const next = new Date(now + (30 - lastCharge) * DAY);
        subscription = { plan: 'pro', status: 'active', razorpaySubscriptionId: planRec.subscriptionId, razorpayPlanId: planRec.razorpayPlanId, currentPeriodEnd: next, nextBillingAt: next };
      } else {
        // The plan stopped: halted (renewal failed), or cancelled. Plan goes back to free and add-ons are cleared, as the billing code does.
        const state = i === 35 ? 'halted' : 'cancelled';
        const endedDaysAgo = i === 37 ? 50 : i === 36 ? 12 : 5;
        subscription = { plan: 'pro', status: state, razorpaySubscriptionId: planRec.subscriptionId, razorpayPlanId: planRec.razorpayPlanId, currentPeriodEnd: ago(Math.min(endedDaysAgo, safeAge)) };
        planDoc = { tier: 'free', addons: [] };
      }
    }
    // Quark top-ups: paying clients only, so the Paying counts stay as they were.
    if (paid && i % 4 === 2) {
      const pack = TOPUP_PACKS[i % TOPUP_PACKS.length];
      payments.push({ razorpayOrderId: `order_demo_${i}_t`, razorpayPaymentId: `pay_demo_${i}_t`, amount: rupees(pack.inr), currency: 'INR', credits: pack.quarks, status: 'paid', item: 'Nebulaa Quarks', exGstAmount: pack.inr, paidAt: ago(Math.min(safeAge, 2 + (i % 20))) });
    }
    // Declined attempts and a refund. The app does not record declined attempts today; these show how they would look if it did.
    if (TRAITS.failedPaymentOnly.has(i)) payments.push({ razorpayOrderId: `order_demo_${i}_f`, razorpayPaymentId: `pay_demo_${i}_f`, amount: rupees(TOPUP_PACKS[1].inr), currency: 'INR', credits: TOPUP_PACKS[1].quarks, status: 'failed', item: 'Nebulaa Quarks', exGstAmount: TOPUP_PACKS[1].inr, paidAt: ago(Math.min(ageDays - 0.1, 3)) });
    if (i === 31 || i === 47) payments.push({ razorpayOrderId: `order_demo_${i}_f`, razorpayPaymentId: `pay_demo_${i}_f`, amount: rupees(TOPUP_PACKS[0].inr), currency: 'INR', credits: TOPUP_PACKS[0].quarks, status: 'failed', item: 'Nebulaa Quarks', exGstAmount: TOPUP_PACKS[0].inr, paidAt: ago(Math.min(safeAge, i === 31 ? 8 : 40)) });
    if (TRAITS.refundedOnly.has(i)) payments.push({ razorpayOrderId: `order_demo_${i}_r`, razorpayPaymentId: `pay_demo_${i}_r`, amount: rupees(TOPUP_PACKS[0].inr), currency: 'INR', credits: TOPUP_PACKS[0].quarks, status: 'refunded', item: 'Nebulaa Quarks', exGstAmount: TOPUP_PACKS[0].inr, paidAt: ago(Math.min(ageDays - 0.1, 5)) });

    if (planDoc) planDoc.subscriptions = subs;
    const trial = tier === 'free' || (!paid && tier !== 'managed')
      ? { startDate: createdAt, expiresAt: new Date(createdAt.getTime() + 14 * DAY), isExpired: TRAITS.expiredTrial.has(i) }
      : undefined;

    const quarks = TRAITS.lowQuarks[i] !== undefined ? TRAITS.lowQuarks[i] : TRAITS.exactly100.has(i) ? 100 : Math.round(between(150, 4200));
    const connected = hiddenTest ? 1 : TRAITS.noSocial.has(i) ? 0 : 1 + Math.floor(rand() * 4);
    const platforms = Array.from(new Set(Array.from({ length: connected }, () => pick(PLATFORMS))));
    const viaDirect = i % 4 === 0; // some accounts store connections directly, most through the posting provider

    const first = FIRST[i % FIRST.length];
    clients.push({
      key: `c${i}`, index: i,
      email: hiddenTest ? `demo.hidden${i - 59}@example.test` : `demo.client${String(i + 1).padStart(2, '0')}@example.test`,
      password: passwordHash, firstName: first, lastName: LAST[i % LAST.length], companyName: business,
      mobileNumber: `+91 90000 ${String(10000 + i).slice(-5)}`,
      isVerified: true, isActive: !TRAITS.disabled.has(i), isHidden: hiddenTest,
      onboardingCompleted: !TRAITS.unfinished.has(i),
      businessProfile: { name: i % 2 === 0 ? business : '', industry: INDUSTRIES[i % INDUSTRIES.length], businessLocation: CITIES[i % CITIES.length], website: `https://demo-${word.toLowerCase()}.example.test` },
      credits: { balance: quarks, totalUsed: Math.round(between(0, 3000)), history: [] },
      payments, plan: planDoc, ...(subscription ? { subscription } : {}), ...(trial ? { trial } : {}),
      connectedSocials: viaDirect ? platforms.map((p) => ({ platform: p, accountId: `acct_${i}_${p}`, accountName: `${business} ${p}`, connectedAt: createdAt })) : [],
      ayrshare: { activeSocialAccounts: viaDirect ? [] : platforms, ...(connected > 0 && i % 3 !== 1 ? { profileKey: `PROFILE-KEY-DEMO-${i}`, title: business } : {}) },
      assignedCsm: csmOf[i] || null, // replaced with the real id when inserted
      lastLoginAt, createdAt, updatedAt: lastLoginAt
    });
    if (csmOf[i]) clients[clients.length - 1].csmKey = csmOf[i];

    // Feature use: active clients used something in the last 7 days; inactive ones only before that.
    const first7 = Math.max(0, Math.min(ageDays, 7));
    const nEvents = 3 + Math.floor(rand() * 30);
    for (let k = 0; k < nEvents; k++) {
      let when;
      if (inactive) {
        const oldest = Math.max(8.5, ageDays - 0.05);
        if (ageDays < 8.5) break;
        when = between(8.5, Math.min(30, oldest));
      } else {
        when = k === 0 ? between(0.02, Math.max(0.03, Math.min(first7, 6.5))) : between(0.02, Math.min(30, Math.max(0.05, ageDays - 0.02)));
      }
      events.push({ index: i, feature: pick(FEATURES), at: ago(when) });
    }

    // Drafts: some waiting more than 3 days, fresh ones, published ones, failed ones.
    const make = (status, minDays, maxDays) => {
      const d = Math.min(between(minDays, maxDays), Math.max(0.02, ageDays - 0.02));
      const at = ago(d);
      const updatedAt = status === 'draft' ? at : new Date(at.getTime() + DAY / 4 > now ? now : at.getTime() + DAY / 4);
      const r = rand2();
      drafts.push({ index: i, status, createdAt: at, updatedAt, ...(r < 0.12 ? { slides: 3 + Math.floor(rand2() * 3) } : r < 0.82 ? { imageUrl: 'https://example.test/demo-image.jpg' } : {}) });
      if (status === 'published') campaigns.push({ index: i, status: 'posted', publishedAt: updatedAt, createdAt: at });
    };
    if (TRAITS.draftsWaiting.has(i)) { make('draft', 4.2, 12); make('draft', 0.1, 3); }
    else if (i % 3 !== 0) make('draft', 0.1, 2.5);
    const published = i % 4;
    for (let k = 0; k < published; k++) make('published', 0.5, 20);
    if (TRAITS.failedRecent.has(i)) {
      const n = 1 + (i % 3);
      for (let k = 0; k < n; k++) { const at = ago(between(0.1, 6.5)); drafts.push({ index: i, status: 'failed', createdAt: new Date(createdAt.getTime() + 1), updatedAt: new Date(Math.max(at.getTime(), createdAt.getTime() + 2)) }); }
    }
    if (TRAITS.failedOld.has(i)) { const at = ago(Math.min(between(10, 20), Math.max(0.1, ageDays - 0.1))); drafts.push({ index: i, status: 'failed', createdAt: at, updatedAt: at }); }
  }

  // More realistic usage for the Usage page. Everything here uses the second random stream.
  clients.forEach((c) => {
    const i = c.index; const age = (now - c.createdAt.getTime()) / DAY;
    const at = (minD, maxD) => ago(Math.min(minD + rand2() * (maxD - minD), Math.max(0.03, age - 0.03)));
    if (age < 0.5) return;
    // extra drafts over the last 30 days for clients who work in the product
    if (i % 12 !== 0 && !TRAITS.inactive.has(i)) {
      const n = Math.floor(rand2() * 7);
      for (let k = 0; k < n; k++) { const when = at(0.1, 29); const r = rand2(); drafts.push({ index: i, status: r < 0.25 ? 'published' : 'draft', createdAt: when, updatedAt: when, ...(rand2() < 0.8 ? { imageUrl: 'https://example.test/demo-image.jpg' } : {}) }); if (r < 0.25) campaigns.push({ index: i, status: 'posted', publishedAt: when, createdAt: when }); }
    }
    // a translated copy of a draft now and then (the Usage page does not count these twice)
    if (i % 9 === 5) { const when = at(0.2, 20); drafts.push({ index: i, status: 'draft', createdAt: when, updatedAt: when, imageUrl: 'https://example.test/demo-image.jpg', variant: true }); }
    // video: some clients make finished videos, a few fail
    if (i % 5 === 0 || i === 61) {
      const n = 1 + Math.floor(rand2() * 3);
      for (let k = 0; k < n; k++) videoJobs.push({ index: i, status: k === 2 ? 'failed' : 'completed', createdAt: at(0.2, 28) });
    }
    if (i % 17 === 3 || i === 61) { heroJobs.push({ index: i, status: 'completed', createdAt: at(0.3, 25) }); if (i % 2) heroJobs.push({ index: i, status: 'failed', createdAt: at(0.3, 25) }); }
    if (i % 9 === 2 || i === 60) { blueprints.push({ index: i, status: 'completed', createdAt: at(0.3, 27) }); if (i % 2) blueprints.push({ index: i, status: 'stopped', createdAt: at(0.3, 27) }); }
    // reply suggestions for clients that have the inbox
    const hasInbox = tier2(c).includes('inbox') || (c.plan && c.plan.tier === 'managed' && i % 4 === 1);
    if (hasInbox) { const n = 3 + Math.floor(rand2() * 12); for (let k = 0; k < n; k++) inbox.push({ index: i, generatedAt: at(0.05, 29) }); }
  });
  function tier2(c) { const a = (c.plan && c.plan.addons) || []; return a.includes('bundle') ? [...a, 'inbox'] : a; }

  // A few Quark history lines so the client page has something to show.
  clients.slice(0, 12).forEach((c, n) => {
    c.credits.history = [
      { action: 'purchase', amount: 5000, description: 'Quark pack', balanceAfter: 5000, createdAt: new Date(c.createdAt.getTime() + 60000), timestamp: new Date(c.createdAt.getTime() + 60000) },
      { action: 'image_generated', amount: -QUARK_COSTS.image_generated, description: 'Image created', balanceAfter: c.credits.balance, createdAt: new Date(Math.max(ago(1 + n * 0.2).getTime(), c.createdAt.getTime() + 120000)), timestamp: new Date(Math.max(ago(1 + n * 0.2).getTime(), c.createdAt.getTime() + 120000)) }
    ];
  });

  // This month's Quark spending on paying clients (a refund each, one busy client with a long history) so the Money page has numbers.
  clients.forEach((c) => {
    if (!c.payments.some((p) => p.status === 'paid')) return;
    const n = c.index === 45 ? 62 : 3 + (c.index % 5);
    for (let k = 0; k < n; k++) {
      const at = ago(Math.min(between(0.05, 6), Math.max(0.05, (now - c.createdAt.getTime()) / DAY - 0.05)));
      between(0, 60); // keeps the earlier random numbers where they were
      const action = SPEND_ACTIONS[(k + c.index) % SPEND_ACTIONS.length];
      const spend = QUARK_COSTS[action];
      c.credits.history.push({ action, amount: -spend, description: 'Made something', balanceAfter: c.credits.balance, createdAt: at, timestamp: at });
      if (k === 1) c.credits.history.push({ action: `${action}_refund`, amount: spend, description: 'Refund', balanceAfter: c.credits.balance, createdAt: at, timestamp: at });
    }
  });

  // Free-plan and trial clients spend a few Quarks too (this month only).
  clients.forEach((c) => {
    if (c.payments.some((p) => p.status === 'paid') || c.isHidden) return;
    const age = (now - c.createdAt.getTime()) / DAY;
    if (age < 0.3) return;
    const n = 1 + Math.floor(rand2() * 4);
    for (let k = 0; k < n; k++) {
      const at = ago(Math.min(0.05 + rand2() * 6, Math.max(0.05, age - 0.05)));
      const action = SPEND_ACTIONS[Math.floor(rand2() * 4)];
      c.credits.history.push({ action, amount: -QUARK_COSTS[action], description: 'Made something', balanceAfter: c.credits.balance, createdAt: at, timestamp: at });
    }
  });

  return { staff, clients, events, drafts, csmOf, campaigns, videoJobs, heroJobs, blueprints, inbox };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const { host, db } = assertSafeTarget(uri);
  const mongoose = require('mongoose');
  const bcrypt = require('bcryptjs');
  const User = require('../models/User');
  const Draft = require('../models/Draft');
  const FeatureEvent = require('../models/FeatureEvent');
  const StaffAction = require('../models/StaffAction');
  const Campaign = require('../models/Campaign');
  const VideoJob = require('../models/VideoJob');
  const HeroVideoJob = require('../models/HeroVideoJob');
  const Blueprint = require('../models/Blueprint');
  const SocialInboxMessage = require('../models/SocialInboxMessage');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  if (mongoose.connection.name !== db) throw new Error('Connected database does not match the checked name; stopping.');
  console.log(`Seeding ${db} on ${host}`);

  const now = Date.now();
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  const data = buildData(now, hash);

  await Promise.all([User, Draft, FeatureEvent, StaffAction, Campaign, VideoJob, HeroVideoJob, Blueprint, SocialInboxMessage].map((m) => m.deleteMany({})));

  const staffDocs = await User.insertMany(data.staff);
  const byKey = Object.fromEntries(data.staff.map((s, n) => [s.key, staffDocs[n]._id]));
  const clientDocs = await User.insertMany(data.clients.map(({ key, index, csmKey, ...doc }) => ({ ...doc, assignedCsm: csmKey ? byKey[csmKey] : null })));
  const idOf = (index) => clientDocs[index]._id;

  await FeatureEvent.insertMany(data.events.map((e) => ({ userId: idOf(e.index), feature: e.feature, feature_module: 'content', timestamp: e.at })));
  await Draft.insertMany(data.drafts.map((d, n) => ({
    userId: idOf(d.index), title: `Demo post ${n + 1}`, caption: 'Made-up caption for the staff demo.', sourceType: d.slides ? 'carousel' : 'post', contentType: d.slides ? 'carousel' : 'post', status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt,
    ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
    ...(d.slides ? { carouselSlides: Array.from({ length: d.slides }, (_, k) => ({ order: k + 1, role: k === 0 ? 'hook' : 'build', headline: `Slide ${k + 1}`, imageUrl: 'https://example.test/demo-slide.jpg' })) } : {}),
    ...(d.variant ? { languageVariantOf: new mongoose.Types.ObjectId(), language: 'tamil' } : {})
  })), { lean: false });
  await Campaign.insertMany(data.campaigns.map((c, n) => ({ userId: idOf(c.index), name: `Demo campaign ${n + 1}`, platforms: ['instagram'], status: 'posted', ayrshareStatus: 'success', publishedAt: c.publishedAt, createdAt: c.createdAt, updatedAt: c.publishedAt })));
  const stamp = (j) => ({ createdAt: j.createdAt, updatedAt: j.createdAt, ...(j.status === 'completed' ? { completedAt: j.createdAt } : {}) });
  await VideoJob.insertMany(data.videoJobs.map((j, n) => ({ jobId: `demo-video-${n}`, userId: idOf(j.index), status: j.status, ...stamp(j) })));
  await HeroVideoJob.insertMany(data.heroJobs.map((j, n) => ({ jobId: `demo-hero-${n}`, userId: idOf(j.index), status: j.status, ...stamp(j) })));
  await Blueprint.insertMany(data.blueprints.map((j, n) => ({ blueprintId: `demo-blueprint-${n}`, userId: idOf(j.index), emailKey: `demo-${n}@example.test`, tierAtStart: data.clients[j.index].plan ? data.clients[j.index].plan.tier : 'managed', status: j.status, createdAt: j.createdAt, updatedAt: j.createdAt })));
  await SocialInboxMessage.insertMany(data.inbox.map((m, n) => ({ userId: idOf(m.index), conversationId: new mongoose.Types.ObjectId(), platform: 'instagram', providerMessageId: `demo-msg-${n}`, direction: 'inbound', messageType: 'comment', body: 'Made-up comment.', ai: { suggestedReplies: ['Thank you for writing to us.'], autoReplyStatus: 'suggested', generatedAt: m.generatedAt }, createdAt: m.generatedAt })));

  await StaffAction.insertMany([
    { actor: byKey.owner, actorRole: 'owner', action: 'add_quarks', client: idOf(10), details: { amount: 500, balanceAfter: 1500 }, at: new Date(now - 2 * DAY) },
    { actor: byKey.owner, actorRole: 'owner', action: 'assign_csm', client: idOf(3), details: { csm: String(byKey.csm1) }, at: new Date(now - 3 * DAY) },
    { actor: byKey.admin, actorRole: 'admin', action: 'disable_client', client: idOf(14), details: {}, at: new Date(now - 4 * DAY) },
    { actor: byKey.admin, actorRole: 'admin', action: 'bulk_assign_csm', details: { clients: 6, csm: String(byKey.csm2) }, at: new Date(now - 5 * DAY) },
    { actor: byKey.csm1, actorRole: 'csm', action: 'open_client', client: idOf(1), details: {}, at: new Date(now - 1 * DAY) },
    { actor: byKey.owner, actorRole: 'owner', action: 'team_add', client: byKey.csm3, details: { role: 'csm', converted: false, emailed: false }, at: new Date(now - 9 * DAY) }
  ]);

  const counts = { users: await User.countDocuments(), drafts: await Draft.countDocuments(), events: await FeatureEvent.countDocuments(), actions: await StaffAction.countDocuments(), campaigns: await Campaign.countDocuments(), videos: await VideoJob.countDocuments(), hero: await HeroVideoJob.countDocuments(), blueprints: await Blueprint.countDocuments(), inbox: await SocialInboxMessage.countDocuments() };
  console.log('Done:', JSON.stringify(counts));
  console.log('Team sign-in emails: aarav.owner@example.test (Owner), bhavna.admin@example.test (Admin), chitra.csm@example.test, dev.csm@example.test, esha.csm@example.test (CSMs). Password: see SEED_PASSWORD in this script.');
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((error) => { console.error('Seed stopped:', error.message); process.exit(1); });
}

module.exports = { assertSafeTarget, buildData, SEED_PASSWORD };
