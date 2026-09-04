const User = require('../models/User');
const Product = require('../models/Product');
const BrandAsset = require('../models/BrandAsset');
const BrandIntelligenceProfile = require('../models/BrandIntelligenceProfile');

/**
 * The "Brand Memory" context block fed to the content-writing prompts.
 *
 * The prompts describe a single library of everything the brand has —
 * identity, products, people, physical locations — and instruct the model to
 * use real assets instead of inventing substitutes. That library is real
 * (BrandIntelligenceProfile, Product, BrandAsset) but scattered across three
 * collections with different owners and field names, so this is the one
 * place that assembles it into the text block those prompts expect.
 *
 * Text only: this does not attach image bytes. It tells the model what
 * exists and roughly what it looks like, so the copy it writes matches what
 * the image step will actually be given as reference images later.
 *
 * A category with nothing in it is stated as empty rather than omitted or
 * invented — "No approved photos of your space yet" is honest; silence would
 * read as "don't know", and a fabricated founder photo would be worse.
 */
async function buildBrandMemoryBlock(userId) {
  if (!userId) return '';

  const [user, brandProfile, products, environmentAssets, logoAsset] = await Promise.all([
    User.findById(userId).select('companyName businessProfile').lean(),
    BrandIntelligenceProfile.findOne({ userId }).lean(),
    Product.find({ user: userId }).select('name type price currency description images imageUrl').limit(12).lean(),
    BrandAsset.find({ user: userId, type: 'environment' }).select('name url').limit(6).lean(),
    BrandAsset.findOne({ user: userId, type: 'logo' }).sort({ isPrimary: -1, createdAt: -1 }).lean()
  ]);

  const bp = user?.businessProfile || {};
  const assets = brandProfile?.assets || {};

  const lines = [];

  lines.push('BRAND IDENTITY');
  lines.push(`- Name: ${brandProfile?.brandName || user?.companyName || 'Not set'}`);
  lines.push(`- Industry: ${bp.industry || 'Not set'}`);
  if (brandProfile?.brandDescription) lines.push(`- Description: ${brandProfile.brandDescription}`);
  const tone = brandProfile?.detectedProfile?.tone || bp.brandVoice;
  lines.push(`- Tone: ${Array.isArray(tone) ? tone.join(', ') : (tone || 'professional')}`);
  if (assets.primaryColor || assets.secondaryColor) {
    lines.push(`- Brand colours: ${[assets.primaryColor, assets.secondaryColor].filter(Boolean).join(', ')}`);
  }
  if (assets.fontType) lines.push(`- Typography: ${assets.fontType}`);
  lines.push(`- Logo: ${logoAsset?.url ? 'Approved logo on file' : 'No logo uploaded yet'}`);

  lines.push('');
  lines.push('TARGET AUDIENCE / ICP');
  lines.push(`- ${bp.targetCustomerProfile || bp.targetAudience || 'Not defined — infer a reasonable audience from the brand and idea.'}`);

  lines.push('');
  lines.push('PRODUCTS AND SERVICES');
  if (products.length === 0) {
    lines.push('- None catalogued yet. Do not invent a specific product; keep the focus on the brand or the idea itself.');
  } else {
    products.forEach((p) => {
      const kind = p.type === 'service' ? 'Service' : 'Product';
      const hasImage = Boolean(p.imageUrl || (Array.isArray(p.images) && p.images.length));
      const price = p.price ? `, ${p.currency || '₹'}${p.price}` : '';
      const desc = p.description ? ` — ${String(p.description).slice(0, 140)}` : '';
      lines.push(`- [${kind}] ${p.name}${price}${desc} (${hasImage ? 'real image available' : 'no image on file'})`);
    });
  }

  lines.push('');
  lines.push('PHYSICAL LOCATIONS');
  if (environmentAssets.length === 0) {
    lines.push('- No approved photos of a shop, showroom, office or other space yet. Do not invent a specific real-world location.');
  } else {
    environmentAssets.forEach((e) => lines.push(`- ${e.name || 'Approved location photo'} (real image available)`));
  }

  lines.push('');
  lines.push('PEOPLE (founders, team, customers)');
  lines.push('- Not yet supported in Gravity. Do not depict a specific real founder, team member or customer — if a person is needed, keep them generic and unbranded.');

  return lines.join('\n');
}

/**
 * The literal inventory the Creative Director picks from.
 *
 * buildBrandMemoryBlock() describes the brand in prose, for understanding
 * tone and positioning. This is different on purpose: a flat, named list —
 * "product: Ultra Wireless Headphones", "environment: Showroom floor" — so
 * the Creative Director's requiredAssets/optionalAssets output can name an
 * entry from this exact list, and that name can be resolved straight back to
 * a real URL afterwards. Prose can't be resolved; a catalogue can.
 *
 * Returns both the text block for the prompt and the lookup map used to
 * resolve whatever the model names back to an actual asset.
 */
async function buildAvailableAssetsCatalogue(userId) {
  if (!userId) return { text: 'None on file.', catalogue: new Map() };

  const [products, environmentAssets, logoAsset] = await Promise.all([
    Product.find({ user: userId }).select('name type images imageUrl').limit(12).lean(),
    BrandAsset.find({ user: userId, type: 'environment' }).select('name url').limit(6).lean(),
    BrandAsset.findOne({ user: userId, type: 'logo' }).sort({ isPrimary: -1, createdAt: -1 }).lean()
  ]);

  const catalogue = new Map();
  const lines = [];

  products.forEach((p) => {
    const url = p.imageUrl || (Array.isArray(p.images) && p.images[0]) || '';
    if (!url) return;
    const kind = p.type === 'service' ? 'service' : 'product';
    const name = `${kind}: ${p.name}`;
    catalogue.set(name.toLowerCase(), { url, kind });
    lines.push(`- ${name}`);
  });

  environmentAssets.forEach((e) => {
    if (!e.url) return;
    const name = `location: ${e.name || 'Approved location photo'}`;
    catalogue.set(name.toLowerCase(), { url: e.url, kind: 'environment' });
    lines.push(`- ${name}`);
  });

  if (logoAsset?.url) {
    const name = 'logo: brand logo';
    catalogue.set(name.toLowerCase(), { url: logoAsset.url, kind: 'logo' });
    lines.push(`- ${name}`);
  }

  lines.push('- founders / team / customers: not available — Gravity does not store these yet');

  return { text: lines.length ? lines.join('\n') : 'None on file.', catalogue };
}

/**
 * Resolve the Creative Director's chosen asset names back to real URLs.
 *
 * The model names assets loosely ("product: Ultra Wireless Headphones", or
 * sometimes just "Ultra Wireless Headphones"), so this matches by substring
 * against the catalogue rather than demanding an exact key. Anything that
 * doesn't match anything real is dropped — the art director never receives a
 * reference to an asset that turned out not to exist.
 */
function resolveAssetNames(names, catalogue) {
  const resolved = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const needle = String(raw || '').trim().toLowerCase();
    if (!needle) continue;
    let hit = catalogue.get(needle);
    if (!hit) {
      for (const [key, value] of catalogue) {
        if (key.includes(needle) || needle.includes(key)) { hit = value; break; }
      }
    }
    if (hit) resolved.push({ label: raw, ...hit });
  }
  return resolved;
}

/**
 * The short version of brand guidance, for the image model. The Creative
 * Director gets the full narrative brand memory to make a good decision; the
 * image step only needs enough to render correctly — palette, whether a logo
 * exists, and the tone in one word. This is the concrete mechanism behind
 * "the image model should not receive the entire brand context": there are
 * two different context builders, and only this short one reaches it.
 */
async function buildBrandGuidance(userId) {
  if (!userId) return '';
  const [brandProfile, logoAsset] = await Promise.all([
    BrandIntelligenceProfile.findOne({ userId }).select('assets detectedProfile').lean(),
    BrandAsset.findOne({ user: userId, type: 'logo' }).sort({ isPrimary: -1, createdAt: -1 }).lean()
  ]);
  const assets = brandProfile?.assets || {};
  const parts = [];
  if (assets.primaryColor || assets.secondaryColor) {
    parts.push(`Brand colours: ${[assets.primaryColor, assets.secondaryColor].filter(Boolean).join(', ')} — use intelligently, not mechanically.`);
  }
  if (assets.fontType) parts.push(`Typography style: ${assets.fontType}.`);
  parts.push(brandProfile?.detectedProfile?.tone
    ? `Tone: ${brandProfile.detectedProfile.tone}.`
    : 'Tone: professional.');
  parts.push(logoAsset?.url ? 'A logo is available if this creative calls for it.' : 'No logo on file.');
  return parts.join(' ');
}

module.exports = {
  buildBrandMemoryBlock,
  buildAvailableAssetsCatalogue,
  resolveAssetNames,
  buildBrandGuidance
};
