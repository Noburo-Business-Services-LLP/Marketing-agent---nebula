'use strict';
// Re-reads saved designed pages with the CURRENT check (no new images): vision read only (a few cents).
// Usage: node scripts/reread-designed-pages.js <folderWithPage-NN.jpg>
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PAGES } = require('../config/blueprint');
const { buildDeck } = require('../services/blueprint/designedDeck');
const { matchTranscript, pageAccepted, rejectionNote, norm } = require('../services/blueprint/designedCheck');
const { readTextFromImage } = require('../services/openaiImage');

const claim = (text) => ({ text, tag: 'proposed' });
const result = {
  cover: { businessName: 'Aval Home Store', promise: 'Three reels a week that bring families into your shop', colours: [{ hex: '#1f7a7a' }, { hex: '#f2b134' }], logo: null },
  pages: PAGES.map((p) => ({ n: p.n, id: p.id, title: p.title, purpose: p.purpose, sections: [
    { heading: 'What we found', kind: 'claims', items: [claim('Your shop is known for honest prices on daily-use items'), claim('Customers ask most about steel and copper cookware')] },
    { heading: 'What to do next', kind: 'claims', items: [claim('Show one product in use every morning'), claim('Reply to every comment within a day')] },
  ] })),
  closing: { contact: { email: 'support@nebulaa.ai' } },
};
const deck = buildDeck(result);
const dir = path.resolve(process.argv[2]);
if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

(async () => {
  const files = fs.readdirSync(dir).filter((f) => /^page-\d+\.jpg$/.test(f)).sort();
  let accepted = 0;
  for (const f of files) {
    const meta = await sharp(path.join(dir, f)).metadata();
    // The saved pages carry the footer strip added by code (bottom ~6%); the check runs on the picture before that.
    const buf = await sharp(path.join(dir, f)).extract({ left: 0, top: 0, width: meta.width, height: Math.floor(meta.height * 0.94) }).jpeg({ quality: 82 }).toBuffer();
    const transcript = await readTextFromImage(buf);
    // Which page is it? The one whose heading is best present in the transcript.
    const t = norm(transcript);
    const page = deck.map((p) => ({ p, hit: norm(p.title) && t.includes(norm(p.title)) ? norm(p.title).length : 0 })).sort((a, b) => b.hit - a.hit)[0].p;
    const m = matchTranscript(page.lines, transcript, { allowed: [page.title, page.kicker], headings: [page.title, page.kicker] });
    const ok = pageAccepted(m);
    if (ok) accepted += 1;
    console.log(`${f} = page ${page.n} "${page.title}": ${ok ? 'ACCEPTED' : 'REJECTED'} coverage=${m.coverage.toFixed(2)} extraWords=${m.extraWords} dup=${m.duplicates.length} invented=${m.invented.length}${ok ? '' : ' — ' + rejectionNote(m)}`);
    if (m.extraLines.length) console.log('    extra:', JSON.stringify(m.extraLines));
    if (m.duplicates.length) console.log('    twice:', JSON.stringify(m.duplicates));
  }
  console.log(`\n${accepted} of ${files.length} pages accepted by the stricter check`);
})().catch((e) => { console.error(e); process.exit(1); });
