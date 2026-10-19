'use strict';
/**
 * Where a live trend source plugs in later (Google Trends, a news feed, a social "trending now" list). NOT IMPLEMENTED:
 * no source is chosen yet (the owner decides from docs/superpowers/ops/trends-sources.md), so this file makes no network
 * call, reads no key and scrapes nothing. Today "Trending for you" uses only the curated calendar in
 * config/trendingEvents.js (labelled "From the news calendar") and the other honest sources in bestPosts.trendItems.
 *
 * The contract a future provider must keep
 * ----------------------------------------
 *   const provider = {
 *     id: 'example',                       // short, lower case, never shown to customers
 *     label: 'Trending now',               // what the page shows above the idea; plain words, no vendor name
 *     enabled(env) -> boolean,              // its own switch, OFF unless set to exactly "on" (like ENABLE_COMPETITOR_TRACKER)
 *     async list({ industry, region, language, now, limit }) -> TrendItem[]
 *   };
 *   TrendItem = { id, title, reason, startsOn?, endsOn?, industries?: string[], sourceUrl?: string }
 *
 * Duties of an implementation (each is checked by normaliseItems below or must be kept by the implementation itself):
 *   - an official API or a licensed feed only, within its terms; never scraping a platform's pages,
 *   - its own caps: a daily call ceiling, results cached for at least a few hours per region and industry (never one
 *     call per page view), and the spend guard before every paid call,
 *   - plain, kind wording: titles and reasons pass the competitor wording guard (config/competitorWording.js); anything
 *     that does not is dropped, never rewritten by a model without review,
 *   - nothing about real people's private lives, tragedies, disasters, elections or political parties is turned into a
 *     marketing idea (filter by category before returning),
 *   - `sourceUrl` only to the public page of the source (shown as "Read more"), never a tracking link.
 */
const BANNED = require('../../config/competitorWording');
const SENSITIVE = /\b(death|dies|died|killed|attack|crash|flood|earthquake|tragedy|disaster|election|vote for|party|riot|war|terror\w*)\b/i;
const MAX_ITEMS = 10;
const plain = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 200 && !BANNED.some((re) => re.test(s));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The provider in use today: none. A real one replaces this after the owner's decision. */
const noProvider = Object.freeze({
  id: 'none',
  label: '',
  enabled: () => false,
  list: async () => []
});

/** Pick the configured provider. With nothing chosen this is always the empty one. */
function trendProvider(/* env = process.env */) {
  return noProvider;
}

/** Defensive pass over a provider's answer: shape, wording, sensitive topics, size. Pure. */
function normaliseItems(items, { label = '' } = {}) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const title = String(it.title || '').trim();
    const reason = String(it.reason || '').trim();
    if (!plain(title) || !plain(reason) || SENSITIVE.test(`${title} ${reason}`)) continue;
    const url = typeof it.sourceUrl === 'string' && /^https:\/\/[^\s]+$/.test(it.sourceUrl) ? it.sourceUrl : null;
    out.push({
      id: `live:${String(it.id || title).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60)}`,
      title, reason, label: plain(label) ? label : 'Trending now',
      startsOn: DATE.test(String(it.startsOn || '')) ? it.startsOn : null,
      endsOn: DATE.test(String(it.endsOn || '')) ? it.endsOn : null,
      industries: Array.isArray(it.industries) ? it.industries.map(String).slice(0, 10) : ['all'],
      sourceUrl: url
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

module.exports = { trendProvider, normaliseItems, noProvider };
