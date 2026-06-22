const { callGemini, parseGeminiJSON } = require('./geminiAI');
const { uploadBase64Image, uploadBase64Audio } = require('./imageUploader');
const { composeImageToVideoWithAudio } = require('./mediaComposer');
const { getPublicBaseUrl, resolveToneAudioUrl } = require('../utils/toneAudio');

const REEL_PROMPT_TEMPLATES = {
  event_promotion: {
    key: 'event_promotion',
    label: 'Event Promotion',
    description: 'Sales, launches, announcements, openings, and limited-time events.',
    objective: 'traffic',
    tone: 'professional',
    promptTemplate:
      'Promote a business event with urgency and a clear value proposition. Mention date-driven urgency, key highlights, and a strong conversion CTA.'
  },
  celebration_festival: {
    key: 'celebration_festival',
    label: 'Celebration / Festival',
    description: 'Diwali, Pongal, New Year, cultural celebrations, and social functions.',
    objective: 'engagement',
    tone: 'fun',
    promptTemplate:
      'Create festive, warm, culturally positive content with celebration vibes, gratitude, and community-first messaging.'
  },
  product_promotion: {
    key: 'product_promotion',
    label: 'Product Promotion',
    description: 'Product selling, feature highlights, and promotional offers.',
    objective: 'sales',
    tone: 'professional',
    promptTemplate:
      'Focus on product benefits, feature-to-value translation, offer framing, and a purchase-oriented CTA.'
  },
  brand_awareness: {
    key: 'brand_awareness',
    label: 'Brand Awareness',
    description: 'General branding content to improve recognition and trust.',
    objective: 'awareness',
    tone: 'luxury',
    promptTemplate:
      'Build brand identity, trust, and recall. Keep messaging clear, memorable, and emotionally resonant.'
  },
  custom_normal: {
    key: 'custom_normal',
    label: 'Custom / Normal Prompt',
    description: 'Default reusable template with custom business intent.',
    objective: 'awareness',
    tone: 'normal',
    promptTemplate:
      'Create versatile, balanced social content suitable for regular posting with clear message, CTA, and branded tone.'
  }
};

const REEL_LANGUAGE_OPTIONS = [
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം' },
  { code: 'en', label: 'English', nativeLabel: 'English' }
];

const REEL_DURATION_OPTIONS = [10, 20, 30];
const GEMINI_TIMEOUT_MS = 90 * 1000;

function getReelGenerationOptions() {
  return {
    promptTypes: Object.values(REEL_PROMPT_TEMPLATES).map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description
    })),
    languages: REEL_LANGUAGE_OPTIONS,
    durations: REEL_DURATION_OPTIONS
  };
}

function normalizePromptType(rawPromptType) {
  const key = String(rawPromptType || '').trim().toLowerCase();
  return REEL_PROMPT_TEMPLATES[key] ? key : 'custom_normal';
}

function normalizeLanguage(rawLanguage) {
  const candidate = String(rawLanguage || '').trim().toLowerCase();
  const byCode = REEL_LANGUAGE_OPTIONS.find((lang) => lang.code.toLowerCase() === candidate);
  if (byCode) return byCode;

  const byLabel = REEL_LANGUAGE_OPTIONS.find((lang) => lang.label.toLowerCase() === candidate);
  if (byLabel) return byLabel;

  const byNative = REEL_LANGUAGE_OPTIONS.find((lang) => String(lang.nativeLabel || '').toLowerCase() === candidate);
  if (byNative) return byNative;

  return REEL_LANGUAGE_OPTIONS[0];
}

function normalizeDuration(rawDuration) {
  const n = Number.parseInt(String(rawDuration || ''), 10);
  return REEL_DURATION_OPTIONS.includes(n) ? n : 20;
}

function normalizeHashtags(rawHashtags = []) {
  if (!Array.isArray(rawHashtags)) return [];

  const hashtags = rawHashtags
    .map((tag) => String(tag || '').trim())
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .map((tag) => tag.replace(/[^#\p{L}\p{N}_]/gu, ''))
    .filter((tag) => tag.length > 1 && tag.length <= 40);

  return Array.from(new Set(hashtags)).slice(0, 15);
}

function splitSentenceChunks(text = '', chunkCount = 3) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return [];
  const words = compact.split(' ');
  if (words.length <= chunkCount) return [compact];

  const size = Math.max(4, Math.ceil(words.length / chunkCount));
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(' '));
  }
  return chunks.filter(Boolean);
}

function buildFallbackScenePlan({ durationSeconds, caption, voiceoverScript }) {
  const safeDuration = Math.max(3, Number.parseInt(String(durationSeconds || 10), 10) || 10);
  const chunkCount = safeDuration >= 24 ? 4 : 3;
  const lines = splitSentenceChunks(voiceoverScript || caption, chunkCount);
  const segment = safeDuration / chunkCount;

  const scenes = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const startSec = Number((segment * i).toFixed(2));
    const endSec = i === chunkCount - 1 ? safeDuration : Number((segment * (i + 1)).toFixed(2));
    scenes.push({
      sceneTitle: `Scene ${i + 1}`,
      startSec,
      endSec,
      visualDirection: 'Apply subtle zoom motion and smooth vertical framing for a reel-style look.',
      caption: lines[i] || lines[lines.length - 1] || caption
    });
  }
  return scenes;
}

function normalizeScenePlan(rawScenePlan, { durationSeconds, fallbackCaption }) {
  if (!Array.isArray(rawScenePlan) || rawScenePlan.length === 0) {
    return buildFallbackScenePlan({
      durationSeconds,
      caption: fallbackCaption,
      voiceoverScript: fallbackCaption
    });
  }

  const maxDuration = Math.max(3, Number(durationSeconds) || 10);
  const normalized = rawScenePlan
    .map((scene, index) => {
      const startRaw = Number(scene?.startSec);
      const endRaw = Number(scene?.endSec);
      const startSec = Number.isFinite(startRaw) ? Math.max(0, Math.min(startRaw, maxDuration)) : index * 2;
      const endSec = Number.isFinite(endRaw) ? Math.max(startSec + 0.4, Math.min(endRaw, maxDuration)) : Math.min(startSec + 2.5, maxDuration);
      const caption = String(scene?.caption || scene?.onScreenText || '').trim() || fallbackCaption;
      const visualDirection = String(scene?.visualDirection || '').trim() || 'Keep motion smooth and vertical for reels.';
      const sceneTitle = String(scene?.sceneTitle || scene?.title || `Scene ${index + 1}`).trim();

      return {
        sceneTitle,
        startSec: Number(startSec.toFixed(2)),
        endSec: Number(endSec.toFixed(2)),
        visualDirection,
        caption
      };
    })
    .sort((a, b) => a.startSec - b.startSec);

  if (normalized.length === 0) {
    return buildFallbackScenePlan({
      durationSeconds,
      caption: fallbackCaption,
      voiceoverScript: fallbackCaption
    });
  }

  const fixed = [];
  let cursor = 0;
  for (const scene of normalized) {
    const startSec = Math.max(cursor, scene.startSec);
    const endSec = Math.max(startSec + 0.4, Math.min(scene.endSec, maxDuration));
    fixed.push({
      ...scene,
      startSec: Number(startSec.toFixed(2)),
      endSec: Number(endSec.toFixed(2))
    });
    cursor = endSec;
    if (cursor >= maxDuration) break;
  }

  if (fixed.length === 0) {
    return buildFallbackScenePlan({
      durationSeconds,
      caption: fallbackCaption,
      voiceoverScript: fallbackCaption
    });
  }

  if (fixed[fixed.length - 1].endSec < maxDuration) {
    fixed[fixed.length - 1].endSec = maxDuration;
  }

  return fixed;
}

function inferCallToActionKey(cta, promptType) {
  const text = String(cta || '').toLowerCase();
  if (text.includes('shop') || text.includes('buy') || text.includes('order')) return 'shop_now';
  if (text.includes('book') || text.includes('reserve')) return 'book_now';
  if (text.includes('download')) return 'download';
  if (text.includes('quote') || text.includes('pricing')) return 'get_quote';
  if (text.includes('contact') || text.includes('call') || text.includes('message') || text.includes('dm')) return 'contact_us';
  if (text.includes('sign') || text.includes('register') || text.includes('join')) return 'sign_up';
  if (text.includes('watch') || text.includes('video')) return 'watch_more';

  if (promptType === 'product_promotion') return 'shop_now';
  if (promptType === 'event_promotion') return 'book_now';
  return 'learn_more';
}

function buildFallbackScript({ language, durationSeconds, promptMeta, customPrompt, businessProfile }) {
  const brandName = String(businessProfile?.name || businessProfile?.companyName || 'your brand').trim();
  const languageLabel = language?.label || 'Tamil';
  const intentHint = String(customPrompt || promptMeta?.label || 'marketing update').trim();
  const caption = `[${languageLabel}] ${brandName} - ${intentHint}. Discover what is new and take action today.`;
  const cta = `[${languageLabel}] Learn more today`;
  const hashtags = ['#Nebulaa', '#Marketing', '#Reel', '#Brand', '#Growth'];
  const voiceoverScript = `[${languageLabel}] ${brandName} presents ${intentHint}. Stay connected and explore now.`;
  const scenePlan = buildFallbackScenePlan({
    durationSeconds,
    caption,
    voiceoverScript
  });

  return {
    caption,
    cta,
    hashtags,
    voiceoverScript,
    scenePlan
  };
}

function buildTtsLanguageCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  const map = {
    ta: 'ta',
    te: 'te',
    hi: 'hi',
    kn: 'kn',
    ml: 'ml',
    en: 'en'
  };
  return map[normalized] || 'en';
}

function normalizeVoiceoverText(script = '') {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.,!?'"():-]/gu, '')
    .trim()
    .slice(0, 220);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function tryGenerateLocalizedVoiceoverAudio({ voiceoverScript, languageCode }) {
  try {
    const ttsText = normalizeVoiceoverText(voiceoverScript);
    if (!ttsText) return null;

    const tl = buildTtsLanguageCode(languageCode);
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText)}&tl=${encodeURIComponent(tl)}&client=tw-ob`;
    const response = await fetchWithTimeout(
      ttsUrl,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://translate.google.com/'
        }
      },
      20000
    );

    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer || buffer.length < 1500) return null;

    const base64Audio = `data:audio/mpeg;base64,${buffer.toString('base64')}`;
    const upload = await uploadBase64Audio(base64Audio, 'nebula-ai-reels/voiceovers');
    if (!upload?.success || !upload?.url) return null;
    return upload.url;
  } catch (_error) {
    return null;
  }
}

async function generateReelScript({
  promptType,
  promptMeta,
  language,
  durationSeconds,
  businessProfile = {},
  customPrompt = ''
}) {
  const brandName = String(businessProfile?.name || businessProfile?.companyName || '').trim() || 'the brand';
  const industry = String(businessProfile?.industry || 'business').trim();
  const targetAudience = String(businessProfile?.targetAudience || 'local audience').trim();
  const brandVoiceRaw = businessProfile?.brandVoice;
  const brandVoice = Array.isArray(brandVoiceRaw)
    ? String(brandVoiceRaw.join(', ')).trim()
    : String(brandVoiceRaw || 'professional').trim();
  const businessLocation = String(businessProfile?.businessLocation || '').trim();
  const niche = String(businessProfile?.niche || '').trim();
  const userIntent = String(customPrompt || '').trim();

  const prompt = `You are creating short-form marketing reel content.

Return STRICT JSON only with this schema:
{
  "caption": "string",
  "cta": "string",
  "hashtags": ["#hash1", "#hash2", "#hash3", "#hash4", "#hash5"],
  "voiceoverScript": "string",
  "scenePlan": [
    {
      "sceneTitle": "string",
      "startSec": 0,
      "endSec": 3.2,
      "visualDirection": "string",
      "caption": "string"
    }
  ]
}

Rules:
- Language for all text fields must be: ${language.label} (${language.nativeLabel}).
- Do not output English unless selected language is English.
- Caption must be platform-ready, natural, and conversion-aware.
- Include strong CTA text in cta.
- Hashtags must be relevant and valid hashtag strings.
- Scene plan must cover the full reel duration from 0 to ${durationSeconds} seconds.
- Use 3-6 scenes.
- Make scene instructions motion-friendly (zoom, pan, reveal, focus shift).

Business context:
- Brand: ${brandName}
- Industry: ${industry}
- Target Audience: ${targetAudience}
- Brand Voice: ${brandVoice}
- Location: ${businessLocation || 'Not specified'}
- Niche: ${niche || 'General'}

Prompt type: ${promptMeta.label}
Prompt template intent:
${promptMeta.promptTemplate}

${userIntent ? `Custom user intent: ${userIntent}` : ''}
`;

  try {
    const raw = await callGemini(prompt, {
      skipCache: true,
      temperature: 0.7,
      timeout: GEMINI_TIMEOUT_MS,
      maxTokens: 2200
    });

    const parsed = parseGeminiJSON(raw);
    const caption = String(parsed?.caption || '').trim();
    const cta = String(parsed?.cta || '').trim();
    const voiceoverScript = String(parsed?.voiceoverScript || '').trim() || caption;

    if (!caption) {
      throw new Error('Missing caption from AI response');
    }

    const hashtags = normalizeHashtags(parsed?.hashtags || []);
    const scenePlan = normalizeScenePlan(parsed?.scenePlan, {
      durationSeconds,
      fallbackCaption: caption
    });

    return {
      caption,
      cta: cta || caption,
      hashtags: hashtags.length > 0 ? hashtags : normalizeHashtags(['#Nebulaa', '#Marketing', '#Reel']),
      voiceoverScript,
      scenePlan
    };
  } catch (error) {
    console.warn('[Reel Generation] Falling back to template script:', error.message || error);
    return buildFallbackScript({
      language,
      durationSeconds,
      promptMeta,
      customPrompt,
      businessProfile
    });
  }
}

async function ensurePublicImageUrl({ imageData, imageUrl }) {
  const incomingUrl = String(imageUrl || '').trim();
  const incomingData = String(imageData || '').trim();

  if (incomingData) {
    const upload = await uploadBase64Image(incomingData, 'nebula-ai-reels/source-images');
    if (!upload?.success || !upload?.url) {
      throw new Error(upload?.error || 'Failed to upload reel source image');
    }
    return upload.url;
  }

  if (incomingUrl && /^https?:\/\//i.test(incomingUrl)) {
    return incomingUrl;
  }

  throw new Error('A valid imageData or public imageUrl is required');
}

async function generateReelFromImage({
  imageData,
  imageUrl,
  promptType,
  language,
  durationSeconds,
  customPrompt = '',
  businessProfile = {},
  req
}) {
  const normalizedPromptType = normalizePromptType(promptType);
  const promptMeta = REEL_PROMPT_TEMPLATES[normalizedPromptType];
  const normalizedLanguage = normalizeLanguage(language);
  const normalizedDuration = normalizeDuration(durationSeconds);

  const publicImageUrl = await ensurePublicImageUrl({ imageData, imageUrl });

  const script = await generateReelScript({
    promptType: normalizedPromptType,
    promptMeta,
    language: normalizedLanguage,
    durationSeconds: normalizedDuration,
    businessProfile,
    customPrompt
  });

  const baseUrl = getPublicBaseUrl({ req });
  const localizedVoiceoverUrl = await tryGenerateLocalizedVoiceoverAudio({
    voiceoverScript: script.voiceoverScript,
    languageCode: normalizedLanguage.code
  });

  const audioUrl = localizedVoiceoverUrl || resolveToneAudioUrl(promptMeta.tone, { baseUrl });
  if (!audioUrl) {
    throw new Error('Could not resolve reel audio track');
  }

  const composed = await composeImageToVideoWithAudio({
    imageUrl: publicImageUrl,
    audioUrl,
    requestedDurationSeconds: normalizedDuration,
    cloudinaryFolder: 'nebula-ai-reels/videos',
    motionEffect: 'ken_burns'
  });

  if (!composed?.success || !composed?.videoUrl) {
    const reason = composed?.error || 'FFmpeg composition failed';
    const error = new Error(reason);
    error.details = {
      metadata: composed?.metadata || null,
      validation: composed?.validation || null,
      audioValidation: composed?.audioValidation || null
    };
    throw error;
  }

  return {
    promptType: normalizedPromptType,
    prompt: promptMeta,
    language: normalizedLanguage,
    durationSeconds: normalizedDuration,
    sourceImageUrl: publicImageUrl,
    audioUrl,
    audioMode: localizedVoiceoverUrl ? 'localized_voiceover' : 'tone_track',
    script: {
      ...script,
      scenePlan: normalizeScenePlan(script.scenePlan, {
        durationSeconds: normalizedDuration,
        fallbackCaption: script.caption
      })
    },
    video: {
      url: composed.videoUrl,
      duration: composed.duration || null,
      bytes: composed.bytes || null,
      publicId: composed.publicId || null,
      metadata: composed.metadata || null,
      validation: composed.validation || null
    },
    callToActionKey: inferCallToActionKey(script.cta, normalizedPromptType),
    tone: promptMeta.tone,
    objective: promptMeta.objective
  };
}

module.exports = {
  REEL_PROMPT_TEMPLATES,
  REEL_LANGUAGE_OPTIONS,
  REEL_DURATION_OPTIONS,
  getReelGenerationOptions,
  normalizePromptType,
  normalizeLanguage,
  normalizeDuration,
  generateReelFromImage
};
