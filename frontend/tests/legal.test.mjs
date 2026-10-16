import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_ENTITY, LEGAL_PAGES } from '../constants/legal.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the legal pages name one company, and the old name is gone', () => {
  assert.equal(LEGAL_ENTITY, 'Noburo Systems Private Limited');
  for (const f of ['pages/TermsAndConditions.tsx', 'pages/PrivacyPolicy.tsx', 'pages/RefundPolicy.tsx']) {
    assert.ok(!/Business Services LLP|BUSINESS SERVICES LLP/.test(read(f)), `${f} still names the old company`);
  }
  assert.match(read('pages/TermsAndConditions.tsx'), /Noburo Systems Private Limited/);
});

test('the refund page is routed, linked from the footers, and says the things the policy promises', () => {
  assert.match(read('App.tsx'), /path="\/refund-policy"/);
  assert.deepEqual(LEGAL_PAGES.map((p) => p.href), ['/#/terms', '/#/privacy-policy', '/#/refund-policy']);
  for (const f of ['pages/LandingPage.tsx', 'pages/Auth.tsx', 'components/Layout.tsx', 'pages/TrialExpired.tsx']) {
    assert.ok(/refund-policy|LegalLinks/.test(read(f)), `${f} links the refund page`);
  }
  const page = read('pages/RefundPolicy.tsx');
  for (const phrase of ['Settings, then Billing, and choose Cancel plan', 'three days before each monthly charge', 'returned to your account automatically', 'within 7 days', 'within 10 business days', 'Grievance Officer']) {
    assert.ok(page.includes(phrase), `the refund page says: ${phrase}`);
  }
});

test('customer facing legal pages do not use the banned words', () => {
  for (const f of ['pages/RefundPolicy.tsx']) {
    const t = read(f);
    assert.ok(!/\btrial\b|unlimited/i.test(t), f);
  }
});

test('the sign-up form asks for agreement, links the three pages, and sends it with the sign-up', () => {
  const auth = read('pages/Auth.tsx');
  assert.match(auth, /type="checkbox"/);
  assert.match(auth, /Please agree to the Terms and the Privacy Policy to continue\./);
  for (const href of ['/#/terms', '/#/privacy-policy', '/#/refund-policy']) assert.ok(auth.includes(`href="${href}"`), href);
  assert.match(auth, /acceptedTerms: agreed/);
  assert.match(read('services/api.ts'), /acceptedTerms: boolean/);
});
