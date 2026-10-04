/**
 * What each plan tier may use. Pure config: no database, no network.
 * Accounts without `plan.tier` (every account created before plans existed)
 * resolve to `managed`, which is never blocked.
 */

const TIERS = ['free', 'starter', 'professional', 'managed'];
const FEATURES = ['create', 'video', 'social_connect', 'publish', 'schedule', 'inbox', 'auto_reply', 'competitors'];

// Feature -> the add-on that unlocks it on a paid plan.
const FEATURE_ADDON = {
  social_connect: 'publish',
  publish: 'publish',
  schedule: 'publish',
  inbox: 'inbox',
  auto_reply: 'inbox',
  competitors: 'competitors'
};

const HERO_LIMITS = { managed: 2, professional: 2, starter: 1, free: 1 };

const MESSAGES = {
  upgrade: 'This is not included in the free plan. Please upgrade your plan, or buy an add-on pack.',
  addon: 'This needs an add-on. Please add it to your plan or upgrade.'
};

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
  if (feature === 'create' || feature === 'video') return { allowed: true, reason: 'ok', message: '' };

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

module.exports = { TIERS, FEATURES, resolveTier, addonsOf, canUse, heroLimitForUser };
