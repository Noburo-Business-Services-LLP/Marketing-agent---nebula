/**
 * ONE real Photoshoot photo, to prove the prompt and the reference photo work with the real image model and to measure
 * what a photo really costs. Makes exactly one paid image call (about USD 0.06 to 0.10 at medium quality). Run it only
 * with the owner's OK for this run: docs/superpowers/ops/photoshoot-real-proof.md
 *
 *   CONFIRM_REAL_PHOTOSHOOT=yes PROOF_PRODUCT_PHOTO=/path/to/product.jpg node scripts/photoshoot-real-proof.js [pack] [scene]
 *
 * pack and scene default to marketplace / front. No database is touched, nothing is charged to any account, nothing is
 * uploaded: the photo is written next to this script's output folder (scratch) and the measured tokens are printed so
 * config/apiCosts.js (photoshoot_reference_input_per_photo) can be corrected. The key is read by the app's own loader
 * from the environment and is never printed.
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  if (process.env.CONFIRM_REAL_PHOTOSHOOT !== 'yes') {
    console.log('Refusing: this makes one real, paid image call. Set CONFIRM_REAL_PHOTOSHOOT=yes once the owner has said yes for this run.');
    process.exit(2);
  }
  const file = process.env.PROOF_PRODUCT_PHOTO || '';
  if (!file || !fs.existsSync(file)) { console.log('Set PROOF_PRODUCT_PHOTO to a PNG, JPEG or WEBP photo of one product on this computer.'); process.exit(2); }
  if (!process.env.OPENAI_API_KEY) { console.log('The image key is not set in this environment (it is read from backend/.env by the app loader).'); process.exit(2); }

  const { packOf } = require('../config/photoshootPacks');
  const { buildPhotoPrompt } = require('../services/photoshoot/prompt');
  const { readDataUrl } = require('../services/photoshoot/refs');
  const { buildEditForm } = require('../services/openaiImage');
  const costs = require('../config/apiCosts');

  const pack = packOf(process.argv[2] || 'marketplace');
  if (!pack) { console.log('Unknown pack.'); process.exit(2); }
  const scene = pack.scenes.find((s) => s.key === (process.argv[3] || pack.scenes[0].key)) || pack.scenes[0];
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const read = readDataUrl(`data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`);
  if (!read.ok) { console.log(`That photo is not accepted (${read.reason}): use a PNG, JPEG or WEBP of up to 6 MB.`); process.exit(2); }

  const aspectRatio = pack.aspectRatios[0];
  const prompt = buildPhotoPrompt({ scene, background: pack.backgrounds[0] || '', productName: process.env.PROOF_PRODUCT_NAME || '', aspectRatio });
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
  const size = { '1:1': '1024x1024', '4:5': '1024x1280', '9:16': '1024x1824', '16:9': '1824x1024' }[aspectRatio] || '1024x1024';
  console.log(`One real photo: pack ${pack.key}, scene ${scene.key}, ${aspectRatio}, model ${model}, quality ${costs.PHOTOSHOOT_QUALITY}, 1 reference photo.`);
  console.log(`Priced in apiCosts: USD ${costs.ACTION_USD.photoshoot_image.toFixed(4)} per photo, ${costs.QUARK_COSTS.photoshoot_image} Quarks.`);

  const started = Date.now();
  const form = buildEditForm(prompt, size, [{ mimeType: read.mime, data: read.buffer.toString('base64') }], model, costs.PHOTOSHOOT_QUALITY);
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.log(`FAIL  the image call was refused (HTTP ${res.status}): ${String((body.error && body.error.message) || '').slice(0, 200)}`); process.exit(1); }
  const b64 = body && body.data && body.data[0] && body.data[0].b64_json;
  if (!b64) { console.log('FAIL  no image came back.'); process.exit(1); }
  const out = path.join(process.env.PROOF_OUT_DIR || os.tmpdir(), `photoshoot-proof-${Date.now()}.png`);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  const u = body.usage || {};
  const det = u.input_tokens_details || {};
  console.log(`PASS  one photo made in ${seconds} s, saved to ${out}`);
  console.log(`      tokens: input ${u.input_tokens ?? '?'} (image ${det.image_tokens ?? '?'}, text ${det.text_tokens ?? '?'}), output ${u.output_tokens ?? '?'}`);
  console.log('      Look at the photo: the product must match the reference exactly, with no person, no added logo and no text.');
  console.log('      Then put the measured image-input cost per reference photo into config/apiCosts.js (photoshoot_reference_input_per_photo).');
}

main().catch((e) => { console.log(`FAIL  ${e && e.message}`); process.exit(1); });
