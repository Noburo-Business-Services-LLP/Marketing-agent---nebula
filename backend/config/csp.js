'use strict';
/**
 * The Content-Security-Policy of the web app, in REPORT-ONLY mode (docs/superpowers/ops/security-hardening.md,
 * decision D44). One list, used by helmet on the API server and copied into nginx.conf for the static app (a test
 * keeps the two equal: tests/securityHeaders.test.js). Browsers report what the policy would block to
 * /api/csp-report; nothing is blocked yet.
 *
 * Built from what the app really loads (2026-10-20): frontend/index.html (Tailwind Play CDN script and its inline
 * config script, Google Fonts, the esm.sh import map), Razorpay Checkout (script, frames, its API), Cloudflare
 * Turnstile on the sign-in page, pictures from Cloudinary, S3, Unsplash, Instagram/Facebook CDNs and ui-avatars,
 * sample audio from soundhelix, the API on the same origin (/api, live updates are server-sent events on /api).
 *
 * What blocks ENFORCING it today: the Tailwind Play CDN builds its CSS in the browser and needs the inline config
 * script ('unsafe-inline' for scripts) and inline styles; index.html has inline scripts; the esm.sh import map loads
 * code from a third party. Build Tailwind at build time and drop the import map first (frontend job).
 */

const DIRECTIVES = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://esm.sh', 'https://checkout.razorpay.com', 'https://challenges.cloudflare.com'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://*.amazonaws.com', 'https://images.unsplash.com', 'https://*.cdninstagram.com', 'https://*.fbcdn.net', 'https://ui-avatars.com'],
  'media-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://*.amazonaws.com', 'https://www.soundhelix.com'],
  'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://checkout.razorpay.com', 'https://esm.sh', 'https://res.cloudinary.com', 'https://*.amazonaws.com', 'https://challenges.cloudflare.com'],
  'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://challenges.cloudflare.com'],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
  'report-uri': ['/api/csp-report']
});

/** The header value, in a stable order ("default-src 'self'; script-src ..."). */
function cspHeaderValue(directives = DIRECTIVES) {
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

/** For helmet's contentSecurityPolicy option (report-only, no defaults added). */
function helmetCsp() {
  return { useDefaults: false, reportOnly: true, directives: Object.fromEntries(Object.entries(DIRECTIVES).map(([k, v]) => [k, [...v]])) };
}

module.exports = { DIRECTIVES, cspHeaderValue, helmetCsp };
