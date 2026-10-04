/**
 * Hero Studio: brief validation, server-side brand loading, reference selection and staging.
 * Imports without Mongo or network: models and the uploader are lazy-required (or injected).
 */
const { isPublicHttpsUrl } = require('./heroVideoService');

const MAX_CAST = 4;
const MAX_SCENES = 12;
const MAX_ENV_IMAGES = 5;
const MAX_REFS = 9;
const CAPS = { cast: 3, environment: 2, brand: 2, keyframe: 3 };
const MAX_DATA_BYTES = 6 * 1024 * 1024;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i;
const MAX_DATA_URL_CHARS = Math.ceil(MAX_DATA_BYTES * 4 / 3) + 64;
const ASPECTS = ['9:16', '16:9', '1:1'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : (typeof v === 'number' ? String(v).slice(0, max) : ''));
const pubUrl = (v) => (isPublicHttpsUrl(v) ? v.trim() : '');
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function dataUrlBytes(d) {
  const m = typeof d === 'string' ? d.match(DATA_URL_RE) : null;
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, '');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return { type: m[1].toLowerCase(), bytes: Math.floor(b64.length * 3 / 4) - pad };
}

function normalizeHeroBrief(raw) {
  if (!isObj(raw)) return { ok: false, message: 'The hero brief is missing. Go back to the wizard and try again.' };
  const castIn = Array.isArray(raw.cast) ? raw.cast.filter(isObj) : [];
  const cast = castIn.slice(0, MAX_CAST).map((c, i) => ({
    id: str(c.id, 80) || `cast-${i + 1}`, name: str(c.name, 80), age: str(c.age, 20), gender: str(c.gender, 30),
    role: str(c.role, 120), appearance: str(c.appearance, 500), clothing: str(c.clothing, 300),
    hairStyle: str(c.hairStyle, 120), hairColor: str(c.hairColor, 60), personality: str(c.personality, 300),
    portraitUrl: pubUrl(c.portraitUrl)
  }));
  if (!cast.length) return { ok: false, message: 'Create your cast first: finish the cast step, then make the hero video.' };
  const scenesIn = Array.isArray(raw.scenes) ? raw.scenes.filter(isObj) : [];
  const scenes = scenesIn.slice(0, MAX_SCENES).map((s, i) => {
    const d = Number(s.durationSeconds);
    return {
      sceneId: str(s.sceneId, 80) || `scene-${i + 1}`, title: str(s.title, 120), script: str(s.script, 800),
      visual: str(s.visual, 800), durationSeconds: Number.isFinite(d) ? Math.min(120, Math.max(0, d)) : 0,
      charactersRequired: (Array.isArray(s.charactersRequired) ? s.charactersRequired : []).slice(0, 8).map((x) => str(x, 80)).filter(Boolean),
      imageUrl: pubUrl(s.imageUrl)
    };
  });
  if (!scenes.length) return { ok: false, message: 'Write your script and scenes first: finish the script step, then make the hero video.' };
  const c = isObj(raw.concept) ? raw.concept : {};
  const env = isObj(raw.environment) ? raw.environment : {};
  const images = [];
  for (const im of (Array.isArray(env.images) ? env.images : []).slice(0, MAX_ENV_IMAGES)) {
    if (!isObj(im)) continue;
    const url = pubUrl(im.url);
    const dataUrl = !url && typeof im.dataUrl === 'string' && im.dataUrl.length <= MAX_DATA_URL_CHARS && DATA_URL_RE.test(im.dataUrl) ? im.dataUrl : '';
    if (url || dataUrl) images.push({ url, dataUrl, alt: str(im.alt, 120) });
  }
  return {
    ok: true,
    brief: {
      concept: { title: str(c.title, 200), storySummary: str(c.storySummary, 1500), coreEmotion: str(c.coreEmotion, 200), visualStyle: str(c.visualStyle, 400) },
      aspectRatio: ASPECTS.includes(raw.aspectRatio) ? raw.aspectRatio : '9:16',
      language: str(raw.language, 40) || 'English',
      cast, castSheetUrl: pubUrl(raw.castSheetUrl),
      environment: { enabled: env.enabled === true, notes: str(env.notes, 600), images },
      scenes
    }
  };
}

async function loadBrand(userId, deps = {}) {
  const brand = { name: '', website: '', industry: '', audience: '', icp: '', tone: [], heroProduct: '', logoUrl: '', colors: [], productImages: [] };
  try {
    const User = deps.User || require('../models/User');
    const user = await User.findById(userId).select('businessProfile brandAssets').lean();
    if (!user) return brand;
    const bp = user.businessProfile || {};
    const ba = user.brandAssets || {};
    brand.name = str(bp.name, 120);
    brand.website = str(bp.website, 200);
    brand.industry = str(bp.industry, 120);
    brand.audience = str(bp.targetAudience, 400);
    brand.icp = str(bp.targetCustomerProfile, 800);
    brand.tone = (Array.isArray(bp.brandVoice) ? bp.brandVoice : [bp.brandVoice]).map((t) => str(t, 60)).filter(Boolean).slice(0, 6);
    brand.heroProduct = str(bp.heroProduct, 200);
    brand.logoUrl = pubUrl(ba.logoUrl);
    brand.colors = (Array.isArray(ba.brandColors) ? ba.brandColors : []).map((x) => str(x, 20)).filter(Boolean).slice(0, 6);
    brand.productImages = (Array.isArray(ba.images) ? ba.images : [])
      .filter((im) => im && !im.isLogo && pubUrl(im.src))
      .slice(0, 6).map((im) => ({ url: pubUrl(im.src), alt: str(im.alt, 120) }));
    try {
      const BrandAsset = deps.BrandAsset || require('../models/BrandAsset');
      const assets = await BrandAsset.find({ user: userId, type: 'logo' }).sort({ isPrimary: -1, createdAt: -1 }).limit(3).lean();
      if (!brand.logoUrl) {
        const logo = (assets || []).find((a) => pubUrl(a && a.url));
        if (logo) brand.logoUrl = pubUrl(logo.url);
      }
    } catch (_) { /* logo collection is optional */ }
  } catch (_) { /* never throw: return what we have */ }
  return brand;
}

const UNSUPPORTED_IMAGE_EXT = /\.(svg|gif|avif|heic|heif|bmp|tiff?)$/i;
// fal accepts only jpeg/png/webp; judge by the URL path, ignoring any query string.
function hasUnsupportedImageType(url) {
  try { return UNSUPPORTED_IMAGE_EXT.test(new URL(String(url)).pathname); } catch (_) { return false; }
}

function selectReferences(brief, brand, opts = {}) {
  if (!isObj(brief)) return [];
  const b = isObj(brand) ? brand : {};
  const out = [];
  const seen = new Set();
  const counts = { cast: 0, environment: 0, brand: 0, keyframe: 0 };
  const add = (kind, label, url, source, dataUrl) => {
    const key = url || dataUrl;
    if (!key || (url && hasUnsupportedImageType(url)) || seen.has(key) || out.length >= MAX_REFS || counts[kind] >= CAPS[kind]) return;
    seen.add(key); counts[kind]++;
    const ref = { tag: '', kind, label: String(label || kind), url: url || '', source };
    if (!url && dataUrl) ref.dataUrl = dataUrl;
    out.push(ref);
  };
  const scenes = Array.isArray(brief.scenes) ? brief.scenes : [];
  const kept = Array.isArray(opts.keptSceneIds) ? scenes.filter((s) => opts.keptSceneIds.includes(s.sceneId)) : scenes;
  const cast = Array.isArray(brief.cast) ? brief.cast : [];
  const required = new Set(kept.flatMap((s) => s.charactersRequired || []));
  const ordered = [...cast.filter((c) => required.has(c.id)), ...cast.filter((c) => !required.has(c.id))];
  for (const c of ordered) add('cast', c.name || 'Character', c.portraitUrl, 'cast-portrait');
  if (!counts.cast) add('cast', 'Cast sheet', brief.castSheetUrl, 'cast-sheet');
  const env = brief.environment;
  if (env && env.enabled) for (const im of env.images || []) add('environment', im.alt || 'Location', im.url, 'environment', im.dataUrl);
  for (const p of b.productImages || []) add('brand', p.alt || 'Product', p.url, 'brand-product');
  add('brand', 'Logo', b.logoUrl, 'brand-logo');
  for (const s of kept) add('keyframe', s.title || s.sceneId, s.imageUrl, 'scene-keyframe');
  out.forEach((r, i) => { r.tag = `@image${i + 1}`; });
  return out;
}

async function stageReferences(refs, deps = {}) {
  const kept = [];
  const dropped = [];
  for (const r of Array.isArray(refs) ? refs : []) {
    if (!isObj(r)) continue;
    const label = r.label || r.kind || 'reference';
    const next = { ...r };
    if (r.dataUrl && !r.url) {
      const info = dataUrlBytes(r.dataUrl);
      if (!info) { dropped.push({ label, reason: 'Only PNG, JPEG or WebP images can be used as references.' }); continue; }
      if (info.bytes > MAX_DATA_BYTES) { dropped.push({ label, reason: 'The image is larger than 6 MB.' }); continue; }
      try {
        const upload = deps.uploadBase64Image || require('./imageUploader').uploadBase64Image;
        const res = await upload(r.dataUrl, 'nebula-hero-refs');
        if (!res || !res.success || !isPublicHttpsUrl(res.url)) throw new Error('upload failed');
        next.url = res.url;
        delete next.dataUrl;
      } catch (_) { dropped.push({ label, reason: 'The image could not be uploaded. Try again.' }); continue; }
    } else if (!isPublicHttpsUrl(r.url)) {
      dropped.push({ label, reason: 'The image address is not a public https link.' });
      continue;
    } else if (hasUnsupportedImageType(r.url)) {
      dropped.push({ label, reason: "This image type isn't supported, use a JPG, PNG or WebP photo" });
      continue;
    }
    kept.push(next);
  }
  const capped = kept.slice(0, MAX_REFS);
  for (const x of kept.slice(MAX_REFS)) dropped.push({ label: x.label, reason: 'At most 9 references can be used.' });
  capped.forEach((r, i) => { r.tag = `@image${i + 1}`; });
  return { refs: capped, dropped };
}

module.exports = { hasUnsupportedImageType, isPublicHttpsUrl, normalizeHeroBrief, loadBrand, selectReferences, stageReferences };
