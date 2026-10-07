// The quick Hero flow: three crisp 15-second ideas instead of a long story.
// Pure helpers only (no network); the route supplies the AI call.

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

const LIMITS = { TITLE: 60, EMOTION: 40, HOOK: 120, BEAT: 160, LINE: 80, CTA: 60, LOOK: 120, MAX_LINES: 2 };

const QUICK_STYLES = {
  ugc: {
    slug: 'social-media-reel',
    name: 'UGC',
    rules: 'A real-feeling person filmed on a phone: handheld, natural light, casual speech, one honest reaction. Looks unpolished on purpose. Talks to camera or reacts to something in hand.'
  },
  'brand-film': {
    slug: 'cinematic-commercial',
    name: 'Brand film',
    rules: 'A short, simple, cinematic film with almost no dialogue: strong visuals, one memorable transition, deliberate camera movement, rich natural light and sound design.'
  }
};
const isQuickStyle = (k) => Object.prototype.hasOwnProperty.call(QUICK_STYLES, k);

// Keeps only ideas that fit 15 seconds: a hook, three beats, a closing call to action.
function normaliseQuickConcepts(parsed) {
  const list = isObj(parsed) && Array.isArray(parsed.concepts) ? parsed.concepts : [];
  const out = [];
  for (const c of list) {
    if (!isObj(c)) continue;
    const beats = (Array.isArray(c.beats) ? c.beats : []).map((b) => text(b, LIMITS.BEAT)).filter(Boolean);
    const hook = text(c.hook, LIMITS.HOOK);
    const title = text(c.title, LIMITS.TITLE);
    if (!title || !hook || beats.length < 3) continue;
    out.push({
      title,
      emotion: text(c.emotion, LIMITS.EMOTION),
      hook,
      beats: beats.slice(0, 3),
      dialogue: (Array.isArray(c.dialogue) ? c.dialogue : []).map((l) => text(l, LIMITS.LINE)).filter(Boolean).slice(0, LIMITS.MAX_LINES),
      cta: text(c.cta, LIMITS.CTA),
      look: text(c.look, LIMITS.LOOK)
    });
    if (out.length === 3) break;
  }
  return out;
}

// The brief the existing /brief, /plan and /generate flow already understands: no cast, three beats as scenes.
function conceptToBrief(concept, { aspectRatio = '9:16', language = 'English', environment } = {}) {
  const c = concept || {};
  const beats = Array.isArray(c.beats) ? c.beats : [];
  const lines = Array.isArray(c.dialogue) ? c.dialogue : [];
  const story = [`Hook: ${c.hook || ''}`, ...beats.map((b, i) => `Beat ${i + 1}: ${b}`), lines.length ? `Spoken: ${lines.join(' / ')}` : '']
    .filter(Boolean).join(' ');
  return {
    quick: true,
    concept: { title: c.title || '', storySummary: story.slice(0, 1500), coreEmotion: c.emotion || '', visualStyle: c.look || '' },
    aspectRatio,
    language,
    cast: [],
    environment: environment || { enabled: false, notes: '', images: [] },
    scenes: beats.slice(0, 3).map((b, i) => ({
      sceneId: `beat-${i + 1}`,
      title: i === 0 ? 'Hook' : i === 2 ? 'Close' : `Beat ${i + 1}`,
      script: lines[i] || '',
      visual: i === 0 && c.hook ? `${c.hook} ${b}`.slice(0, 800) : b,
      durationSeconds: 5,
      charactersRequired: []
    }))
  };
}

module.exports = { LIMITS, QUICK_STYLES, isQuickStyle, normaliseQuickConcepts, conceptToBrief };
