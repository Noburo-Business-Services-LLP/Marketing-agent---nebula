'use strict';
// Signup abuse controls. Pure helpers plus one Express middleware. Everything is switched by environment settings,
// with safe defaults, so nothing here can lock out a legitimate customer by accident:
//   SIGNUP_MODE=invite + SIGNUP_INVITE_CODES=code1,code2   invitation-only signup
//   SIGNUPS_PER_DAY=300                                   most new accounts in any 24 hours (0 = no cap)
//   TURNSTILE_SECRET_KEY / TURNSTILE_SITE_KEY              bot check (skipped when the secret is not set)

// Throwaway-mail domains. Not exhaustive: it stops the common ones; the bot check and daily cap do the rest.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'tempmail.net', 'tempail.com',
  '10minutemail.com', '10minutemail.net', '10minemail.com', '20minutemail.com', 'minutemail.com', 'throwawaymail.com', 'trashmail.com',
  'trashmail.net', 'trashmail.de', 'trash-mail.com', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com',
  'mintemail.com', 'fakeinbox.com', 'fakemail.net', 'fake-mail.net', 'emailondeck.com', 'spamgourmet.com', 'mytemp.email', 'mohmal.com',
  'burnermail.io', 'discard.email', 'discardmail.com', 'mailcatch.com', 'mailforspam.com', 'moakt.com', 'mail.tm', 'inboxkitten.com',
  'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'tempinbox.com', 'dropmail.me', 'emailfake.com', 'email-fake.com', 'crazymailing.com',
  'jetable.org', 'harakirimail.com', 'mailtothis.com', 'spambox.us', 'spam4.me', 'tempr.email', 'luxusmail.org', 'anonbox.net',
  'mailsac.com', 'guerrillamail.biz', 'guerrillamail.de', 'wegwerfmail.de', 'wegwerfemail.de', 'einrot.com', 'cuvox.de', 'gustr.com',
  'armyspy.com', 'dayrep.com', 'fleckens.hu', 'rhyta.com', 'superrito.com', 'teleworm.us', 'cool.fr.nf', 'nospam.ze.tc', 'owlpic.com',
  'smailpro.com', 'tempmailaddress.com', 'temporary-mail.net', 'tempmailer.com', 'yopmail.gq', 'mailbox92.biz', 'bccto.me', 'vomoto.com',
  'trbvm.com', 'getairmail.com', 'airmail.cc', 'byom.de', 'deadaddress.com', 'incognitomail.com', 'mailexpire.com', 'mailmoat.com',
  'mailzilla.com', 'objectmail.com', 'proxymail.eu', 'rcpt.at', 'safetymail.info', 'sneakemail.com', 'sogetthis.com', 'spamhereplease.com',
  'tempsky.com', 'thankyou2010.com', 'trashymail.com', 'wh4f.org', 'zippymail.info', 'emltmp.com', 'mailpoof.com', 'tempemail.co',
]);

function domainOf(email) {
  const at = String(email || '').toLowerCase().trim().lastIndexOf('@');
  return at < 0 ? '' : String(email).toLowerCase().trim().slice(at + 1);
}

function isDisposableEmail(email) {
  const d = domainOf(email);
  if (!d) return false;
  if (DISPOSABLE.has(d)) return true;
  // Subdomains of a listed domain (for example x.mailinator.com).
  return [...DISPOSABLE].some((x) => d.endsWith(`.${x}`));
}

// One person, one mailbox: strips "+tag" from every address and dots from Gmail-style addresses, so
// a.b+1@gmail.com and ab+2@gmail.com count as the same account.
function canonicalEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

const MSG = {
  disposable: 'Please sign up with your own work or personal email address. Temporary email addresses are not accepted.',
  alias: 'An account with this email already exists. Please sign in.',
  capacity: 'We are receiving a very large number of sign-ups right now. Please try again in a few hours.',
  invite: 'Sign-up is by invitation for now. Please enter a valid invitation code.',
  bot: 'We could not confirm that you are a person. Please refresh the page and try again.',
};

function settings(env = process.env) {
  const codes = String(env.SIGNUP_INVITE_CODES || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  const perDay = Number(env.SIGNUPS_PER_DAY);
  return {
    inviteOnly: String(env.SIGNUP_MODE || '').toLowerCase() === 'invite',
    inviteCodes: codes,
    perDay: Number.isFinite(perDay) && env.SIGNUPS_PER_DAY !== undefined && env.SIGNUPS_PER_DAY !== '' ? perDay : 300,
    turnstileSecret: env.TURNSTILE_SECRET_KEY || '',
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
  };
}

/** What the signup screen needs to know. Never includes a secret or an invitation code. */
function publicConfig(env = process.env) {
  const s = settings(env);
  return { inviteRequired: s.inviteOnly, botCheckSiteKey: s.turnstileSecret ? s.turnstileSiteKey : '' };
}

async function verifyBotCheck(token, ip, secret, fetchImpl = fetch) {
  if (!token || typeof token !== 'string' || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const json = await res.json();
    return !!(json && json.success === true);
  } catch (_) {
    return false; // a failed check never lets a request through
  }
}

/**
 * Express middleware for POST /signup. Order: invitation, disposable mail, bot check, daily cap.
 * Dependencies are injected so each rule is tested without a database or the network.
 */
function signupGuard(deps = {}) {
  const env = deps.env || process.env;
  const countRecent = deps.countRecent || (() => require('../models/User').countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }));
  const verify = deps.verifyBotCheck || verifyBotCheck;
  return async (req, res, next) => {
    try {
      const s = settings(env);
      const body = req.body || {};
      const refuse = (status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
      if (s.inviteOnly) {
        const code = String(body.inviteCode || '').trim().toLowerCase();
        if (!code || !s.inviteCodes.includes(code)) return refuse(403, MSG.invite, { inviteRequired: true });
      }
      if (isDisposableEmail(body.email)) return refuse(400, MSG.disposable);
      if (s.turnstileSecret) {
        const ok = await verify(body.botCheckToken, req.ip, s.turnstileSecret);
        if (!ok) return refuse(400, MSG.bot, { botCheckFailed: true });
      }
      if (s.perDay > 0) {
        const n = await countRecent();
        if (n >= s.perDay) return refuse(503, MSG.capacity);
      }
      next();
    } catch (err) {
      console.error('[signup-guard] error:', err && err.message);
      // A fault in the guard must not become an open door for abuse or a closed door for customers: keep the
      // cheap rules (done above) and let the request continue to the normal validation.
      next();
    }
  };
}

module.exports = { isDisposableEmail, canonicalEmail, publicConfig, settings, verifyBotCheck, signupGuard, MSG };
