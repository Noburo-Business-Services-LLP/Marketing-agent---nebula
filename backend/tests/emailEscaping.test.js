/**
 * Every HTML email escapes the text it puts in with the ONE helper utils/escapeHtml.js (tester's note 2026-10-20).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const XSS = '<img src=x onerror=alert(1)>';
const SAFE = '&lt;img src=x onerror=alert(1)&gt;';

test('welcome, renewal and account emails show a name as text, never as markup', () => {
  const { buildWelcomeEmail } = require('../services/welcomeEmail');
  const w = buildWelcomeEmail({ firstName: XSS, tier: 'starter', quarks: 600 });
  assert.ok(!w.html.includes(XSS) && w.html.includes(SAFE));
  const { buildReminderEmail } = require('../services/renewalReminders');
  const r = buildReminderEmail({ user: { firstName: XSS, email: 'a@x.test', plan: { tier: 'starter' }, subscription: { status: 'active', currentEnd: new Date(Date.now() + 3 * 86400000) } } });
  assert.ok(!r.html.includes(XSS) && r.html.includes(SAFE));
  const m = require('../services/accountMail');
  for (const mail of [m.requestedEmail({ firstName: XSS }, new Date()), m.deletedEmail({ firstName: XSS })]) {
    assert.ok(!mail.html.includes(XSS), 'account email');
  }
});

test('quotes are escaped too (the shared helper), so text cannot leave an attribute', () => {
  const { escapeHtml } = require('../utils/escapeHtml');
  assert.strictEqual(escapeHtml(`"' onmouseover=x`), '&quot;&#39; onmouseover=x');
});

test('the plain-text to HTML fallback of the mail service escapes the text first', () => {
  const svc = require('../services/emailService');
  const html = (svc._textToHtml || svc.constructor.prototype._textToHtml).call(svc, `Hi ${XSS}\n\nbye`);
  assert.ok(!html.includes(XSS) && html.includes(SAFE));
});

test('no email file keeps its own escape function: they all use utils/escapeHtml', () => {
  for (const f of ['welcomeEmail.js', 'renewalReminders.js', 'accountMail.js', 'sesEmailService.js', 'otpService.js', 'emailService.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8');
    assert.match(src, /require\('\.\.\/utils\/escapeHtml'\)/, f);
    assert.ok(!/(const esc = \(s\) =>|function escapeHtml\()/.test(src), `${f} has its own escape function`);
  }
});

// ---- kept from the first version of this file (sign-in code and campaign emails) ----
// Text is no longer stripped on the way in, so every HTML email must escape what it puts in.
const EVIL = '<a href="https://evil.example">Click to verify</a> & co';

test('the sign-in code email escapes the name typed at sign-up', () => {
  const otp = require('../services/otpService');
  const html = otp._buildEmailTemplate('123456', EVIL);
  assert.ok(!html.includes('<a href="https://evil.example">'));
  assert.ok(html.includes('Hi &lt;a href=&quot;https://evil.example&quot;&gt;Click to verify&lt;/a&gt; &amp; co,'));
});

test('campaign reminder and live emails escape the campaign name, time and platforms', async () => {
  const ses = require('../services/sesEmailService');
  const sent = [];
  ses.initialized = true;
  ses.client = { send: async (cmd) => { sent.push(cmd.input); return { MessageId: 'm1' }; } };
  await ses.sendCampaignReminder({ to: 'zz@example.test', campaignName: EVIL, minutesBefore: 15, scheduledTime: '<i>9 am</i>', platforms: ['<b>instagram</b>'] });
  await ses.sendCampaignLive({ to: 'zz@example.test', campaignName: EVIL, platforms: ['<b>facebook</b>'] });
  assert.strictEqual(sent.length, 2);
  for (const input of sent) {
    const html = input.Message.Body.Html.Data;
    assert.ok(!html.includes('<a href="https://evil.example">'), 'name escaped');
    assert.ok(!html.includes('<b>'), 'platform escaped');
    assert.ok(html.includes('&lt;a href=&quot;https://evil.example&quot;&gt;'));
  }
  assert.ok(!sent[0].Message.Body.Html.Data.includes('<i>9 am</i>'));
});

test('escapeHtml', () => {
  const { escapeHtml } = require('../utils/escapeHtml');
  assert.strictEqual(escapeHtml(`<x a="1" b='2'>&`), '&lt;x a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;');
  assert.strictEqual(escapeHtml(null), '');
});
