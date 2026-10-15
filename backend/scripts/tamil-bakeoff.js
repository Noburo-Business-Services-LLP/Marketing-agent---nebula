require('dotenv').config({ path: '/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend/.env' });
const BRIEFS = [
  'A jewellery shop in Cuddalore: zero making charges on gold coins and 10% off diamond jewellery this Diwali week.',
  'A small sweets and chaat shop in Chennai: a Diwali combo box for Rs 299 with free home delivery.',
  'A furniture shop in Dindigul: up to 30% off on sofa sets, beds and dining tables, free delivery in the district.',
];
const PROMPT = (b) => `You write Instagram posts for small businesses in Tamil Nadu. Brief: ${b}
Write in natural, correct, spoken-but-polished Tamil (Tamil script only; keep the shop type and numbers as given; no English words except unavoidable ones).
Return exactly two lines:
HEADLINE: (at most 6 words, for the image)
CAPTION: (2 short sentences, friendly, ends with a call to action)`;
const MODELS = [
  ['openai', 'gpt-4o'], ['openai', 'gpt-5.5'], ['openai', 'gpt-6.1-sol'],
  ['anthropic', 'claude-sonnet-5-5'], ['anthropic', 'claude-opus-5-5'],
  ['gemini', 'gemini-3.8-flash'], ['gemini', 'gemini-3.1-pro-preview'], ['gemini', 'gemini-3.5-flash-lite'],
];
async function call(provider, model, prompt) {
  if (provider === 'openai') {
    const body = { model, messages: [{ role: 'user', content: prompt }] };
    body[/^gpt-4o/.test(model) ? 'max_tokens' : 'max_completion_tokens'] = 1200;
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j.error || j).slice(0, 160));
    return j.choices[0].message.content;
  }
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j.error || j).slice(0, 160));
    return j.content.map((c) => c.text || '').join('');
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1200 } }) });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j.error || j).slice(0, 160));
  return (j.candidates[0].content.parts || []).map((p) => p.text || '').join('');
}
(async () => {
  const out = {};
  for (const [p, m] of MODELS) {
    out[m] = [];
    for (const b of BRIEFS) {
      const t0 = Date.now();
      try { out[m].push({ text: String(await call(p, m, PROMPT(b))).trim(), ms: Date.now() - t0 }); }
      catch (e) { out[m].push({ error: e.message }); }
    }
  }
  require('fs').writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
  for (const m of Object.keys(out)) {
    console.log('\n=== ' + m + (out[m][0].ms ? ` (${Math.round(out[m].reduce((n, x) => n + (x.ms || 0), 0) / out[m].length / 100) / 10}s avg)` : ''));
    out[m].forEach((x, i) => console.log(`[${i + 1}] ` + (x.error ? 'ERROR ' + x.error : x.text.replace(/\n+/g, ' | '))));
  }
})();
