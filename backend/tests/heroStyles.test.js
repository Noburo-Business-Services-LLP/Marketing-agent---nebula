// Task 8: style groups as editable prompts, the /styles route and the cover script.
// No database, no network: the override test stubs the PromptOverride model in the require cache,
// and the cover script is only ever spawned with --dry-run or with no flags.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const styles = require('../services/heroVideoStyles');
const { HERO_STYLES, isHeroStyle, groupForStyle, getStyleBlock, getBuiltInStyleBlock, STYLE_PROMPT_KEYS } = styles;
const { PROMPTS, listPrompts } = require('../services/promptRegistry');
const heroRouter = require('../routes/heroVideo');

const SLUGS = ['cinematic-commercial', 'storytelling', 'product-advertisement', 'daily-life-vlog', 'documentary', 'educational',
  'motivational', 'corporate-presentation', 'testimonial', 'product-showcase', 'news-update', 'social-media-reel', 'luxury-advertisement'];
const GROUPS = {
  cinematic: ['cinematic-commercial', 'storytelling', 'luxury-advertisement', 'documentary'],
  ugc: ['daily-life-vlog', 'social-media-reel', 'testimonial'],
  product: ['product-advertisement', 'product-showcase'],
  explainer: ['educational', 'motivational', 'corporate-presentation', 'news-update']
};
const KEYS = ['hero_video.style.cinematic', 'hero_video.style.ugc', 'hero_video.style.product', 'hero_video.style.explainer'];
const STYLE_BLOCK_MAX = heroRouter.STYLE_BLOCK_MAX;

test('13 slugs, unknown rejected, group mapping as in Task 2', () => {
  assert.deepEqual(HERO_STYLES.map((s) => s.slug).sort(), [...SLUGS].sort());
  for (const [g, slugs] of Object.entries(GROUPS)) for (const s of slugs) assert.equal(groupForStyle(s), g, s);
  for (const bad of ['', 'nope', 'Testimonial', null, undefined, 3, '__proto__', 'constructor']) assert.equal(isHeroStyle(bad), false, String(bad));
  assert.equal(HERO_STYLES.find((s) => s.slug === 'testimonial').label, 'Creator recommendation');
});

test('getStyleBlock is async; with no user it returns the built-in block', async () => {
  const p = getStyleBlock('daily-life-vlog');
  assert.ok(p && typeof p.then === 'function', 'returns a promise');
  assert.equal(await p, getBuiltInStyleBlock('daily-life-vlog'));
  assert.equal(await getStyleBlock('unknown-style'), getBuiltInStyleBlock('cinematic-commercial'));
  for (const s of SLUGS) assert.equal(await getStyleBlock(s, null), getBuiltInStyleBlock(s), s);
});

test('every group block carries integrity and realism rules and fits STYLE_BLOCK_MAX', async () => {
  assert.equal(STYLE_BLOCK_MAX, 1200);
  for (const s of SLUGS) {
    const b = await getStyleBlock(s);
    assert.ok(b.length <= STYLE_BLOCK_MAX, `${s}: ${b.length} chars`);
    assert.match(b, /never (a )?real customers?/i, `${s}: integrity`);
    assert.match(b, /never invent/i, `${s}: no invented results`);
    assert.match(b, /AI-generated/, `${s}: AI disclosure`);
    assert.match(b, /skin texture|pores/i, `${s}: realism`);
    assert.match(b, /no plastic skin/i, `${s}: realism negative`);
  }
  const ugc = await getStyleBlock('social-media-reel');
  assert.match(ugc, /35-40 words/);
  assert.match(ugc, /phone/i);
  assert.match(ugc, /casual/i);
  assert.match(await getStyleBlock('testimonial'), /creator persona|labelled dramati[sz]ation/i);
  const cine = await getStyleBlock('documentary');
  for (const w of ['SETUP', 'TENSION', 'DISCOVERY', 'TRANSFORMATION', 'EMOTIONAL PAYOFF']) assert.ok(cine.includes(w), w);
  assert.match(cine, /no slow motion/i);
  const product = await getStyleBlock('product-showcase');
  assert.match(product, /label/i);
  assert.match(product, /scale/i);
  const explainer = await getStyleBlock('news-update');
  assert.match(explainer, /one idea/i);
  assert.match(explainer, /draws nothing on screen/i);
});

test('the four registry entries exist on the hero-video stage with no variables', () => {
  assert.deepEqual(Object.values(STYLE_PROMPT_KEYS).sort(), [...KEYS].sort());
  const listed = new Map(listPrompts().map((p) => [p.id, p]));
  for (const k of KEYS) {
    const p = PROMPTS[k];
    assert.ok(p, k);
    assert.equal(p.stage, 'hero-video', k);
    assert.deepEqual(p.variables, {}, k);
    assert.ok(p.label && p.summary, k);
    assert.doesNotMatch(p.template, /\{\{/, `${k}: no placeholders`);
    assert.ok(listed.has(k), `${k} listed for Prompt Studio`);
  }
  assert.ok(PROMPTS['hero_video.plan'], 'planner entry still present');
});

test('a Prompt Studio override replaces the group rules; other groups keep the default', async () => {
  const modelPath = require.resolve('../models/PromptOverride');
  const saved = require.cache[modelPath];
  const seen = [];
  require.cache[modelPath] = {
    id: modelPath, filename: modelPath, loaded: true,
    exports: {
      findOne: (q) => {
        seen.push(q);
        return { lean: async () => (q.promptId === 'hero_video.style.ugc' && q.user === 'u1' ? { template: 'MY UGC RULES\nLine two' } : null) };
      }
    }
  };
  try {
    const ugc = await getStyleBlock('testimonial', 'u1');
    assert.equal(ugc, 'Style: Creator recommendation (ugc).\nMY UGC RULES\nLine two');
    assert.equal(await getStyleBlock('documentary', 'u1'), getBuiltInStyleBlock('documentary'));
    assert.equal(await getStyleBlock('testimonial', 'u2'), getBuiltInStyleBlock('testimonial'));
    assert.deepEqual(seen.map((q) => q.promptId), ['hero_video.style.ugc', 'hero_video.style.cinematic', 'hero_video.style.ugc']);
  } finally {
    if (saved) require.cache[modelPath] = saved; else delete require.cache[modelPath];
  }
});

test('a failing or empty registry lookup falls back to the built-in block', async () => {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const boom = { buildPrompt: async () => { throw new Error('db down'); } };
    assert.equal(await getStyleBlock('product-advertisement', 'u1', boom), getBuiltInStyleBlock('product-advertisement'));
    const empty = { buildPrompt: async () => '   ' };
    assert.equal(await getStyleBlock('educational', 'u1', empty), getBuiltInStyleBlock('educational'));
  } finally {
    console.error = orig;
  }
  assert.ok(errs.length >= 1);
  for (const e of errs) assert.doesNotMatch(e, /Register:|Integrity:/, 'prompt text is never logged');
});

// ---- GET /styles ----
function stylesRoute(impl) {
  const r = heroRouter.createHeroVideoRouter({}, impl);
  return r.stack.filter((l) => l.route).find((l) => l.route.path === '/styles' && l.route.methods.get);
}
async function callStyles(impl) {
  const layer = stylesRoute(impl);
  const h = layer.route.stack[layer.route.stack.length - 1].handle;
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await h({ user: { _id: 'u1' } }, res);
  return res;
}

test('GET /styles: protected, 13 entries with label, group, blurb and a cover', async () => {
  const layer = stylesRoute();
  assert.ok(layer, 'route exists');
  assert.equal(layer.route.stack[0].name, 'protect');
  const res = await callStyles();
  assert.equal(res.code, 200);
  const list = res.body.styles;
  assert.equal(list.length, 13);
  assert.deepEqual(list.map((s) => s.slug), HERO_STYLES.map((s) => s.slug));
  for (const s of list) {
    assert.deepEqual(Object.keys(s).sort(), ['blurb', 'coverUrl', 'group', 'label', 'slug']);
    assert.match(s.coverUrl, new RegExp(`^/assets/video-styles/${s.slug}\\.(svg|jpg)$`));
    assert.ok(s.blurb.length > 5, s.slug);
    assert.equal(s.group, groupForStyle(s.slug));
    assert.doesNotMatch(`${s.label} ${s.blurb}`, /customer|seedance|nano banana|fal\b|kling/i, `${s.slug}: no customer framing or vendor names`);
  }
  assert.equal(list.find((s) => s.slug === 'testimonial').label, 'Creator recommendation');
  assert.equal(list.find((s) => s.slug === 'storytelling').blurb, 'Narrative arc with characters and emotional beats');
});

test('GET /styles prefers a .jpg cover when one exists, else the .svg', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-covers-'));
  try {
    fs.writeFileSync(path.join(dir, 'storytelling.jpg'), 'x');
    const res = await callStyles({ coverDirs: [path.join(dir, 'missing'), dir] });
    const by = new Map(res.body.styles.map((s) => [s.slug, s.coverUrl]));
    assert.equal(by.get('storytelling'), '/assets/video-styles/storytelling.jpg');
    assert.equal(by.get('documentary'), '/assets/video-styles/documentary.svg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const real = await callStyles();
  const frontendDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'video-styles');
  for (const s of real.body.styles) {
    const file = path.join(frontendDir, path.basename(s.coverUrl));
    assert.ok(fs.existsSync(file), `${s.coverUrl} exists`);
  }
});

// ---- cover script: only --dry-run and no flags are ever run ----
const SCRIPT = path.join(__dirname, '..', 'scripts', 'generate-hero-style-covers.js');

function runScript(args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-cover-guard-'));
  const guard = path.join(tmp, 'guard.js');
  // Preloaded into the child: any network attempt or image-helper load is recorded and blocked.
  fs.writeFileSync(guard, `
const Module = require('module');
const hits = [];
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (/geminiAI|openaiImage|sharp|dotenv/.test(String(req))) hits.push('load:' + req);
  return origLoad.apply(this, arguments);
};
const block = (name) => function () { hits.push('net:' + name); throw new Error('network blocked in test'); };
globalThis.fetch = block('fetch');
for (const m of ['http', 'https']) { const mod = require(m); mod.request = block(m); mod.get = block(m); }
process.on('exit', () => { process.stderr.write('\\nGUARD ' + JSON.stringify(hits) + '\\n'); });
`);
  const env = { ...process.env, NODE_OPTIONS: '' };
  for (const k of Object.keys(env)) if (/KEY|TOKEN|SECRET|MONGO/i.test(k)) delete env[k];
  try {
    const r = spawnSync(process.execPath, ['--require', guard, SCRIPT, ...args], { encoding: 'utf8', env, timeout: 20000 });
    const m = /GUARD (\[.*\])/.exec(r.stderr || '');
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', hits: m ? JSON.parse(m[1]) : null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function coverDirListing() {
  const d = path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'video-styles');
  return fs.readdirSync(d).sort().join(',');
}

test('cover script --dry-run prints 13 photographic 3:4 prompts and touches no API', () => {
  const before = coverDirListing();
  const r = runScript(['--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.hits, [], 'no image helper load and no network');
  const lines = r.stdout.split('\n').filter((l) => /^[a-z-]+: /.test(l));
  assert.equal(lines.length, 13, r.stdout);
  assert.deepEqual(lines.map((l) => l.split(':')[0]).sort(), [...SLUGS].sort());
  for (const l of lines) {
    const prompt = l.slice(l.indexOf(':') + 1);
    assert.match(prompt, /photograph/i, l);
    assert.match(prompt, /3:4/, l);
    assert.match(prompt, /no text/i, l);
    assert.doesNotMatch(prompt, /caption|subtitle|headline|lower-third|title card|typography|slogan|\bwords?\b/i, l);
    assert.doesNotMatch(prompt, /customer|review|celebrity/i, l);
    assert.doesNotMatch(prompt, /["\u201c\u201d]/, `${l}: no quoted label`);
    assert.doesNotMatch(prompt, /style card|video style/i, l);
    const productOnly = ['product-advertisement', 'product-showcase', 'luxury-advertisement'].includes(l.split(':')[0]);
    if (productOnly) assert.doesNotMatch(prompt, /skin texture|fictional/i, l);
    else assert.match(prompt, /fictional/i, l);
  }
  assert.equal(coverDirListing(), before, 'nothing written');
});

test('cover script without --confirm-spend exits non-zero before touching any API', () => {
  const before = coverDirListing();
  const r = runScript([]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--confirm-spend/);
  assert.deepEqual(r.hits, [], 'no image helper load and no network');
  assert.equal(r.stdout.trim(), '');
  assert.equal(coverDirListing(), before, 'nothing written');
});
