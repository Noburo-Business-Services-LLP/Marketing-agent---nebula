'use strict';
// Reads a fetched page into plain parts. Pure: no network. Never extracts prices, phones, emails or counts.
const sanitizeHtml = require('sanitize-html');
const { isPublicHttpsUrl } = require('../heroVideoService');

const ORG_TYPE = /Organization|Business|Store|Shop|Restaurant|Clinic|Hotel|Brand/i;
const LINK_PATH = /(about|story|products?|services?|shop|collections?|menu|offers?|pricing|plans?|contact|work|portfolio)/i;
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function toText(html) {
  const spaced = String(html || '').replace(/></g, '> <');
  const out = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {}, nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'svg'] });
  const decoded = out.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
  return squash(decoded);
}

function decode(s) { return squash(toText(s)); }

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] !== undefined ? m[2] : m[3]) : '';
}

function metaTags(html) { return String(html || '').match(/<meta\b[^>]*>/gi) || []; }

function meta(html, key) {
  const k = key.toLowerCase();
  for (const tag of metaTags(html)) {
    if ((attr(tag, 'property') || attr(tag, 'name')).toLowerCase() === k) return squash(decode(attr(tag, 'content')));
  }
  return '';
}

function headings(html) {
  const out = [];
  const re = /<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const t = decode(m[2]);
    if (t.length >= 3 && t.length <= 120 && !out.includes(t)) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function ldNodes(v, out) {
  if (Array.isArray(v)) v.forEach((x) => ldNodes(x, out));
  else if (v && typeof v === 'object') {
    out.push(v);
    if (v['@graph']) ldNodes(v['@graph'], out);
  }
}

function jsonLd(html) {
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let data;
    try { data = JSON.parse(m[1]); } catch (_) { continue; }
    const nodes = [];
    ldNodes(data, nodes);
    const node = nodes.find((n) => [].concat(n['@type'] || []).some((t) => ORG_TYPE.test(String(t))));
    if (!node) continue;
    const addr = node.address && typeof node.address === 'object' ? node.address : {};
    const logo = typeof node.logo === 'string' ? node.logo : (node.logo && typeof node.logo.url === 'string' ? node.logo.url : '');
    return {
      name: squash(node.name), description: squash(node.description),
      sameAs: [].concat(node.sameAs || []).filter((x) => typeof x === 'string').slice(0, 6),
      locality: squash(addr.addressLocality), logo
    };
  }
  return null;
}

function resolveHttps(href, pageUrl) {
  try {
    const u = new URL(href, pageUrl).toString();
    return isPublicHttpsUrl(u) ? u : '';
  } catch (_) { return ''; }
}

function sameSiteLinks(html, pageUrl, hostNoWww) {
  const out = [];
  const re = /<a\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const href = attr(m[0], 'href');
    if (!href) continue;
    let u;
    try { u = new URL(href, pageUrl); } catch (_) { continue; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) continue;
    if (u.hostname.toLowerCase().replace(/^www\./, '') !== hostNoWww) continue;
    u.search = ''; u.hash = '';
    if (u.pathname === '/' || !LINK_PATH.test(u.pathname)) continue;
    const link = u.toString();
    if (!out.includes(link)) out.push(link);
  }
  return out;
}

function logoCandidates(html, pageUrl, ld) {
  const out = [];
  for (const tag of String(html || '').match(/<link\b[^>]*>/gi) || []) {
    if (/apple-touch-icon/i.test(attr(tag, 'rel'))) {
      const u = resolveHttps(attr(tag, 'href'), pageUrl);
      if (u && !out.includes(u)) out.push(u);
    }
  }
  if (ld && ld.logo) {
    const u = resolveHttps(ld.logo, pageUrl);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

function extractPage(html, pageUrl) {
  const h = String(html || '');
  const t = h.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const ld = jsonLd(h);
  const theme = meta(h, 'theme-color');
  let host = '';
  try { host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { /* none */ }
  return {
    title: t ? decode(t[1]) : '',
    description: meta(h, 'description') || meta(h, 'og:description'),
    siteName: meta(h, 'og:site_name'),
    headings: headings(h),
    ld,
    logoCandidates: logoCandidates(h, pageUrl, ld),
    themeColor: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(theme) ? theme.toLowerCase() : '',
    links: host ? sameSiteLinks(h, pageUrl, host) : [],
    text: toText(h)
  };
}

module.exports = { extractPage, toText, meta, headings, jsonLd, sameSiteLinks };
