'use strict';
const { isPublicHttpsUrl } = require('../heroVideoService');
const { GOALS, LIMITS } = require('../../config/blueprint');

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct']);
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function normaliseWebsite(v) {
  const s = clean(v, 300);
  if (!s) return { empty: true };
  if (/\s/.test(s)) return { error: true };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch (_) { return { error: true }; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return { error: true };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(host) || !isPublicHttpsUrl(`https://${host}/`)) return { error: true };
  const path = u.pathname === '/' ? '/' : u.pathname.replace(/\/+$/, '');
  return { url: `https://${host}${path}`, host: host.replace(/^www\./, '') };
}

function normaliseInstagram(v) {
  let s = clean(v, 200).toLowerCase();
  if (!s) return { empty: true };
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/);
  if (m) s = m[1];
  s = s.replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/.test(s) || IG_RESERVED.has(s)) return { error: true };
  return { handle: s, url: `https://www.instagram.com/${s}/` };
}

// One person, one key: case, "+tag" and Gmail dots do not make a new email.
function emailKey(email) {
  const e = clean(String(email || ''), 254).toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

function businessKeysOf(input) {
  const keys = [];
  if (input.websiteHost) keys.push(`host:${input.websiteHost}`);
  if (input.instagramHandle) keys.push(`ig:${input.instagramHandle}`);
  return keys;
}

function hex(v) {
  const m = typeof v === 'string' && v.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '';
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

function logoDataBytes(d) {
  const m = typeof d === 'string' ? d.match(DATA_URL_RE) : null;
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, '');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - pad;
}

function normaliseInput(raw, { allowGuided = false } = {}) {
  const r = isObj(raw) ? raw : {};
  const errors = {};
  const businessName = clean(r.businessName, 80);
  if (businessName.length < 2) errors.businessName = 'Enter your business name.';

  const w = normaliseWebsite(r.website);
  const ig = normaliseInstagram(r.instagram);
  if (w.error) errors.website = 'Enter your website as example.com or as a full address that starts with https://.';
  if (ig.error) errors.instagram = 'Enter your Instagram page as @name or as its web address.';
  if (w.empty && ig.empty) errors.website = 'Enter your website address or your Instagram page, or both.';

  const whatYouSell = clean(r.whatYouSell, 200);
  if (whatYouSell.length < 10) errors.whatYouSell = 'Describe what you sell in one sentence of at least ten characters.';
  const whoItsFor = clean(r.whoItsFor, 200);
  if (whoItsFor.length < 5) errors.whoItsFor = 'Describe who it is for in a few words.';
  const goal = GOALS.includes(r.goal) ? r.goal : '';
  if (!goal) errors.goal = 'Choose your main goal.';

  const competitors = [];
  for (const c of (Array.isArray(r.competitors) ? r.competitors : []).slice(0, LIMITS.MAX_COMPETITORS)) {
    if (!isObj(c)) continue;
    const name = clean(c.name, 80);
    const cw = normaliseWebsite(c.url);
    if (cw.error) { errors.competitors = 'One competitor address could not be read. Check it or remove it.'; continue; }
    if (!name && cw.empty) continue;
    competitors.push({ name: name || cw.host, url: cw.url || '', host: cw.host || '' });
  }

  const offers = [];
  for (const o of (Array.isArray(r.offers) ? r.offers : []).slice(0, LIMITS.MAX_OFFERS)) {
    if (!isObj(o)) continue;
    const name = clean(o.name, 80);
    const price = clean(o.price, 24);
    if (!name && !price) continue;
    if (!name) { errors.offers = 'Give each offer a name, or leave its price empty.'; continue; }
    offers.push({ name, price });
  }

  const colours = (Array.isArray(r.colours) ? r.colours : []).map(hex).filter(Boolean).slice(0, LIMITS.MAX_COLOURS);

  let logoUrl = '';
  let logoDataUrl = null;
  if (clean(r.logoUrl, 2048)) {
    if (!isPublicHttpsUrl(r.logoUrl) || /\.(svg|gif|avif|heic|heif|bmp|tiff?)$/i.test(new URL(r.logoUrl).pathname)) errors.logo = 'Use a JPG, PNG or WebP logo at a public https address, or upload the file.';
    else logoUrl = r.logoUrl.trim();
  } else if (r.logoDataUrl) {
    const bytes = logoDataBytes(r.logoDataUrl);
    if (bytes === null) errors.logo = 'Upload your logo as a PNG, JPG or WebP file.';
    else if (bytes > LIMITS.LOGO_DATA_BYTES) errors.logo = 'The logo file is larger than 2 MB. Upload a smaller file.';
    else logoDataUrl = r.logoDataUrl;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    mode: allowGuided && r.mode === 'guided' ? 'guided' : 'auto',
    logoDataUrl,
    input: {
      businessName, websiteUrl: w.url || '', websiteHost: w.host || '', instagramHandle: ig.handle || '', instagramUrl: ig.url || '',
      whatYouSell, whoItsFor, goal, city: clean(r.city, 60), competitors, offers, colours, logoUrl
    }
  };
}

module.exports = { normaliseInput, normaliseWebsite, normaliseInstagram, emailKey, businessKeysOf };
