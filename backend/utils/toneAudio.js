const path = require('path');

const TONE_AUDIO_FILES = {
  fun: 'fun.mp3',
  luxury: 'luxury.mp3',
  normal: 'normal.mp3',
  professional: 'professional.mp3',
  simple: 'simple.mp3'
};

function normalizeTone(tone) {
  const t = String(tone || '').trim().toLowerCase();
  if (!t) return null;

  // Allow some common synonyms used across the app/templates
  if (t === 'playful' || t === 'humorous' || t === 'casual') return 'fun';
  if (t === 'minimal' || t === 'minimalist') return 'simple';
  if (t === 'bold') return 'professional';

  return Object.prototype.hasOwnProperty.call(TONE_AUDIO_FILES, t) ? t : null;
}

function getPublicBaseUrl({ req } = {}) {
  const configured = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  if (req && typeof req.get === 'function') {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();
    const host = req.get('host');
    if (host) return `${proto}://${host}`;
  }

  return 'http://localhost:5000';
}

function resolveToneAudioUrl(tone, { baseUrl } = {}) {
  const normalized = normalizeTone(tone);
  if (!normalized) return null;
  const file = TONE_AUDIO_FILES[normalized];
  const root = String(baseUrl || getPublicBaseUrl()).replace(/\/+$/, '');
  return `${root}/audio/${encodeURIComponent(file)}`;
}

function audioFilePathForTone(tone) {
  const normalized = normalizeTone(tone);
  if (!normalized) return null;
  return path.join(__dirname, '..', 'tone-audio', TONE_AUDIO_FILES[normalized]);
}

module.exports = {
  TONE_AUDIO_FILES,
  normalizeTone,
  getPublicBaseUrl,
  resolveToneAudioUrl,
  audioFilePathForTone
};
