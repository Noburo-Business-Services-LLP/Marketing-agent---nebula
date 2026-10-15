/**
 * Reads a finished picture and reports what a customer would notice is wrong with its words: a headline that does
 * not read as intended, misspelt or non-words, text cut off mid-sentence, wrong-language words, invented claims.
 * One vision call. Never throws: when it cannot check, it says so and the picture is kept.
 */
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const legacyModel = (m) => /^(gpt-3|gpt-4|chatgpt-4o)/.test(String(m || ''));

function proofreadModel() {
  return process.env.PROOFREAD_MODEL || 'gpt-5.5';
}

function buildProofreadPrompt({ languageName, expected = [], allowedNumbers = [] }) {
  const lines = (expected || []).filter((e) => e && e.text).map((e) => `- ${e.label || 'text'}: "${e.text}"`);
  return `You are a careful proofreader of social media pictures. Look at the picture and check ONLY the words and numbers printed on it.

Language of the post: ${languageName}.
${lines.length ? `These lines are meant to appear exactly as written:\n${lines.join('\n')}` : 'No exact lines were specified.'}
${allowedNumbers.length ? `Numbers that are allowed to appear: ${allowedNumbers.join(', ')}. Any other price, percentage, year, count or phone number is an invention.` : ''}

Report a problem only when a customer would notice it:
- "headline": a line meant to appear exactly does not read exactly as written (wrong or missing letters, a different word, cut off).
- "spelling": a printed word that is misspelt or is not a real word in ${languageName} (ignore brand names, the logo, and tiny background text that is not legible).
- "cut_off": a sentence that stops half way.
- "language": words in a language other than ${languageName} that should not be there (brand names and one unavoidable English term are fine).
- "invented": a price, percentage, year, count, phone number or claim that was not given. Do NOT flag list numbering (1, 2, 3), slide counters such as 2/3, or counts that the post's own idea states (for example "7 days" in a seven-day plan).

Return JSON only:
{"ok": true|false, "issues": [{"kind": "headline|spelling|cut_off|language|invented", "text": "what is printed", "should_be": "what it should read, if you know"}]}
If everything a customer would read is correct, return {"ok": true, "issues": []}.`;
}

async function proofreadImage({ imageUrl, languageName = 'English', expected = [], allowedNumbers = [] } = {}, io = {}) {
  const key = io.apiKey || process.env.OPENAI_API_KEY;
  if (!key || !imageUrl) return { checked: false, ok: true, issues: [] };
  const model = io.model || proofreadModel();
  const body = {
    model,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: [
      { type: 'text', text: buildProofreadPrompt({ languageName, expected, allowedNumbers }) },
      { type: 'image_url', image_url: { url: imageUrl } }
    ] }]
  };
  if (legacyModel(model)) body.max_tokens = 900;
  else { body.max_completion_tokens = 4000; body.reasoning_effort = process.env.TEXT_REASONING_EFFORT || 'low'; }
  const doFetch = io.fetch || fetch;
  try {
    let res = await doFetch(OPENAI_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok && res.status === 400 && body.reasoning_effort) {
      delete body.reasoning_effort;
      res = await doFetch(OPENAI_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (!res.ok) return { checked: false, ok: true, issues: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    const raw = String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '');
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
      .filter((i) => i && ['headline', 'spelling', 'cut_off', 'language', 'invented'].includes(i.kind))
      .map((i) => ({ kind: i.kind, text: String(i.text || '').slice(0, 120), should_be: String(i.should_be || '').slice(0, 120) }))
      .slice(0, 6);
    return { checked: true, ok: issues.length === 0, issues };
  } catch (error) {
    return { checked: false, ok: true, issues: [], error: error.message };
  }
}

/** The sentence added to a remake request so the same mistakes are not repeated. */
function fixInstructions(issues) {
  return (issues || []).map((i) => {
    if (i.kind === 'headline' && i.should_be) return `the headline must read exactly "${i.should_be}"`;
    if (i.kind === 'spelling' && i.should_be) return `correct "${i.text}" to "${i.should_be}"`;
    if (i.kind === 'cut_off') return `finish or remove the sentence "${i.text}"`;
    if (i.kind === 'language') return `remove the words "${i.text}" or write them in the post's language`;
    if (i.kind === 'invented') return `remove "${i.text}", it was not given`;
    return i.should_be ? `"${i.text}" should read "${i.should_be}"` : `fix "${i.text}"`;
  });
}

module.exports = { proofreadImage, buildProofreadPrompt, fixInstructions, proofreadModel };
