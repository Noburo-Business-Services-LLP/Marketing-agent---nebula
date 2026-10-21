/**
 * ONE-OFF, owner-run: makes the sample photos for the cover tiles (Create content, Photoshoot packs, Home).
 *
 *   I_APPROVED_SAMPLE_PHOTOS=yes node scripts/generate-sample-photos.js [--only pack-festival,create-video] [--force] [--quality medium|high]
 *
 * What it does, in order:
 *   1. Works out which slots still need a photo (config/samplePhotoPrompts.js, 12 slots). A slot that already has
 *      frontend/public/samples/<slot>.webp is skipped, and a slot whose original is already in the scratch folder is
 *      reused without a new call, unless --force is given. So running it twice never pays twice.
 *   2. Estimates the cost from config/apiCosts.js (PROVIDER_RATES.gpt_image_2_per_picture, scaled to the 1536x1024 size)
 *      and refuses anything over the hard cap of USD 2.00.
 *   3. Asks for the OpenAI key at a hidden prompt (nothing typed is shown; the key is never printed, logged or saved),
 *      then asks you to type YES to the estimated cost.
 *   4. Makes each photo with its own call (a failed slot does not lose the others; nothing is retried), saves the
 *      original and a small webp copy (768x480, at most 36 KB) in the scratch folder OUTSIDE the repo, and writes a
 *      contact sheet (contact-sheet.html) there to look at.
 *   5. Only after you type PROMOTE are the webp copies put into frontend/public/samples/ (never over an existing file
 *      without --force).
 * No database, no .env, no other service. Refuses without I_APPROVED_SAMPLE_PHOTOS=yes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const REPO = path.resolve(__dirname, '../..');
const SAMPLES_DIR = path.join(REPO, 'frontend/public/samples');
const SCRATCH_DIR = path.join(os.homedir(), 'nebulaa-sample-photos');
const MODEL = 'gpt-image-2';
const GEN_SIZE = { width: 1536, height: 1024 };
// The size the app shows them at (frontend/utils/samplePhotos.ts SAMPLE_PHOTO_SIZE; a test keeps the two equal).
const WEB_SIZE = { width: 768, height: 480 };
const MAX_WEB_BYTES = 36 * 1024;
const MAX_USD = 2.0;
const QUALITIES = ['medium', 'high'];
// The measured gpt-image-2 rates are for 1024x1280; 1536x1024 has 1.2 times the pixels, so it is priced 1.2 times.
const SIZE_FACTOR = (GEN_SIZE.width * GEN_SIZE.height) / (1024 * 1280);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const usd = (n) => `USD ${n.toFixed(2)}`;
/** Never let anything that looks like a key reach the screen. */
const scrub = (s) => String(s || '').replace(/sk-[A-Za-z0-9_\-*]+/g, 'sk-...').slice(0, 120);

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

/** Price of one photo at this quality, from the shared rates. */
function perPhotoUsd(quality, rates) {
  const r = rates && rates.gpt_image_2_per_picture && rates.gpt_image_2_per_picture[quality];
  if (!(r > 0)) throw new Error(`No rate for quality ${quality} in apiCosts.js`);
  return r * SIZE_FACTOR;
}

/**
 * What to do with each slot: 'skip' (the app already has it), 'reuse' (the original is in the scratch folder) or
 * 'generate'. --force makes every chosen slot 'generate'.
 */
function planSlots({ slots, only, force, inApp, inScratch }) {
  const names = slots.map((s) => s.slot);
  const unknown = (only || []).filter((n) => !names.includes(n));
  if (unknown.length) return { error: `Unknown slot: ${unknown.join(', ')}. The slots are: ${names.join(', ')}` };
  const chosen = only && only.length ? slots.filter((s) => only.includes(s.slot)) : slots;
  const items = chosen.map((s) => {
    if (force) return { ...s, action: 'generate' };
    if (inApp(s.slot)) return { ...s, action: 'skip' };
    if (inScratch(s.slot)) return { ...s, action: 'reuse' };
    return { ...s, action: 'generate' };
  });
  return { items, toMake: items.filter((i) => i.action === 'generate').length };
}

function estimate(toMake, quality, rates) {
  const each = perPhotoUsd(quality, rates);
  return { each, total: each * toMake, cap: MAX_USD, withinCap: each * toMake <= MAX_USD + 1e-9 };
}

/** The smallest good webp: quality stepped down until it fits under the limit. */
async function toWebp(sharp, input) {
  for (const q of [80, 74, 68, 62, 56, 50, 44, 38]) {
    const out = await sharp(input).resize(WEB_SIZE.width, WEB_SIZE.height, { fit: 'cover', position: 'centre' }).webp({ quality: q, effort: 6 }).toBuffer();
    if (out.length <= MAX_WEB_BYTES) return { buffer: out, quality: q };
  }
  throw new Error(`could not get the photo under ${kb(MAX_WEB_BYTES)}`);
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

/** A hidden prompt: what is typed or pasted is not shown. */
function askHidden(question, input = process.stdin, output = process.stdout) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY || typeof input.setRawMode !== 'function') { reject(new Error('Run this in Terminal: the key is asked at a hidden prompt.')); return; }
    output.write(question);
    let value = '';
    const done = () => { input.setRawMode(false); input.pause(); input.removeListener('data', onData); output.write('\n'); };
    const onData = (chunk) => {
      for (const c of String(chunk)) {
        if (c === '\r' || c === '\n') { done(); resolve(value.trim()); return; }
        if (c === '\u0003') { done(); reject(new Error('Stopped.')); return; }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

function askLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(String(a || '').trim()); });
  });
}

function contactSheet(rows) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = rows.map((r) => `<figure><div class="ph">${r.web ? `<img src="web/${esc(r.slot)}.webp" alt="">` : '<span>No photo</span>'}</div><figcaption><b>${esc(r.tile)}</b><br>${esc(r.slot)}: ${esc(r.note)}</figcaption></figure>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Sample photos</title><style>body{font:14px system-ui;margin:24px;background:#faf7f0;color:#2b1d0e}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px #0002}.ph{aspect-ratio:16/10;background:#eee;display:grid;place-items:center}.ph img{width:100%;height:100%;object-fit:cover}figcaption{padding:10px 12px}</style><h1>Sample photos</h1><p>These are the small copies the app would use. Type PROMOTE in Terminal to put them into the app.</p><main>${cards}</main>`;
}

async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const out = deps.log || ((...a) => console.log(...a));
  const err = deps.err || ((...a) => console.error(...a));
  const samplesDir = deps.samplesDir || SAMPLES_DIR;
  const scratch = deps.scratchDir || SCRATCH_DIR;
  const ask = deps.ask || askLine;
  const hidden = deps.askHidden || askHidden;

  if (env.I_APPROVED_SAMPLE_PHOTOS !== 'yes') {
    err(`Refusing to run: this makes paid image calls (at most ${usd(MAX_USD)}). Start it with I_APPROVED_SAMPLE_PHOTOS=yes`);
    return 2;
  }
  const a = parseArgs(argv);
  if (a.bad) { err(`Unknown option: ${a.bad}. Use --only <slot,slot>, --force or --quality medium|high.`); return 2; }

  const { SLOTS, promptFor } = deps.prompts || require('../config/samplePhotoPrompts');
  const rates = deps.rates || require('../config/apiCosts').PROVIDER_RATES;
  const orig = (slot) => path.join(scratch, `${slot}.png`);
  const web = (slot) => path.join(scratch, 'web', `${slot}.webp`);
  const plan = planSlots({ slots: SLOTS, only: a.only, force: a.force, inApp: (s) => fs.existsSync(path.join(samplesDir, `${s}.webp`)), inScratch: (s) => fs.existsSync(orig(s)) });
  if (plan.error) { err(plan.error); return 2; }

  out(`Scratch folder (outside the app): ${scratch}`);
  for (const i of plan.items) out(`  ${i.slot.padEnd(18)} ${{ skip: 'already in the app, skipped', reuse: 'original already made, reused (no call)', generate: 'to make' }[i.action]}`);
  const est = estimate(plan.toMake, a.quality, rates);
  if (!est.withinCap) { err(`Refusing: ${plan.toMake} photos at ${a.quality} quality is about ${usd(est.total)}, over the ${usd(MAX_USD)} cap. Use --only for fewer slots or --quality medium.`); return 2; }
  const work = plan.items.filter((i) => i.action !== 'skip');
  if (!work.length) { out('Nothing to do: every chosen slot already has its photo in the app. Use --force to redo one.'); return 0; }

  let key = '';
  if (plan.toMake > 0) {
    out(`About to make ${plan.toMake} photo${plan.toMake === 1 ? '' : 's'} (${MODEL}, ${a.quality} quality, ${GEN_SIZE.width}x${GEN_SIZE.height}), about ${usd(est.each)} each, estimated ${usd(est.total)} in all (cap ${usd(MAX_USD)}).`);
    try { key = env.OPENAI_API_KEY || await hidden('OpenAI key (hidden, press Enter after pasting): '); } catch (e) { err(scrub(e.message)); return 3; }
    if (!key) { err('No key given: no call was made.'); return 3; }
    const yes = await ask(`Type YES to spend about ${usd(est.total)}: `);
    if (yes !== 'YES') { out('Stopped: nothing was made and nothing was spent.'); return 2; }
  }

  fs.mkdirSync(path.join(scratch, 'web'), { recursive: true });
  const generate = deps.generate || ((prompt) => openaiGenerate({ key, prompt, quality: a.quality }));
  const sharp = deps.sharp || require('sharp');
  let spent = 0; let calls = 0; let stopAll = false;
  const rows = [];
  for (const item of work) {
    const row = { slot: item.slot, tile: item.tile, web: false, note: '' };
    rows.push(row);
    try {
      if (item.action === 'generate') {
        if (stopAll) { row.note = 'not made (stopped after an access error)'; continue; }
        if (spent + est.each > MAX_USD + 1e-9) { row.note = 'not made (the cap was reached)'; continue; }
        calls += 1; spent += est.each;
        const png = await generate(promptFor(item), item);
        fs.writeFileSync(orig(item.slot), png);
      }
      const w = await toWebp(sharp, fs.readFileSync(orig(item.slot)));
      fs.writeFileSync(web(item.slot), w.buffer);
      row.web = true; row.bytes = w.buffer.length;
      row.note = `${item.action === 'reuse' ? 'reused, ' : ''}${kb(w.buffer.length)} (quality ${w.quality})`;
    } catch (e) {
      row.note = `failed: ${scrub(e && e.message)}`;
      if (e && (e.status === 401 || e.status === 403)) stopAll = true;
    }
  }
  const sheet = path.join(scratch, 'contact-sheet.html');
  fs.writeFileSync(sheet, contactSheet(rows));
  out('');
  out(`Calls made: ${calls}, estimated spend ${usd(spent)}.`);
  out('Contact sheet:');
  for (const r of rows) out(`  ${r.slot.padEnd(18)} ${r.note}`);
  out(`Look at them first: open "${sheet}"`);

  const ready = rows.filter((r) => r.web);
  if (!ready.length) { err('No photo is ready, so nothing can be put into the app.'); return 4; }
  const promote = await ask(`Type PROMOTE to put ${ready.length} photo${ready.length === 1 ? '' : 's'} into the app (anything else keeps them only in the scratch folder): `);
  if (promote !== 'PROMOTE') { out(`Not promoted. The photos stay in ${scratch}; run the same command again to promote them without new calls.`); return 0; }
  fs.mkdirSync(samplesDir, { recursive: true });
  let copied = 0;
  for (const r of ready) {
    const dest = path.join(samplesDir, `${r.slot}.webp`);
    if (fs.existsSync(dest) && !a.force) { out(`  kept the existing ${r.slot}.webp (use --force to replace it)`); continue; }
    fs.copyFileSync(web(r.slot), dest);
    copied += 1;
  }
  out(`Put ${copied} photo${copied === 1 ? '' : 's'} into ${samplesDir}. Reload Create content to see them.`);
  return rows.some((r) => !r.web) ? 4 : 0;
}

module.exports = { askHidden, askLine, main, parseArgs, planSlots, estimate, perPhotoUsd, toWebp, openaiGenerate, scrub, contactSheet, MAX_USD, WEB_SIZE, GEN_SIZE, MAX_WEB_BYTES, SCRATCH_DIR, SAMPLES_DIR };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('The script stopped:', scrub(e && e.message)); process.exit(1); });
}
