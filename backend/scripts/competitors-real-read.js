/**
 * ONE owner-approved real Instagram profile read (Stage 4 proof of the real data shape).
 * Reads the owner's OWN public account nebulaa.os once through the real scraper (about USD 0.0023), prints a sanitised
 * structural summary and writes the sanitised raw result to a scratch file. No database, no AI call.
 *   I_APPROVED_ONE_REAL_READ=yes node scripts/competitors-real-read.js
 * Never prints the environment, keys, cookies or signed media URLs. A second call to the scraper throws.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const HANDLE = 'nebulaa.os';
const OUT = '/private/tmp/claude-501/-Users-dineshkannaa-Documents-0-CONTENT-Claude-Agents/09560377-72af-47d7-b772-e6de37dcc6da/scratchpad/real-read-nebulaa-os.json';
const CAP = 40;

/** Strings are cut to 40 characters; media/CDN/signed URLs are removed; plain permalinks are kept. */
function sanitiseString(s) {
  if (/^https?:\/\//i.test(s)) {
    if (/[?&#]/.test(s) || /(cdninstagram|fbcdn|scontent|akamai)/i.test(s)) return '[url removed]';
    return s.length > 120 ? '[url removed]' : s;
  }
  return s.length > CAP ? `${s.slice(0, CAP)}...` : s;
}
function sanitise(v, depth = 0) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return sanitiseString(v);
  if (depth > 6) return '[deep]';
  if (Array.isArray(v)) return v.map((x) => sanitise(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = /token|cookie|secret|authorization/i.test(k) ? '[removed]' : sanitise(val, depth + 1);
    return o;
  }
  return String(v);
}
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? `array(${v.length})` : typeof v);

function summarise(res) {
  const lines = [];
  lines.push(`success=${res && res.success} error=${res && res.error ? String(res.error).slice(0, 80) : 'none'} data=${typeOf(res && res.data)}`);
  const items = res && Array.isArray(res.data) ? res.data : [];
  items.forEach((item, i) => {
    lines.push(`item[${i}] keys:`);
    for (const [k, v] of Object.entries(item || {})) {
      if (typeof v === 'number' || typeof v === 'boolean') lines.push(`  ${k}: ${typeOf(v)} = ${v}`);
      else if (typeof v === 'string') lines.push(`  ${k}: string(${v.length})`);
      else lines.push(`  ${k}: ${typeOf(v)}`);
    }
    for (const listKey of ['latestPosts', 'posts', 'latestIgtvVideos', 'relatedProfiles']) {
      const list = item && item[listKey];
      if (!Array.isArray(list)) continue;
      lines.push(`${listKey}: ${list.length} entries`);
      list.forEach((p, j) => {
        const parts = [];
        for (const [k, v] of Object.entries(p || {})) {
          if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`);
          else if (typeof v === 'string' && /(caption|text)/i.test(k)) parts.push(`${k}="${v.slice(0, 40)}"`);
          else if (typeof v === 'string' && /(time|date|type)/i.test(k)) parts.push(`${k}=${v.slice(0, 30)}`);
          else parts.push(`${k}:${typeOf(v)}`);
        }
        lines.push(`  [${j}] ${parts.join(' ')}`);
      });
    }
  });
  return lines.join('\n');
}

async function main() {
  if (process.env.I_APPROVED_ONE_REAL_READ !== 'yes') {
    console.error('Refusing: set I_APPROVED_ONE_REAL_READ=yes on the command line (one owner-approved real read of nebulaa.os).');
    process.exit(2);
  }
  if (!process.env.APIFY_API_KEY) {
    console.error('The scraper key is not available to this script (no read was made, nothing spent). Stopping.');
    process.exit(3);
  }
  const api = require('../services/socialMediaAPI');
  let calls = 0;
  const scrape = async (handle) => {
    calls += 1;
    if (calls > 1) throw new Error('Second scraper call refused: only one real read is approved');
    return api.scrapeInstagramProfile(handle);
  };
  const res = await scrape(HANDLE);
  const clean = sanitise(res);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(clean, null, 2));
  console.log(summarise(clean));
  console.log(`scraper calls made: ${calls}`);
  console.log(`sanitised raw result written to ${OUT}`);
  process.exit(0);
}
main().catch((e) => { console.error('Read failed:', e && e.message); process.exit(1); });
