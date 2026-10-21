'use strict';
/**
 * Brand assets of the demo account: the logo, the people (founder and two models) and the places (studio, shelf),
 * as BrandAsset rows with locally drawn pictures; plus the brand's colours and fonts on its BrandIntelligenceProfile
 * (the record Brand assets reads them from). Every BrandAsset row is tagged `cloudinaryPublicId: demo-zaya/...`.
 */
const images = require('./images');
const { BRAND, PALETTE, FONTS, PRODUCTS, CHARACTERS, PLACES } = require('./constants');
const { DEMO_TAG, assetUrl } = require('./safety');

const LOGO_REL = 'brand/logo.png';

/** What to draw and store. `draw` returns the picture; `rel` is its path under the demo folder. */
function assetSpecs() {
  return [
    { type: 'logo', name: `${BRAND.name} logo`, rel: LOGO_REL, format: 'png', isPrimary: true, draw: () => images.logoPng(512) },
    ...CHARACTERS.map((c) => ({ type: 'character', name: c.name, rel: `people/${c.slug}.jpg`, format: 'jpg', draw: () => images.portraitJpg(c) })),
    ...PLACES.map((p) => ({ type: 'environment', name: p.name, rel: `places/${p.slug}.jpg`, format: 'jpg', draw: () => images.placeJpg(p, PRODUCTS) })),
  ];
}

/** The BrandAsset row for one drawn picture. */
function assetRow(spec, { userId, base, buffer, createdAt }) {
  const size = images.imageSize(buffer) || { width: 0, height: 0 };
  return {
    user: userId, type: spec.type, name: spec.name, url: assetUrl(base, spec.rel),
    cloudinaryPublicId: `${DEMO_TAG}/${spec.rel}`, width: size.width, height: size.height, fileSize: buffer.length,
    format: spec.format, isPrimary: Boolean(spec.isPrimary), defaultPosition: 'top-right', defaultSize: 'medium', createdAt
  };
}

/** Colours and fonts as Brand assets shows them (BrandIntelligenceProfile, one per account). */
function intelligenceProfile({ userId, logoUrl }) {
  return {
    userId, brandName: BRAND.name, brandDescription: `${BRAND.description} ${BRAND.tagline}`,
    assets: { primaryLogoUrl: logoUrl, primaryColor: PALETTE.plum, secondaryColor: PALETTE.roseGold, fontType: FONTS.display.family },
    customProfile: { tone: 'luxury', writingStyle: 'storytelling', ctaStyle: 'soft', visualStyle: 'premium-luxury' },
    enforcementMode: 'adaptive', hasBrandAssets: true, isUserCustomized: true
  };
}

module.exports = { LOGO_REL, assetSpecs, assetRow, intelligenceProfile };
