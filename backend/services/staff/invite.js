/**
 * The invite email for a new team member. One place, used by the Team page and by the old
 * admin "Add CSM" button. They set their own password with "Forgot password" on the sign-in page.
 */
const ROLE_TEXT = {
  owner: { title: 'an Owner', after: 'After you sign in, Staff area appears in the left menu.' },
  admin: { title: 'an Admin', after: 'After you sign in, Staff area appears in the left menu.' },
  csm: { title: 'a customer success manager', after: 'After you sign in, My clients appears in the left menu.' }
};

function inviteText({ firstName, role, site }) {
  const t = ROLE_TEXT[role] || ROLE_TEXT.csm;
  return `Hi ${firstName},\n\nYou have been added to Nebulaa as ${t.title}.\n\n1. Open ${site} and choose Sign in.\n2. Select Forgot password and enter this email address.\n3. Use the code we send you to set your own password.\n\n${t.after}`;
}

/** Real sender (Resend). Replaced in tests. Returns true when the provider accepted the email. */
async function send({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY) return false;
  const { Resend } = require('resend');
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai',
    to, subject, text
  });
  return !error;
}

const api = {
  inviteText,
  send,
  /** Never throws: a failed email must not undo adding the person. */
  async sendInvite({ email, firstName, role }) {
    try {
      // Not FRONTEND_URL: in production that holds the internal load-balancer address.
      const site = process.env.APP_PUBLIC_URL || 'https://gravity.nebulaa.ai';
      return Boolean(await api.send({ to: email, subject: 'Your Nebulaa account is ready', text: inviteText({ firstName, role, site }) }));
    } catch (_) {
      return false;
    }
  }
};

module.exports = api;
