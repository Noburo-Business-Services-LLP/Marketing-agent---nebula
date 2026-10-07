/**
 * What state a client account is in, from the data we already store. Pure: no database, no network.
 * One place decides what "active", "paying", "on trial" and "needs attention" mean, so the list,
 * the counts and the client page always agree.
 */
const { canUse, resolveTier, addonsOf } = require('../../config/entitlements');

const DAY = 86400000;
const ACTIVE_DAYS = 7;
const QUARKS_LOW = 100;
const DRAFT_WAIT_DAYS = 3;

const FILTERS = ['all', 'active', 'inactive', 'disabled', 'trial', 'paying', 'attention', 'no_csm', 'hidden'];

function ms(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

function lastActiveAt(user, lastEventAt) {
  const times = [ms(user && user.lastLoginAt), ms(lastEventAt)].filter((t) => t !== null);
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Paying = at least one paid payment record, or an active subscription. */
function isPaying(user) {
  const paid = Array.isArray(user && user.payments) && user.payments.some((p) => p && p.status === 'paid');
  const subs = Array.isArray(user && user.plan && user.plan.subscriptions) && user.plan.subscriptions.some((s) => s && s.active);
  return Boolean(paid || subs);
}

function connectedCount(user) {
  const direct = Array.isArray(user && user.connectedSocials) ? user.connectedSocials.length : 0;
  const viaProvider = Array.isArray(user && user.ayrshare && user.ayrshare.activeSocialAccounts) ? user.ayrshare.activeSocialAccounts.length : 0;
  return Math.max(direct, viaProvider);
}

function accessOf(user) {
  const yes = (f) => canUse(user, f).allowed;
  return { publish: yes('publish'), schedule: yes('schedule'), inbox: yes('inbox'), autoReply: yes('auto_reply'), video: yes('video'), blueprint: yes('blueprint') };
}

/**
 * extra: { lastEventAt, oldestDraftAt, failedPosts7d }  (read separately; all optional)
 */
function classifyClient(user, now = Date.now(), extra = {}) {
  const active = lastActiveAt(user, extra.lastEventAt);
  const disabled = user && user.isActive === false;
  const daysSince = active ? (now - active.getTime()) / DAY : Infinity;
  const paying = isPaying(user);
  const trialOver = Boolean(user && user.trial && user.trial.isExpired);
  const quarks = Number(user && user.credits && user.credits.balance) || 0;
  const connected = connectedCount(user);
  const onboarded = Boolean(user && user.onboardingCompleted);

  const reasons = [];
  if (!disabled) {
    if (quarks < QUARKS_LOW) reasons.push('quarks_low');
    if (extra.oldestDraftAt && (now - new Date(extra.oldestDraftAt).getTime()) / DAY > DRAFT_WAIT_DAYS) reasons.push('drafts_waiting');
    if (onboarded && daysSince > ACTIVE_DAYS) reasons.push('inactive');
    if (!onboarded) reasons.push('onboarding_unfinished');
    if (onboarded && connected === 0) reasons.push('no_social');
    if (Number(extra.failedPosts7d) > 0) reasons.push('failed_posts');
  }

  return {
    status: disabled ? 'disabled' : (daysSince <= ACTIVE_DAYS ? 'active' : 'inactive'),
    disabled: Boolean(disabled),
    paying,
    trial: !paying && !trialOver,
    tier: resolveTier(user),
    addons: addonsOf(user),
    quarks,
    connected,
    lastActiveAt: active,
    access: accessOf(user),
    attention: reasons
  };
}

function matchesFilter(filter, user, c) {
  switch (filter) {
    case 'active': return c.status === 'active';
    case 'inactive': return c.status === 'inactive';
    case 'disabled': return c.disabled;
    case 'trial': return c.trial && !c.disabled;
    case 'paying': return c.paying;
    case 'attention': return c.attention.length > 0;
    case 'no_csm': return !(user && user.assignedCsm);
    case 'hidden': return Boolean(user && user.isHidden);
    default: return true;
  }
}

module.exports = { FILTERS, ACTIVE_DAYS, QUARKS_LOW, DRAFT_WAIT_DAYS, classifyClient, matchesFilter, isPaying, lastActiveAt, connectedCount };
