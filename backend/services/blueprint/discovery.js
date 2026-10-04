'use strict';
// Modules A and B: discovery, verification and tagging. Facts are made by code only, from the visitor's own
// input and from the few public pages the visitor pointed to. Every fact stores the exact quote it came from and
// is dropped by verifyFacts if that quote cannot be found again. No prices, contact details or counts are read.
const { LIMITS, STOP_MESSAGES, WARNING_MESSAGES } = require('../../config/blueprint');
const { fetchPublicPage, robotsAllows } = require('./safeFetch');
const { extractPage } = require('./pageFacts');

const STOP_WORDS = new Set(['the', 'and', 'co', 'company', 'pvt', 'ltd', 'llp', 'private', 'limited', 'inc', 'shop', 'store', 'studio', 'by']);
const HEADINGS_PER_PAGE = 6;
const HEADINGS_TOTAL = 14;
const IG_COUNTS = /^[\d.,KMkm]+\s+Followers.*?Posts\s*-\s*/i;
// Text that looks like a contact detail, a count, an address or a price is never turned into a fact.
const RISKY = /@|\bfollowers?\b|\bfollowing\b|\d{5,}|\d[\d\s().-]{8,}\d|tel:|mailto:|https?:\/\/|www\.|[$₹€£]|\b(rs|inr|usd)\.?\s*\d|\d\s*%/i;
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const clip = (s, n) => squash(s).slice(0, n);

function nameTokens(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function leaves(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => leaves(x, out));
  return out;
}

function typedFacts(input) {
  const rows = [['Business name', input.businessName, input.businessName]];
  rows.push(['What you sell', input.whatYouSell, input.whatYouSell], ['Who it is for', input.whoItsFor, input.whoItsFor], ['Main goal', input.goal, input.goal]);
  if (input.city) rows.push(['City', input.city, input.city]);
  if (input.websiteHost) rows.push(['Website', input.websiteHost, input.websiteHost]);
  if (input.instagramHandle) rows.push(['Instagram page', `instagram.com/${input.instagramHandle}`, input.instagramHandle]);
  for (const o of input.offers || []) rows.push(['Offer', o.price ? `${o.name}, ${o.price}` : o.name, o.name]);
  if ((input.colours || []).length) rows.push(['Brand colours', input.colours.join(', '), input.colours.join(', ')]);
  return rows.map(([field, text, quote]) => ({ kind: 'typed', field, text: `${field}: ${text}`, quote, source: { type: 'typed', field } }));
}

function pageCandidates(p, kind, url, subject) {
  const src = (field) => ({ type: kind === 'competitor_page' ? 'competitor' : 'page', url, field });
  const out = [];
  const add = (field, value, srcField, label) => {
    const v = clip(value, 200);
    if (v.length >= 3 && !RISKY.test(v)) out.push({ kind, field, subject: subject || null, text: `${subject ? `${subject}, ` : ''}${label || field}: ${v}`, quote: v, source: src(srcField) });
  };
  add('Page title', p.title, 'title');
  add('Page description', p.description, 'description');
  if (kind === 'competitor_page') {
    if (p.headings[0]) add('Heading', p.headings[0], 'heading');
    return out;
  }
  add('Site name', p.siteName, 'site_name');
  if (p.ld) {
    add('Page description', p.ld.description, 'json-ld', 'Business description');
    add('Locality', p.ld.locality, 'json-ld');
    for (const link of p.ld.sameAs.slice(0, 3)) {
      let u;
      try { u = new URL(link); } catch (_) { continue; }
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg && /^[A-Za-z0-9._-]{1,40}$/.test(seg)) out.push({ kind, field: 'Linked profile', subject: null, text: `Linked profile: ${u.hostname.replace(/^www\./, '')}/${seg}`, quote: link, source: src('json-ld') });
    }
  }
  p.headings.slice(0, HEADINGS_PER_PAGE).forEach((h) => add('Heading', h, 'heading'));
  return out;
}

// What can be quoted from a page: its text plus the title, meta values, headings and structured data.
function verifyText(p) {
  return [p.text, p.title, p.description, p.siteName, ...p.headings, p.ld && p.ld.description, p.ld && p.ld.locality, ...((p.ld && p.ld.sameAs) || [])].filter(Boolean).join(' ');
}

function instagramBio(html) {
  const m = String(html || '').match(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:description|description)["'][^>]*>/i);
  if (!m) return { raw: '', bio: '' };
  const c = m[0].match(/content\s*=\s*("([^"]*)"|'([^']*)')/i);
  const raw = squash(c ? (c[2] !== undefined ? c[2] : c[3]) : '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
  const bio = squash(raw.replace(IG_COUNTS, '')).replace(/\s*\(@[A-Za-z0-9._]+\)\s*$/, '');
  return { raw, bio: bio === raw && /\bFollowers\b/i.test(raw) ? '' : bio };
}

function verifyFacts(facts, pageTexts, input) {
  const typedHay = norm(leaves(input).join(' | '));
  const kept = [];
  let removed = 0;
  for (const f of facts || []) {
    const q = norm(f && f.quote);
    let ok = false;
    if (q) {
      if (f.kind === 'typed') ok = typedHay.includes(q);
      else {
        const t = pageTexts && pageTexts.get(f.source && f.source.url);
        ok = typeof t === 'string' && norm(t).includes(q);
      }
    }
    if (ok) kept.push(f); else removed += 1;
  }
  return { facts: kept, removed };
}

// Stop conditions that remain: unreachable and thin. A name mismatch is only a visible warning (owner ruling).
// `ctx` may state what was read; otherwise it is derived from the facts.
function evaluateStop(sheet, input, ctx = {}) {
  const facts = (sheet && sheet.facts) || [];
  const pageFacts = facts.filter((f) => f.kind === 'page');
  const igFacts = facts.filter((f) => f.kind === 'instagram');
  const websiteRead = ctx.websiteRead !== undefined ? ctx.websiteRead : pageFacts.length > 0;
  const instagramRead = ctx.instagramRead !== undefined ? ctx.instagramRead : igFacts.length > 0;
  const offers = (input.offers || []).length;
  const evidence = pageFacts.length + igFacts.length + 3 * offers;
  const basis = evidence < LIMITS.FULL_EVIDENCE || !websiteRead ? 'limited' : 'full';
  const warnings = [];
  const tokens = nameTokens(input.businessName);
  if (websiteRead && tokens.length) {
    const hay = [input.websiteHost, ...pageFacts.filter((f) => ['Page title', 'Site name', 'Heading'].includes(f.field)).map((f) => f.quote)].join(' ').toLowerCase();
    const igHay = igFacts.map((f) => f.quote).join(' ').toLowerCase();
    const corroborated = ctx.instagramCorroborates !== undefined ? ctx.instagramCorroborates : tokens.some((t) => igHay.includes(t));
    if (!tokens.some((t) => hay.includes(t)) && !corroborated) warnings.push({ reason: 'identity_mismatch', message: WARNING_MESSAGES.identity_mismatch });
  }
  let stop = null;
  if (evidence < LIMITS.MIN_EVIDENCE) {
    const reason = (input.websiteUrl || input.instagramUrl) && !websiteRead && !instagramRead ? 'unreachable' : 'thin';
    stop = { reason, message: STOP_MESSAGES[reason] };
  }
  return { stop, warnings, evidence, basis };
}

async function discover({ input, fetchPage = fetchPublicPage, robots = robotsAllows, now = Date.now } = {}) {
  const started = now();
  const sources = [];
  const unverified = [];
  const missing = [];
  const pageTexts = new Map();
  const raw = [];
  let headingsLeft = HEADINGS_TOTAL;
  let websiteRead = false;
  let instagramRead = false;
  let calls = 0;
  const sid = () => `S${sources.length + 1}`;
  const unv = (text, reason) => unverified.push({ id: `U${unverified.length + 1}`, text, reason });
  const overBudget = () => now() - started >= LIMITS.TOTAL_BUDGET_MS;
  const note = (url, kind, ok, reason) => sources.push({ id: sid(), url, kind, ok, ...(reason ? { reason } : {}) });

  async function get(url, kind, sameSiteOf) {
    if (calls >= LIMITS.MAX_PAGES_FETCHED + 1 + LIMITS.MAX_COMPETITORS) { note(url, kind, false, 'limit'); return null; }
    if (calls > 0 && overBudget()) { note(url, kind, false, 'budget'); return null; }
    calls += 1;
    let r;
    try { r = await fetchPage(url, { sameSiteOf, timeoutMs: LIMITS.FETCH_TIMEOUT_MS, maxBytes: LIMITS.PAGE_BYTES }); } catch (_) { r = { ok: false, reason: 'error' }; }
    if (!r || !r.ok || typeof r.text !== 'string') { note(url, kind, false, (r && r.reason) || 'error'); return null; }
    note(url, kind, true);
    return r;
  }

  raw.push(...typedFacts(input));

  // Website: home page, then a few same-site pages named in the home page's links.
  let logo = null;
  let themeColour = '';
  if (input.websiteUrl) {
    const home = await get(input.websiteUrl, 'website', input.websiteHost);
    if (home) {
      websiteRead = true;
      const queue = [{ r: home, url: input.websiteUrl }];
      const homePage = extractPage(home.text, input.websiteUrl);
      const seen = new Set([input.websiteUrl, home.finalUrl]);
      const extra = homePage.links.filter((l) => !seen.has(l)).slice(0, LIMITS.MAX_PAGES_FETCHED - 1);
      for (const link of extra) {
        const r = await get(link, 'website', input.websiteHost);
        if (r) queue.push({ r, url: link });
      }
      queue.forEach(({ r, url }, i) => {
        const p = i === 0 ? homePage : extractPage(r.text, url);
        pageTexts.set(url, verifyText(p));
        const cands = pageCandidates(p, 'page', url);
        for (const c of cands) {
          if (c.field === 'Heading') { if (headingsLeft <= 0) continue; headingsLeft -= 1; }
          raw.push(c);
        }
        if (i === 0) { logo = p.logoCandidates[0] || null; themeColour = p.themeColor; }
      });
    } else {
      unv('Website content', 'The website could not be read.');
      missing.push('website');
    }
  } else missing.push('website');

  // Instagram: only the bio text, never counts.
  let igCorroborates = false;
  if (input.instagramUrl) {
    const r = await get(input.instagramUrl, 'instagram', 'instagram.com');
    if (r) {
      instagramRead = true;
      const { raw: rawDesc, bio } = instagramBio(r.text);
      if (bio && !RISKY.test(bio)) {
        pageTexts.set(input.instagramUrl, rawDesc);
        raw.push({ kind: 'instagram', field: 'Instagram bio', subject: null, text: `Instagram bio: ${clip(bio, 200)}`, quote: clip(bio, 200), source: { type: 'instagram', url: input.instagramUrl, field: 'bio' } });
        igCorroborates = nameTokens(input.businessName).some((t) => bio.toLowerCase().includes(t));
      }
    } else {
      unv('Instagram page', 'The Instagram page could not be read.');
      missing.push('Instagram page');
    }
  }

  // Competitors the visitor named: only the home page of those with an address, if robots allows it.
  let competitorsRead = 0;
  for (const c of input.competitors || []) {
    if (!c.url) { unv(`Competitor ${c.name}`, 'Named by you; not researched'); continue; }
    let allowed = false;
    try { allowed = await robots(c.url, { sameSiteOf: c.host }); } catch (_) { allowed = false; }
    if (!allowed) { note(c.url, 'competitor', false, 'robots'); unv(`Competitor ${c.name}`, 'The site asks automated readers not to visit it.'); continue; }
    const r = await get(c.url, 'competitor', c.host);
    if (!r) { unv(`Competitor ${c.name}`, 'The page could not be read.'); continue; }
    competitorsRead += 1;
    const p = extractPage(r.text, c.url);
    pageTexts.set(c.url, verifyText(p));
    raw.push(...pageCandidates(p, 'competitor_page', c.url, c.name));
  }
  if (!competitorsRead) missing.push('competitors');
  if (!(input.offers || []).length) missing.push('offers');

  // Assets: the visitor's own logo and colours win; a logo the page itself declares is used unchanged.
  if (input.logoUrl) logo = { url: input.logoUrl, source: 'typed' };
  else if (logo) logo = { url: logo, source: 'page' };
  if (!logo) { unv('Logo', 'No logo was provided or found on the page.'); missing.push('logo'); }
  const colours = (input.colours || []).map((hex) => ({ hex, source: 'typed' }));
  if (!colours.length && themeColour) colours.push({ hex: themeColour, source: 'page' });

  const numbered = raw.map((f, i) => ({ id: `F${i + 1}`, tag: 'verified', subject: null, ...f }));
  const { facts, removed } = verifyFacts(numbered, pageTexts, input);
  const sheet = {
    version: 1,
    client: { name: input.businessName, website: input.websiteUrl || '', instagram: input.instagramUrl || '', city: input.city || '' },
    facts, unverified, removed,
    assets: { logo, colours },
    missing,
    evidence: 0, basis: 'limited', stop: null, warnings: []
  };
  const verdict = evaluateStop(sheet, input, { websiteRead, instagramRead, instagramCorroborates: igCorroborates });
  sheet.evidence = verdict.evidence;
  sheet.basis = verdict.basis;
  sheet.stop = verdict.stop;
  sheet.warnings = verdict.warnings;
  return { sheet, sources };
}

module.exports = { discover, verifyFacts, evaluateStop, nameTokens };
