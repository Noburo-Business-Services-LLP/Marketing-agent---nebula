'use strict';
// One real run of the designed Blueprint PDF with nothing shared: an in-memory Blueprint, no database, no Quark
// charge, pages and PDF saved to a local folder. Real OpenAI image + vision calls (about US$4 to 5).
// Usage (from backend/):  node scripts/run-designed-pdf-once.js [outputFolder]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createDesignedService } = require('../services/blueprint/designedService');
const { PAGES } = require('../config/blueprint');

const out = path.resolve(process.argv[2] || path.join(process.cwd(), 'designed-pdf-test-output'));
fs.mkdirSync(out, { recursive: true });
if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set in this shell or backend/.env.'); process.exit(1); }

const claim = (text) => ({ text, tag: 'proposed' });
const doc = {
  blueprintId: 'test-run', userId: 'test-user', status: 'completed', input: { whatYouSell: 'home goods and kitchen store' },
  result: {
    cover: { businessName: 'Aval Home Store', promise: 'Three reels a week that bring families into your shop', colours: [{ hex: '#1f7a7a' }, { hex: '#f2b134' }], logo: null },
    pages: PAGES.map((p) => ({ n: p.n, id: p.id, title: p.title, purpose: p.purpose, sections: [
      { heading: 'What we found', kind: 'claims', items: [claim(`Your shop is known for honest prices on daily-use items`), claim(`Customers ask most about steel and copper cookware`)] },
      { heading: 'What to do next', kind: 'claims', items: [claim(`Show one product in use every morning`), claim(`Reply to every comment within a day`)] },
    ] })),
    closing: { contact: { email: 'support@nebulaa.ai' } },
  },
};

const store = (() => {
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);
  const set = (p, v) => { const ks = p.split('.'); let o = doc; ks.slice(0, -1).forEach((k, i) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  const matches = (q) => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some(matches);
    const cur = get(k);
    if (v && typeof v === 'object' && '$exists' in v) return (cur !== undefined) === v.$exists;
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(cur);
    return cur === v || (v === null && cur == null);
  });
  return {
    findOne: async (q) => (matches(q) ? doc : null),
    findOneAndUpdate: async (q, u) => { if (!matches(q)) return null; Object.entries(u.$set || {}).forEach(([k, v]) => set(k, v)); return doc; },
    updateOne: async (q, u) => { if (!matches(q)) return; Object.entries(u.$set || {}).forEach(([k, v]) => set(k, v)); Object.keys(u.$unset || {}).forEach((k) => { delete doc[k]; }); },
  };
})();

let n = 0;
const queue = [];
const svc = createDesignedService({
  Blueprint: store,
  deduct: async () => ({ success: true }),
  refund: async () => { console.log('(refund would have been issued)'); return { success: true }; },
  generateImage: (prompt) => require('../services/openaiImage').generateOpenAIImageBuffer(prompt),
  readText: (buf) => require('../services/openaiImage').readTextFromImage(buf),
  uploadPage: async (jpeg) => { n += 1; const f = path.join(out, `page-${String(n).padStart(2, '0')}.jpg`); fs.writeFileSync(f, jpeg); console.log('saved', f); return `file://${f}`; },
  uploadPdf: async (pdf) => { const f = path.join(out, 'blueprint.pdf'); fs.writeFileSync(f, pdf); console.log('saved', f); return `file://${f}`; },
  fetchLogo: async () => null,
  enqueue: (task) => queue.push(task),
  now: () => Date.now(),
});

(async () => {
  const started = await svc.start({ userId: 'test-user', id: 'test-run' });
  console.log('start ->', started.status);
  for (const task of queue) await task();
  console.log(JSON.stringify(svc.publicDesigned(doc.designed), (k, v) => (k === 'imageUrl' ? undefined : v), 2));
  console.log('Pages with status "fallback" were made from text instead of an image. Output folder:', out);
})().catch((e) => { console.error(e); process.exit(1); });
