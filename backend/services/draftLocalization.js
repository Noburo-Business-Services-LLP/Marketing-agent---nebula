// Turns one draft into extra-language drafts. Each language becomes its OWN new draft that needs
// approval; nothing is ever published here. The AI writing is done by the existing
// localizeCampaignContent (unchanged). That function has no price in config/apiCosts.js and the
// existing /api/content/localize-campaign route takes no Quarks, so this charges nothing either.
const mongoose = require('mongoose');
const { BASE_LANGUAGES, MAX_ADDITIONAL_LANGUAGES, baseOf, isBaseLanguage, languageLabel } = require('./languageSupport');

const reply = (status, json) => ({ status, json });
const failMessage = (code) => `We could not write the ${languageLabel(code)} version this time. Please try again.`;

function cleanRequest(languages) {
  if (!Array.isArray(languages) || languages.length === 0) return { error: 'Choose at least one language.' };
  const codes = [];
  for (const item of languages) {
    const code = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!isBaseLanguage(code)) return { error: 'One of the languages is not supported.' };
    if (!codes.includes(code)) codes.push(code);
  }
  if (codes.length > MAX_ADDITIONAL_LANGUAGES) return { error: `Choose at most ${MAX_ADDITIONAL_LANGUAGES} languages at a time.` };
  return { codes };
}

function buildVariant(source, code, localized) {
  const caption = String(localized.caption || '').trim();
  const hashtags = Array.isArray(localized.hashtags) ? localized.hashtags : [];
  const cta = String(localized.cta || '').trim();
  const creative = source.creative && typeof source.creative === 'object' ? { ...source.creative } : {};
  if ('textContent' in creative) creative.textContent = caption;
  if ('captions' in creative) creative.captions = caption;
  if ('hashtags' in creative) creative.hashtags = hashtags;
  if ('callToAction' in creative) creative.callToAction = cta;
  return {
    userId: source.userId,
    title: source.title,
    caption,
    hashtags,
    cta,
    // The picture is reused unchanged in Stage 1, so any text on it stays in the original language.
    imageUrl: source.imageUrl || '',
    imageUrlNoLogo: source.imageUrlNoLogo || '',
    logoApplied: Boolean(source.logoApplied),
    imagePrompt: source.imagePrompt || '',
    imageText: source.imageText || '',
    creativeConcept: source.creativeConcept || '',
    visualTreatment: source.visualTreatment || '',
    imagePromptResolved: source.imagePromptResolved || '',
    platforms: Array.isArray(source.platforms) ? [...source.platforms] : [],
    tone: source.tone || '',
    objective: source.objective || '',
    sourceType: source.sourceType,
    contentType: source.contentType,
    carouselSlides: Array.isArray(source.carouselSlides) ? source.carouselSlides.map((s) => ({ ...s })) : [],
    carouselStyleGuide: source.carouselStyleGuide || '',
    creative,
    // Not linked to the original's campaign or calendar slot, and not scheduled: it needs its own approval.
    campaignId: null,
    contentCalendarId: null,
    scheduledDate: null,
    status: 'draft',
    language: code,
    languageVariantOf: source._id,
  };
}

function createDraftLocalizer({ Draft, User, localize }) {
  return async function localizeDraft({ userId, draftId, languages }) {
    const request = cleanRequest(languages);
    if (request.error) return reply(400, { success: false, message: request.error });
    const notFound = reply(404, { success: false, message: 'Draft not found' });
    if (!userId || !mongoose.isValidObjectId(String(draftId))) return notFound;

    const found = await Draft.findOne({ _id: draftId, userId });
    if (!found) return notFound;
    const source = typeof found.toObject === 'function' ? found.toObject() : found;

    const own = baseOf(source.language);
    if (request.codes.includes(own)) {
      return reply(400, { success: false, message: `This post is already in ${languageLabel(own)}. Choose a different language.` });
    }

    const existing = await Draft.find({ userId, languageVariantOf: source._id, language: { $in: request.codes } });
    const existingByCode = new Map(existing.map((d) => [d.language, d]));
    const outcome = new Map();
    for (const [code, d] of existingByCode) {
      outcome.set(code, { language: code, ok: true, existing: true, draftId: String(d._id), message: 'This version already exists.' });
    }

    const missing = request.codes.filter((code) => !existingByCode.has(code));
    if (missing.length > 0) {
      let rows = [];
      try {
        const owner = await User.findById(userId).select('businessProfile');
        const bp = (owner && owner.businessProfile) || {};
        const voice = Array.isArray(bp.brandVoice) ? bp.brandVoice.join(', ') : String(bp.brandVoice || '');
        rows = await localize({
          brandName: bp.name || '',
          tone: source.tone || voice,
          audience: bp.targetAudience || '',
          brandDescription: bp.description || '',
          industry: bp.industry || '',
          keyMessage: source.caption,
          baseCaption: source.caption,
          platform: (source.platforms && source.platforms[0]) || '',
          localizations: missing.map((code) => ({ region: bp.businessLocation || '', language: languageLabel(code) })),
        });
      } catch (err) {
        console.error('Draft localisation failed:', err && err.message);
        rows = [];
      }
      if (!Array.isArray(rows)) rows = [];

      for (let i = 0; i < missing.length; i += 1) {
        const code = missing[i];
        const row = rows[i];
        if (!row || row.fallback === true || !String(row.caption || '').trim()) {
          outcome.set(code, { language: code, ok: false, message: failMessage(code) });
          continue;
        }
        try {
          const created = await Draft.create(buildVariant(source, code, row));
          outcome.set(code, { language: code, ok: true, draftId: String(created._id), draft: created });
        } catch (err) {
          if (err && err.code === 11000) {
            const again = await Draft.find({ userId, languageVariantOf: source._id, language: { $in: [code] } });
            if (again[0]) {
              outcome.set(code, { language: code, ok: true, existing: true, draftId: String(again[0]._id), message: 'This version already exists.' });
              continue;
            }
          }
          console.error('Draft localisation save failed:', err && err.message);
          outcome.set(code, { language: code, ok: false, message: failMessage(code) });
        }
      }
    }

    return reply(200, { success: true, results: request.codes.map((code) => outcome.get(code)) });
  };
}

module.exports = { createDraftLocalizer, BASE_LANGUAGES };
