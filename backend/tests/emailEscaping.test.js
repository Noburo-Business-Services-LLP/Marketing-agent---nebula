const test = require('node:test');
const assert = require('node:assert');

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
