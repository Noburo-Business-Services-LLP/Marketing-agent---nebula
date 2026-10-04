/**
 * Welcome email for a new paid subscriber (Starter or Professional).
 * Pure builder plus a sender that takes an injectable transport, so tests never send mail.
 * Voice: docs/superpowers/specs/2026-10-03-nebulaa-app-voice-design.md.
 */
const { heroLimitForUser } = require('../config/entitlements');

const PLAN_NAMES = { starter: 'Starter', professional: 'Professional' };

function formatQuarks(n) {
  return Number(n).toLocaleString('en-US');
}

function buildWelcomeEmail({ firstName, tier, quarks }) {
  const planName = PLAN_NAMES[tier];
  if (!planName || !Number.isFinite(quarks) || quarks <= 0) return null;
  const hero = heroLimitForUser({ plan: { tier } });
  const heroText = hero === 1 ? 'one Hero video' : `${hero === 2 ? 'two' : hero} Hero videos`;
  const name = String(firstName || '').trim();
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const subject = `Your Nebulaa ${planName} plan is active`;

  const paragraphs = [
    greeting,
    `Thank you for subscribing. Your ${planName} plan is now active, and ${formatQuarks(quarks)} Quarks have been added to your account.`,
    `You can now create content, including posters and image posts, and generate ${heroText} each month. Each task uses Quarks, and the amount is shown before you confirm it.`,
    'Publish and schedule, Inbox and replies, and Competitor insights are add-ons. You can add any of them from the plans page whenever you need them.',
    'To begin, sign in to Nebulaa and open Create content.',
    'If you have any questions, reply to this email and our team will help.',
    'Nebulaa'
  ];
  const text = paragraphs.join('\n\n');
  const html = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(p)}</p>`)
    .join('');
  return { subject, text, html, planName };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Default transport: Resend, the same service the sign-in codes use. Created lazily.
function defaultTransport(env = process.env) {
  return async ({ from, to, subject, html, text }) => {
    if (!env.RESEND_API_KEY) return { skipped: true };
    const { Resend } = require('resend');
    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from, to, subject, html, text });
    if (error) throw new Error(error.message || 'Email provider error');
    return { sent: true };
  };
}

/** Never throws. Returns { sent, skipped?, error? }. */
async function sendSubscriberWelcome(user, { tier, quarks }, { transport, env = process.env } = {}) {
  try {
    if (!user?.email) return { sent: false, skipped: true };
    const mail = buildWelcomeEmail({ firstName: user.firstName, tier, quarks });
    if (!mail) return { sent: false, skipped: true };
    const send = transport || defaultTransport(env);
    const out = await send({
      from: `Nebulaa <${env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai'}>`,
      to: user.email, subject: mail.subject, html: mail.html, text: mail.text
    });
    return out && out.skipped ? { sent: false, skipped: true } : { sent: true };
  } catch (e) {
    console.warn('Welcome email failed (non-blocking):', e.message);
    return { sent: false, error: e.message };
  }
}

module.exports = { buildWelcomeEmail, sendSubscriberWelcome };
