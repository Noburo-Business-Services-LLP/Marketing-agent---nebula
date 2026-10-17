'use strict';
// The rules for who gets a plan and when it can be made again. Pure: no database, no clock of its own.
const { resolveTier } = require('../../config/entitlements');
const { profileComplete } = require('./profileInput');

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_REFRESH_DAYS = 7;
const PLAN_MONTHLY_DAYS = 30;
const PLAN_STALE_DAYS = 45;

// Paying and managed accounts with a finished profile. Free accounts keep the free Blueprint; staff and CSMs never get one.
function shouldHavePlan(user) {
  if (!user) return false;
  if (user.staffRole || user.isCsm) return false;
  if (user.deletion && user.deletion.status === 'pending') return false;
  if (user.isActive === false) return false;
  if (user.onboardingCompleted !== true) return false;
  if (resolveTier(user) === 'free') return false;
  return profileComplete(user).complete === true;
}

function canRefresh({ user, now = new Date(), staff = false }) {
  if (staff) return { ok: true };
  const last = user && user.planState && user.planState.lastRefreshAt;
  if (!last) return { ok: true };
  const nextAt = new Date(new Date(last).getTime() + PLAN_REFRESH_DAYS * DAY_MS);
  if (new Date(now).getTime() >= nextAt.getTime()) return { ok: true };
  const when = nextAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  return { ok: false, nextAt, message: `You can refresh your plan once a week. The next refresh is available on ${when}.` };
}

function monthlyDue({ lastPlanAt, now = new Date() }) {
  if (!lastPlanAt) return true;
  return new Date(now).getTime() - new Date(lastPlanAt).getTime() > PLAN_MONTHLY_DAYS * DAY_MS;
}

function isStale(planDoc, now = new Date()) {
  if (!planDoc || !planDoc.completedAt) return false;
  return new Date(now).getTime() - new Date(planDoc.completedAt).getTime() > PLAN_STALE_DAYS * DAY_MS;
}

module.exports = { shouldHavePlan, canRefresh, monthlyDue, isStale, PLAN_REFRESH_DAYS, PLAN_MONTHLY_DAYS, PLAN_STALE_DAYS };
