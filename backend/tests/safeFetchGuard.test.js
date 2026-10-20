'use strict';
// Guard (hardening C4): no new raw outbound call on a dynamic link. Every fetch / axios / http(s).request in the
// runtime code must either start with a literal https://provider URL, or be listed below with the reason it is
// safe. A link that a person, a stored record or another service gave us goes through services/safeFetch.js.
// When this test fails: use require('../services/safeFetch') for the new call, or add an entry with a reason
// that a reviewer can check (a FIXED provider endpoint held in a constant, a wrapper whose callers are fixed, or
// a module with its own reviewed SSRF guard).
const test = require('node:test');
const assert = require('node:assert');
const { scan } = require('./helpers/outboundCallScan');

const ALLOW = [
  // Fixed provider endpoints held in a constant or built from fixed hosts.
  { file: 'routes/adCampaigns.js', has: 'fetch(googleAdsApiUrl', why: 'GOOGLE_ADS_API_URL from the server environment, never from a request' },
  { file: 'routes/campaigns.js', has: 'response = await fetch(url, {', why: 'url is https://generativelanguage.googleapis.com/... built two lines above' },
  { file: 'routes/campaigns.js', has: "import('node-fetch').then(({default: fetch}) => fetch(...args))", why: 'a local fetch alias used only for the fixed Gemini URL' },
  { file: 'routes/campaigns.js', has: 'fetch(`${apiUrl}?key=', why: 'apiUrl is the fixed Gemini endpoint' },
  { file: 'services/aiDashboard.js', has: 'fetch(GROQ_API_URL', why: 'fixed Groq endpoint constant' },
  { file: 'services/geminiAI.js', has: 'const response = await fetch(url, {', why: 'inside fetchWithTimeout; every caller passes a fixed Google endpoint (the two image-link callers use safeFetch)' },
  { file: 'services/geminiAI.js', has: 'fetchWithTimeout(`${apiUrl}?key=', why: 'apiUrl is a fixed generativelanguage.googleapis.com endpoint' },
  { file: 'services/geminiAI.js', has: 'fetchWithTimeout(`${fallbackUrl}?key=', why: 'fallbackUrl is a fixed generativelanguage.googleapis.com endpoint' },
  { file: 'services/geminiAI.js', has: 'fetch(vertexUrl', why: 'fixed *-aiplatform.googleapis.com endpoint from server config' },
  { file: 'services/geminiAI.js', has: 'fetch(imagen3Url', why: 'fixed *-aiplatform.googleapis.com endpoint from server config' },
  { file: 'services/googleReviews.js', has: 'fetchImpl(`${AYRSHARE_REVIEWS_URL}', why: 'fixed Ayrshare endpoint constant' },
  { file: 'services/googleReviews.js', has: 'fetchImpl({ profileKey', why: 'not HTTP: calls the injected fetchReviews function' },
  { file: 'services/llmRouter.js', has: 'doFetch(`${GEMINI_BASE_URL}', why: 'fixed Gemini base constant' },
  { file: 'services/llmRouter.js', has: 'doFetch(OPENAI_CHAT_URL', why: 'fixed OpenAI endpoint constant' },
  { file: 'services/llmRouter.js', has: 'fetch(GROK_API_URL', why: 'fixed x.ai endpoint constant' },
  { file: 'services/omniVideo.js', has: '`${BASE}/', why: 'BASE is the fixed generativelanguage.googleapis.com constant' },
  { file: 'services/openAI.js', has: 'const res = await fetch(url, { ...opts', why: 'inside fetchWithTimeout; the only caller passes OPENAI_URL' },
  { file: 'services/openAI.js', has: 'fetchWithTimeout(OPENAI_URL', why: 'fixed OpenAI endpoint constant' },
  { file: 'services/openaiImage.js', has: 'const res = await fetch(url, { ...opts', why: 'inside fetchWithTimeout; callers pass fixed OpenAI endpoints' },
  { file: 'services/openaiImage.js', has: 'fetchWithTimeout(OPENAI_IMAGE_', why: 'fixed OpenAI endpoint constants' },
  { file: 'services/proofread.js', has: 'doFetch(OPENAI_API_URL', why: 'fixed OpenAI endpoint constant' },
  { file: 'services/reelGenerationService.js', has: 'return await fetch(url, { ...options', why: 'inside fetchWithTimeout; the only caller passes the fixed translate.google.com TTS URL' },
  { file: 'services/reelGenerationService.js', has: 'const response = await fetchWithTimeout(', why: 'ttsUrl is https://translate.google.com/translate_tts built on the line above' },
  { file: 'services/studioTranscribe.js', has: 'fetchFn(URL,', why: 'URL is the fixed OpenAI transcription endpoint constant' },
  { file: 'services/videoGenerationPipeline.js', has: 'fetchImpl(ttsUrl', why: 'ttsUrl is https://translate.google.com/translate_tts built on the line above' },
  { file: 'services/visionExtract.js', has: 'doFetch(OPENAI_URL', why: 'fixed OpenAI endpoint constant' },
  { file: 'services/zohoBooks.js', has: 'const res = await fetch(url, options);', why: 'inside zohoRequest: url = BASE_URL (fixed zohoapis.in) + a code-chosen endpoint' },
  { file: 'services/zohoBooks.js', has: 'fetch(searchUrl', why: 'searchUrl = BASE_URL (fixed zohoapis.in) + encoded query' },
  { file: 'services/zohoBooks.js', has: 'const shareRes = await fetch(', why: 'BASE_URL (fixed zohoapis.in) on the next line' },
  { file: 'services/zohoBooks.js', has: 'fetch(`${BASE_URL}/', why: 'BASE_URL is the fixed zohoapis.in constant' },
  { file: 'services/socialMediaAPI.js', has: 'protocol.request(reqOptions', why: 'Ayrshare API client: the URL is the fixed Ayrshare base plus a code-chosen path' },
  // Modules with their own reviewed SSRF guard (public addresses only, checked at connect time, redirect and size limits).
  { file: 'services/safeFetch.js', has: 'transport.request({', why: 'the SSRF-safe helper itself (pinned lookup)' },
  { file: 'services/heroVideoFinish.js', has: 'transport.request({', why: 'pinnedFetch: connects only to an address already checked by isPublicIp (shared safeFetch rules); Blueprint discovery uses it too' },
  { file: 'services/scraper.js', has: 'protocol.request(reqOptions', why: 'fetchUrl: publicOnlyLookup at connect time (shared rules), ports 80/443, IP literals checked, redirect and 5 MB limits; scraperSsrf.test.js' },
  { file: 'services/scraper.js', has: 'https.request(', why: 'fixed api.apify.com host written in each request (run status, dataset items)' },
  { file: 'utils/socialPostValidation.js', has: 'return await fetchFn(url, {', why: 'inside fetchWithTimeout, used only with a fetch function a test passes in; production uses safeFetch' },
  { file: 'utils/socialPostValidation.js', has: 'fetchWithTimeout(options.fetchFn', why: 'test seam only; production uses safeFetch' }
];

test('every outbound call on a dynamic link goes through safeFetch or is a reviewed exception', () => {
  const calls = scan();
  assert.ok(calls.length > 50, `the scanner found ${calls.length} calls; it should see the provider clients`);
  const unreviewed = calls.filter((c) => !c.fixed && !ALLOW.some((a) => a.file === c.file && c.text.includes(a.has)));
  assert.deepStrictEqual(unreviewed.map((c) => `${c.file}:${c.line} ${c.text.slice(0, 120)}`), [],
    'A new raw outbound call was found. Use services/safeFetch.js for any link that is not a fixed provider endpoint, or add a reviewed entry with a reason.');
});

test('every exception is still used (no stale entries) and has a reason', () => {
  const calls = scan();
  for (const a of ALLOW) {
    assert.ok(a.why && a.why.length > 10, `${a.file}: give a reason`);
    assert.ok(calls.some((c) => c.file === a.file && c.text.includes(a.has)), `stale allowlist entry: ${a.file} "${a.has}"`);
  }
});

test('the migrated call sites use safeFetch and no longer call fetch on the link', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['routes/videoGeneration.js', 'routes/studioVideos.js', 'routes/products.js', 'routes/campaigns.js', 'services/logoOverlay.js',
    'services/directImage.js', 'services/postFrames.js', 'services/blueprint/designedService.js', 'services/videoDownload.js', 'services/mediaComposer.js',
    'services/videoGenerationPipeline.js', 'services/geminiAI.js', 'utils/socialPostValidation.js']) {
    assert.match(read(f), /require\('(\.\.\/services\/|\.\/|\.\.\/)safeFetch'\)/, f);
  }
  assert.doesNotMatch(read('services/videoDownload.js'), /require\('https?'\)/, 'videoDownload has no raw http client left');
  assert.doesNotMatch(read('services/logoOverlay.js'), /node-fetch/);
});
