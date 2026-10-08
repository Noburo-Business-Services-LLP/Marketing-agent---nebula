/**
 * What each plan tier may use. Pure config: no database, no network.
 * Accounts without `plan.tier` (every account created before plans existed)
 * resolve to `managed`, which is never blocked.
 */

const TIERS = ['free', 'starter', 'professional', 'managed'];
const FEATURES = ['create', 'video', 'social_connect', 'publish', 'schedule', 'inbox', 'auto_reply', 'competitors', 'blueprint'];

// Feature -> the add-on that unlocks it on a paid plan.
const FEATURE_ADDON = {
  social_connect: 'publish',
  publish: 'publish',
  schedule: 'publish',
  inbox: 'inbox',
  auto_reply: 'inbox',
  competitors: 'competitors'
};

// No monthly cap on Hero videos: the Quark price is the limit. HERO_VIDEO_MONTHLY_LIMIT can still set one as an emergency brake.
const HERO_LIMITS = { managed: Infinity, professional: Infinity, starter: Infinity, free: Infinity };

const MESSAGES = {
  upgrade: 'This is not included in the free plan. Please upgrade your plan, or buy an add-on pack.',
  video: 'Videos unlock once you have finished setting up your business, or bought Quarks or a plan. Please complete your business setup first.',
  addon: 'This needs an add-on. Please add it to your plan or upgrade.'
};

function hasPaid(user) {
  const list = user && user.payments;
  return Array.isArray(list) && list.some((p) => p && p.status === 'paid');
}

function resolveTier(user) {
  const tier = user && user.plan && user.plan.tier;
  return TIERS.includes(tier) ? tier : 'managed';
}

function addonsOf(user) {
  const a = user && user.plan && user.plan.addons;
  return Array.isArray(a) ? a : [];
}

// An add-on is held directly, or through the bundle. `inbox` also needs `publish`.
function holds(addons, name) {
  return addons.includes(name) || addons.includes('bundle');
}

function canUse(user, feature) {
  const tier = resolveTier(user);
  if (tier === 'managed') return { allowed: true, reason: 'ok', message: '' };
  // Videos are the costly part of a free account, so they open once the person has set up their business or paid once.
  if (feature === 'video') {
    if (tier !== 'free' || user.onboardingCompleted === true || hasPaid(user)) return { allowed: true, reason: 'ok', message: '' };
    return { allowed: false, reason: 'setup', message: MESSAGES.video };
  }
  if (feature === 'create' || feature === 'blueprint') return { allowed: true, reason: 'ok', message: '' };

  if (tier === 'free') return { allowed: false, reason: 'upgrade', message: MESSAGES.upgrade };

  const needed = FEATURE_ADDON[feature];
  const addons = addonsOf(user);
  const ok = needed && holds(addons, needed) && (needed !== 'inbox' || holds(addons, 'publish'));
  if (ok) return { allowed: true, reason: 'ok', message: '' };
  return { allowed: false, reason: 'addon', message: MESSAGES.addon };
}

function heroLimitForUser(user, envOverride) {
  if (envOverride !== undefined && envOverride !== null && /^\d+$/.test(String(envOverride).trim())) {
    const n = Number(String(envOverride).trim());
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return HERO_LIMITS[resolveTier(user)];
}

// The plan written onto a NEW account at registration. Existing accounts are never touched.
function newAccountPlan() {
  return { tier: 'free' };
}

module.exports = { TIERS, FEATURES, resolveTier, addonsOf, canUse, heroLimitForUser, newAccountPlan };
