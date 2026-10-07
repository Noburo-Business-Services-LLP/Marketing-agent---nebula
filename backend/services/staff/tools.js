/**
 * Owner and Admin tools that used to live on the old /admin page. The rules are here and tested with
 * fakes; routes/staff.js only wires in the database. Nothing from the request is trusted for who is
 * acting: `actor` is the signed-in account loaded by the server (requireStaff).
 */
const { can, isStaff } = require('./permissions');
const { isCustomer } = require('./clientActions');

const refuse = (status, message) => ({ status, body: { success: false, message } });
const idOf = (v) => (v ? String(v._id || v.id || v) : '');

/**
 * After moving to a different Ayrshare account, the stored per-customer profile ids belong to the old
 * account and would be refused. Clearing them makes the app create a fresh profile on the new account the
 * next time each customer connects. Only the Ayrshare fields are touched; nothing is sent to Ayrshare.
 */
const AYRSHARE_RESET = {
  filter: { 'ayrshare.profileKey': { $exists: true, $nin: ['', null] } },
  update: { $set: { 'ayrshare.profileKey': '', 'ayrshare.refId': '', 'ayrshare.title': '', 'ayrshare.activeSocialAccounts': [], 'ayrshare.displayNames': [], 'ayrshare.lastCheckedAt': null } }
};

async function resetAyrshareIds({ actor, confirm, repo, record }) {
  if (!isStaff(actor) || !can(actor, 'reset_accounts')) return refuse(403, 'Your role cannot do this.');
  if (confirm !== true) return refuse(400, 'Please confirm first.');
  const cleared = await repo.resetAyrshareProfileKeys();
  await record({ actor, action: 'reset_ayrshare_ids', details: { cleared } });
  return { status: 200, body: { success: true, cleared } };
}

/**
 * Turns a staff account into a clean one: business profile and connected accounts cleared, drafts archived
 * (archived, not deleted, so they can be restored). Quarks, login, role and clients stay. Staff accounts only.
 */
async function resetStaffAccount({ actor, targetId, confirm, repo, record }) {
  if (!isStaff(actor) || !can(actor, 'reset_accounts')) return refuse(403, 'Your role cannot do this.');
  const target = await repo.findById(targetId);
  if (!target || !isStaff(target)) return refuse(404, 'That person is not on the team.');
  if (confirm !== true) return refuse(400, 'Please confirm first.');
  const archivedDrafts = await repo.clearTestProfile(target._id);
  await record({ actor, action: 'reset_staff_account', client: target._id, details: { archivedDrafts } });
  return { status: 200, body: { success: true, archivedDrafts } };
}

/** Leaves a client out of (or back in) every staff count; test accounts are the use. Client accounts only. */
async function setHidden({ actor, targetId, hidden, repo, record }) {
  if (!isStaff(actor) || !can(actor, 'hide_client')) return refuse(403, 'Your role cannot do this.');
  if (typeof hidden !== 'boolean') return refuse(400, 'Say whether to hide or show this client.');
  const target = await repo.findById(targetId);
  if (!target || !isCustomer(target)) return refuse(404, 'That client was not found.');
  await repo.setHidden(target._id, hidden);
  await record({ actor, action: hidden ? 'hide_client' : 'show_client', client: target._id });
  return { status: 200, body: { success: true, hidden } };
}

const CODE = /^[A-Z0-9_-]{3,30}$/;

/** A coupon code is upper case letters, digits, dash or underscore, 3 to 30 characters. */
function parseCoupon(input = {}) {
  const code = String(input.code || '').trim().toUpperCase();
  if (!CODE.test(code)) return { ok: false, message: 'Use 3 to 30 letters, numbers, dashes or underscores for the code.' };
  const discountedAmount = input.discountedAmount === undefined || input.discountedAmount === '' ? 5000 : Number(input.discountedAmount);
  if (!Number.isFinite(discountedAmount) || discountedAmount <= 0 || discountedAmount > 10000000) return { ok: false, message: 'Enter the discounted price as a number above 0.' };
  const maxUses = input.maxUses === undefined || input.maxUses === '' ? 1 : Number(input.maxUses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000) return { ok: false, message: 'Enter how many times it can be used, a whole number from 1.' };
  const note = String(input.note || '').trim().slice(0, 200);
  return { ok: true, coupon: { code, discountedAmount, maxUses, note } };
}

const mayCoupons = (actor) => isStaff(actor) && can(actor, 'manage_coupons');

async function createCoupon({ actor, input, repo, record }) {
  if (!mayCoupons(actor)) return refuse(403, 'Your role cannot do this.');
  const parsed = parseCoupon(input);
  if (!parsed.ok) return refuse(400, parsed.message);
  let created;
  try { created = await repo.create(parsed.coupon); } catch (error) {
    if (error && error.code === 11000) return refuse(409, 'That coupon code already exists.');
    throw error;
  }
  await record({ actor, action: 'coupon_create', details: { code: parsed.coupon.code, discountedAmount: parsed.coupon.discountedAmount, maxUses: parsed.coupon.maxUses } });
  return { status: 200, body: { success: true, coupon: created } };
}

async function deactivateCoupon({ actor, code, repo, record }) {
  if (!mayCoupons(actor)) return refuse(403, 'Your role cannot do this.');
  const clean = String(code || '').trim().toUpperCase();
  const coupon = await repo.deactivate(clean);
  if (!coupon) return refuse(404, 'That coupon was not found.');
  await record({ actor, action: 'coupon_deactivate', details: { code: clean } });
  return { status: 200, body: { success: true, coupon } };
}

async function deleteCoupon({ actor, code, repo, record }) {
  if (!mayCoupons(actor)) return refuse(403, 'Your role cannot do this.');
  const clean = String(code || '').trim().toUpperCase();
  const gone = await repo.remove(clean);
  if (!gone) return refuse(404, 'That coupon was not found.');
  await record({ actor, action: 'coupon_delete', details: { code: clean } });
  return { status: 200, body: { success: true } };
}

module.exports = { AYRSHARE_RESET, resetAyrshareIds, resetStaffAccount, setHidden, parseCoupon, createCoupon, deactivateCoupon, deleteCoupon, idOf };
