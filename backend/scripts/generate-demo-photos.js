/**
 * ONE-OFF, owner-run: makes real pictures for the Zaya Naturals demo account, so the Library, the product pages and the Photoshoot
 * no longer look like script-drawn templates.
 *
 *   I_APPROVED_DEMO_PHOTOS=yes node scripts/generate-demo-photos.js [--only product-marble,carousel-2] [--force] [--quality low|medium|high]
 *
 * What it does, in order (the same pattern as generate-sample-photos.js):
 *   1. Works out which of the 24 slots (scripts/demo-brand/photoPrompts.js) still need a picture. A slot whose original is already
 *      in the scratch folder is reused without a new call, unless --force is given. So running it twice never pays twice.
 *   2. Estimates the cost from config/apiCosts.js (PROVIDER_RATES.gpt_image_2_per_picture, measured at the 1024x1280 size used here)
 *      and refuses anything over the hard cap of USD 3.00.
 *   3. Asks for the OpenAI key at a hidden prompt (nothing typed is shown; the key is never printed, logged or saved, and the
 *      environment is not read for it), then asks you to type YES to the estimated cost.
 *   4. Makes each picture with its own call (a failed slot does not lose the others; nothing is retried), saves the original and a
 *      compressed JPEG (cropped to the size of the drawn picture it replaces, at most 250 KB) in ~/nebulaa-demo-photos, OUTSIDE the
 *      repo, and writes a contact sheet (contact-sheet.html) there to look at.
 *   5. Only after you type PROMOTE are the JPEGs copied into backend/demo-assets/zaya/, under the SAME file names the drawn pictures
 *      use, so every screen shows them at once with no database change (a hard refresh is enough). `seed-demo-brand.js create` also
 *      lays any picture in ~/nebulaa-demo-photos/final over the drawn one, so a rebuilt demo keeps them.
 * No database, no .env, no other service. Refuses without I_APPROVED_DEMO_PHOTOS=yes, and refuses in production.
 */
const fs = require('fs');
const path = require('path');
const { askHidden, askLine, scrub } = require('./generate-sample-photos');
const { SLOTS, GEN_SIZE, promptFor, relOk } = require('./demo-brand/photoPrompts');
const { PHOTOS_DIR, finalDir } = require('./demo-brand/realPhotos');

const MODEL = 'gpt-image-2';
const DEMO_DIR = path.join(__dirname, '..', 'demo-assets', 'zaya');
const MAX_USD = 3.0;
const MAX_BYTES = 250 * 1024;
const QUALITIES = ['low', 'medium', 'high'];
// The measured gpt-image-2 rates in apiCosts.js are for 1024x1280, which is exactly the size made here, so the factor is 1.
const SIZE_FACTOR = (GEN_SIZE.width * GEN_SIZE.height) / (1024 * 1280);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const usd = (n) => `USD ${n.toFixed(2)}`;

function parseArgs(argv) {
  const o = { only: null, force: false, quality: 'medium', bad: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') o.force = true;
    else if (a === '--only') { o.only = String(argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (a === '--quality') { o.quality = String(argv[i + 1] || ''); i += 1; }
    else o.bad = a;
  }
  if (!QUALITIES.includes(o.quality)) o.bad = `--quality ${o.quality}`;
  return o;
}

/** Price of one picture at this quality, from the shared rates. */
function perPhotoUsd(quality, rates) {
  const r = rates && rates.gpt_image_2_per_picture && rates.gpt_image_2_per_picture[quality];
  if (!(r > 0)) throw new Error(`No rate for quality ${quality} in apiCosts.js`);
  return r * SIZE_FACTOR;
}

/** 'skip' (a finished picture exists and the original is gone), 'reuse' (original in the scratch folder) or 'generate'. --force: 'generate'. */
function planSlots({ slots, only, force, hasFinal, hasOriginal }) {
  const names = slots.map((s) => s.slot);
  const unknown = (only || []).filter((n) => !names.includes(n));
  if (unknown.length) return { error: `Unknown slot: ${unknown.join(', ')}. The slots are: ${names.join(', ')}` };
  const chosen = only && only.length ? slots.filter((s) => only.includes(s.slot)) : slots;
  const items = chosen.map((s) => {
    if (force) return { ...s, action: 'generate' };
    if (hasOriginal(s.slot)) return { ...s, action: 'reuse' };
    if (hasFinal(s)) return { ...s, action: 'skip' };
    return { ...s, action: 'generate' };
  });
  return { items, toMake: items.filter((i) => i.action === 'generate').length };
}

function estimate(toMake, quality, rates) {
  const each = perPhotoUsd(quality, rates);
  return { each, total: each * toMake, cap: MAX_USD, withinCap: each * toMake <= MAX_USD + 1e-9 };
}

/** The smallest good JPEG: cropped to the slot's size, quality stepped down until it fits under the limit. */
async function toJpeg(sharp, input, [width, height]) {
  for (const q of [88, 84, 80, 76, 72, 68, 64, 58, 52, 46]) {
    const out = await sharp(input).resize(width, height, { fit: 'cover', position: 'centre' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_BYTES) return { buffer: out, quality: q };
  }
  throw new Error(`could not get the picture under ${kb(MAX_BYTES)}`);
}

/** The one real call: OpenAI image generation, one picture, no retry. */
async function openaiGenerate({ key, prompt, quality, fetchImpl = fetch, timeoutMs = 240000 }) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, size: `${GEN_SIZE.width}x${GEN_SIZE.height}`, quality, n: 1 }),
      signal: ctl.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(`the image service answered ${res.status}: ${scrub(body && body.error && body.error.message)}`);
      e.status = res.status;
      throw e;
    }
    const b64 = body && body.data && body.data[0] && body.data[0].b64_json;
    if (!b64) throw new Error('no picture came back');
    return Buffer.from(b64, 'base64');
  } finally { clearTimeout(t); }
}

function contactSheet(rows) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = rows.map((r) => `<figure><div class="ph">${r.done ? `<img src="final/${esc(r.rel)}" alt="">` : '<span>No photo</span>'}</div><figcaption><b>${esc(r.slot)}</b> (${esc(r.group)})<br>${esc(r.rel)}: ${esc(r.note)}</figcaption></figure>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Demo photos</title><style>body{font:14px system-ui;margin:24px;background:#faf7f0;color:#2b1d0e}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px #0002}.ph{aspect-ratio:4/5;background:#eee;display:grid;place-items:center}.ph img{width:100%;height:100%;object-fit:cover}figcaption{padding:10px 12px;font-size:12px}</style><h1>Zaya Naturals demo photos</h1><p>These are the pictures that would replace the drawn ones. Type PROMOTE in Terminal to put them into the demo.</p><main>${cards}</main>`;
}

/** True when `file` is inside `dir` (after resolving). */
const inside = (dir, file) => { const r = path.relative(path.resolve(dir), path.resolve(file)); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const out = deps.log || ((...a) => console.log(...a));
  const err = deps.err || ((...a) => console.error(...a));
  const demoDir = deps.demoDir || DEMO_DIR;
  const scratch = deps.scratchDir || PHOTOS_DIR;
  const ask = deps.ask || askLine;
  const hidden = deps.askHidden || askHidden;
  const slots = deps.slots || SLOTS;

  if (env.I_APPROVED_DEMO_PHOTOS !== 'yes') {
    err(`Refusing to run: this makes paid image calls (at most ${usd(MAX_USD)}). Start it with I_APPROVED_DEMO_PHOTOS=yes`);
    return 2;
  }
  if (env.NODE_ENV === 'production') { err('Refusing to run: this is a development-only tool (NODE_ENV is production).'); return 2; }
  const a = parseArgs(argv);
  if (a.bad) { err(`Unknown option: ${a.bad}. Use --only <slot,slot>, --force or --quality low|medium|high.`); return 2; }
  const badPath = slots.find((s) => !relOk(s.rel) || !inside(demoDir, path.join(demoDir, s.rel)));
  if (badPath) { err(`Refusing: the slot ${badPath.slot} does not point at a demo picture path.`); return 2; }

  const rates = deps.rates || require('../config/apiCosts').PROVIDER_RATES;
  const orig = (slot) => path.join(scratch, 'originals', `${slot}.png`);
  const fin = (rel) => path.join(finalDir(scratch), rel);
  const plan = planSlots({ slots, only: a.only, force: a.force, hasFinal: (s) => fs.existsSync(fin(s.rel)), hasOriginal: (n) => fs.existsSync(orig(n)) });
  if (plan.error) { err(plan.error); return 2; }

  out(`Picture folder (outside the app): ${scratch}`);
  for (const i of plan.items) out(`  ${i.slot.padEnd(20)} ${{ skip: 'a finished picture is already there, skipped', reuse: 'original already made, reused (no call)', generate: 'to make' }[i.action]}`);
  const est = estimate(plan.toMake, a.quality, rates);
  if (!est.withinCap) { err(`Refusing: ${plan.toMake} pictures at ${a.quality} quality is about ${usd(est.total)}, over the ${usd(MAX_USD)} cap. Use --only for fewer slots or --quality medium.`); return 2; }
  const work = plan.items.filter((i) => i.action !== 'skip');
  if (!work.length) { out('Nothing to do: every chosen slot already has its picture. Use --force to redo one.'); return 0; }

  let key = '';
  if (plan.toMake > 0) {
    out(`About to make ${plan.toMake} picture${plan.toMake === 1 ? '' : 's'} (${MODEL}, ${a.quality} quality, ${GEN_SIZE.width}x${GEN_SIZE.height}), about ${usd(est.each)} each, estimated ${usd(est.total)} in all (cap ${usd(MAX_USD)}).`);
    try { key = await hidden('OpenAI key (hidden, press Enter after pasting): '); } catch (e) { err(scrub(e.message)); return 3; }
    if (!key) { err('No key given: no call was made.'); return 3; }
    const yes = await ask(`Type YES to spend about ${usd(est.total)}: `);
    if (yes !== 'YES') { out('Stopped: nothing was made and nothing was spent.'); return 2; }
  }

  fs.mkdirSync(path.join(scratch, 'originals'), { recursive: true });
  const generate = deps.generate || ((prompt) => openaiGenerate({ key, prompt, quality: a.quality }));
  const sharp = deps.sharp || require('sharp');
  let spent = 0; let calls = 0; let stopAll = false;
  const rows = [];
  for (const item of work) {
    const row = { slot: item.slot, rel: item.rel, group: item.group, done: false, note: '' };
    rows.push(row);
    try {
      if (item.action === 'generate') {
        if (stopAll) { row.note = 'not made (stopped after an access error)'; continue; }
        if (spent + est.each > MAX_USD + 1e-9) { row.note = 'not made (the cap was reached)'; continue; }
        calls += 1; spent += est.each;
        const png = await generate(promptFor(item), item);
        fs.writeFileSync(orig(item.slot), png);
      }
      const j = await toJpeg(sharp, fs.readFileSync(orig(item.slot)), item.size);
      fs.mkdirSync(path.dirname(fin(item.rel)), { recursive: true });
      fs.writeFileSync(fin(item.rel), j.buffer);
      row.done = true;
      row.note = `${item.action === 'reuse' ? 'reused, ' : ''}${item.size[0]}x${item.size[1]}, ${kb(j.buffer.length)} (quality ${j.quality})`;
    } catch (e) {
      row.note = `failed: ${scrub(e && e.message)}`;
      if (e && (e.status === 401 || e.status === 403)) stopAll = true;
    }
  }
  const sheet = path.join(scratch, 'contact-sheet.html');
  // the sheet shows every finished picture in the folder, not only this run's
  const all = slots.map((s) => rows.find((r) => r.slot === s.slot) || { slot: s.slot, rel: s.rel, group: s.group, done: fs.existsSync(fin(s.rel)), note: fs.existsSync(fin(s.rel)) ? 'made earlier' : 'not made yet' });
  fs.writeFileSync(sheet, contactSheet(all));
  out('');
  out(`Calls made: ${calls}, estimated spend ${usd(spent)}.`);
  for (const r of rows) out(`  ${r.slot.padEnd(20)} ${r.note}`);
  out(`Look at them first: open "${sheet}"`);

  const ready = rows.filter((r) => r.done);
  if (!ready.length) { err('No picture is ready, so nothing can be put into the demo.'); return 4; }
  const promote = await ask(`Type PROMOTE to put ${ready.length} picture${ready.length === 1 ? '' : 's'} into the demo (anything else keeps them only in ${scratch}): `);
  if (promote !== 'PROMOTE') { out(`Not promoted. The pictures stay in ${scratch}; run the same command again to promote them without new calls.`); return rows.some((r) => !r.done) ? 4 : 0; }
  if (!fs.existsSync(demoDir)) {
    out(`The demo folder does not exist yet, so nothing was copied. The next "seed-demo-brand.js create" lays these ${ready.length} pictures over the drawn ones.`);
    return rows.some((r) => !r.done) ? 4 : 0;
  }
  let copied = 0;
  for (const r of ready) {
    const dest = path.join(demoDir, r.rel);
    if (!inside(demoDir, dest)) { out(`  skipped ${r.slot}: not a demo path`); continue; }
    const src = fs.readFileSync(fin(r.rel));
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src);
    copied += 1;
  }
  out(`Put ${copied} picture${copied === 1 ? '' : 's'} into ${demoDir}. Run "node scripts/seed-demo-brand.js create" (adds the fourth carousel slide), then hard refresh the browser.`);
  return rows.some((r) => !r.done) ? 4 : 0;
}

module.exports = { main, parseArgs, planSlots, estimate, perPhotoUsd, toJpeg, openaiGenerate, contactSheet, MAX_USD, MAX_BYTES, DEMO_DIR, PHOTOS_DIR };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('The script stopped:', scrub(e && e.message)); process.exit(1); });
}
