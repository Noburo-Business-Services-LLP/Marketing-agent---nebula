/**
 * Image quality A/B test, run by hand on the DEV database (never production). For each case it makes:
 *   A  the app's real pipeline: a Draft is created and the background worker runs it exactly as Create does
 *      (content pass, Creative Director, Art Director, image model, logo overlay)
 *   B  the simple route: the brief + a few brand facts + the logo straight to the image model, one call
 * and writes a side-by-side HTML page. Costs real money: about US$0.165 per picture on gpt-image-2.
 *
 *   node scripts/image-ab-test.js <outFile.html> [caseNumbers e.g. 1,2,3]
 */
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');

const CASES = [
  { n: 1, userId: '6aa53d889de0cabce38cf413', brief: 'Festive loan offer for women entrepreneurs: low-interest small business loans this Diwali, quick approval, visit your nearest branch.' },
  { n: 2, userId: '6a5e4ff1bc329c6a57b4b01e', brief: 'Diwali gold coin offer: zero making charges on gold coins and 10% off diamond jewellery, this week only.' },
  { n: 3, userId: '6a5a050fb415082e1fabc8f2', brief: 'New Diwali sweets and chaat combo box at Rs 299, order today for free home delivery.' },
  { n: 4, userId: '6a68668c41a8031a429741df', brief: 'DTCP-approved residential plots in Neyveli, easy EMI, book a free site visit this weekend.' },
  { n: 5, userId: '6a3e40e8a65384fd914f9991', brief: 'Diwali furniture sale: up to 30% off sofa sets, beds and dining tables, free delivery in Cuddalore district.' },
];
const LANG_WORDS = { tamil: 'Tamil (Tamil script)', tamil_english_mix: 'a natural mix of Tamil script and English words', english: 'English' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRef(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType: res.headers.get('content-type') || 'image/png', data: buf.toString('base64') };
  } catch (_) { return null; }
}

async function main() {
  const out = process.argv[2];
  const only = (process.argv[3] || '').split(',').filter(Boolean).map(Number);
  if (!out) throw new Error('Give an output file');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const dbName = mongoose.connection.name;
  if (dbName !== 'nebulaa_dev') throw new Error(`Refusing to run on database ${dbName}`);
  const User = require('./../models/User');
  const Draft = require('./../models/Draft');
  const BrandAsset = require('./../models/BrandAsset');
  const { enqueue } = require('./../services/backgroundQueue');
  const { generateOpenAIImage } = require('./../services/openaiImage');

  const rows = [];
  for (const c of CASES.filter((x) => !only.length || only.includes(x.n))) {
    const user = await User.findById(c.userId).select('businessProfile companyName').lean();
    const bp = user.businessProfile || {};
    const logo = await BrandAsset.findOne({ user: c.userId, type: 'logo' }).sort({ isPrimary: -1, createdAt: -1 }).lean();
    const lang = bp.contentLanguage || 'english';
    const row = { n: c.n, brand: bp.name, industry: bp.industry, brief: c.brief, lang, logo: logo && logo.url };
    console.log(`[case ${c.n}] ${bp.name}`);

    // A: the real pipeline
    try {
      const draft = await new Draft({
        userId: c.userId, title: c.brief.slice(0, 60), caption: '', hashtags: [], platforms: ['instagram'], imagePrompt: c.brief,
        status: 'processing', sourceType: 'post', contentType: 'post', language: lang,
        creative: { type: 'image', textContent: '', captions: '', imageUrls: [], hashtags: [] }
      }).save();
      const t0 = Date.now();
      enqueue({
        type: 'generate_post_image', draftId: draft._id, aspectRatio: '4:5', referenceImage: null, contentPillar: '', contentType: 'post',
        campaignContext: '', objective: '', linkedProduct: null, productReferenceImages: [], language: lang,
        logoUrl: logo ? logo.url : '', logoPosition: logo ? (logo.defaultPosition || 'bottom-right') : undefined
      });
      let d;
      for (let i = 0; i < 100; i++) {
        await sleep(3000);
        d = await Draft.findById(draft._id).lean();
        if (d && d.status !== 'processing') break;
      }
      row.a = { url: d && d.imageUrl, status: d && d.status, error: d && d.errorMessage, seconds: Math.round((Date.now() - t0) / 1000), caption: d && d.caption, prompt: d && (d.imagePromptResolved || '') };
    } catch (e) { row.a = { error: e.message }; }
    console.log(`  A: ${row.a.status || 'error'} ${row.a.url || row.a.error || ''}`);

    // B: the simple route (SKIP_B=1 leaves it out)
    if (process.env.SKIP_B) { rows.push(row); fs.writeFileSync(out + '.json', JSON.stringify(rows, null, 2)); continue; }
    try {
      const prompt = [
        `Create a finished, professional social media post, 4:5 portrait, for ${bp.name}, a ${String(bp.industry || 'local business').replace(/&amp;/g, '&')} business${bp.businessLocation ? ' in ' + bp.businessLocation : ''}.`,
        `What the post is about: ${c.brief}`,
        `All text on the image must be in ${LANG_WORDS[lang] || 'English'}, spelled correctly, with large readable type.`,
        logo ? 'The attached picture is the business logo. Place it cleanly, exactly as it is, in one corner.' : '',
        'It must look like one cohesive, polished design made by a professional agency, with real-looking people or products where it helps, not a template and not stock clip art.'
      ].filter(Boolean).join('\n');
      const refs = logo ? [await fetchRef(logo.url)].filter(Boolean) : [];
      const t0 = Date.now();
      const r = await generateOpenAIImage(prompt, { aspectRatio: '4:5', references: refs });
      row.b = { url: r.imageUrl && r.imageUrl.startsWith('http') ? r.imageUrl : (r.imageUrl ? r.imageUrl : ''), model: r.model, error: r.error, seconds: Math.round((Date.now() - t0) / 1000), prompt };
    } catch (e) { row.b = { error: e.message }; }
    console.log(`  B: ${row.b.model || 'error'} ${row.b.url ? (row.b.url.slice(0, 60)) : row.b.error || ''}`);
    rows.push(row);
    fs.writeFileSync(out + '.json', JSON.stringify(rows, null, 2));
  }

  const cell = (x) => (x && x.url ? `<img src="${x.url}">` : `<p class="bad">No picture: ${(x && (x.error || x.status)) || 'unknown'}</p>`);
  const html = `<!doctype html><meta charset="utf-8"><title>Image test</title><style>
body{font:15px system-ui;margin:24px;background:#faf6ee;color:#222}h1{font-size:22px}.row{margin:28px 0;padding-top:18px;border-top:2px solid #ddd}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;border-radius:10px;border:1px solid #ccc}h3{margin:6px 0}.meta{color:#555;font-size:13px}.bad{color:#b00}
</style><h1>Image test: the app's pipeline (A) against a direct request (B)</h1>
${rows.map((r) => `<div class="row"><h2>${r.n}. ${r.brand}</h2><p class="meta">${r.brief}</p><div class="pair">
<div><h3>A: current pipeline <span class="meta">(${(r.a && r.a.seconds) || '?'}s)</span></h3>${cell(r.a)}</div>
${r.b ? `<div><h3>B: direct to ${r.b.model || 'model'} <span class="meta">(${r.b.seconds || '?'}s)</span></h3>${cell(r.b)}</div>` : ''}</div></div>`).join('')}`;
  fs.writeFileSync(out, html);
  console.log('Wrote', out);
  process.exit(0);
}
main().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
