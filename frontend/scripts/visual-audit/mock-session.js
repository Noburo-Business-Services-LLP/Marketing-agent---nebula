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
  try {
    localStorage.setItem('authToken', 'audit-fake-token');
    localStorage.setItem('token', 'audit-fake-token');
    localStorage.removeItem('nebulaa-theme');
    // Keep first-run tours and popups from covering the pages.
    localStorage.setItem('nebulaa_tour_completed', 'true');
    localStorage.setItem('onboardingTourCompleted', 'true');
  } catch (e) { /* ignore */ }
  // Session mode: ?audit=logged-out | onboarding | admin | normal (remembered for the tab in sessionStorage).
  var params = new URLSearchParams(location.search);
  if (params.get('audit')) sessionStorage.setItem('audit-mode', params.get('audit'));
  var MODE = sessionStorage.getItem('audit-mode') || 'normal';
  var LOGGED_OUT = MODE === 'logged-out';
  var NEEDS_ONBOARDING = MODE === 'onboarding';
  var STAFF = MODE === 'staff'; // a signed-in Owner, so the staff area and its menu entry show
  AUDIT.mode = MODE;
  if (LOGGED_OUT) { localStorage.removeItem('authToken'); localStorage.removeItem('token'); }
  // Admin pages check their own token; 'admin' mode gives them a fake one.
  try { if (MODE === 'admin') localStorage.setItem('adminToken', 'audit-fake-admin-token'); else localStorage.removeItem('adminToken'); } catch (e) { /* ignore */ }

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

  var ok = function (extra) { var o = { success: true }; for (var k in extra) o[k] = extra[k]; return o; };

  // [method or '*', RegExp on pathname after /api, response object or function(ctx) -> object|{__status,body}]
  var ROUTES = [
    ['GET', /^\/auth\/me$/, function () { return LOGGED_OUT ? { __status: 401, body: { success: false, message: 'Not signed in' } } : ok({ user: user }); }],
    ['GET', /^\/auth\/business-context$/, ok({ businessLocation: businessProfile.businessLocation, company: businessProfile, geography: { city: 'Chennai', country: 'India' } })],
    ['GET', /^\/credits/, ok({ credits: credits, trial: { startDate: iso(-3), expiresAt: iso(4), daysLeft: 4, isExpired: false }, costs: { post: 10, reel: 50, heroClip: 250, blueprint: 7 }, units: {} })],
    ['GET', /^\/payment\/plans/, function () {
      var cyc = function (amt) { return { monthly: { planId: 'audit-m', amount: amt, label: 'Monthly', per: 'per month' }, quarterly: { planId: 'audit-q', amount: amt * 3, label: 'Quarterly', per: 'per quarter' }, annual: { planId: 'audit-a', amount: amt * 10, label: 'Annual', per: 'per year' } }; };
      var plan = function (name, amt) { return { name: name, description: 'Audit placeholder plan.', features: ['Feature one', 'Feature two', 'Feature three'], cycles: cyc(amt) }; };
      return ok({ plans: { pro: plan('Pro', 1000), growth: plan('Growth', 2000), scale: plan('Scale', 3000) } });
    }],
    ['GET', /^\/payment\/(status|billing)/, ok({ subscription: user.subscription, credits: credits, payments: [] })],
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
    ['GET', /^\/staff\/team$/, ok({ me: 'owner-1', grantable: ['owner', 'admin', 'csm'], maxClients: 12, owners: 1, rows: [
      { id: 'owner-1', name: 'Dinesh Kannaa', email: 'owner@example.test', role: 'owner', status: 'active', lastActiveAt: iso(0), clients: null, draftsWaiting: null, needAttention: null },
      { id: 'admin-1', name: 'Meera Nair', email: 'meera@example.test', role: 'admin', status: 'active', lastActiveAt: iso(-1), clients: null, draftsWaiting: null, needAttention: null },
      { id: 'csm-1', name: 'Priya Raman', email: 'priya@example.test', role: 'csm', status: 'active', lastActiveAt: iso(-1), clients: 12, draftsWaiting: 9, needAttention: 3 },
      { id: 'csm-2', name: 'Arun Kumar', email: 'arun@example.test', role: 'csm', status: 'active', lastActiveAt: iso(-9), clients: 5, draftsWaiting: 1, needAttention: 0 },
      { id: 'csm-3', name: 'Lakshmi Venkataraman-Subramaniam', email: 'lakshmi.venkataraman-subramaniam@example.test', role: 'csm', status: 'switched_off', lastActiveAt: null, clients: 0, draftsWaiting: 0, needAttention: 0 }
    ] })],
    ['POST', /^\/staff\/team$/, ok({ member: { id: 'csm-9', name: 'New Person', email: 'new@example.test', role: 'csm' }, converted: false, emailed: true })],
    ['PATCH', /^\/staff\/team\/[^/]+$/, ok({ member: { id: 'csm-1', name: 'Priya Raman', email: 'priya@example.test', role: 'admin' }, unassigned: { count: 12, clients: [{ id: 'c1', name: 'Sunrise Bakery' }, { id: 'c2', name: 'Green Leaf Cafe' }, { id: 'c6', name: 'Meera Jewellers' }] } })],
    ['DELETE', /^\/staff\/team\/[^/]+$/, ok({ removed: true, unassigned: { count: 5, clients: [{ id: 'c1', name: 'Sunrise Bakery' }, { id: 'c2', name: 'Green Leaf Cafe' }, { id: 'c6', name: 'Meera Jewellers' }] } })],
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
    ['GET', /^\/staff\/clients\/[^/?]+$/, ok({ client: { id: 'c1', name: 'Sunrise Bakery', email: 'owner@sunrise-bakery.example', mobile: '9876543210', business: { name: 'Sunrise Bakery', industry: 'Food & Beverage', website: 'https://sunrise-bakery.example', location: 'Chennai' }, signedUpAt: iso(-40), lastActiveAt: iso(-1), onboardingCompleted: true, csm: { id: 'csm-1', name: 'Priya Raman' }, status: 'active', tier: 'managed', addons: [], paying: true, trial: false, access: { publish: true, schedule: true, inbox: true, autoReply: true, video: true, blueprint: true }, attention: ['quarks_low', 'drafts_waiting'], quarks: 62, connections: ['instagram', 'facebook'], recentQuarks: [{ action: 'staff_grant', amount: 500, description: 'Nebulaa staff added 500 Quarks', at: iso(-6) }], featureUse30d: [{ feature: 'post_generated', count: 24 }, { feature: 'campaign_created', count: 3 }], drafts30d: { published: 12, draft: 4, failed: 1 }, money: { payments: [{ item: 'Quark pack 500', amount: 999, currency: 'INR', status: 'paid', at: iso(-12) }], subscriptions: [] }, history: [{ action: 'add_quarks', by: 'Dinesh Kannaa', at: iso(-6), details: { amount: 500 } }] }, can: { open_client: true, add_quarks: true, toggle_client: true, assign_csm: true, view_money: true } })],
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
    ['GET', /^\/social\/inbox\/summary/, ok({ summary: { unread: 0, total: 0 }, accounts: [] })],
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
    ['GET', /^\/hero-video\/styles/, ok({ styles: [] })],
    ['GET', /^\/hero-video\/jobs/, ok({ jobs: [] })],
    ['GET', /^\/video-generation\/drafts/, ok({ drafts: [] })],
    ['GET', /^\/video-generation\//, ok({ items: [], images: [] })],
    ['GET', /^\/competitors\/posts/, ok({ posts: [] })],
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
    // Internal admin dashboard (mode=admin). Users list empty; trial funnel left out (its tab is not opened).
    ['GET', /^\/admin\/overview/, ok({ data: { totalUsers: 12, newToday: 1, newThisWeek: 3, newThisMonth: 7, dau: 4, wau: 8, mau: 11, activeTrials: 5, expiringSoon: 1, expiredTrials: 2, totalCreditsUsed: 5400 } })],
    ['GET', /^\/admin\/users/, ok({ data: [] })],
    ['GET', /^\/admin\/content-stats/, ok({ data: { generated: 40, published: 22, publishRate: 55, topGenerators: [] } })],
    ['GET', /^\/admin\/(coupons)/, ok({ data: [] })],
    ['GET', /^\/admin\/(trial-funnel|ayrshare-usage)/, { success: false }],
  ];

  var GENERIC_GET = function () {
    return ok({ data: [], items: [], results: [], list: [], total: 0, count: 0 });
  };
  var GENERIC_WRITE = function () {
    return { __status: 200, body: { success: false, auditStub: true, message: 'Audit stub: nothing was sent.' } };
  };

  var isApiPath = function (p) { return /^\/(api|audio|generated-media)(\/|$)/.test(p); };

  function route(method, urlStr) {
    var u;
    try { u = new URL(urlStr, location.href); } catch (e) { return { kind: 'block', reason: 'bad url' }; }
    var sameOrigin = u.origin === location.origin;
    if (isApiPath(u.pathname)) {
      var p = u.pathname.replace(/^\/api/, '') || '/';
      var m = (method || 'GET').toUpperCase();
      for (var i = 0; i < ROUTES.length; i++) {
        var r = ROUTES[i];
        if ((r[0] === '*' || r[0] === m) && r[1].test(p)) {
          var out = typeof r[2] === 'function' ? r[2]({ method: m, path: p, url: u }) : r[2];
          var res = out && out.__status ? out : { __status: 200, body: out };
          AUDIT.log.push({ method: m, url: u.href, route: String(r[1]), status: res.__status });
          return { kind: 'mock', status: res.__status, body: res.body };
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
    var r = route(method, url);
    if (r.kind === 'pass') return realFetch(input, init);
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
  FakeXHR.prototype.send = function () {
    var self = this;
    var r = route(this._method, this._url);
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
