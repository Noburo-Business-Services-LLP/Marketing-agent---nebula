'use strict';
/** The two emails about deleting an account. Plain, short, and never stating anything we cannot keep to. */
const longDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

function build(paragraphs) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { text: paragraphs.join('\n\n'), html: paragraphs.map((p) => `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">${esc(p)}</p>`).join('') };
}

function requestedEmail(user, purgeAfter) {
  const name = String(user.firstName || '').trim();
  const when = longDate(purgeAfter);
  return {
    subject: 'Your Nebulaa account will be deleted',
    ...build([
      name ? `Hello ${name},` : 'Hello,',
      `We received your request to delete your Nebulaa account. It will be erased on ${when}.`,
      'Your plan has been cancelled and you will not be charged again. Posts that were scheduled have been paused.',
      `If you did not ask for this, or you have changed your mind, sign in before ${when} and choose Restore. Nothing is lost until then.`,
      'After that date your posts, pictures, videos, brand details and messages are erased and cannot be brought back. We keep only the payment and tax invoice records that the law requires us to keep.',
      'If you have any questions, reply to this email and our team will help.',
      'Nebulaa'
    ])
  };
}

function deletedEmail(user) {
  const name = String(user.firstName || '').trim();
  return {
    subject: 'Your Nebulaa account has been deleted',
    ...build([
      name ? `Hello ${name},` : 'Hello,',
      'Your Nebulaa account and the data in it have been erased, as you asked.',
      'We have kept only the payment and tax invoice records that the law requires us to keep.',
      'Thank you for trying Nebulaa. You are welcome back whenever you like.',
      'Nebulaa'
    ])
  };
}

async function send(to, mail, env = process.env) {
  if (!env.RESEND_API_KEY) return { skipped: true };
  const { Resend } = require('resend');
  const { error } = await new Resend(env.RESEND_API_KEY).emails.send({ from: `Nebulaa <${env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai'}>`, to, subject: mail.subject, html: mail.html, text: mail.text });
  if (error) throw new Error(error.message || 'Email provider error');
  return { sent: true };
}

module.exports = {
  requestedEmail, deletedEmail,
  sendDeletionRequested: (user, purgeAfter) => send(user.email, requestedEmail(user, purgeAfter)),
  sendDeleted: (user) => send(user.email, deletedEmail(user))
};
