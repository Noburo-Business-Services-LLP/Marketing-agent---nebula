/* Nebulaa visual-audit mock session.
 *
 * Classic (non-module) script. vite.audit.config.mjs inlines it as the FIRST element of
 * <head>, so it runs before Tailwind, before the app bundle and before any API call.
 *
 * What it does:
 *  1. Puts a FAKE signed-in session in localStorage ("audit-fake-token", not a real credential).
 *  2. Replaces window.fetch, XMLHttpRequest, WebSocket, EventSource and navigator.sendBeacon.
 *     - Any URL whose path starts with /api, /audio or /generated-media (on ANY host, including
 *       the hard-coded http://localhost:5000 in a few pages) gets canned JSON from ROUTES below.
 *     - Same-origin non-API requests (Vite modules, /assets, /favicon.png) go to the dev server.
 *     - Every other host is refused locally (status 503, logged in window.__AUDIT.blocked);
 *       nothing is sent. Script/link/img tags (Tailwind CDN, Google Fonts, esm.sh, Razorpay
 *       checkout.js) are not fetch/XHR and load as the app normally does.
 *     - Writes (POST/PUT/PATCH/DELETE) never leave the page either; they get a canned
 *       "audit stub" answer.
 *  3. Logs every intercepted call in window.__AUDIT.log (method, url, matched route).
 *  4. Exposes window.__nebulaaAudit(routeName) which loads contrast-audit.js from the dev
 *     server and runs it (see README.md).
 *
 * Mock data: user "Sunrise Bakery" (fake), a business profile, brand assets, 4 drafts,
 * a content calendar plan, 3 campaigns, 3 ideas, 2 products, quotas and credits.
 */
(function () {
  'use strict';
  if (window.__AUDIT) return;
  // On "localhost" several files build http://localhost:5000 URLs, and media tags (<img>, <video>,
  // <audio>) with those URLs would bypass this stub. Refuse to boot the app at all.
  if (location.hostname === 'localhost' || location.hostname === '[::1]') {
    var msg = 'Nebulaa audit stub: refusing to run on "' + location.hostname + '". Open http://127.0.0.1:' + location.port + '/ instead.';
    console.error(msg);
    window.stop();
    document.documentElement.innerHTML = '<head><title>Audit refused</title></head><body style="font:16px sans-serif;padding:24px"><h1>Audit refused</h1><p>' + msg + '</p></body>';
    window.__AUDIT_REFUSED = true;
    return;
  }

  var AUDIT = (window.__AUDIT = { log: [], blocked: [], unmatched: [], startedAt: Date.now() });

  // ---- 1. fake session ------------------------------------------------------------------
  var CLIENT_TOKEN = 'audit-fake-client-token'; // what the mock "open a client" answer hands out
  var cameWithClientToken = false;
  try { cameWithClientToken = localStorage.getItem('authToken') === CLIENT_TOKEN; } catch (e) { /* ignore */ }
  try {
    localStorage.setItem('authToken', cameWithClientToken ? CLIENT_TOKEN : 'audit-fake-token');
    localStorage.setItem('token', 'audit-fake-token');
    localStorage.removeItem('nebulaa-theme');
    // Keep first-run tours and popups from covering the pages.
    localStorage.setItem('nebulaa_tour_completed', 'true');
    localStorage.setItem('onboardingTourCompleted', 'true');
  } catch (e) { /* ignore */ }
  // Session mode: ?audit=logged-out | onboarding | staff | normal (remembered for the tab in sessionStorage).
  var params = new URLSearchParams(location.search);
  if (params.get('audit')) sessionStorage.setItem('audit-mode', params.get('audit'));
  var MODE = sessionStorage.getItem('audit-mode') || 'normal';
  var LOGGED_OUT = MODE === 'logged-out';
  var NEEDS_ONBOARDING = MODE === 'onboarding';
  var STAFF = MODE === 'staff'; // a signed-in Owner, so the staff area and its menu entry show
  // Agency modes: agency = the agency's own account; agency-client = already inside the client "Sweet Co".
  // ?agencystate= full | empty | error | slow | busy | wrongpw | nosession picks the Clients page variant (kept for the tab).
  var AGENCY = MODE === 'agency' || MODE === 'agency-client';
  if (params.get('agencystate')) sessionStorage.setItem('audit-agency-state', params.get('agencystate'));
  var ASTATE = sessionStorage.getItem('audit-agency-state') || '';
  // ?compstate= all | locked | empty | error | puterr | put403 | put429 picks the competitor tracking variant (kept for the tab):
  // all = every handle state on one account, locked = no add-on (403), empty = no competitors, error = the card fails to load,
  // puterr / put403 / put429 = saving a handle is refused.
  if (params.get('compstate')) sessionStorage.setItem('audit-comp-state', params.get('compstate'));
  var CSTATE = sessionStorage.getItem('audit-comp-state') || 'all';
  // ?tier= free | starter | professional gives the normal account that plan tier (kept for the tab); used to look at the Competitors menu entry.
  if (params.get('tier')) sessionStorage.setItem('audit-tier', params.get('tier'));
  var TIERQ = sessionStorage.getItem('audit-tier') || '';
  // ?listenstate= ready | stale | notenough | off | error | locked | empty | waiting picks the "What people say about you" card variant (kept for the tab):
  // ready = scored with a trend, quotes and recent negative; stale = ready, but last checked more than 10 days ago ("Last checked on ..." line);
  // notenough = scored before, under the minimum; off = scoring not running or never scored: the card shows NOTHING (empty is the same);
  // error = fails to load; locked = no Inbox add-on (403); waiting = scored before, next weekly check pending.
  if (params.get('listenstate')) sessionStorage.setItem('audit-listen-state', params.get('listenstate'));
  var LSTATE = sessionStorage.getItem('audit-listen-state') || 'ready';
  // ?homestate= full | new | nosocials | building | client | free | error | slow picks the Home summary variant (kept for the tab):
  // full = a settled paid account with data, new = nothing yet and an unfinished profile, nosocials = paid but nothing connected,
  // building = the plan is being built, client = an agency client workspace, free = a free account, error = the summary fails,
  // slow = the summary answers after 4 seconds. The agency-client session mode shows the client variant by itself.
  if (params.get('homestate')) sessionStorage.setItem('audit-home-state', params.get('homestate'));
  var HSTATE = sessionStorage.getItem('audit-home-state') || 'full';
  // ?weekstate= ready | partly | approved | top_up | no_plan | skipped | not_eligible picks the This week card variant (kept for the tab).
  if (params.get('weekstate')) sessionStorage.setItem('audit-week-state', params.get('weekstate'));
  var WSTATE = sessionStorage.getItem('audit-week-state') || 'ready';
  // ?setupstate= mid | fresh | done picks the Setup card variant (kept for the tab).
  if (params.get('setupstate')) sessionStorage.setItem('audit-setup-state', params.get('setupstate'));
  var SSTATE = sessionStorage.getItem('audit-setup-state') || 'mid';
  // ?planstate= ready | old | building | failed | stale | none picks the My plan variant (kept for the tab).
  if (params.get('planstate')) sessionStorage.setItem('audit-plan-state', params.get('planstate'));
  var PSTATE = sessionStorage.getItem('audit-plan-state') || 'ready';
  var INSIDE = false;
  if (AGENCY) {
    try {
      if (MODE === 'agency-client' && !sessionStorage.getItem('audit-client-seeded')) {
        sessionStorage.setItem('audit-client-seeded', '1');
        localStorage.setItem('authToken', CLIENT_TOKEN);
        localStorage.setItem('csmReturnToken', 'audit-fake-token');
        localStorage.setItem('csmActingClient', 'Sweet Co');
        localStorage.setItem('csmReturnTo', '#/agency/clients');
      }
      INSIDE = localStorage.getItem('authToken') === CLIENT_TOKEN;
      if (!INSIDE) { localStorage.removeItem('csmReturnToken'); localStorage.removeItem('csmActingClient'); localStorage.removeItem('csmReturnTo'); }
    } catch (e) { /* ignore */ }
  }
  var MANAGED = MODE === 'managed'; // an account on the managed plan (plans page shows "managed by Nebulaa")
  // The payment window is replaced by a stand-in that can never reach a payment service: the real checkout
  // script (a <script> tag in index.html) cannot overwrite it. ?agencystate= slotdismiss | slotfail | slot409 picks the outcome.
  function FakeRazorpay(opts) { this.opts = opts || {}; this.h = {}; }
  FakeRazorpay.prototype.on = function (n, f) { this.h[n] = f; };
  FakeRazorpay.prototype.open = function () {
    var o = this.opts, self = this;
    AUDIT.log.push({ method: 'OPEN', url: 'fake-payment-window', route: 'FakeRazorpay', status: 200 });
    setTimeout(function () {
      if (ASTATE === 'slotdismiss') { if (o.modal && o.modal.ondismiss) o.modal.ondismiss(); return; }
      if (ASTATE === 'slotfail') { if (self.h['payment.failed']) self.h['payment.failed']({ error: { description: 'Your card was declined.' } }); return; }
      if (o.handler) o.handler({ razorpay_payment_id: 'pay_audit', razorpay_subscription_id: o.subscription_id, razorpay_signature: 'sig_audit' });
    }, 600);
  };
  try { Object.defineProperty(window, 'Razorpay', { configurable: false, get: function () { return FakeRazorpay; }, set: function () { /* the real script is ignored */ } }); } catch (e) { /* ignore */ }
  AUDIT.mode = MODE;
  if (LOGGED_OUT) { localStorage.removeItem('authToken'); localStorage.removeItem('token'); }

  // ---- 2. canned data -------------------------------------------------------------------
  var svg = function (bg, label) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="' + bg +
      '"/><text x="50%" y="50%" font-family="sans-serif" font-size="48" fill="#14203A" text-anchor="middle">' + label + '</text></svg>');
  };
  var IMG1 = svg('#F5D7A1', 'Croissant');
  var IMG2 = svg('#CDE8D6', 'Sourdough');
  var IMG3 = svg('#D9E4F5', 'Cake');
  var LOGO = svg('#F5A623', 'SB');

  var now = new Date();
  var iso = function (days) { var d = new Date(now); d.setDate(d.getDate() + days); return d.toISOString(); };
  var ymd = function (days) { return iso(days).slice(0, 10); };

  var businessProfile = {
    name: 'Sunrise Bakery', website: 'https://sunrise-bakery.example', gstNumber: '',
    industry: 'Food & Beverage', niche: 'Artisan bakery', businessType: 'B2C',
    businessLocation: 'Chennai, Tamil Nadu', targetAudience: 'Young families and office workers nearby',
    brandVoice: ['Warm', 'Friendly'], marketingGoals: ['Brand Awareness', 'Sales'],
    description: 'A neighbourhood bakery baking sourdough, croissants and celebration cakes every morning.',
    competitors: ['Daily Bread Co', 'Crumb & Co'], yearsInBusiness: 4, brandMaturity: 'growing',
    contentLanguage: 'english', additionalLanguages: ['kannada', 'telugu'], contentCadence: { postsPerDay: 1, reelsPerWeek: 2 },
  };
  var user = {
    _id: 'audit-user-1', id: 'audit-user-1', staffRole: STAFF ? 'owner' : null, email: 'owner@sunrise-bakery.example', firstName: 'Asha', lastName: 'Kumar',
    name: 'Asha Kumar', isVerified: true, onboardingCompleted: !NEEDS_ONBOARDING, businessProfile: businessProfile,
    trial: { startDate: iso(-3), expiresAt: iso(4), isExpired: false },
    subscription: { plan: 'pro', status: 'active', expiresAt: iso(27) },
    credits: { balance: 4200, totalUsed: 800 },
    brandScore: { score: 72, metrics: { engagement: 68, consistency: 75, authenticity: 74 } },
    preferences: { emailNotifications: true }, createdAt: iso(-30),
  };
  if (MANAGED) user.plan = { tier: 'managed' };
  if (TIERQ && !AGENCY && !MANAGED) user.plan = { tier: TIERQ };
  // The Terms prompt would cover the plans page; the Task 11 plans-page routes are audited with the terms already accepted.
  if (MANAGED || MODE === 'normal') user.consent = { acceptedAt: iso(-30), termsVersion: 'audit' };
  if (AGENCY) { var clientName = (function () { try { return localStorage.getItem('csmActingClient') || 'Sweet Co'; } catch (e) { return 'Sweet Co'; } })(); user.plan = { tier: 'agency' }; if (!INSIDE) user.consent = { acceptedAt: iso(-30), termsVersion: 'audit' }; user.actingAgency = INSIDE ? { name: 'Studio North' } : null; if (INSIDE) { user.businessProfile = Object.assign({}, businessProfile, { name: clientName }); user.firstName = clientName; } else { user.firstName = 'Studio North'; user.businessProfile = Object.assign({}, businessProfile, { name: 'Studio North' }); } }

  var draft = function (i, status, sourceType, img) {
    return {
      _id: 'audit-draft-' + i, id: 'audit-draft-' + i, title: ['Weekend croissant drop', 'Sourdough Sunday', 'Birthday cake orders open', 'Morning coffee combo'][i % 4],
      caption: 'Fresh out of the oven at 7am. Come early, they go fast.', hashtags: ['#bakery', '#chennai', '#freshbread'],
      cta: 'Visit us today', imageUrl: img, mediaUrl: img, imagePrompt: 'A warm bakery counter', platforms: ['instagram', 'facebook'],
      language: 'english', tone: 'warm', objective: 'awareness', scheduledDate: iso(i + 1), status: status,
      sourceType: sourceType, contentType: sourceType === 'reel' ? 'reel' : 'post', createdAt: iso(-i), updatedAt: iso(-i),
    };
  };
  var drafts = [draft(0, 'draft', 'post', IMG1), draft(1, 'draft', 'calendar', IMG2), draft(2, 'scheduled', 'campaign', IMG3), draft(3, 'published', 'post', IMG1)];

  var campaign = function (i, status) {
    return {
      _id: 'audit-campaign-' + i, id: 'audit-campaign-' + i, name: ['Diwali sweets box', 'Sourdough subscription', 'Weekend brunch'][i],
      objective: 'awareness', platforms: ['instagram', 'facebook'], tone: 'warm', status: status, priority: 'medium',
      description: 'Seasonal push for the bakery.', startDate: iso(i), endDate: iso(i + 7),
      creative: { type: 'image', textContent: 'Treat your family this festive season.', imageUrls: [[IMG1, IMG2, IMG3][i]], captions: 'Treat your family this festive season.', hashtags: ['#bakery'], callToAction: 'Order now', aiGenerated: true },
      scheduling: { startDate: iso(i), endDate: iso(i + 7), postTime: '09:00' },
      performance: { impressions: 1200 * (i + 1), clicks: 80 * (i + 1), ctr: 6.6, engagement: 140 * (i + 1), spend: 0 },
      createdAt: iso(-5 - i),
    };
  };
  var campaigns = [campaign(0, 'draft'), campaign(1, 'scheduled'), campaign(2, 'posted')];

  var calendarItems = [];
  for (var d = 0; d < 10; d++) {
    calendarItems.push({
      _id: 'audit-cal-item-' + d, day: d + 1, date: ymd(d), week: Math.floor(d / 7) + 1, weekNumber: Math.floor(d / 7) + 1,
      title: ['Behind the oven', 'Customer of the week', 'New: millet cookies', 'Reel: kneading sourdough', 'Festive pre-orders'][d % 5],
      theme: 'Fresh every morning', contentType: d % 3 === 0 ? 'reel' : 'post', type: d % 3 === 0 ? 'reel' : 'post',
      platform: 'instagram', platforms: ['instagram'], caption: 'A short caption for day ' + (d + 1), status: d < 2 ? 'generated' : 'planned',
      imageUrl: d < 2 ? IMG2 : '', postTime: '09:00', pillar: 'Product', objective: 'awareness',
    });
  }
  var calendar = {
    _id: 'audit-calendar-1', id: 'audit-calendar-1', month: now.getMonth() + 1, year: now.getFullYear(), monthName: now.toLocaleString('en', { month: 'long' }),
    theme: 'Festive season, fresh every morning', language: 'english', status: 'active', items: calendarItems, posts: calendarItems,
    days: calendarItems, coverImage: IMG3, settings: { autoGenerate: false, limit: 1 }, createdAt: iso(-2),
    strategy: { summary: 'Lean into festive pre-orders and morning freshness.', pillars: ['Product', 'Community', 'Behind the scenes'] },
  };

  // Fake 31-day October 2026 AI plan for the Plan tab (weeks run Monday to Sunday; reels were
  // appended after regular posts, as the real service does, so the page must order them by day).
  var planFormats = ['Post', 'Carousel', 'Story', 'Post', 'Carousel'];
  var planPosts = [];
  var planReels = [];
  var planReelDays = [1, 2, 3, 9, 16, 23, 30];
  for (var pd = 1; pd <= 31; pd++) {
    if (planReelDays.indexOf(pd) !== -1) continue;
    planPosts.push({
      _id: 'audit-plan-' + pd, day: pd, format: planFormats[pd % planFormats.length],
      status: pd % 5 === 0 ? 'approved' : pd % 7 === 0 ? 'rejected' : 'draft',
      headline: 'Festive morning story number ' + pd,
      creativeConcept: 'Show the bakery team shaping the day\'s first batch while the shutters open. Keep the shot close and warm, and end on the tray reaching the counter. Add one line about this week\'s pre-order slots.',
      contentPillar: 'Behind the scenes', objective: 'Awareness', shootType: 'Phone, natural light', cta: 'Order for the weekend', productNeeded: 'Sourdough loaf',
    });
  }
  planReelDays.forEach(function (rd) {
    planReels.push({
      _id: 'audit-plan-reel-' + rd, day: rd, format: 'Reel', status: rd === 2 ? 'approved' : 'draft',
      headline: 'Kneading sourdough, start to finish on day ' + rd,
      creativeConcept: 'A fifteen second reel that follows one loaf from dough to oven. Use quick cuts and the sound of the bakery. Close with the finished loaf on a wooden board.',
      contentPillar: 'Product', objective: 'Engagement', shootType: 'Tripod, kitchen', cta: 'Visit us this weekend', productNeeded: 'Sourdough loaf',
    });
  });
  var planAll = planPosts.concat(planReels);
  var planWeeks = [];
  var planWeekMap = {};
  planAll.forEach(function (it) {
    var wk = Math.floor((it.day + 2) / 7) + 1; // 1 Oct 2026 is a Thursday: days 1 to 4 are week 1
    if (!planWeekMap[wk]) { planWeekMap[wk] = { _id: 'audit-plan-week-' + wk, weekNumber: wk, items: [] }; planWeeks.push(planWeekMap[wk]); }
    planWeekMap[wk].items.push(it);
  });
  var planCalendar = Object.assign({}, calendar, {
    _id: 'audit-plan-calendar', month: '2026-10', businessName: 'Audit Bakery', approved: false, autoGenerate: false, weeks: planWeeks,
  });

  var ideas = [
    { _id: 'audit-idea-1', text: 'Show the 5am bake in a reel', status: 'new', createdAt: iso(-1), dueDate: ymd(3) },
    { _id: 'audit-idea-2', text: 'Customer birthday cake gallery', status: 'expanded', createdAt: iso(-2) },
    { _id: 'audit-idea-3', text: 'Millet cookie launch poll', status: 'new', createdAt: iso(-4) },
  ];
  var products = [
    { _id: 'audit-product-1', name: 'Butter croissant', category: 'Pastry', price: 90, currency: 'INR', status: 'active', description: 'Flaky, all-butter.', imageUrl: IMG1, images: [IMG1], tags: ['bestseller'] },
    { _id: 'audit-product-2', name: 'Country sourdough', category: 'Bread', price: 220, currency: 'INR', status: 'active', description: '36-hour ferment.', imageUrl: IMG2, images: [IMG2], tags: [] },
  ];
  var logos = [{ _id: 'audit-logo-1', url: LOGO, imageUrl: LOGO, name: 'Primary logo', type: 'logo', isPrimary: true, createdAt: iso(-9) }];
  var intelligenceProfile = {
    _id: 'audit-ip-1', status: 'complete', colors: ['#F5A623', '#14203A', '#FBF5EA'], brandColors: ['#F5A623', '#14203A', '#FBF5EA'],
    fonts: { heading: 'Playfair Display', body: 'Plus Jakarta Sans' }, fontType: 'Serif', tone: 'Warm, friendly',
    voice: 'Warm and neighbourly', pastPosts: [], summary: 'Warm neighbourhood bakery.', logoUrl: LOGO,
  };
  var credits = { balance: 4200, totalUsed: 800, history: [] };
  var socialConnections = [
    { platform: 'Instagram', connected: true, username: 'sunrisebakery', accountName: 'Sunrise Bakery', connectedAt: iso(-10) },
    { platform: 'Facebook', connected: false },
    { platform: 'X', connected: false },
    { platform: 'LinkedIn', connected: false },
    { platform: 'YouTube', connected: false },
    { platform: 'Google Business', connected: false },
  ];

  var BOUGHT = 0; // extra clients the stand-in payment window has "bought" in this tab
  try { if (params.get('agencystate')) sessionStorage.removeItem('audit-extra-bought'); BOUGHT = Number(sessionStorage.getItem('audit-extra-bought')) || 0; } catch (e) { /* ignore */ }
  var CLIENT_LIMIT = (ASTATE === 'cap' ? 25 : ASTATE === 'slots2' || ASTATE === 'usage-paging' ? 7 : 5) + BOUGHT;
  var ok = function (extra) { var o = { success: true }; for (var k in extra) o[k] = extra[k]; return o; };

  // One competitor in each state the card and the list can show. insight() builds the GET /competitors/insights row.
  var COMP_ROWS = [
    ['cmp-1', 'Sweet Co Bakery', 'sweetco', 'verified', 'current'],
    ['cmp-2', 'Green Leaf Cafe', 'greenleafcafe', 'confirmed', 'stale'],
    ['cmp-3', 'Harbour Dental Care', 'harbourdental', 'suggested', 'unconfirmed'],
    ['cmp-4', 'Meera Jewellers With A Very Long Business Name That Has To Wrap', '', undefined, 'no_handle'],
    ['cmp-5', 'Studio Nine Salon', 'studionine', 'confirmed', 'paused'],
    ['cmp-6', 'Crumb and Co', 'crumbandco', 'confirmed', 'failed']
  ].map(function (a) {
    var o = { id: a[0], name: a[1], handle: a[2], handleStatus: a[3], state: a[4] };
    o.insight = function () {
      var st = o.state === 'current' || o.state === 'stale' ? 'tracking' : o.state;
      var base = { id: o.id, name: o.name, handle: o.handle || undefined, handleStatus: o.handleStatus, status: st, trend: [], lastCheckedAt: null, weekOf: null, isCurrentWeek: false, previousWeekOf: null, lastCheckedOn: null };
      if (o.state === 'current') { base.trend = [{ weekStart: '2026-09-28', postsInWindow: 2, avgLikes: 30 }, { weekStart: '2026-10-05', postsInWindow: 2, avgLikes: 41 }, { weekStart: '2026-10-12', postsInWindow: 5, avgLikes: 52 }]; base.weekOf = '2026-10-12'; base.isCurrentWeek = true; base.previousWeekOf = '2026-10-05'; base.lastCheckedOn = '2026-10-13'; base.lastCheckedAt = '2026-10-13T04:00:00.000Z'; }
      if (o.state === 'stale') { base.trend = [{ weekStart: '2026-09-07', postsInWindow: 5, avgLikes: 20 }, { weekStart: '2026-09-14', postsInWindow: 3, avgLikes: 18 }]; base.weekOf = '2026-09-14'; base.previousWeekOf = '2026-09-07'; base.lastCheckedOn = '2026-09-15'; base.lastCheckedAt = '2026-09-15T04:00:00.000Z'; }
      if (o.state === 'paused' || o.state === 'failed') { base.trend = [{ weekStart: '2026-09-14', postsInWindow: 3, avgLikes: 18 }]; base.weekOf = '2026-09-14'; base.lastCheckedOn = '2026-09-22'; }
      return base;
    };
    return o;
  });

  // ---- Home summary (GET /home/summary), shaped exactly like backend/services/homeSummary.js ----------------------------
  var num = function (value, previous, changePct, extra) { return Object.assign({ value: value, previous: previous, changePct: changePct, available: true, reason: null, unit: 'count' }, extra || {}); };
  var none = function (reason) { return { value: null, previous: null, changePct: null, available: false, reason: reason }; };
  var atIst = function (h, m) { var d = new Date(now); d.setUTCHours(h - 5, m - 30, 0, 0); return d.toISOString(); }; // today at h:m India time
  function homeSummary() {
    var client = HSTATE === 'client' || (AGENCY && INSIDE);
    var st = client ? 'client' : HSTATE;
    var s = {
      generatedAt: now.toISOString(),
      account: { tier: 'starter', free: false, paidTier: true, agencyOwner: false, clientWorkspace: false, managed: false, staff: false, pass: false, frozen: false, showsPostsNotQuarks: false },
      features: { inbox: true, competitors: true, publish: true },
      numbers: {
        reach: num(48200, 41000, 17.6, { asOf: ymd(-1), stale: false }),
        engagement: num(4.2, 3.8, 10.5, { unit: 'percent', asOf: ymd(-1), stale: false }),
        followers: num(12450, 12200, 2, { change: 250, asOf: ymd(-1), stale: false }),
        postsPublishedThisWeek: num(3, 5, -40),
        draftsWaiting: num(4, null, null),
        unrepliedMessages: num(6, null, null)
      },
      nextActions: [
        { id: 'approve_week', kind: 'week', title: "Make this week's 5 posts", detail: 'Nothing goes out until you approve it.', to: '/dashboard#this-week', count: 5 },
        { id: 'review_drafts', kind: 'drafts', title: 'Review 4 posts', detail: '4 posts are waiting for your approval.', to: '/drafts', count: 4 },
        { id: 'reply_messages', kind: 'inbox', title: 'Reply to 6 messages', detail: '6 messages are unread.', to: '/inbox', count: 6 },
        { id: 'confirm_competitor', kind: 'competitors', title: "Confirm your competitors' handles", detail: 'We only look at a page once you have confirmed it.', to: '/competitors', count: 2 },
        { id: 'add_product_photo', kind: 'products', title: 'Add a photo to a product', detail: '1 product has no photo yet.', to: '/brand-assets?tab=products', count: 1 }
      ],
      week: { start: ymd(-((now.getDay() + 6) % 7)), end: ymd(7 - ((now.getDay() + 6) % 7)), proposal: 'proposed', topUp: false, posts: { planned: 5, made: 0, published: 3, scheduled: 2 }, counts: { posts: 5, carousels: 1, videos: 1 } },
      plan: { state: 'ready', opened: true, eligible: true, stopped: false, completedAt: iso(-2) },
      setup: { next: null, allDone: true, done: 4, total: 4 },
      balance: { available: true, quarks: 4200, posts: 381, videos: 26, showQuarks: true, text: '4,200 Quarks (about 381 posts or 26 videos)', paused: false },
      connected: { count: 2, platforms: ['instagram', 'facebook'] },
      competitors: { held: true, tracked: 4, needHandle: 2 },
      products: { count: 2, withPhotos: 1 },
      // Deliberately out of order (10:00 AM before 9:00 AM) to prove the page sorts by the real time.
      today: [
        { id: 't2', at: atIst(10, 0), title: 'Sourdough Sunday', subtitle: 'Fresh out of the oven at 7am. Come early, they go fast.', image: IMG2, status: 'scheduled', platform: 'instagram' },
        { id: 't1', at: atIst(9, 0), title: 'Weekend croissant drop', subtitle: 'Butter croissants, all morning.', image: IMG1, status: 'posted', platform: 'instagram' },
        { id: 't3', at: atIst(18, 30), title: 'Birthday cake orders open', subtitle: 'Order two days ahead for the weekend.', image: null, status: 'scheduled', platform: 'facebook' }
      ],
      recent: [
        { image: IMG1, platform: 'instagram', when: iso(0) }, { image: IMG2, platform: 'facebook', when: iso(1) },
        { image: IMG3, platform: 'instagram', when: iso(2) }, { image: IMG1, platform: 'instagram', when: iso(3) }
      ],
      degraded: []
    };
    if (st === 'new' || st === 'free') {
      s.account = Object.assign(s.account, { tier: 'free', free: true, paidTier: false });
      s.features = { inbox: false, competitors: false, publish: false };
      var why = 'Connecting accounts comes with a paid plan.';
      s.numbers = { reach: none(why), engagement: none(why), followers: none(why), postsPublishedThisWeek: num(0, 0, null), draftsWaiting: num(0, null, null), unrepliedMessages: none('Messages are part of the Inbox add-on.') };
      s.nextActions = [
        { id: 'finish_profile', kind: 'setup', title: 'Finish your business details', detail: 'Your plan and your posts are built from them.', to: '/settings?tab=business' },
        { id: 'choose_plan', kind: 'billing', title: 'Choose a plan', detail: 'Pick the plan that fits to get your plan and weekly posts.', to: '/trial-expired' },
        { id: 'connect_account', kind: 'setup', title: 'Connect your accounts', detail: 'You can still make posts without it. Connecting lets them go out for you.', to: '/connect-socials' }
      ];
      if (st === 'free') s.nextActions.shift();
      s.week = { start: s.week.start, end: s.week.end, proposal: 'none', topUp: false, posts: { planned: null, made: null, published: 0, scheduled: 0 }, counts: null };
      s.plan = { state: 'none', opened: false, eligible: false, stopped: false, completedAt: null };
      s.setup = { next: 'profile', allDone: false, done: 0, total: 3 };
      s.balance = { available: true, quarks: 0, posts: 0, videos: 0, showQuarks: true, text: '0 Quarks', paused: false };
      s.connected = { count: 0, platforms: [] };
      s.competitors = { held: false, tracked: 0, needHandle: 0 };
      s.products = { count: 0, withPhotos: 0 };
      s.today = []; s.recent = [];
    }
    if (st === 'nosocials') {
      var c = 'Connect an account to see this.';
      s.numbers.reach = none(c); s.numbers.engagement = none(c); s.numbers.followers = none(c); s.numbers.unrepliedMessages = none(c);
      s.nextActions = [s.nextActions[1], { id: 'connect_account', kind: 'setup', title: 'Connect your accounts', detail: 'You can still make posts without it. Connecting lets them go out for you.', to: '/connect-socials' }];
      s.connected = { count: 0, platforms: [] };
      s.week.posts.published = 0; s.numbers.postsPublishedThisWeek = num(0, 2, -100);
    }
    if (st === 'building') {
      s.plan = { state: 'building', opened: false, eligible: true, stopped: false, completedAt: null };
      s.week = Object.assign(s.week, { proposal: 'none', posts: { planned: null, made: null, published: 0, scheduled: 0 }, counts: null });
      s.nextActions = [{ id: 'plan_building', kind: 'plan', title: 'Your plan is being built', detail: 'It usually takes a few minutes. You do not need to wait.', to: null, info: true }];
      s.numbers.followers = none('Your first numbers arrive within a day of connecting.'); s.numbers.reach = none('Your first numbers arrive within a day of connecting.'); s.numbers.engagement = none('Your first numbers arrive within a day of connecting.');
      s.numbers.draftsWaiting = num(0, null, null); s.recent = []; s.today = [];
    }
    if (st === 'client') {
      s.account = Object.assign(s.account, { tier: 'agency', clientWorkspace: true, pass: true, showsPostsNotQuarks: true });
      s.balance = { available: true, quarks: null, posts: 381, videos: 26, showQuarks: false, text: 'about 381 posts or 26 videos', paused: false };
      s.nextActions = [s.nextActions[0], s.nextActions[1]];
    }
    return s;
  }

  // ---- This week and Setup, shaped like backend/routes/week.js ----
  function weekItems(status) {
    var topics = ['Behind the oven: the 5am bake', 'Customer of the week', 'New: millet cookies', 'Festive pre-orders open', 'Sourdough Sunday'];
    var items = topics.map(function (t, i) { return { id: 'wk-' + (i + 1), kind: 'post', topic: t, channel: i % 2 ? 'facebook' : 'instagram', pillar: ['Product', 'Community', 'Behind the scenes'][i % 3], source: 'plan', status: status, ref: null, error: null }; });
    items.push({ id: 'wk-6', kind: 'carousel', topic: 'Five ways to serve sourdough', channel: 'instagram', pillar: 'Product', source: 'plan', status: status === 'made' ? 'proposed' : status, ref: null, error: null });
    items.push({ id: 'wk-7', kind: 'video', topic: 'Kneading sourdough, start to finish', channel: 'instagram', pillar: 'Behind the scenes', source: 'plan', status: status === 'made' ? 'proposed' : status, ref: null, error: null });
    return items;
  }
  function weekAnswer() {
    var weekStart = ymd(-((now.getDay() + 6) % 7));
    var counts = { posts: 5, carousels: 1, videos: 1 };
    if (WSTATE === 'not_eligible') return { success: true, eligible: false, reason: 'free', proposal: null };
    if (WSTATE === 'no_plan') return { success: true, eligible: false, reason: 'no_plan', proposal: null };
    if (WSTATE === 'top_up') return { success: true, eligible: true, topUp: true, proposal: { weekStart: weekStart, status: 'proposed', items: [], counts: { posts: 0, carousels: 0, videos: 0 }, scaledDown: false, removed: { posts: 5, carousels: 1, videos: 1 }, empty: true } };
    if (WSTATE === 'skipped') return { success: true, eligible: true, proposal: { weekStart: weekStart, status: 'skipped', items: weekItems('skipped'), counts: counts } };
    if (WSTATE === 'approved') return { success: true, eligible: true, proposal: { weekStart: weekStart, status: 'approved', items: weekItems('made').map(function (i) { return i.kind === 'post' ? i : Object.assign(i, { status: 'made' }); }), counts: counts } };
    if (WSTATE === 'partly') { var it = weekItems('made'); it[3].status = 'proposed'; it[4].status = 'failed'; it[4].error = 'no_pool'; return { success: true, eligible: true, proposal: { weekStart: weekStart, status: 'approved', items: it, counts: counts } }; }
    return { success: true, eligible: true, proposal: { weekStart: weekStart, status: 'proposed', items: weekItems('proposed'), counts: counts } };
  }
  function setupAnswer() {
    var steps = [
      { id: 'profile', title: 'Complete your business profile', done: SSTATE !== 'fresh', reason: 'Your plan is built from it.', minutes: 5 },
      { id: 'socials', title: 'Connect your social accounts', done: SSTATE === 'done', reason: 'So posts can go out for you. You can make posts without it.', minutes: 2 },
      { id: 'plan', title: 'Read your plan', done: SSTATE === 'done', reason: 'See what we will do for your business and why.', minutes: 3 },
      { id: 'week', title: 'Approve your first week', done: SSTATE === 'done', reason: 'Nothing goes out until you say so.', minutes: 1 }
    ];
    var next = steps.filter(function (x) { return !x.done; })[0];
    return { success: true, steps: steps, next: next ? next.id : null, allDone: !next };
  }

  // ---- My plan: a realistic plan (claims carry tags; effort and roadmap as the planner writes them) ----
  var claim = function (text, tag) { return { text: text, tag: tag || 'proposed' }; };
  function planResult() {
    var plan = {
      promise: claim('A steady month of bakery content that shows how each loaf is made, so nearby families trust the shop.'),
      positioning: {
        audience: [claim('Young families and office workers within a short walk of the shop', 'inference')],
        territory: { name: 'The neighbourhood bakery that bakes at dawn', rationale: claim('Fresh every morning is something the large chains cannot say.', 'inference'), risk: claim('It only works if the opening hours stay early.') },
        line: claim('Baked at dawn, on your table by breakfast.')
      },
      whereToday: [claim('You post on Instagram a few times a month.', 'verified'), claim('Your website lists the menu but not the opening hours.', 'verified')],
      competitors: [{ name: 'Daily Bread Co', observations: [claim('Posts mostly photos of finished loaves.', 'inference')] }],
      pillars: [{ name: 'Behind the scenes', why: claim('People like seeing how the bread is made.'), example: 'The 5am bake' }, { name: 'Product', why: claim('Shows what is fresh today.'), example: 'Croissants out of the oven' }, { name: 'Community', why: claim('Regulars bring in new customers.'), example: 'Customer of the week' }],
      calendar: Array.from({ length: 30 }, function (_, i) { return { day: i + 1, pillar: ['Behind the scenes', 'Product', 'Community'][i % 3], format: ['Post', 'Carousel', 'Reel', 'Post'][i % 4], hook: claim('Day ' + (i + 1) + ' idea for the shop') }; }),
      offers: [],
      channels: [{ channel: 'Instagram', role: claim('Your main shop window: daily photos and short reels.', 'inference'), priority: 1 }, { channel: 'Facebook', role: claim('Reaches parents and local groups.'), priority: 2 }, { channel: 'WhatsApp', role: claim('Pre-orders and festival offers to regulars.'), priority: 3 }],
      icp: { who: [claim('Parents within 3 km who buy bread several times a week', 'inference')], pains: [claim('Supermarket bread goes stale by the next day.')], where: [claim('Local Facebook groups and Instagram.')], triggers: [claim('A birthday, a festival or a weekend guest.')] },
      effort: [
        { channel: 'Instagram', organicPct: 80, paidPct: 20, nebulaaDoes: ['posts', 'videos'], youDo: [claim('Reply to comments in the morning.'), claim('Tag the shop location on every post.')] },
        { channel: 'Facebook', organicPct: 100, paidPct: 0, nebulaaDoes: ['posts'], youDo: [claim('Share the weekly post to two local groups.')] },
        { channel: 'WhatsApp', organicPct: 100, paidPct: 0, nebulaaDoes: [], youDo: [claim('Send the festival menu to your regular customers.')] }
      ],
      roadmap: [
        { phase: 'foundation', focus: claim('Set up the basics and post three times a week.'), actions: [claim('Connect Instagram and Facebook.'), claim('Add photos of your best five products.')], measure: [claim('Posts go out every week without gaps.')] },
        { phase: 'storytelling', focus: claim('Show the people and the process.'), actions: [claim('Film one reel a week at the oven.')], measure: [claim('More saves and shares than last month.')] },
        { phase: 'growth', focus: claim('Turn regular viewers into regular buyers.'), actions: [claim('Open pre-orders for weekends.')], measure: [claim('Pre-orders each weekend.')] }
      ],
      firstSteps: [claim('Approve this week\'s posts.'), claim('Add a photo to each product.'), claim('Confirm your competitors\' pages.')]
    };
    if (PSTATE === 'old') { delete plan.icp; delete plan.effort; delete plan.roadmap; delete plan.calendar; delete plan.pillars; }
    return { version: 1, plan: plan, pages: [] };
  }
  function planAnswer() {
    var base = { success: true, plan: null, running: false, failed: false, stopped: null, nextRefreshAt: null, eligible: true, reason: '', missing: [], freeBlueprint: null, lastRunAt: iso(-2), lastStatus: 'completed' };
    if (PSTATE === 'building') return Object.assign(base, { running: true, lastStatus: 'processing' });
    if (PSTATE === 'failed') return Object.assign(base, { failed: true, lastStatus: 'failed' });
    if (PSTATE === 'none') return Object.assign(base, { lastRunAt: null, lastStatus: null });
    return Object.assign(base, { plan: { id: 'audit-plan-1', completedAt: iso(PSTATE === 'stale' ? -60 : -2), stale: PSTATE === 'stale', result: planResult() }, nextRefreshAt: iso(5) });
  }

  // [method or '*', RegExp on pathname after /api, response object or function(ctx) -> object|{__status,body}]
  var ROUTES = [
    // ---- Agency (Task 10): the Clients page, the switcher, add / rename / remove / open, usage ----
    ['GET', /^\/agency\/clients$/, function () {
      if (ASTATE === 'error') return { __status: 500, body: { success: false, message: 'Something went wrong.' } };
      var big = ASTATE === 'cap' || ASTATE === 'usage-paging';
      var list = ASTATE === 'empty' ? [] : big
        ? Array.from({ length: ASTATE === 'cap' ? 25 : 31 }, function (_, i) { return ['a' + (i + 1), ['Sweet Co', 'Green Leaf Cafe', 'Harbour Dental Care', 'Meera Jewellers', 'Studio Nine Salon'][i % 5] + (i >= 5 ? ' ' + (Math.floor(i / 5) + 1) : ''), false]; })
        : ASTATE === 'full'
        ? [['a1', 'Sweet Co', false], ['a2', 'Green Leaf Cafe', false], ['a3', 'Meera Jewellers', true], ['a4', 'Harbour Dental Care', false], ['a5', 'A very long client business name that has to wrap on a small screen without breaking the card', false]]
        : [['a1', 'Sweet Co', false], ['a2', 'Green Leaf Cafe', false], ['a3', 'Meera Jewellers', true]];
      var out = { success: true, clients: list.map(function (c, i) { return { id: c[0], name: c[1], createdAt: iso(-40 + i), frozen: c[2] }; }), limit: CLIENT_LIMIT, used: list.length, slotInr: 1499 };
      if (ASTATE === 'slow') out.__delay = 4000;
      return out.__delay ? { __status: 200, __delay: out.__delay, body: out } : out;
    }],
    ['POST', /^\/agency\/clients$/, function () { return { __status: 201, body: { success: true, client: { id: 'a9', name: 'New client', createdAt: iso(0), frozen: false } } }; }],
    ['PATCH', /^\/agency\/clients\/[^/]+$/, ok({})],
    ['DELETE', /^\/agency\/clients\/[^/]+$/, function () {
      if (ASTATE === 'busy') return { __status: 409, body: { success: false, message: "Wait until this client's videos and jobs finish, then try again." } };
      if (ASTATE === 'wrongpw') return { __status: 403, body: { success: false, message: 'That password is not correct.' } };
      return ok({});
    }],
    ['POST', /^\/agency\/clients\/[^/]+\/open$/, function (c) {
      var id = c.path.split('/')[3];
      var names = { a1: 'Sweet Co', a2: 'Green Leaf Cafe', a4: 'Harbour Dental Care' };
      return ok({ token: CLIENT_TOKEN, expiresInHours: 8, client: { id: id, name: names[id] || 'Sweet Co' } });
    }],
    ['GET', /^\/agency\/usage\.csv$/, 'Client,Posts,Videos\nSweet Co,12,2\nGreen Leaf Cafe,7,0\n'],
    ['GET', /^\/agency\/usage$/, function (c) {
      if (ASTATE === 'usage-error') return { __status: 500, body: { success: false, message: 'Cannot read properties of undefined (reading usage)' } };
      var cur = now.toISOString().slice(0, 7);
      var month = /^\d{4}-\d{2}$/.test(c.url.searchParams.get('month') || '') ? c.url.searchParams.get('month') : cur;
      var monthsBack = (Number(cur.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(cur.slice(5)) - Number(month.slice(5));
      var label = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(month.slice(5)) - 1] + ' ' + month.slice(0, 4);
      var scale = monthsBack <= 0 ? 1 : monthsBack === 1 ? 0.6 : 0;
      var base = [['a1', 'Sweet Co', false, 12, 2, 0], ['a2', 'Green Leaf Cafe', false, 7, 0, -6], ['a3', 'Meera Jewellers', true, 0, 0, null]];
      if (ASTATE === 'cap' || ASTATE === 'usage-paging') base = Array.from({ length: ASTATE === 'cap' ? 25 : 31 }, function (_, i) { return ['a' + (i + 1), ['Sweet Co', 'Green Leaf Cafe', 'Harbour Dental Care', 'Meera Jewellers', 'Studio Nine Salon'][i % 5] + (i >= 5 ? ' ' + (Math.floor(i / 5) + 1) : ''), false, (i * 3) % 17, i % 4 === 0 ? 1 : 0, -i]; });
      var all = ASTATE === 'usage-empty' ? [] : base.map(function (b) {
        return { id: b[0], name: b[1], frozen: b[2], posts: Math.round(b[3] * scale), videos: Math.round(b[4] * scale), lastActive: b[5] === null ? null : iso(b[5]), quarksSpent: Math.round(b[3] * scale) * 11, total: { posts: b[3] * 2, videos: b[4], quarksSpent: 999 } };
      });
      if (!ASTATE.indexOf('usage-empty') && all.length === 0) { /* no clients at all */ } else if (scale > 0 || monthsBack > 1) all.push({ id: 'removed', name: 'Removed client', removed: true, frozen: false, posts: Math.round(1 * scale), videos: 0, lastActive: iso(-20), quarksSpent: 11, total: { posts: 1, videos: 0, quarksSpent: 11 } });
      if (ASTATE === 'usage-empty') all = [];
      var limit = ASTATE === 'usage-paging' ? 10 : 25;
      var page = Math.max(1, Number(c.url.searchParams.get('page')) || 1);
      var slice = all.slice((page - 1) * limit, page * limit);
      return ok({ month: month, monthLabel: label, poolLeft: 4200, poolPosts: ASTATE === 'pool-empty' ? 0 : 381, poolVideos: ASTATE === 'pool-empty' ? 0 : 26, page: page, limit: limit, total: all.length, hasMore: page * limit < all.length, clients: slice });
    }],
    ['POST', /^\/payment\/create-slot-subscription$/, function () {
      if (ASTATE === 'slotrefused' || ASTATE === 'cap') return { __status: 400, body: { success: false, message: 'You are at the most clients one agency account can have (25). Contact us for a larger set-up.' } };
      return ok({ subscription_id: 'sub_audit', key: 'rzp_audit_key', amount: 176882, gstPaise: 26982, slot: { id: 'client', quarks: 500 }, prefill: { name: 'Studio North' } });
    }],
    ['POST', /^\/payment\/verify-subscription$/, function () {
      if (ASTATE === 'slot409') return { __status: 409, body: { success: false, message: 'Your payment was received, but the extra client could not be added yet. Our team has been told.' } };
      BOUGHT += 1; CLIENT_LIMIT += 1;
      try { sessionStorage.setItem('audit-extra-bought', String(BOUGHT)); } catch (e) { /* ignore */ }
      return ok({ alreadyProcessed: false, message: 'Your extra client is added.', kind: 'slot', key: 'client', clientLimit: CLIENT_LIMIT });
    }],
    ['GET', /^\/auth\/me$/, function () { return LOGGED_OUT ? { __status: 401, body: { success: false, message: 'Not signed in' } } : ok({ user: user, actingAgency: user.actingAgency || null, actingCsm: null }); }],
    ['GET', /^\/auth\/business-context$/, ok({ businessLocation: businessProfile.businessLocation, company: businessProfile, geography: { city: 'Chennai', country: 'India' } })],
    ['GET', /^\/credits/, ok({ credits: credits, trial: { startDate: iso(-3), expiresAt: iso(4), daysLeft: 4, isExpired: false }, costs: { post: 10, reel: 50, heroClip: 250, blueprint: 7, image_generated: 11, campaign_full: 12, carousel_generated: 4, campaign_text: 3, studio_video: 161 }, units: {} })],
    ['GET', /^\/payment\/plans/, function () {
      var price = function (inr) { var gst = Math.round(inr * 18); return { inr: inr, gstPaise: gst, chargePaise: inr * 100 + gst }; };
      var feat = function (posts, videos) { return ['Up to ' + posts + ' posts a month, or', 'up to ' + videos + ' short videos with voice and music', 'Spend it on posts or videos, in any mix', 'Top up any time']; };
      return ok({
        plans: [
          Object.assign({ id: 'starter', name: 'Starter', description: 'For a single business getting started.', quarks: 600, outputs: { posts: 54, videos: 3 }, features: feat(54, 3).concat(['Brand Blueprint']) }, price(999)),
          Object.assign({ id: 'professional', name: 'Growth', description: 'For a business that posts every day.', quarks: 2000, outputs: { posts: 181, videos: 12 }, features: feat(181, 12).concat(['Priority support']) }, price(1999)),
          Object.assign({ id: 'agency', name: 'Agency', description: 'Run several client brands from one account, with one shared pool of posts and videos.', quarks: 6000, outputs: { posts: 545, videos: 37 }, features: feat(545, 37).concat(['5 client brands included', 'Publishing, inbox and competitor insights included', 'Usage report for each client']) }, price(6999)),
        ],
        topups: [[500, 240, 21, 1], [1000, 475, 43, 2], [2500, 1190, 108, 7], [5000, 2380, 216, 14], [10000, 4760, 432, 29]].map(function (t) { return Object.assign({ quarks: t[1], outputs: { posts: t[2], videos: t[3] } }, price(t[0])); }),
        addons: [Object.assign({ id: 'publish', label: 'Publish and schedule', requires: [], includes: [] }, price(1000)), Object.assign({ id: 'competitors', label: 'Competitor insights', requires: [], includes: [] }, price(500)), Object.assign({ id: 'inbox', label: 'Inbox and automatic replies', requires: ['publish'], includes: [] }, price(500)), Object.assign({ id: 'bundle', label: 'Publish, competitors and inbox bundle', requires: [], includes: ['publish', 'competitors', 'inbox'] }, price(1800))],
        agency: { includedClients: 5, maxClients: 25, slotInr: 1499, slotQuarks: 500 },
        slot: Object.assign({ id: 'client', quarks: 500 }, price(1499)),
      });
    }],
    ['GET', /^\/payment\/billing-details$/, ok({ details: { gstin: '', legalName: '', address: '', pin: '', stateCode: '' }, states: [{ abbr: 'TN', name: 'Tamil Nadu' }, { abbr: 'KA', name: 'Karnataka' }] })],
    ['GET', /^\/payment\/billing$/, function () {
      var tier = AGENCY ? 'agency' : MANAGED ? 'managed' : ASTATE === 'starter' ? 'starter' : (TIERQ === 'starter' || TIERQ === 'professional') ? TIERQ : 'free';
      return ok({ plan: { tier: tier, addons: tier === 'agency' ? ['bundle'] : [] }, subscription: (tier === 'free' || tier === 'managed') ? { plan: 'free', status: 'active' } : { plan: tier, status: 'active', cancelAtPeriodEnd: false, endsAt: iso(21) }, credits: { balance: ASTATE === 'pool-empty' ? 0 : tier === 'free' ? 0 : credits.balance }, payments: [] });
    }],
    ['GET', /^\/payment\/status/, ok({ subscription: user.subscription, credits: credits, payments: [] })],
    ['GET', /^\/drafts\/?$/, ok({ drafts: drafts, total: drafts.length })],
    ['POST', /^\/drafts\/[^/]+\/localize$/, ok({ results: [{ language: 'kannada', ok: true, draftId: 'audit-draft-v1' }, { language: 'telugu', ok: false, message: 'We could not write the Telugu version this time. Please try again.' }] })],
    ['GET', /^\/drafts\/[^/]+$/, function (c) { return ok({ draft: drafts[0] }); }],
    ['GET', /^\/campaigns\/?$/, ok({ campaigns: campaigns, counts: { all: 3, draft: 1, scheduled: 1, posted: 1 } })],
    ['GET', /^\/campaigns\/reel\/options/, ok({ tones: [], styles: [], voices: [], music: [] })],
    ['GET', /^\/campaigns\/icp-strategy/, ok({ strategy: null })],
    ['GET', /^\/campaigns\/[^/]+$/, ok({ campaign: campaigns[0] })],
    ['GET', /^\/content-calendar\/history/, ok({ calendars: [planCalendar] })],
    ['GET', /^\/content-calendar\/today/, ok({ items: calendarItems.slice(0, 1), drafts: [] })],
    ['GET', /^\/content-calendar\/settings/, ok({ settings: { autoGenerate: false, limit: 1 } })],
    ['GET', /^\/content-calendar\/?$/, ok({ calendar: planCalendar, calendars: [planCalendar] })],
    ['GET', /^\/content-calendar\/[^/]+\/drafts/, ok({ drafts: drafts.slice(0, 2) })],
    ['GET', /^\/content-calendar\/[^/]+$/, ok({ calendar: planCalendar })],
    ['GET', /^\/ideas/, ok({ ideas: ideas })],
    ['GET', /^\/products\/?$/, ok({ products: products, data: products, total: 2, categories: ['Pastry', 'Bread'] })],
    ['GET', /^\/products\/[^/]+$/, ok({ product: products[0] })],
    ['GET', /^\/brand-assets\/intelligence-profile/, ok({ profile: intelligenceProfile, data: intelligenceProfile })],
    ['GET', /^\/brand-assets\/primary-logo/, ok({ logo: logos[0], asset: logos[0] })],
    ['GET', /^\/brand-assets\/logos/, ok({ logos: logos, assets: logos })],
    ['GET', /^\/brand-assets\/templates/, ok({ templates: [], assets: [] })],
    ['GET', /^\/brand-assets/, ok({ assets: logos, logos: logos, templates: [], environments: [] })],
    // Staff area (made-up people, only for the visual audit and the preview)
    ['GET', /^\/staff\/me/, ok({ staff: { id: 'owner-1', name: 'Dinesh Kannaa', email: 'owner@example.test', role: 'owner' }, can: { view_home: true, view_clients: true, open_client: true, add_quarks: true, toggle_client: true, assign_csm: true, add_csm: true, manage_admins: true, reset_accounts: true, view_money: true, view_usage_full: true, view_usage_summary: true, manage_coupons: true, export_csv: true, view_activity_all: true } })],
    ['GET', /^\/staff\/team$/, ok({ me: 'owner-1', grantable: ['owner', 'admin', 'csm'], can: { reset_accounts: true }, maxClients: 12, owners: 1, rows: [
      { id: 'owner-1', name: 'Dinesh Kannaa', email: 'owner@example.test', role: 'owner', status: 'active', lastActiveAt: iso(0), clients: null, draftsWaiting: null, needAttention: null },
      { id: 'admin-1', name: 'Meera Nair', email: 'meera@example.test', role: 'admin', status: 'active', lastActiveAt: iso(-1), clients: null, draftsWaiting: null, needAttention: null },
      { id: 'csm-1', name: 'Priya Raman', email: 'priya@example.test', role: 'csm', status: 'active', lastActiveAt: iso(-1), clients: 12, draftsWaiting: 9, needAttention: 3 },
      { id: 'csm-2', name: 'Arun Kumar', email: 'arun@example.test', role: 'csm', status: 'active', lastActiveAt: iso(-9), clients: 5, draftsWaiting: 1, needAttention: 0 },
      { id: 'csm-3', name: 'Lakshmi Venkataraman-Subramaniam', email: 'lakshmi.venkataraman-subramaniam@example.test', role: 'csm', status: 'switched_off', lastActiveAt: null, clients: 0, draftsWaiting: 0, needAttention: 0 }
    ] })],
    ['POST', /^\/staff\/team$/, ok({ member: { id: 'csm-9', name: 'New Person', email: 'new@example.test', role: 'csm' }, converted: false, emailed: true })],
    ['POST', /^\/staff\/team\/[^/]+\/reset-account$/, ok({ archivedDrafts: 3 })],
    ['POST', /^\/staff\/ayrshare\/reset-ids$/, ok({ cleared: 14 })],
    ['POST', /^\/staff\/clients\/[^/]+\/hidden$/, ok({ hidden: true })],
    ['GET', /^\/staff\/coupons$/, ok({ coupons: [{ code: 'WELCOME5000', discountedAmount: 5000, maxUses: 3, usedCount: 1, isActive: true, note: 'For early clients' }, { code: 'OLDONE', discountedAmount: 4000, maxUses: 1, usedCount: 1, isActive: false, note: '' }] })],
    ['POST', /^\/staff\/coupons$/, ok({ coupon: { code: 'NEWCODE', discountedAmount: 5000, maxUses: 1, usedCount: 0, isActive: true, note: '' } })],
    ['POST', /^\/staff\/coupons\/[^/]+\/deactivate$/, ok({ coupon: { code: 'WELCOME5000', isActive: false } })],
    ['DELETE', /^\/staff\/coupons\/[^/]+$/, ok({})],
    ['PATCH', /^\/staff\/team\/[^/]+$/, ok({ member: { id: 'csm-1', name: 'Priya Raman', email: 'priya@example.test', role: 'admin' }, unassigned: { count: 12, clients: [{ id: 'c1', name: 'Sunrise Bakery' }, { id: 'c2', name: 'Green Leaf Cafe' }, { id: 'c6', name: 'Meera Jewellers' }] } })],
    ['DELETE', /^\/staff\/team\/[^/]+$/, ok({ removed: true, unassigned: { count: 5, clients: [{ id: 'c1', name: 'Sunrise Bakery' }, { id: 'c2', name: 'Green Leaf Cafe' }, { id: 'c6', name: 'Meera Jewellers' }] } })],
    ['GET', /^\/staff\/money\/payments/, ok({ total: 12, page: 2, pages: 2, pageSize: 10, rows: [
      { id: 'c1:9', at: iso(-30), clientId: 'c1', clientName: 'Sunrise Bakery', what: 'Starter plan', totalPaise: 117882, exGstPaise: 99900, gstPaise: 17982, status: 'paid' },
      { id: 'c2:4', at: iso(-33), clientId: 'c2', clientName: 'Green Leaf Cafe', what: 'Quark pack, 500 Quarks', totalPaise: 117882, exGstPaise: 99900, gstPaise: 17982, status: 'refunded' }
    ] })],
    ['GET', /^\/staff\/money/, ok({
      generatedAt: iso(0),
      revenue: {
        currency: 'INR',
        thisMonth: { exGstPaise: 399600, gstPaise: 71928, unsplitPaise: 0, totalPaise: 471528, count: 4 },
        lastMonth: { exGstPaise: 1099700, gstPaise: 197946, unsplitPaise: 0, totalPaise: 1297646, count: 9 },
        last30Days: { exGstPaise: 1199500, gstPaise: 215910, unsplitPaise: 0, totalPaise: 1415410, count: 10 },
        allTime: { exGstPaise: 12345600, gstPaise: 2222208, unsplitPaise: 50000, totalPaise: 14617808, count: 61 },
        series30: Array.from({ length: 30 }, function (_, i) { var d = new Date(Date.now() + 19800000 - (29 - i) * 86400000).toISOString().slice(0, 10); var n = (i % 6 === 0) ? 1 + (i % 3) : 0; return { day: d, exGstPaise: n * 99900, gstPaise: n * 17982, unsplitPaise: 0, totalPaise: n * 117882 }; }),
        otherCurrencyPayments: 0,
        note: 'Collected money from paid payment records, in rupees, in India time. Refunded and failed payments are not counted. Some older payments have no stored amount before GST, so they are counted in the total but not split.'
      },
      planMix: { customers: 62, tiers: [{ id: 'free', label: 'Free', count: 20 }, { id: 'starter', label: 'Starter', count: 9 }, { id: 'professional', label: 'Professional', count: 4 }, { id: 'managed', label: 'Managed', count: 29 }], addons: [{ id: 'publish', label: 'Publish and schedule', count: 5 }, { id: 'competitors', label: 'Competitor insights', count: 1 }, { id: 'inbox', label: 'Inbox and automatic replies', count: 2 }, { id: 'bundle', label: 'Publish, competitors and inbox bundle', count: 1 }], monthlyRecurring: { exGstPaise: 2189900, note: 'Estimate: the config price of every active plan and add-on subscription, before GST.' } },
      payments: { total: 12, page: 1, pages: 2, pageSize: 10, rows: [
        { id: 'c1:12', at: iso(-1), clientId: 'c1', clientName: 'Sunrise Bakery', what: 'Starter plan', totalPaise: 117882, exGstPaise: 99900, gstPaise: 17982, status: 'paid' },
        { id: 'c4:2', at: iso(-2), clientId: 'c4', clientName: 'Kumar Hardware', what: 'Quark pack, 1,000 Quarks', totalPaise: 235882, exGstPaise: null, gstPaise: null, status: 'failed' },
        { id: 'c7:1', at: iso(-3), clientId: 'c7', clientName: 'A Very Long Business Name For Narrow Screens Private Limited', what: 'Publish and schedule add-on', totalPaise: 118000, exGstPaise: 100000, gstPaise: 18000, status: 'paid' }
      ] },
      renewals: { windowDays: 14, totalPaise: 353764, items: [
        { clientId: 'c1', clientName: 'Sunrise Bakery', what: 'Starter plan', at: iso(2), totalPaise: 117882, exGstPaise: 99900, gstPaise: 17982 },
        { clientId: 'c3', clientName: 'Studio Nine Salon', what: 'Professional plan', at: iso(6), totalPaise: 235882, exGstPaise: 199900, gstPaise: 35982 }
      ], note: 'Plan renewals only, at the current config price. Add-on renewal dates are not stored, so add-ons are not listed here.' },
      failures: { windowDays: 30, payments: { count: 1, items: [{ clientId: 'c4', clientName: 'Kumar Hardware', what: 'Quark pack, 1,000 Quarks', at: iso(-2), totalPaise: 235882, reason: 'The payment did not go through.' }] }, renewals: { count: 1, items: [{ clientId: 'c6', clientName: 'Meera Jewellers', kind: 'halted', what: 'Starter plan', at: iso(-9), reason: 'The monthly renewal failed several times, so the plan was stopped.' }] }, note: 'Failed payments are listed only if they were recorded as failed; the app stores successful payments, so declined card attempts may be missing.' },
      quarks: { available: true, monthStart: iso(-6), sold: 8400, spent: 5120, refunded: 240, grantedByStaff: 500, possiblyIncompleteClients: 1, usdPerQuark: 0.02, spentValueUsdCents: 10240, note: 'Sold is the Quarks on paid payments this month. Spent is counted from each client\'s recent Quark history (the app keeps only the last 50 to 100 entries per client), so a very busy client can be undercounted. Quarks added by staff are shown apart and are not sold.' },
      ayrshare: { available: true, estimate: true, profiles: 34, included: 30, extra: 4, maxProfiles: 100, perExtraProfileUsdCents: 899, extraUsdCents: 3596, planUsdPerMonth: 599, note: 'Estimate: accounts that have a social profile, against the profiles the plan includes. The extra-profile rate is from our own config, not from an invoice.' }
    })],
    ['GET', /^\/staff\/usage/, ok({
      level: 'full',
      featureUse: { days: 30, customers: 6, items: [
        { key: 'images', label: 'Images generated', definition: 'Sample', available: true, count: 148, clients: 5 },
        { key: 'postsDrafted', label: 'Posts drafted', definition: 'Sample', available: true, count: 96, clients: 5 },
        { key: 'postsPublished', label: 'Posts published', definition: 'Sample', available: true, count: 61, clients: 4 },
        { key: 'videos', label: 'Videos', definition: 'Sample', available: true, count: 9, clients: 3 },
        { key: 'heroVideos', label: 'Hero videos', definition: 'Sample', available: true, count: 2, clients: 1 },
        { key: 'blueprints', label: 'Blueprints', definition: 'Sample', available: true, count: 4, clients: 4 },
        { key: 'repliesDrafted', label: 'Replies drafted', definition: 'Sample', available: false, reason: 'We could not read the inbox right now.' }
      ], note: 'Counted from what the app stores about each client\'s work in the last 30 days.' },
      funnel: { available: true, days: 30, signedUp: 21, steps: [
        { key: 'signedUp', label: 'Signed up', available: true, count: 21, reached: 21, fromPrevious: null, fromStart: 100 },
        { key: 'onboarded', label: 'Finished onboarding', available: true, count: 15, reached: 15, fromPrevious: 71, fromStart: 71 },
        { key: 'firstContent', label: 'Created first content', available: true, count: 12, reached: 13, fromPrevious: 80, fromStart: 57 },
        { key: 'connected', label: 'Connected a social account', available: true, count: 7, reached: 9, fromPrevious: 58, fromStart: 33 },
        { key: 'published', label: 'Published first post', available: true, count: 5, reached: 6, fromPrevious: 71, fromStart: 24 },
        { key: 'paid', label: 'Paid', available: true, count: 3, reached: 5, fromPrevious: 60, fromStart: 14 }
      ], note: 'Clients who signed up in the last 30 days. Each step counts only clients who also passed every step before it.' },
      quarks: { available: true, total: 5120, totalValueUsdCents: 10240, possiblyIncompleteClients: 1, categories: [
        { key: 'images', label: 'Images and posts', quarks: 2800, percent: 55 }, { key: 'captions', label: 'Captions', quarks: 200, percent: 4 },
        { key: 'video', label: 'Video', quarks: 1500, percent: 29 }, { key: 'hero', label: 'Hero video', quarks: 400, percent: 8 },
        { key: 'blueprint', label: 'Blueprint', quarks: 120, percent: 2 }, { key: 'other', label: 'Other', quarks: 100, percent: 2 }
      ], note: 'Counted from each client\'s recent Quark history (the app keeps only the last 50 to 100 entries per client), so a very busy client can be undercounted.' },
      topByTier: { available: true, tiers: [
        { id: 'free', label: 'Free', clients: 2, top: { key: 'images', label: 'Images generated', count: 12, clients: 2 } },
        { id: 'starter', label: 'Starter', clients: 1, top: { key: 'postsDrafted', label: 'Posts drafted', count: 20, clients: 1 } },
        { id: 'professional', label: 'Professional', clients: 0, top: null },
        { id: 'managed', label: 'Managed', clients: 3, top: { key: 'images', label: 'Images generated', count: 130, clients: 3 } }
      ], note: 'The feature with the most items made in the last 30 days by clients on that plan.' }
    })],
    ['GET', /^\/staff\/home/, ok({
      health: { since: iso(-1), cards: [
        { key: 'images', label: 'Images', status: 'green', note: 'Image creation is working.', lastHour: 0, lastDay: 1, latest: [{ at: iso(-0.5), detail: 'Image request timed out after 60 seconds (sample)' }] },
        { key: 'publishing', label: 'Publishing', status: 'amber', note: 'Posting to social networks failed 2 times in the last hour.', lastHour: 2, lastDay: 5, latest: [{ at: iso(-0.02), detail: 'Instagram refused the post: image too large (sample)' }, { at: iso(-0.04), detail: 'Facebook page token expired (sample)' }] },
        { key: 'social', label: 'Social accounts', status: 'green', note: 'Connecting social accounts is working.', lastHour: 0, lastDay: 0, latest: [] },
        { key: 'payments', label: 'Payments', status: 'red', note: 'Payments and subscriptions failed 3 times in the last hour.', lastHour: 3, lastDay: 3, latest: [{ at: iso(-0.01), detail: 'Payment signature did not match (sample)' }] },
        { key: 'video', label: 'Video', status: 'green', note: 'Video creation is working.', lastHour: 0, lastDay: 0, latest: [] },
        { key: 'writing', label: 'AI writing', status: 'green', note: 'Writing captions and scripts is working.', lastHour: 0, lastDay: 0, latest: [] }
      ] },
      attention: { total: 4, items: [
        { id: 'c4', name: 'Kumar Hardware', email: 'kumar@hardware.example', quarks: 0, reasons: ['quarks_low', 'inactive'], csm: null, lastActiveAt: iso(-15) },
        { id: 'c1', name: 'Sunrise Bakery', email: 'owner@sunrise-bakery.example', quarks: 62, reasons: ['quarks_low', 'drafts_waiting'], csm: { id: 'csm-1', name: 'Priya Raman' }, lastActiveAt: iso(-1) },
        { id: 'c3', name: 'Studio Nine Salon', email: 'bookings@studionine.example', quarks: 100, reasons: ['no_social'], csm: null, lastActiveAt: iso(0) },
        { id: 'c7', name: 'A Very Long Business Name For Narrow Screens Private Limited', email: 'accounts.department.with.a.long.address@very-long-company-domain.example', quarks: 480, reasons: ['onboarding_unfinished'], csm: { id: 'csm-2', name: 'Arun Kumar' }, lastActiveAt: null }
      ] },
      growth: {
        signups: { today: { now: 2, before: 0, change: null }, week: { now: 9, before: 6, change: 50 }, month: { now: 21, before: 28, change: -25 } },
        activeThisWeek: 3, totalClients: 6, trialToPaid: { signedUp: 21, paid: 3, percent: 14 },
        series: Array.from({ length: 30 }, function (_, i) { var d = new Date(Date.now() + 19800000 - (29 - i) * 86400000).toISOString().slice(0, 10); return { day: d, signups: (i * 7) % 4 + (i === 29 ? 2 : 0), active: 2 + ((i * 5) % 6) + Math.floor(i / 6) }; })
      }
    })],
    ['POST', /^\/staff\/clients\/[^/]+\/quarks$/, ok({ balance: 562 })],
    ['GET', /^\/staff\/csms/, ok({ csms: [{ id: 'csm-1', name: 'Priya Raman' }, { id: 'csm-2', name: 'Arun Kumar' }] })],
    ['GET', /^\/staff\/clients\/[^/?]+$/, ok({ client: { id: 'c1', name: 'Sunrise Bakery', email: 'owner@sunrise-bakery.example', mobile: '9876543210', business: { name: 'Sunrise Bakery', industry: 'Food & Beverage', website: 'https://sunrise-bakery.example', location: 'Chennai' }, hidden: false, signedUpAt: iso(-40), lastActiveAt: iso(-1), onboardingCompleted: true, csm: { id: 'csm-1', name: 'Priya Raman' }, status: 'active', tier: 'managed', addons: [], paying: true, trial: false, access: { publish: true, schedule: true, inbox: true, autoReply: true, video: true, blueprint: true }, attention: ['quarks_low', 'drafts_waiting'], quarks: 62, connections: ['instagram', 'facebook'], recentQuarks: [{ action: 'staff_grant', amount: 500, description: 'Nebulaa staff added 500 Quarks', at: iso(-6) }], featureUse30d: [{ feature: 'post_generated', count: 24 }, { feature: 'campaign_created', count: 3 }], drafts30d: { published: 12, draft: 4, failed: 1 }, money: { payments: [{ item: 'Quark pack 500', amount: 999, currency: 'INR', status: 'paid', at: iso(-12) }], subscriptions: [] }, history: [{ action: 'add_quarks', by: 'Dinesh Kannaa', at: iso(-6), details: { amount: 500 } }] }, can: { open_client: true, add_quarks: true, toggle_client: true, assign_csm: true, hide_client: true, view_money: true } })],
    ['GET', /^\/staff\/clients/, ok({ counts: { all: 6, active: 3, inactive: 1, disabled: 1, trial: 2, paying: 2, attention: 3, no_csm: 2, hidden: 1 }, total: 6, page: 1, pages: 1, rows: [
      { id: 'c1', name: 'Sunrise Bakery', email: 'owner@sunrise-bakery.example', tier: 'managed', addons: [], paying: true, trial: false, status: 'active', quarks: 62, platforms: ['instagram', 'facebook'], access: { publish: true, schedule: true, inbox: true, autoReply: true, video: true }, csm: { id: 'csm-1', name: 'Priya Raman' }, lastActiveAt: iso(-1), attention: ['quarks_low', 'drafts_waiting'] },
      { id: 'c2', name: 'Green Leaf Cafe', email: 'hello@greenleaf.example', tier: 'starter', addons: ['publish'], paying: true, trial: false, status: 'active', quarks: 1240, platforms: ['instagram', 'x', 'linkedin'], access: { publish: true, schedule: true, inbox: false, autoReply: false, video: true }, csm: { id: 'csm-2', name: 'Arun Kumar' }, lastActiveAt: iso(-2), attention: [] },
      { id: 'c3', name: 'Studio Nine Salon', email: 'bookings@studionine.example', tier: 'free', addons: [], paying: false, trial: true, status: 'active', quarks: 100, platforms: [], access: { publish: false, schedule: false, inbox: false, autoReply: false, video: true }, csm: null, lastActiveAt: iso(0), attention: ['no_social'] },
      { id: 'c4', name: 'Kumar Hardware', email: 'kumar@hardware.example', tier: 'free', addons: [], paying: false, trial: true, status: 'inactive', quarks: 85, platforms: ['facebook'], access: { publish: false, schedule: false, inbox: false, autoReply: false, video: true }, csm: null, lastActiveAt: iso(-15), attention: ['quarks_low', 'inactive'] },
      { id: 'c5', name: 'Old Town Books', email: 'shop@oldtownbooks.example', tier: 'free', addons: [], paying: false, trial: false, status: 'disabled', quarks: 0, platforms: [], access: { publish: false, schedule: false, inbox: false, autoReply: false, video: true }, csm: null, lastActiveAt: iso(-60), attention: [] },
      { id: 'c6', name: 'Meera Jewellers', email: 'meera@jewellers.example', tier: 'professional', addons: ['publish', 'inbox'], paying: true, trial: false, status: 'active', quarks: 3100, platforms: ['instagram', 'facebook', 'gmb'], access: { publish: true, schedule: true, inbox: true, autoReply: true, video: true }, csm: { id: 'csm-1', name: 'Priya Raman' }, lastActiveAt: iso(-3), attention: [] }
    ] })],
    ['GET', /^\/social\/(status|api-status)/, ok({ connections: socialConnections, platforms: socialConnections, connected: ['instagram'] })],
    ['GET', /^\/social\/ayrshare\/profile/, ok({ profiles: [] })],
    ['GET', /^\/social\/inbox\/summary/, ok({ summary: { unread: 3, total: 12 }, accounts: [], connectedPlatformCount: 2, unreadMessageCount: 3 })],
    ['GET', /^\/social\/inbox/, ok({ accounts: [], conversations: [], messages: [] })],
    ['GET', /^\/social\/?$/, ok({ connections: socialConnections })],
    ['GET', /^\/socials?\b/, ok({ connections: socialConnections })],
    ['GET', /^\/notifications\/unread-count/, ok({ count: 1, unreadCount: 1 })],
    ['GET', /^\/notifications/, ok({ notifications: [{ _id: 'audit-n1', title: 'Your plan is ready', message: 'Your monthly plan is ready.', read: false, createdAt: iso(-1), type: 'info' }], unreadCount: 1 })],
    ['GET', /^\/reminders/, ok({ reminders: [], count: 0 })],
    // Brand Growth Blueprint: the view depends on the id so each state can be audited.
    ['GET', /^\/blueprint\/?$/, ok({ blueprints: [{ id: 'audit-done', businessName: 'Sweet Co', status: 'completed', createdAt: iso(-2) }, { id: 'audit-processing', businessName: 'Sunrise Bakery', status: 'processing', createdAt: iso(-1) }] })],
    ['GET', /^\/blueprint\/[^/]+$/, function (c) {
      var id = decodeURIComponent(c.path.split('/')[2]);
      // The completed Blueprint is the fixture copied from the backend (blueprint-fixture.json), injected by vite.audit.config.mjs.
      if (id === 'audit-done' && window.__AUDIT_BLUEPRINT_FIXTURE) return ok(window.__AUDIT_BLUEPRINT_FIXTURE);
      var base = { id: id, mode: 'guided', businessName: 'Sunrise Bakery', createdAt: iso(-1), refunded: false, stop: null, error: null, checkpoint: null, progress: 35, step: 'checking', status: 'processing' };
      var o = {
        'audit-checkpoint0': { status: 'awaiting_approval', step: 'approval', checkpoint: 0, progress: 40, discovery: { basis: 'limited', warnings: [{ reason: 'name_mismatch', message: 'The name on the website does not match the business name you entered.' }],
          facts: [{ id: 'f1', text: 'The website describes sourdough bread, croissants and celebration cakes baked each morning.', source: 'sunrise-bakery.example' }, { id: 'f2', text: 'Offer typed by you: Country sourdough, \u20b9220.', source: 'typed' }],
          unverified: [{ id: 'u1', text: 'Logo', reason: 'No logo was provided or found on the page.' }], missing: ['logo', 'city'] } },
        'audit-checkpoint1': { status: 'awaiting_approval', step: 'approval', checkpoint: 1, progress: 50, directions: [
          { id: 0, name: 'Fresh every morning', rationale: { text: 'Lead with the daily bake, because it is the clearest thing your own pages say.', tag: 'proposed' }, risk: { text: 'It can read as routine if the photos repeat.', tag: 'proposed' } },
          { id: 1, name: 'Made for celebrations', rationale: { text: 'Build the month around cakes and orders placed ahead.', tag: 'proposed' }, risk: null } ] },
        'audit-stopped': { status: 'stopped', step: 'stopped', progress: 100, refunded: true, stop: { reason: 'thin', message: 'We could not find enough about your business to build a reliable Blueprint. Add your website address, your Instagram page or one of your real offers, then try again.' } },
        'audit-done': { status: 'completed', step: 'done', progress: 100, result: {} }
      }[id] || {};
      var out = {}; for (var k in base) out[k] = base[k]; for (var k2 in o) out[k2] = o[k2];
      return ok(out);
    }],
    ['POST', /^\/blueprint\/[^/]+\/continue$/, { __status: 202, body: { success: true, id: 'audit-processing', status: 'queued' } }],
    ['POST', /^\/blueprint\/?$/, { __status: 202, body: { success: true, id: 'audit-processing', status: 'queued' } }],
    ['GET', /^\/hero-video\/quota/, ok({ quota: { used: 1, limit: 4, remaining: 3 }, used: 1, limit: 4, remaining: 3 })],
    ['POST', /^\/hero-video\/brief/, (function () {
      var img = function (c) { return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="' + c + '"/></svg>'); };
      var r = function (kind, source, label, c, p) { return { tag: p ? '' : '@image', kind: kind, source: source, label: label, url: img(c), mayShowPeople: !!p || undefined }; };
      var refs = [r('environment', 'environment', 'Cafe corner', '#c9b79c'), r('brand', 'brand-product', 'Tumbler', '#9aa7b5'), r('brand', 'brand-logo', 'Logo', '#d8c27a')];
      refs.forEach(function (x, i) { x.tag = '@image' + (i + 1); });
      return ok({
        brief: { concept: { title: 'Late shift', storySummary: 'A tired student finds the cafe.', coreEmotion: 'relief', visualStyle: 'warm night' }, aspectRatio: '9:16', language: 'English',
          cast: [{ id: 'cast-1', name: 'Maya', age: '22', gender: 'female', role: 'student', appearance: 'tall', clothing: 'hoodie', portraitUrl: img('#e0a') }],
          environment: { enabled: true, notes: 'corner seat', images: [] },
          scenes: [{ sceneId: 'scene-1', title: 'Hook', script: 'Yawn', visual: 'desk', durationSeconds: 5, charactersRequired: ['cast-1'], imageUrl: img('#0ae') }] },
        brand: { name: 'Gravity Cafe', website: 'https://gravity.example', logoUrl: '', colors: [], heroProduct: 'Filter coffee' },
        references: refs,
        peoplePhotos: [r('cast', 'cast-portrait', 'Maya', '#e0a', 1), r('keyframe', 'scene-keyframe', 'Hook', '#0ae', 1)],
        dropped: []
      });
    })()],
    ['GET', /^\/hero-video\/styles/, ok({ styles: [] })],
    ['GET', /^\/hero-video\/jobs/, ok({ jobs: [] })],
    ['GET', /^\/video-generation\/drafts/, ok({ drafts: [] })],
    ['GET', /^\/video-generation\//, ok({ items: [], images: [] })],
    // ---- Competitor tracking (Stage 4): the "What your competitors did" card, the list, and saving a handle ----
    ['GET', /^\/competitors\/insights/, function () {
      if (CSTATE === 'locked') return { __status: 403, body: { success: false, upgradeRequired: true, reason: 'addon', feature: 'competitors', message: 'Competitor insights is an add-on.' } };
      if (CSTATE === 'error') return { __status: 500, body: { success: false, message: 'Something went wrong.' } };
      if (CSTATE === 'empty') return ok({ weekStart: '2026-10-12', highlights: [], competitors: [] });
      var rows = COMP_ROWS.map(function (r) { return r.insight(); });
      return ok({ weekStart: '2026-10-12', highlights: [
        { competitorId: 'cmp-1', name: 'Sweet Co Bakery', text: 'Sweet Co Bakery posted 5 times this week, up from 2.', weight: 1.5 },
        { competitorId: 'cmp-1', name: 'Sweet Co Bakery', text: "Sweet Co Bakery's best post this week was a reel with 120 likes.", weight: 0.9 }
      ], competitors: rows });
    }],
    // ---- Social listening (Stage 5): the "What people say about you" card on My plan and the Inbox page ----
    ['GET', /^\/listening$/, function () {
      if (LSTATE === 'locked') return { __status: 403, body: { success: false, upgradeRequired: true, reason: 'addon', feature: 'inbox', message: 'Inbox is an add-on.' } };
      if (LSTATE === 'error') return { __status: 500, body: { success: false, message: 'Something went wrong.' } };
      var base = { enabled: true, period: { from: '2026-09-20', to: '2026-10-17' }, asOf: '2026-10-17', total: 0, counts: { positive: 0, neutral: 0, negative: 0 }, percentages: { positive: 0, neutral: 0, negative: 0 }, trend: null, topReason: null, quotes: [], recentNegative: [], lastScoredAt: null, lastScoredOn: null };
      if (LSTATE === 'notenough') return ok(Object.assign(base, { state: 'not_enough', message: 'Not enough comments yet to show a score.' }));
      if (LSTATE === 'empty' || LSTATE === 'off') return ok(Object.assign(base, { enabled: false, state: 'off', message: null, stale: false }));
      if (LSTATE === 'waiting') return ok(Object.assign(base, { state: 'waiting', message: 'Your comments are waiting for the next weekly check.', lastScoredAt: '2026-10-10T04:00:00.000Z', lastScoredOn: '2026-10-10' }));
      var STALE = LSTATE === 'stale';
      return ok(Object.assign(base, {
        enabled: true, state: 'ready', message: null, total: 86, stale: STALE,
        period: STALE ? { from: '2026-09-08', to: '2026-10-05' } : base.period, asOf: STALE ? '2026-10-05' : base.asOf,
        counts: { positive: 53, neutral: 21, negative: 12 }, percentages: { positive: 62, neutral: 24, negative: 14 },
        trend: STALE ? 'More negative comments than usual in the week to 5 October: 6 of 22, against 12% in the four weeks before. Most negative comments are about delivery.' : 'More negative comments than usual in the week to 17 October: 6 of 22, against 12% in the four weeks before. Most negative comments are about delivery.',
        lastScoredAt: STALE ? '2026-10-05T04:00:00.000Z' : '2026-10-17T04:00:00.000Z', lastScoredOn: STALE ? '2026-10-05' : '2026-10-17',
        quotes: [
          { id: 'q1', label: 'positive', platform: 'instagram', date: '2026-10-14', text: 'The cake was fresh and the packing was lovely. Will order again for the next birthday.' },
          { id: 'q2', label: 'negative', platform: 'facebook', date: '2026-10-12', text: 'My order reached two days late and nobody replied when I asked where it was.' },
          { id: 'q3', label: 'positive', platform: 'linkedin', date: '2026-10-09', text: 'Thoughtful team, quick replies, and the quality was better than we expected from a local bakery.' }
        ],
        recentNegative: [
          { id: 'n1', conversationId: 'conv-1', platform: 'facebook', date: '2026-10-16', preview: 'My order reached two days late and nobody replied when I asked where it was.' },
          { id: 'n2', conversationId: 'conv-2', platform: 'instagram', date: '2026-10-15', preview: 'The box was dented.' },
          { id: 'n3', conversationId: 'conv-3', platform: 'instagram', date: '2026-10-13', preview: 'Price went up again, a very long comment with no spaces will test wrapping: Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious' }
        ]
      }));
    }],
    ['PUT', /^\/competitors\/[^/]+\/handle$/, function (c) {
      if (CSTATE === 'put403') return { __status: 403, body: { success: false, upgradeRequired: true, reason: 'addon', feature: 'competitors', message: 'Competitor insights is an add-on.' } };
      if (CSTATE === 'put429') return { __status: 429, body: { success: false, message: 'Too many changes. Please try again in a little while.' } };
      if (CSTATE === 'puterr') return { __status: 400, body: { success: false, message: 'That handle does not look right. Use letters, numbers, dots and underscores only.' } };
      var id = c.path.split('/')[2];
      var h = ''; try { h = String(JSON.parse(c.body || '{}').handle || ''); } catch (e) { /* ignore */ }
      var row = COMP_ROWS.filter(function (r) { return r.id === id; })[0];
      if (!row) return { __status: 404, body: { success: false, message: 'We could not find that competitor.' } };
      row.handle = h; row.handleStatus = 'confirmed'; row.state = 'waiting';
      return ok({ competitor: { id: id, name: row.name, handle: h, handleStatus: 'confirmed' } });
    }],
    // My plan with a finished plan, so the competitor card shows there too (the card follows ?compstate=).
    ['GET', /^\/plan$/, function () { return planAnswer(); }],
    ['GET', /^\/home\/summary/, function () {
      if (HSTATE === 'error') return { __status: 500, body: { success: false, message: 'We could not load your home page numbers. Please try again.' } };
      var out = { __status: 200, body: Object.assign({ success: true, cached: false }, homeSummary()) };
      if (HSTATE === 'slow') out.__delay = 4000;
      return out;
    }],
    ['GET', /^\/week$/, function () { return weekAnswer(); }],
    ['GET', /^\/setup$/, function () { return setupAnswer(); }],
    ['POST', /^\/competitors\/(add-manual|auto-discover)$/, function () {
      if (CSTATE === 'locked') return { __status: 403, body: { success: false, upgradeRequired: true, reason: 'addon', feature: 'competitors', message: 'Competitor insights is an add-on.' } };
      return { __status: 200, body: { success: false, message: 'Audit stub: nothing was sent.' } };
    }],
    ['GET', /^\/competitors\/posts/, function () {
      if (CSTATE === 'empty') return ok({ posts: [], competitors: [] });
      return ok({ posts: [], competitors: COMP_ROWS.map(function (r) { return { _id: r.id, name: r.name, industry: 'bakery', socialHandles: r.handle ? { instagram: r.handle } : {}, handleStatus: r.handle ? r.handleStatus : undefined, competitorType: 'direct' }; }) });
    }],
    ['GET', /^\/competitors/, ok({ competitors: [{ _id: 'audit-comp-1', name: 'Daily Bread Co', handle: 'dailybread', platform: 'instagram', followers: 5400, posts: [] }], ignored: [] })],
    ['GET', /^\/ad-campaigns\/summary/, ok({ summary: { totalAdCampaigns: 0, activeAdCampaigns: 0, metrics: { clicks: 0, impressions: 0, ctr: 0, spend: 0 } } })],
    ['GET', /^\/ad-campaigns/, ok({ campaigns: [], adCampaigns: [] })],
    ['GET', /^\/ads\//, ok({ accounts: [], ads: [], history: [] })],
    // A few weeks of snapshots so the classic Insights chart (SVG axis labels) renders.
    ['GET', /^\/analytics\/history/, function () {
      var h = [];
      for (var i = 7; i >= 0; i--) {
        var f = 1200 + (7 - i) * 35;
        h.push({ date: iso(-i * 4), platforms: { instagram: { followers: f, reach: f * 3, impressions: f * 5, engagementRate: 3.1 + i * 0.1, posts: 20 - i, likes: 300 + i * 12 } }, totals: { followers: f, reach: f * 3, impressions: f * 5, posts: 20 - i } });
      }
      return ok({ history: h });
    }],
    ['GET', /^\/analytics\//, ok({ data: [], analytics: [], snapshots: [], posts: [], history: [] })],
    ['GET', /^\/dashboard\//, ok({ data: {}, followers: {}, competitors: [] })],
    ['GET', /^\/seo\//, ok({ data: {}, keywords: [], hashtags: [] })],
    ['GET', /^\/influencers/, ok({ influencers: [] })],
    ['GET', /^\/collaborations/, ok({ collaborations: [] })],
    ['GET', /^\/submissions/, ok({ submissions: [] })],
    ['GET', /^\/goals/, ok({ goals: [] })],
    ['GET', /^\/abtest/, ok({ tests: [] })],
    ['GET', /^\/onboarding-tour/, ok({ completed: true, progress: { completed: true }, config: { steps: [] } })],
    ['GET', /^\/google-calendar\/status/, ok({ connected: false })],
    ['GET', /^\/settings/, ok({ settings: {} })],
    ['GET', /^\/auto-reply/, ok({ settings: { enabled: false } })],
    ['GET', /^\/prompts/, ok({ prompts: [] })],
    ['GET', /^\/ai-memory/, ok({ memories: [], items: [] })],
    ['GET', /^\/ai-(history|performance)/, ok({ items: [], history: [] })],
    ['GET', /^\/reachouts\//, ok({ leads: [], campaigns: [], sequences: [], integrations: [] })],
    ['GET', /^\/trends/, ok({ trends: [] })],
    ['GET', /^\/accounts/, ok({ accounts: [] })],
  ];

  var GENERIC_GET = function () {
    return ok({ data: [], items: [], results: [], list: [], total: 0, count: 0 });
  };
  var GENERIC_WRITE = function () {
    return { __status: 200, body: { success: false, auditStub: true, message: 'Audit stub: nothing was sent.' } };
  };

  var isApiPath = function (p) { return /^\/(api|audio|generated-media)(\/|$)/.test(p); };

  function route(method, urlStr, reqBody) {
    var u;
    try { u = new URL(urlStr, location.href); } catch (e) { return { kind: 'block', reason: 'bad url' }; }
    var sameOrigin = u.origin === location.origin;
    if (isApiPath(u.pathname)) {
      var p = u.pathname.replace(/^\/api/, '') || '/';
      var m = (method || 'GET').toUpperCase();
      for (var i = 0; i < ROUTES.length; i++) {
        var r = ROUTES[i];
        if ((r[0] === '*' || r[0] === m) && r[1].test(p)) {
          var out = typeof r[2] === 'function' ? r[2]({ method: m, path: p, url: u, body: reqBody }) : r[2];
          var res = out && out.__status ? out : { __status: 200, body: out };
          AUDIT.log.push({ method: m, url: u.href, route: String(r[1]), status: res.__status });
          return { kind: 'mock', status: res.__status, body: res.body, delay: res.__delay || 0 };
        }
      }
      var fb = m === 'GET' ? { __status: 200, body: GENERIC_GET() } : GENERIC_WRITE();
      AUDIT.log.push({ method: m, url: u.href, route: 'GENERIC', status: fb.__status });
      AUDIT.unmatched.push(m + ' ' + p);
      return { kind: 'mock', status: fb.__status, body: fb.body };
    }
    if (sameOrigin) return { kind: 'pass' };
    AUDIT.blocked.push({ method: method, url: u.href });
    return { kind: 'block', reason: 'non-local host' };
  }

  // ---- 3. fetch ------------------------------------------------------------------------
  var realFetch = window.fetch.bind(window);
  var jsonResponse = function (status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  };
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var method = (init && init.method) || (input && input.method) || 'GET';
    var r = route(method, url, init && init.body);
    if (r.kind === 'pass') return realFetch(input, init);
    if (r.kind === 'mock' && r.delay) return new Promise(function (ok2) { setTimeout(function () { ok2(jsonResponse(r.status, r.body)); }, r.delay); });
    if (r.kind === 'mock') return Promise.resolve(jsonResponse(r.status, r.body));
    return Promise.resolve(jsonResponse(503, { success: false, auditBlocked: true, message: 'Blocked by audit stub' }));
  };

  // ---- 4. XMLHttpRequest (fully fake; same-origin non-API goes through realFetch) -------
  function FakeXHR() {
    this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.response = '';
    this.responseType = ''; this.timeout = 0; this.withCredentials = false; this._headers = {};
    this.upload = { addEventListener: function () {}, removeEventListener: function () {} };
    this._listeners = {};
  }
  FakeXHR.UNSENT = 0; FakeXHR.OPENED = 1; FakeXHR.HEADERS_RECEIVED = 2; FakeXHR.LOADING = 3; FakeXHR.DONE = 4;
  FakeXHR.prototype.open = function (method, url) { this._method = method; this._url = url; this.readyState = 1; this._fire('readystatechange'); };
  FakeXHR.prototype.setRequestHeader = function () {};
  FakeXHR.prototype.getResponseHeader = function (n) { return /content-type/i.test(n) ? 'application/json' : null; };
  FakeXHR.prototype.getAllResponseHeaders = function () { return 'content-type: application/json\r\n'; };
  FakeXHR.prototype.overrideMimeType = function () {};
  FakeXHR.prototype.abort = function () { this._aborted = true; };
  FakeXHR.prototype.addEventListener = function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); };
  FakeXHR.prototype.removeEventListener = function (t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(function (f) { return f !== fn; }); };
  FakeXHR.prototype._fire = function (t) {
    var ev = { type: t, target: this, currentTarget: this };
    if (typeof this['on' + t] === 'function') this['on' + t](ev);
    (this._listeners[t] || []).forEach(function (fn) { fn(ev); }, this);
  };
  FakeXHR.prototype._finish = function (status, text) {
    if (this._aborted) return;
    this.status = status; this.statusText = String(status); this.responseText = text;
    this.response = this.responseType === 'json' ? (function () { try { return JSON.parse(text); } catch (e) { return null; } })() : text;
    this.readyState = 4; this._fire('readystatechange'); this._fire(status >= 400 && status !== 401 && status !== 403 ? 'error' : 'load'); this._fire('loadend');
  };
  FakeXHR.prototype.send = function (body) {
    var self = this;
    var r = route(this._method, this._url, body);
    if (r.kind === 'mock') { setTimeout(function () { self._finish(r.status, JSON.stringify(r.body)); }, 0); return; }
    if (r.kind === 'pass') {
      realFetch(this._url, { method: this._method }).then(function (res) { return res.text().then(function (t) { self._finish(res.status, t); }); },
        function () { self._finish(0, ''); });
      return;
    }
    setTimeout(function () { self._finish(503, JSON.stringify({ success: false, auditBlocked: true })); }, 0);
  };
  window.XMLHttpRequest = FakeXHR;

  // ---- 5. WebSocket / EventSource / sendBeacon -------------------------------------------
  var RealWS = window.WebSocket;
  function FakeWS(url) {
    var self = this; this.url = url; this.readyState = 3; this._l = {};
    AUDIT.blocked.push({ method: 'WS', url: String(url) });
    setTimeout(function () { ['error', 'close'].forEach(function (t) { var ev = { type: t, target: self, code: 1006 }; if (self['on' + t]) self['on' + t](ev); (self._l[t] || []).forEach(function (f) { f(ev); }); }); }, 0);
  }
  FakeWS.prototype.send = function () {}; FakeWS.prototype.close = function () {};
  FakeWS.prototype.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
  FakeWS.prototype.removeEventListener = function () {};
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
  window.WebSocket = function (url, protocols) {
    // Vite's own HMR socket (same host:port as the page) is allowed; anything else is faked.
    try { var u = new URL(url, location.href); if (u.host === location.host && RealWS) return new RealWS(url, protocols); } catch (e) { /* fall through */ }
    return new FakeWS(url);
  };
  window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
  window.EventSource = function (url) { AUDIT.blocked.push({ method: 'SSE', url: String(url) }); this.readyState = 2; this.close = function () {}; this.addEventListener = function () {}; };
  if (navigator.sendBeacon) navigator.sendBeacon = function (url) { AUDIT.blocked.push({ method: 'BEACON', url: String(url) }); return true; };

  // ---- 6. audit runner ---------------------------------------------------------------------
  window.__nebulaaAudit = async function (routeName, opts) {
    var src = await (await realFetch('/scripts/visual-audit/contrast-audit.js?t=' + Date.now())).text();
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    return new AsyncFunction('route', 'opts', src)(routeName || location.hash || location.pathname, opts || {});
  };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var slug = function (s) { return String(s).replace(/^[#/]+/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root'; };
  // Wait until no intercepted API call has happened for `quietMs` (max `maxMs`).
  window.__auditSettle = async function (quietMs, maxMs) {
    quietMs = quietMs || 1200; maxMs = maxMs || 8000;
    var start = Date.now(), last = AUDIT.log.length, lastChange = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(200);
      if (AUDIT.log.length !== last) { last = AUDIT.log.length; lastChange = Date.now(); }
      if (Date.now() - lastChange >= quietMs) break;
    }
  };
  var save = function (kind, name, body) {
    return realFetch('/__audit/' + kind + '?name=' + encodeURIComponent(name), { method: 'POST', body: body });
  };
  // Screenshot of the viewport via html2canvas, saved as out/shots/<name>.jpg.
  window.__auditShot = async function (name) {
    if (!window.html2canvas) {
      await new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = '/__audit/html2canvas.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    }
    var canvas = await window.html2canvas(document.body, {
      x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
      windowWidth: window.innerWidth, windowHeight: window.innerHeight, scale: 1, logging: false, useCORS: false,
    });
    await save('shot', name, canvas.toDataURL('image/jpeg', 0.72));
    return name + '.jpg';
  };
  // Click a tab/toggle by its exact visible text (tabs only; routes.json never names an action button).
  var clickByText = function (text) {
    var cands = Array.prototype.slice.call(document.querySelectorAll('button, [role="tab"], a'));
    var hit = cands.find(function (b) { return (b.innerText || '').replace(/\s+/g, ' ').trim() === text && b.getBoundingClientRect().width > 0; });
    if (hit) hit.click();
    return !!hit;
  };
  // Audit one route from routes.json ({label, path, click}) or a bare hash path; saves the JSON
  // as out/results/<width>__<label>.json and returns a one-line summary.
  window.__auditRoute = async function (spec, labelArg) {
    if (typeof spec === 'string' || spec == null) spec = { path: spec, label: labelArg };
    var path = spec.path, label = spec.label || labelArg;
    // Under phone emulation a page that overflows sideways widens innerWidth (layout viewport);
    // the device width is screen.width then. The overflow itself is recorded as layoutWidth.
    var w = Math.min(window.innerWidth, screen.width || window.innerWidth);
    // The Browser pane can drop a size emulation mid-run; never save results under the wrong width.
    if (window.__auditExpectWidth && w !== window.__auditExpectWidth) throw new Error('viewport is ' + w + ', expected ' + window.__auditExpectWidth);
    var clicked = null;
    if (path != null) {
      var target = '#' + path;
      var curBase = location.hash.split('?')[0], newBase = target.split('?')[0];
      // Pages that read ?tab= only on mount need a remount: hop away first.
      if (curBase === newBase) { location.hash = curBase === '#/terms' ? '#/privacy-policy' : '#/terms'; await sleep(500); }
      location.hash = target;
      await sleep(400);
      await window.__auditSettle();
      await sleep(800);
      window.scrollTo(0, 0);
    }
    if (spec.click) {
      clicked = clickByText(spec.click);
      await sleep(300);
      await window.__auditSettle(800, 5000);
      await sleep(500);
    }
    var crashed = !document.getElementById('root') || !document.getElementById('root').children.length;
    var r = await window.__nebulaaAudit(path || location.hash);
    r.label = label || path; r.width = w; r.layoutWidth = window.innerWidth; r.blank = crashed;
    r.finalHash = location.hash;
    r.path = path; r.click = spec.click || null; r.clicked = clicked; r.mode = MODE;
    r.textLength = (document.getElementById('root') || document.body).innerText.length;
    r.consoleErrors = (window.__auditErrors || []).slice(-10);
    window.__auditErrors = [];
    var name = w + '__' + slug(label || path || location.hash);
    await save('save', name, JSON.stringify(r));
    return { name: name, finalHash: r.finalHash, checked: r.checked, failures: r.failureCount, unknown: r.unknown.length, blank: crashed, errors: r.consoleErrors.length, clicked: clicked };
  };
  // Audit every routes.json entry for the current mode (or the labels given), one after another.
  window.__auditRun = async function (labels) {
    var all = (await (await realFetch('/scripts/visual-audit/routes.json')).json()).routes;
    var todo = all.filter(function (r) { return labels ? labels.indexOf(r.label) >= 0 : r.mode === MODE; });
    var out = [];
    for (var i = 0; i < todo.length; i++) {
      try {
        var s = await window.__auditRoute(todo[i]);
        out.push([s.name, s.finalHash, s.checked, s.failures, s.unknown, s.blank ? 'BLANK' : '', s.errors, s.clicked === false ? 'NOCLICK' : ''].join(' '));
        // A crash unmounts the whole app; later routes would all be blank. Stop and say where to resume.
        if (s.blank) { out.push('STOPPED: app crashed; reload and resume with labels ' + JSON.stringify(todo.slice(i + 1).map(function (r) { return r.label; }))); break; }
      } catch (e) {
        var em = String(e && e.message);
        out.push(todo[i].label + ' ERROR ' + em);
        if (/viewport is/.test(em)) break;
        // An audit that throws is recorded as ERROR for that route, never as "0 failures".
        await save('save', Math.min(window.innerWidth, screen.width || window.innerWidth) + '__' + slug(todo[i].label),
          JSON.stringify({ route: todo[i].path, label: todo[i].label, path: todo[i].path, error: em, width: Math.min(window.innerWidth, screen.width || window.innerWidth), mode: MODE, at: new Date().toISOString() }));
      }
    }
    return out;
  };
  // Same as __auditRun but returns at once (tool calls time out); poll window.__auditJob.
  window.__auditStart = function (labels, expectWidth) {
    window.__auditExpectWidth = expectWidth || null;
    var job = (window.__auditJob = { done: false, out: null, startedAt: Date.now() });
    window.__auditRun(labels).then(function (o) { job.out = o; job.done = true; }, function (e) { job.out = ['ERROR ' + (e && e.message)]; job.done = true; });
    return 'started';
  };
  window.__auditErrors = [];
  var realConsoleError = console.error;
  console.error = function () {
    try { window.__auditErrors.push(Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a); }).join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
    return realConsoleError.apply(console, arguments);
  };
  window.addEventListener('error', function (e) { window.__auditErrors.push(String(e.message || e)); });
  window.addEventListener('unhandledrejection', function (e) { window.__auditErrors.push('unhandled: ' + String(e.reason && (e.reason.message || e.reason))); });
  window.__auditNetworkSummary = function () {
    var hosts = {};
    performance.getEntriesByType('resource').forEach(function (e) { try { var h = new URL(e.name).host; hosts[h] = (hosts[h] || 0) + 1; } catch (x) { /* ignore */ } });
    return { resourceHosts: hosts, mocked: AUDIT.log.length, blocked: AUDIT.blocked, unmatched: Array.from(new Set(AUDIT.unmatched)) };
  };
})();
