function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeHexColor(color) {
  const raw = String(color || '').trim();
  if (!raw) return '';
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  const short = /^#([0-9a-fA-F]{3})$/.exec(withHash);
  if (short) {
    const triplet = short[1];
    return `#${triplet[0]}${triplet[0]}${triplet[1]}${triplet[1]}${triplet[2]}${triplet[2]}`.toUpperCase();
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(withHash);
  if (!full) return '';
  return `#${full[1].toUpperCase()}`;
}

const DEFAULT_PRIMARY_COLOR = '#111111';
const DEFAULT_SECONDARY_COLOR = '#FFCC29';

const NAMED_COLORS = Object.freeze({
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  orange: '#FFA500',
  purple: '#800080',
  pink: '#FFC0CB',
  gray: '#808080',
  grey: '#808080',
  silver: '#C0C0C0',
  navy: '#000080',
  teal: '#008080',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  brown: '#A52A2A',
  maroon: '#800000',
  olive: '#808000',
  gold: '#FFD700'
});

const NAMED_COLOR_PATTERN = Object.keys(NAMED_COLORS).join('|');
const COLOR_TOKEN_REGEX = new RegExp(
  `#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|\\b(?:${NAMED_COLOR_PATTERN})\\b`,
  'gi'
);

function clampByte(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHexToRgb(color) {
  const hex = normalizeHexColor(color);
  if (!hex) return null;
  const v = hex.slice(1);
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  return (
    '#' +
    [clampByte(r), clampByte(g), clampByte(b)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function hslToRgb(h, s, l) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, Number(s)));
  const light = Math.max(0, Math.min(1, Number(l)));

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}

function rgbToHsl(r, g, b) {
  const rn = clampByte(r) / 255;
  const gn = clampByte(g) / 255;
  const bn = clampByte(b) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
  }
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function normalizeCssColor(color) {
  const raw = String(color || '').trim().toLowerCase();
  if (!raw) return '';

  const direct = normalizeHexColor(raw);
  if (direct) return direct;

  const hexWithAlpha = /^#([0-9a-f]{8})$/i.exec(raw);
  if (hexWithAlpha) return normalizeHexColor(`#${hexWithAlpha[1].slice(0, 6)}`);

  const named = NAMED_COLORS[raw];
  if (named) return named;

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(raw);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((p) => p.trim());
    if (parts.length < 3) return '';
    const parsePart = (part) => {
      if (part.endsWith('%')) {
        const pct = Number(part.slice(0, -1));
        if (!Number.isFinite(pct)) return null;
        return clampByte((pct / 100) * 255);
      }
      const n = Number(part);
      if (!Number.isFinite(n)) return null;
      return clampByte(n);
    };
    const r = parsePart(parts[0]);
    const g = parsePart(parts[1]);
    const b = parsePart(parts[2]);
    if (r === null || g === null || b === null) return '';

    if (parts.length >= 4) {
      const alpha = Number(parts[3]);
      if (Number.isFinite(alpha) && alpha <= 0.03) return '';
    }
    return rgbToHex(r, g, b);
  }

  const hslMatch = /^hsla?\(([^)]+)\)$/.exec(raw);
  if (hslMatch) {
    const parts = hslMatch[1].split(',').map((p) => p.trim());
    if (parts.length < 3) return '';
    const h = Number(parts[0].replace('deg', ''));
    const sRaw = parts[1].endsWith('%') ? Number(parts[1].slice(0, -1)) / 100 : Number(parts[1]);
    const lRaw = parts[2].endsWith('%') ? Number(parts[2].slice(0, -1)) / 100 : Number(parts[2]);
    if (!Number.isFinite(h) || !Number.isFinite(sRaw) || !Number.isFinite(lRaw)) return '';

    if (parts.length >= 4) {
      const alpha = Number(parts[3]);
      if (Number.isFinite(alpha) && alpha <= 0.03) return '';
    }
    const rgb = hslToRgb(h, sRaw, lRaw);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  return '';
}

function extractColorTokens(text = '') {
  const raw = String(text || '');
  const found = raw.match(COLOR_TOKEN_REGEX);
  return Array.isArray(found) ? found : [];
}

function getColorStats(hexColor) {
  const rgb = parseHexToRgb(hexColor);
  if (!rgb) return { saturation: 0, luminance: 0 };
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const rn = rgb.r / 255;
  const gn = rgb.g / 255;
  const bn = rgb.b / 255;
  const luminance = 0.2126 * rn + 0.7152 * gn + 0.0722 * bn;
  return { saturation: hsl.s, luminance };
}

function isNeutralColor(hexColor) {
  const { saturation, luminance } = getColorStats(hexColor);
  return saturation < 0.13 || luminance > 0.97 || luminance < 0.04;
}

function colorDistance(hexA, hexB) {
  const a = parseHexToRgb(hexA);
  const b = parseHexToRgb(hexB);
  if (!a || !b) return 0;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function addColorWeight(buckets, color, weight) {
  const hex = normalizeCssColor(color);
  if (!hex) return;
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return;
  buckets[hex] = (buckets[hex] || 0) + w;
}

function extractColorsFromDeclarations(declarations = '', baseWeight = 0, buckets = {}) {
  const declarationRegex = /(background(?:-color)?|color|border(?:-color)?|fill|stroke)\s*:\s*([^;}{]+)\s*;?/gi;
  let match;
  while ((match = declarationRegex.exec(String(declarations || ''))) !== null) {
    const property = String(match[1] || '').toLowerCase();
    const value = String(match[2] || '');
    const propWeight =
      property.startsWith('background') ? 7 :
      property.startsWith('color') ? 4 :
      property.startsWith('border') ? 2 :
      property === 'fill' ? 3 : 1;

    extractColorTokens(value).forEach((token) => {
      addColorWeight(buckets, token, baseWeight + propWeight);
    });
  }
}

function deriveSecondaryColor(primaryColor) {
  const rgb = parseHexToRgb(primaryColor);
  if (!rgb) return DEFAULT_SECONDARY_COLOR;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const shiftedHue = (hsl.h + 34) % 360;
  const sat = Math.max(0.45, Math.min(0.85, hsl.s || 0.55));
  const light = hsl.l > 0.6 ? Math.max(0.34, hsl.l - 0.26) : Math.min(0.68, hsl.l + 0.24);
  const derivedRgb = hslToRgb(shiftedHue, sat, light);
  return rgbToHex(derivedRgb.r, derivedRgb.g, derivedRgb.b);
}

function ensureDistinctSecondary(primaryColor, secondaryColor) {
  const normalizedPrimary = normalizeHexColor(primaryColor) || DEFAULT_PRIMARY_COLOR;
  const normalizedSecondary = normalizeHexColor(secondaryColor);
  if (!normalizedSecondary) return deriveSecondaryColor(normalizedPrimary);
  if (normalizedSecondary === normalizedPrimary || colorDistance(normalizedPrimary, normalizedSecondary) < 26) {
    return deriveSecondaryColor(normalizedPrimary);
  }
  return normalizedSecondary;
}

function rankWebsiteColors({ html = '', parsed = {} } = {}) {
  const buckets = {};
  const rawHtml = String(html || '');

  const parsedBrandColors = Array.isArray(parsed?.brandColors) ? parsed.brandColors : [];
  parsedBrandColors.forEach((color) => addColorWeight(buckets, color, 4));

  const themeMatches = rawHtml.match(
    /<meta[^>]*name=["'](?:theme-color|msapplication-tilecolor)["'][^>]*content=["']([^"']+)["']/gi
  ) || [];
  themeMatches.forEach((tag) => {
    const contentMatch = tag.match(/content=["']([^"']+)["']/i);
    if (contentMatch?.[1]) addColorWeight(buckets, contentMatch[1], 24);
  });

  const variableRegex = /--([a-z0-9_-]+)\s*:\s*([^;}{]+)\s*;?/gi;
  let variableMatch;
  while ((variableMatch = variableRegex.exec(rawHtml)) !== null) {
    const varName = String(variableMatch[1] || '').toLowerCase();
    const value = String(variableMatch[2] || '');
    const baseWeight =
      /(primary|brand|main)/.test(varName) ? 17 :
      /(secondary|accent)/.test(varName) ? 14 :
      /(link|cta|button)/.test(varName) ? 12 : 6;
    extractColorTokens(value).forEach((token) => addColorWeight(buckets, token, baseWeight));
  }

  const styleBlocks = rawHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (const block of styleBlocks) {
    const cssText = String(block[1] || '');
    const cssRuleRegex = /([^{}]+)\{([^{}]+)\}/g;
    let rule;
    while ((rule = cssRuleRegex.exec(cssText)) !== null) {
      const selector = String(rule[1] || '').toLowerCase();
      const declarations = String(rule[2] || '');
      let contextWeight = 4;
      if (/(button|\.btn|cta|submit|primary-btn)/.test(selector)) contextWeight += 12;
      if (/(header|nav|menu|hero)/.test(selector)) contextWeight += 10;
      if (/(\ba\b|link)/.test(selector)) contextWeight += 8;
      if (/(primary|brand|main)/.test(selector)) contextWeight += 7;
      if (/(secondary|accent)/.test(selector)) contextWeight += 5;
      extractColorsFromDeclarations(declarations, contextWeight, buckets);
    }
  }

  const inlineStyleRegex = /<([a-z0-9]+)([^>]*)style=["']([^"']+)["'][^>]*>/gi;
  let inlineMatch;
  while ((inlineMatch = inlineStyleRegex.exec(rawHtml)) !== null) {
    const tagName = String(inlineMatch[1] || '').toLowerCase();
    const attrs = String(inlineMatch[2] || '').toLowerCase();
    const declaration = String(inlineMatch[3] || '');
    let contextWeight = 5;
    if (tagName === 'button' || /\bbtn\b|\bcta\b/.test(attrs)) contextWeight += 13;
    if (tagName === 'a') contextWeight += 9;
    if (tagName === 'header' || tagName === 'nav') contextWeight += 10;
    if (/\bprimary\b|\bbrand\b/.test(attrs)) contextWeight += 6;
    if (/\bsecondary\b|\baccent\b/.test(attrs)) contextWeight += 4;
    extractColorsFromDeclarations(declaration, contextWeight, buckets);
  }

  return Object.entries(buckets)
    .map(([color, score]) => ({
      color,
      score: Number(score) || 0,
      neutral: isNeutralColor(color)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

function computeWebsiteConfidence({
  ranked = [],
  primaryFromWebsite = false,
  secondaryFromWebsite = false
} = {}) {
  if (!ranked.length) return 0;
  const top = ranked.slice(0, 8);
  const totalScore = top.reduce((sum, entry) => sum + entry.score, 0);
  const diversity = top.length;
  let confidence = 56 + Math.min(26, Math.round(totalScore / 18)) + Math.min(9, diversity);
  if (!primaryFromWebsite) confidence -= 8;
  if (!secondaryFromWebsite) confidence -= 6;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function buildManualColorResponse(primaryColor = '', secondaryColor = '', reason = '') {
  const manualPrimary = normalizeHexColor(primaryColor);
  const manualSecondary = normalizeHexColor(secondaryColor);
  const primary = manualPrimary || DEFAULT_PRIMARY_COLOR;
  const secondary = ensureDistinctSecondary(primary, manualSecondary || DEFAULT_SECONDARY_COLOR);
  const confidence =
    manualPrimary && manualSecondary ? 96 :
    manualPrimary || manualSecondary ? 84 : 68;

  return {
    primary_color: primary,
    secondary_color: secondary,
    source: 'manual',
    confidence,
    reason: reason || 'Used manually provided colors because website color signals were unavailable.'
  };
}

async function determineBrandColors({
  websiteUrl = '',
  primaryColor = '',
  secondaryColor = '',
  scrapeWebsite = null
} = {}) {
  const websiteInput = String(websiteUrl || '').trim();
  const manualPrimary = normalizeHexColor(primaryColor);
  const manualSecondary = normalizeHexColor(secondaryColor);

  if (!websiteInput) {
    return buildManualColorResponse(
      manualPrimary,
      manualSecondary,
      'No website URL was provided, so manual colors were used.'
    );
  }

  if (typeof scrapeWebsite !== 'function') {
    return buildManualColorResponse(
      manualPrimary,
      manualSecondary,
      'Website analysis is unavailable, so manual colors were used.'
    );
  }

  let normalizedUrl = websiteInput;
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch (error) {
    return buildManualColorResponse(
      manualPrimary,
      manualSecondary,
      'Website URL was invalid, so manual colors were used.'
    );
  }

  try {
    const scrapeResult = await scrapeWebsite(parsedUrl.origin);
    if (!scrapeResult?.success) {
      return buildManualColorResponse(
        manualPrimary,
        manualSecondary,
        'Website could not be analyzed, so manual colors were used.'
      );
    }

    const ranked = rankWebsiteColors({
      html: scrapeResult?.data || scrapeResult?.raw || '',
      parsed: scrapeResult?.parsed || {}
    });

    const nonNeutral = ranked.filter((entry) => !entry.neutral);
    const primaryCandidate = nonNeutral[0]?.color || ranked[0]?.color || '';
    const secondaryPool = ranked.filter((entry) => entry.color !== primaryCandidate);
    const contrastingSecondary =
      secondaryPool.find((entry) => colorDistance(primaryCandidate, entry.color) >= 60)?.color ||
      secondaryPool[0]?.color ||
      '';

    if (!primaryCandidate) {
      return buildManualColorResponse(
        manualPrimary,
        manualSecondary,
        'No reliable website colors were detected, so manual colors were used.'
      );
    }

    const primary = primaryCandidate;
    const secondary = ensureDistinctSecondary(
      primary,
      contrastingSecondary || manualSecondary || DEFAULT_SECONDARY_COLOR
    );
    const primaryFromWebsite = Boolean(primaryCandidate);
    const secondaryFromWebsite = Boolean(contrastingSecondary);
    const confidence = computeWebsiteConfidence({
      ranked,
      primaryFromWebsite,
      secondaryFromWebsite
    });

    return {
      primary_color: primary,
      secondary_color: secondary,
      source: 'website',
      confidence: confidence || 72,
      reason: 'Colors were extracted from website UI signals (theme, buttons, headers, links, and CSS).'
    };
  } catch (error) {
    return buildManualColorResponse(
      manualPrimary,
      manualSecondary,
      'Website analysis failed, so manual colors were used.'
    );
  }
}

function normalizeToneValue(value) {
  const t = String(value || '').trim().toLowerCase();
  if (!t) return '';
  if (['fun', 'playful', 'casual', 'humorous'].includes(t)) return 'fun';
  if (['professional', 'formal', 'corporate', 'serious'].includes(t)) return 'professional';
  if (['luxury', 'luxurious', 'premium', 'elegant'].includes(t)) return 'luxury';
  if (['minimal', 'simple'].includes(t)) return 'simple';
  if (['normal', 'balanced', 'neutral'].includes(t)) return 'normal';
  return t;
}

function toText(value) {
  return String(value || '').trim();
}

function normalizePastPost(post = {}) {
  return {
    source: ['uploaded', 'campaign_history'].includes(String(post.source || '')) ? post.source : 'uploaded',
    platform: String(post.platform || 'instagram').trim().toLowerCase() || 'instagram',
    caption: toText(post.caption),
    imageUrl: toText(post.imageUrl),
    cloudinaryPublicId: toText(post.cloudinaryPublicId),
    campaignId: post.campaignId || null,
    postedAt: post.postedAt || null
  };
}

function pickTopEntries(counter, max = 5) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([value, count]) => ({ value, count }));
}

function extractHashtags(text = '') {
  const tags = String(text).match(/#[A-Za-z0-9_]+/g);
  return Array.isArray(tags) ? tags.map((t) => t.toLowerCase()) : [];
}

function detectWritingStyle(captions = []) {
  if (!captions.length) {
    return { value: 'formal', confidence: 0.35 };
  }

  const totalChars = captions.reduce((acc, c) => acc + c.length, 0);
  const avgChars = totalChars / captions.length;
  const avgLineBreaks =
    captions.reduce((acc, c) => acc + (String(c).match(/\n/g)?.length || 0), 0) / captions.length;
  const questionRatio =
    captions.filter((c) => String(c).includes('?')).length / captions.length;

  let value = 'formal';
  let confidence = 0.55;

  if (avgChars < 120 && avgLineBreaks <= 1.2) {
    value = 'short';
    confidence = 0.72;
  } else if (avgChars >= 220 || avgLineBreaks >= 3) {
    value = 'storytelling';
    confidence = 0.76;
  } else if (questionRatio > 0.4) {
    value = 'casual';
    confidence = 0.66;
  } else {
    value = 'formal';
    confidence = 0.64;
  }

  return { value, confidence };
}

function detectCtaStyle(captions = []) {
  if (!captions.length) {
    return { value: 'balanced', confidence: 0.35 };
  }

  const text = captions.join('\n').toLowerCase();
  const score = {
    direct: 0,
    soft: 0,
    community: 0,
    value_first: 0
  };

  ['buy now', 'shop now', 'book now', 'sign up', 'order now', 'get started'].forEach((k) => {
    if (text.includes(k)) score.direct += 2;
  });
  ['learn more', 'discover', 'read more', 'explore', 'see details'].forEach((k) => {
    if (text.includes(k)) score.soft += 2;
  });
  ['comment', 'dm us', 'tag a friend', 'share this', 'tell us'].forEach((k) => {
    if (text.includes(k)) score.community += 2;
  });
  ['tips', 'guide', 'how to', 'save this', 'insight'].forEach((k) => {
    if (text.includes(k)) score.value_first += 2;
  });

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const winner = ranked[0]?.[0] || 'balanced';
  const winnerScore = ranked[0]?.[1] || 0;
  const runnerUp = ranked[1]?.[1] || 0;
  const confidence = clamp01(0.45 + (winnerScore - runnerUp) * 0.08 + Math.min(captions.length, 8) * 0.03);

  return {
    value: winnerScore > 0 ? winner : 'balanced',
    confidence
  };
}

function detectTone({
  brandDescription = '',
  captions = [],
  brandVoiceHint = ''
} = {}) {
  const corpus = `${brandDescription}\n${captions.join('\n')}\n${brandVoiceHint}`.toLowerCase();
  const score = {
    fun: 0,
    professional: 0,
    luxury: 0,
    normal: 0,
    simple: 0
  };

  const dictionary = {
    fun: ['fun', 'playful', 'excited', 'lol', 'haha', 'vibe', 'awesome', 'amazing', 'party'],
    professional: ['professional', 'strategy', 'business', 'analysis', 'executive', 'official', 'results'],
    luxury: ['luxury', 'premium', 'exclusive', 'elegant', 'sophisticated', 'high-end', 'elite'],
    normal: ['balanced', 'everyday', 'practical', 'clear', 'friendly'],
    simple: ['simple', 'minimal', 'clean', 'easy', 'straightforward', 'minimalist']
  };

  Object.entries(dictionary).forEach(([tone, keywords]) => {
    keywords.forEach((k) => {
      if (corpus.includes(k)) score[tone] += 2;
    });
  });

  const toneHint = normalizeToneValue(brandVoiceHint);
  if (toneHint && score[toneHint] !== undefined) {
    score[toneHint] += 4;
  }

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const winner = ranked[0]?.[0] || 'professional';
  const winnerScore = ranked[0]?.[1] || 0;
  const runnerUp = ranked[1]?.[1] || 0;

  const sampleBoost = Math.min(captions.length, 10) * 0.025;
  const confidence = clamp01(0.45 + (winnerScore - runnerUp) * 0.06 + sampleBoost);
  return { value: winner, confidence };
}

function detectVisualStyle({
  primaryColor = '',
  secondaryColor = '',
  fontType = '',
  captions = []
} = {}) {
  const p = normalizeHexColor(primaryColor);
  const s = normalizeHexColor(secondaryColor);
  const font = String(fontType || '').toLowerCase();
  const textBlob = captions.join(' ').toLowerCase();

  let value = 'clean-minimal';
  let confidence = 0.5;

  if ((p === '#000000' || p === '#111111' || p === '#1A1A1A') && (s === '#D4AF37' || s === '#C9A227')) {
    value = 'premium-luxury';
    confidence = 0.82;
  } else if (font.includes('serif') || font.includes('playfair') || font.includes('garamond')) {
    value = 'premium-luxury';
    confidence = 0.73;
  } else if (
    ['#FF4D4F', '#FF6B6B', '#FFCC29', '#00C2FF', '#7C3AED'].includes(p) ||
    textBlob.includes('bold') ||
    textBlob.includes('vibrant')
  ) {
    value = 'vibrant-playful';
    confidence = 0.72;
  } else if (font.includes('mono') || font.includes('inter') || font.includes('sans')) {
    value = 'clean-minimal';
    confidence = 0.67;
  }

  return { value, confidence };
}

function computePatternSummary(pastPosts = []) {
  const posts = Array.isArray(pastPosts) ? pastPosts.map(normalizePastPost) : [];
  const captions = posts.map((p) => p.caption).filter(Boolean);

  const hashtagCounter = {};
  const openerCounter = {};
  const ctaExamples = [];
  let totalChars = 0;
  let totalLineBreaks = 0;

  captions.forEach((caption) => {
    const c = String(caption);
    totalChars += c.length;
    totalLineBreaks += c.match(/\n/g)?.length || 0;

    extractHashtags(c).forEach((tag) => {
      hashtagCounter[tag] = (hashtagCounter[tag] || 0) + 1;
    });

    const opener = c.split('\n')[0].split(' ').slice(0, 4).join(' ').trim().toLowerCase();
    if (opener) openerCounter[opener] = (openerCounter[opener] || 0) + 1;

    if (/(learn more|shop now|sign up|book now|comment|dm|read more|discover)/i.test(c)) {
      const line = c
        .split('\n')
        .find((l) => /(learn more|shop now|sign up|book now|comment|dm|read more|discover)/i.test(l));
      if (line) ctaExamples.push(line.trim());
    }
  });

  const avgCaptionLength = captions.length ? Math.round(totalChars / captions.length) : 0;
  const avgLineBreaks = captions.length ? Number((totalLineBreaks / captions.length).toFixed(2)) : 0;

  const formatSignals = [];
  if (captions.some((c) => /\n[-*•]\s/.test(c))) formatSignals.push('bullet-points');
  if (captions.some((c) => c.includes('?'))) formatSignals.push('question-hook');
  if (avgLineBreaks >= 2) formatSignals.push('multi-line');
  if (avgCaptionLength <= 120) formatSignals.push('short-form');
  if (avgCaptionLength >= 220) formatSignals.push('long-form');

  return {
    totals: {
      posts: posts.length,
      withCaption: captions.length,
      withImage: posts.filter((p) => p.imageUrl).length
    },
    captionMetrics: {
      avgCaptionLength,
      avgLineBreaks
    },
    topHashtags: pickTopEntries(hashtagCounter, 8),
    commonOpeners: pickTopEntries(openerCounter, 6),
    ctaExamples: Array.from(new Set(ctaExamples)).slice(0, 6),
    formatSignals
  };
}

function analyzeBrandInputs({
  brandName = '',
  brandDescription = '',
  primaryColor = '',
  secondaryColor = '',
  fontType = '',
  pastPosts = [],
  businessProfile = {}
} = {}) {
  const normalizedPosts = Array.isArray(pastPosts) ? pastPosts.map(normalizePastPost) : [];
  const captions = normalizedPosts.map((p) => p.caption).filter(Boolean);
  const voiceHint = Array.isArray(businessProfile?.brandVoice)
    ? businessProfile.brandVoice.join(' ')
    : String(businessProfile?.brandVoice || '');

  const tone = detectTone({ brandDescription, captions, brandVoiceHint: voiceHint });
  const writingStyle = detectWritingStyle(captions);
  const ctaStyle = detectCtaStyle(captions);
  const visualStyle = detectVisualStyle({ primaryColor, secondaryColor, fontType, captions });
  const patterns = computePatternSummary(normalizedPosts);

  const hasBrandAssets = Boolean(
    toText(brandName) ||
      toText(brandDescription) ||
      normalizeHexColor(primaryColor) ||
      normalizeHexColor(secondaryColor) ||
      toText(fontType)
  );
  const hasPastPosts = normalizedPosts.length > 0;

  const completenessParts = [
    toText(brandName) ? 1 : 0,
    toText(brandDescription) ? 1 : 0,
    normalizeHexColor(primaryColor) ? 1 : 0,
    normalizeHexColor(secondaryColor) ? 1 : 0,
    toText(fontType) ? 1 : 0,
    hasPastPosts ? 1 : 0
  ];
  const completeness = completenessParts.reduce((a, b) => a + b, 0) / completenessParts.length;

  const overall = clamp01(
    tone.confidence * 0.27 +
      writingStyle.confidence * 0.25 +
      ctaStyle.confidence * 0.2 +
      visualStyle.confidence * 0.2 +
      completeness * 0.08
  );

  return {
    detectedProfile: {
      tone: tone.value,
      writingStyle: writingStyle.value,
      ctaStyle: ctaStyle.value,
      visualStyle: visualStyle.value
    },
    confidence: {
      tone: clamp01(tone.confidence),
      writingStyle: clamp01(writingStyle.confidence),
      ctaStyle: clamp01(ctaStyle.confidence),
      visualStyle: clamp01(visualStyle.confidence),
      overall
    },
    patterns,
    flags: {
      hasBrandAssets,
      hasPastPosts
    }
  };
}

function getEffectiveProfile(profile = {}) {
  const detected = profile?.detectedProfile || {};
  const custom = profile?.customProfile || {};
  return {
    tone: normalizeToneValue(custom.tone) || normalizeToneValue(detected.tone) || 'professional',
    writingStyle: String(custom.writingStyle || detected.writingStyle || 'formal').toLowerCase(),
    ctaStyle: String(custom.ctaStyle || detected.ctaStyle || 'balanced').toLowerCase(),
    visualStyle: String(custom.visualStyle || detected.visualStyle || 'clean-minimal').toLowerCase()
  };
}

function buildGenerationGuidelines(profile = {}) {
  const effective = getEffectiveProfile(profile);
  const confidenceOverall = clamp01(profile?.confidence?.overall || 0.2);
  const patterns = profile?.patterns || {};
  const topHashtags = Array.isArray(patterns?.topHashtags)
    ? patterns.topHashtags.map((h) => h.value).filter(Boolean).slice(0, 5)
    : [];
  const commonOpeners = Array.isArray(patterns?.commonOpeners)
    ? patterns.commonOpeners.map((o) => o.value).filter(Boolean).slice(0, 4)
    : [];
  const formatSignals = Array.isArray(patterns?.formatSignals) ? patterns.formatSignals : [];
  const ctaExamples = Array.isArray(patterns?.ctaExamples) ? patterns.ctaExamples.slice(0, 3) : [];

  const hasBrandAssets = Boolean(profile?.hasBrandAssets);
  const hasPastPosts = Boolean(profile?.hasPastPosts);
  const mode = String(profile?.enforcementMode || 'strict');
  const strictMode = hasBrandAssets && mode !== 'off';

  let instructions = '';
  if (strictMode) {
    instructions += `\nBRAND ENFORCEMENT (STRICT): You MUST keep all output aligned to this brand profile.`;
  } else if (hasBrandAssets) {
    instructions += `\nBRAND ENFORCEMENT (ADAPTIVE): Follow the brand profile unless platform constraints require slight adaptation.`;
  } else {
    instructions += `\nBRAND ENFORCEMENT: No strong brand profile available. Use default best-practice style.`;
  }

  instructions += `\n- Effective Tone: ${effective.tone}`;
  instructions += `\n- Writing Style: ${effective.writingStyle}`;
  instructions += `\n- CTA Style: ${effective.ctaStyle}`;
  instructions += `\n- Visual Style: ${effective.visualStyle}`;
  instructions += `\n- Brand Match Confidence: ${Math.round(confidenceOverall * 100)}%`;

  if (profile?.assets?.primaryColor || profile?.assets?.secondaryColor || profile?.assets?.fontType) {
    instructions += `\n- Visual Tokens: primary=${profile.assets.primaryColor || 'not-set'}, secondary=${profile.assets.secondaryColor || 'not-set'}, font=${profile.assets.fontType || 'not-set'}`;
  }

  if (hasPastPosts) {
    instructions += `\nPAST POST PATTERNS (MIMIC THESE):`;
    if (commonOpeners.length) instructions += `\n- Common opening styles: ${commonOpeners.join(' | ')}`;
    if (formatSignals.length) instructions += `\n- Format signals: ${formatSignals.join(', ')}`;
    if (ctaExamples.length) instructions += `\n- CTA examples: ${ctaExamples.join(' | ')}`;
    if (topHashtags.length) instructions += `\n- Recurring hashtags: ${topHashtags.join(' ')}`;
  }

  return {
    strictMode,
    hasBrandAssets,
    hasPastPosts,
    effectiveProfile: effective,
    confidenceOverall,
    instructions
  };
}

module.exports = {
  normalizeHexColor,
  normalizeToneValue,
  normalizePastPost,
  analyzeBrandInputs,
  determineBrandColors,
  getEffectiveProfile,
  buildGenerationGuidelines
};
