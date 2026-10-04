/**
 * One-off: photographic cover images for the 13 Hero Studio style cards.
 *
 * SPENDS IMAGE CREDITS: one image generation per style (13 in total, fewer if some covers exist).
 * It refuses to run unless --confirm-spend is passed; --dry-run prints the prompts and exits without
 * loading any image helper or touching the network.
 *
 *   node scripts/generate-hero-style-covers.js --dry-run
 *   node scripts/generate-hero-style-covers.js --confirm-spend            (skips covers that already exist)
 *   node scripts/generate-hero-style-covers.js --confirm-spend --overwrite
 *
 * Output: frontend/public/assets/video-styles/<slug>.jpg (3:4 vertical). GET /api/hero-video/styles
 * serves the .jpg once it exists, else the shipped .svg.
 */
const path = require('path');
const { HERO_STYLES } = require('../services/heroVideoStyles');

const OUT_DIR = path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'video-styles');

// One scene per style: fictional, brand-neutral, no recognisable person or product.
const SCENES = {
  'cinematic-commercial': 'a woman in her thirties pauses at a rain-streaked cafe window at dusk, warm practical lamps inside and cool street light outside, a ceramic cup in her hands, shallow depth of field',
  storytelling: 'a young man sits on the steps of an old apartment building at golden hour holding a handwritten letter, a quiet thoughtful expression, long warm shadows across the street',
  'product-advertisement': 'an unbranded matte glass bottle on a stone surface, soft side light from a large window, a single droplet running down the glass, clean neutral background',
  'daily-life-vlog': 'a woman films herself with a phone at arm\'s length in a sunlit kitchen while making breakfast, casual clothes, slightly messy hair, a candid half laugh',
  documentary: 'an older craftsman works at a cluttered wooden workbench, window light falling across his hands and tools, sawdust in the air, observed from a respectful distance',
  educational: 'a woman demonstrates something with her hands at a workshop table, simple objects laid out in front of her, daylight from a window, steady eye-level framing',
  motivational: 'a runner stops at the top of a city stairway at sunrise, breath visible in the cold air, the skyline soft behind her, determined expression',
  'corporate-presentation': 'two colleagues talk beside a bright office window, one gesturing while explaining, plants and a plain whiteboard softly out of focus behind them',
  testimonial: 'a young man talks to a phone propped on a bookshelf in his living room, relaxed and smiling, natural afternoon light, a plant and a lamp behind him',
  'product-showcase': 'an unbranded ceramic mug on a small round plinth, a single soft spotlight, gentle reflection on the glazed surface, deep charcoal backdrop',
  'news-update': 'a woman stands on a city street at blue hour holding a plain microphone, traffic lights blurred behind her, steady composed framing',
  'social-media-reel': 'friends laughing on a rooftop at sunset, one turning toward the camera mid-motion, natural motion blur, vivid but natural colour',
  'luxury-advertisement': 'an unbranded gold watch resting on black velvet, a narrow hard light raking across its face, deep shadow, restrained and premium'
};

// Scenes with no person in them: the people-only wording would be wrong for these.
const PRODUCT_ONLY = new Set(['product-advertisement', 'product-showcase', 'luxury-advertisement']);

function promptFor(style) {
  const scene = SCENES[style.slug];
  const people = !PRODUCT_ONLY.has(style.slug);
  return [
    'Photograph, vertical 3:4 portrait frame.',
    `Scene: ${scene}.`,
    people
      ? 'Real-world photography with natural imperfections: real skin texture, real light with real shadows, subtle film grain.'
      : 'Real-world photography with natural imperfections: real light with real shadows, subtle film grain.',
    people ? 'Every person is fictional; no recognisable real person.' : '',
    'No text, no letters, no numbers, no logos, no brand marks, no watermark, no on-screen graphics.'
  ].filter(Boolean).join(' ');
}

async function saveImage(imageUrl, file) {
  const sharp = require('sharp');
  let buf;
  const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(imageUrl || '');
  if (m) {
    buf = Buffer.from(m[1], 'base64');
  } else {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  await sharp(buf).resize({ width: 900, height: 1200, fit: 'cover' }).jpeg({ quality: 84, mozjpeg: true }).toFile(file);
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--confirm-spend');
  const overwrite = argv.includes('--overwrite');

  if (dryRun) {
    for (const s of HERO_STYLES) console.log(`${s.slug}: ${promptFor(s)}`);
    return 0;
  }
  if (!confirmed) {
    console.error('Refusing to run: this generates 13 images and spends image credits. Pass --confirm-spend to proceed, or --dry-run to print the prompts.');
    return 2;
  }

  // Only past the guard: environment, image helper and file system.
  const fs = require('fs');
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { generateCampaignImageNanoBanana } = require('../services/geminiAI');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let failed = 0;
  for (const s of HERO_STYLES) {
    const file = path.join(OUT_DIR, `${s.slug}.jpg`);
    if (!overwrite && fs.existsSync(file)) {
      console.log(`skip ${s.slug} (cover exists)`);
      continue;
    }
    try {
      const r = await generateCampaignImageNanoBanana(promptFor(s), { useRawPrompt: true, aspectRatio: '3:4' });
      if (!r || !r.imageUrl) throw new Error('no image returned');
      await saveImage(r.imageUrl, file);
      console.log(`saved ${path.relative(process.cwd(), file)}`);
    } catch (err) {
      failed += 1;
      console.error(`failed ${s.slug}: ${err && err.message}`);
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(err && err.message); process.exitCode = 1; }
  );
}

module.exports = { promptFor, SCENES };
