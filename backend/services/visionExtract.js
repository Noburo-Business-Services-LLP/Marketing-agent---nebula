/**
 * Reads what is printed on a business document a customer dropped in (a pamphlet, poster, price list, menu, a photo
 * of a signboard) and returns it as plain facts for a social post. Reading only: nothing is made up, a field not
 * present stays empty, and personal or financial documents are refused. One vision call per file.
 */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const legacy = (m) => /^(gpt-3|gpt-4|chatgpt-4o)/.test(String(m || ''));
const extractModel = () => process.env.EXTRACT_MODEL || 'gpt-5.5';

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

function buildExtractPrompt({ languageLabel = 'English' } = {}) {
  return `You read a business document for the owner of a small shop who wants to make social media posts from it. The document may be a pamphlet, poster, price list, menu, offer sheet, brochure, or a photo of a signboard or a flyer.

Extract ONLY what is actually printed. Never invent. A field that is not there must be an empty string (or an empty list).

If the document is personal or financial (an ID card, passport, bank statement, cheque, card, password, medical record), set "sensitive" to true and leave everything else empty.

Return JSON only:
{
  "sensitive": false,
  "kind": "pamphlet|poster|price_list|menu|brochure|signboard|other",
  "businessName": "",
  "summary": "one or two plain sentences: what this document advertises",
  "brief": "a short idea for a social media post (1 to 3 sentences) in ${languageLabel}, using only facts printed in the document",
  "headline": "the main heading as printed, at most 8 words",
  "offer": "the offer or discount exactly as printed",
  "items": ["one product or service per entry, with its price if printed"],
  "phone": "", "address": "", "hours": "", "tagline": "",
  "dates": "validity or event dates if printed",
  "notes": "anything unreadable, cut off or uncertain, in one sentence"
}`;
}

function parseExtraction(raw) {
  let obj = {};
  try {
    const s = String(raw || '');
    obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  } catch (_) { obj = {}; }
  const items = Array.isArray(obj.items) ? obj.items.map((i) => clip(i, 90)).filter(Boolean).slice(0, 12) : [];
  return {
    sensitive: obj.sensitive === true,
    kind: clip(obj.kind, 20) || 'other',
    businessName: clip(obj.businessName, 80),
    summary: clip(obj.summary, 400),
    brief: clip(obj.brief, 900),
    details: {
      headline: clip(obj.headline, 90), offer: clip(obj.offer, 120), items: items.join('\n'),
      phone: clip(obj.phone, 60), address: clip(obj.address, 200), hours: clip(obj.hours, 80), tagline: clip(obj.tagline, 80),
    },
    dates: clip(obj.dates, 100),
    notes: clip(obj.notes, 300),
  };
}

/** `part` is { type: 'image', dataUrl } or { type: 'pdf', dataUrl, name }. */
async function extractFromFile(part, { languageLabel = 'English' } = {}, io = {}) {
  const key = io.apiKey || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, message: 'Reading files is not available right now.' };
  const model = io.model || extractModel();
  const filePart = part.type === 'pdf'
    ? { type: 'file', file: { filename: part.name || 'document.pdf', file_data: part.dataUrl } }
    : { type: 'image_url', image_url: { url: part.dataUrl } };
  const body = { model, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [{ type: 'text', text: buildExtractPrompt({ languageLabel }) }, filePart] }] };
  if (legacy(model)) body.max_tokens = 1500;
  else { body.max_completion_tokens = 6000; body.reasoning_effort = process.env.TEXT_REASONING_EFFORT || 'low'; }
  const doFetch = io.fetch || fetch;
  const send = () => doFetch(OPENAI_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let res = await send();
    if (!res.ok && res.status === 400 && body.reasoning_effort) {
      const why = await res.clone().text().catch(() => '');
      if (/reasoning_effort|unsupported|not supported/i.test(why)) { delete body.reasoning_effort; res = await send(); }
    }
    if (!res.ok) return { ok: false, message: 'Could not read this file. Try a clear photo of it instead.' };
    const data = await res.json();
    const out = parseExtraction(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    if (out.sensitive) return { ok: false, sensitive: true, message: 'This looks like a personal or financial document. Please add a pamphlet, poster or price list instead.' };
    if (!out.summary && !out.brief && !Object.values(out.details).some(Boolean)) return { ok: false, message: 'Nothing readable was found in this file. Try a clearer photo or a different file.' };
    return { ok: true, ...out };
  } catch (error) {
    return { ok: false, message: 'Could not read this file. Please try again.' };
  }
}

module.exports = { extractFromFile, buildExtractPrompt, parseExtraction, extractModel };
