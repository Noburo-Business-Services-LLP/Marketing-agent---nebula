import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ayrshareResetConfirm, ayrshareResetNotice, resetAccountConfirm, resetAccountNotice,
  hideConfirm, hideNotice, validateCouponForm, couponLine, canResetAccount
} from '../utils/staffTools.ts';

test('the Ayrshare confirm says exactly what is cleared and what is not touched', () => {
  const t = ayrshareResetConfirm(12);
  assert.match(t, /12 stored social profile IDs/);
  assert.match(t, /Use this only after switching to a different Ayrshare account/);
  assert.match(t, /Posts, drafts and Quarks are not touched/);
  assert.match(ayrshareResetConfirm(1), /1 stored social profile ID\b/);
  assert.match(ayrshareResetConfirm(undefined), /every customer's stored social profile ID/);
});

test('the Ayrshare notice reports the real count, and says so when nothing needed clearing', () => {
  assert.equal(ayrshareResetNotice({ success: true, cleared: 3 }), 'Done. 3 stored profile IDs were cleared. Each client gets a new profile the next time they connect an account.');
  assert.equal(ayrshareResetNotice({ success: true, cleared: 1 }).startsWith('Done. 1 stored profile ID was cleared.'), true);
  assert.equal(ayrshareResetNotice({ success: true, cleared: 0 }), 'Nothing to clear: no client has a stored profile ID.');
  assert.equal(ayrshareResetNotice({ success: false, message: 'Your role cannot do this.' }), 'Your role cannot do this.');
  assert.equal(ayrshareResetNotice({ success: false }), 'We could not reset the profile IDs. Please try again.');
});

test('the staff account reset confirm names the person and what is cleared and kept', () => {
  const t = resetAccountConfirm({ name: 'Cleo Rao', email: 'cleo@x.com' });
  assert.match(t, /Cleo Rao \(cleo@x\.com\)/);
  assert.match(t, /clears their business profile and connected social accounts/);
  assert.match(t, /archives their drafts/);
  assert.match(t, /Quarks, sign-in, role and clients stay/);
});

test('the staff account reset notice reports archived drafts', () => {
  assert.equal(resetAccountNotice('Cleo Rao', { success: true, archivedDrafts: 2 }), "Cleo Rao's account is clean again. 2 drafts were archived.");
  assert.equal(resetAccountNotice('Cleo Rao', { success: true, archivedDrafts: 1 }), "Cleo Rao's account is clean again. 1 draft was archived.");
  assert.equal(resetAccountNotice('Cleo Rao', { success: true, archivedDrafts: 0 }), "Cleo Rao's account is clean again. No drafts needed archiving.");
  assert.equal(resetAccountNotice('Cleo Rao', { success: false, message: 'That person is not on the team.' }), 'That person is not on the team.');
});

test('only the Owner sees the reset, and it is offered on any staff row', () => {
  assert.equal(canResetAccount({ reset_accounts: true }), true);
  assert.equal(canResetAccount({ reset_accounts: false }), false);
  assert.equal(canResetAccount(undefined), false);
});

test('hide and show wording', () => {
  assert.match(hideConfirm('Acme', true), /Leave Acme out of the numbers\?/);
  assert.match(hideConfirm('Acme', true), /Home, Money and Usage/);
  assert.match(hideConfirm('Acme', false), /Count Acme in the numbers again\?/);
  assert.equal(hideNotice({ success: true, hidden: true }), 'This client is now left out of the numbers.');
  assert.equal(hideNotice({ success: true, hidden: false }), 'This client counts in the numbers again.');
  assert.equal(hideNotice({ success: false, message: 'Your role cannot do this.' }), 'Your role cannot do this.');
});

test('coupon form checks give plain messages and a clean payload', () => {
  assert.equal(validateCouponForm({ code: '', discountedAmount: '5000', maxUses: '1', note: '' }).ok, false);
  assert.match(validateCouponForm({ code: 'ab', discountedAmount: '5000', maxUses: '1', note: '' }).message, /3 to 30 letters/);
  assert.match(validateCouponForm({ code: 'good code', discountedAmount: '5000', maxUses: '1', note: '' }).message, /3 to 30 letters/);
  assert.match(validateCouponForm({ code: 'GOOD', discountedAmount: '0', maxUses: '1', note: '' }).message, /discounted price/i);
  assert.match(validateCouponForm({ code: 'GOOD', discountedAmount: '5000', maxUses: '1.5', note: '' }).message, /whole number/);
  const ok = validateCouponForm({ code: ' spring25 ', discountedAmount: '4000', maxUses: '3', note: '  For Bobby ' });
  assert.deepEqual(ok, { ok: true, payload: { code: 'SPRING25', discountedAmount: 4000, maxUses: 3, note: 'For Bobby' } });
});

test('a coupon line reads in plain words', () => {
  assert.equal(couponLine({ code: 'A1', discountedAmount: 5000, maxUses: 3, usedCount: 1, isActive: true, note: '' }), '1 of 3 uses · INR 5,000');
  assert.equal(couponLine({ code: 'A1', discountedAmount: 5000, maxUses: 1, usedCount: 0, isActive: false, note: 'For Bobby' }), 'Switched off · 0 of 1 use · INR 5,000 · For Bobby');
});
