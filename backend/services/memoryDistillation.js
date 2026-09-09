/**
 * Distills Layer 1 evidence (AIContentPerformance + the AICampaignHistory/
 * AIVideoMemory records it references) into Layer 2: a small, curated,
 * human-readable set of notes on AIBrandMemory.learnedNotes. This is what
 * actually gets read into generation prompts and shown on the AI Memory
 * page — never the raw evidence log directly, the same way a MEMORY.md
 * file is legible where a raw event log isn't.
 *
 * Runs weekly (see startMemoryDistillationScheduler) and on-demand from the
 * AI Memory page's "Refresh now" button. Skips accounts with no new
 * evidence since the last run, to avoid pointless LLM spend.
 */

const AIBrandMemory = require('../models/AIBrandMemory');
const AIContentPerformance = require('../models/AIContentPerformance');
const { callTextLLM } = require('./openAI');
const { parseGeminiJSON } = require('./geminiAI');

const WINNER_LIMIT = 20;
const LOSER_LIMIT = 10;
const MAX_NOTES = 12;

const DISTILLATION_PROMPT = `
You are analyzing real social media performance data to extract a SMALL set
of specific, actionable patterns — not a summary of everything, only what
genuinely repeats across multiple posts or stands out clearly.

WINNING POSTS (high performance):
{{WINNERS}}

LOSING POSTS (low performance, for contrast):
{{LOSERS}}

EXISTING NOTES (update or drop these based on the new evidence above; don't
just append to them):
{{EXISTING_NOTES}}

Write up to ${MAX_NOTES} short notes, each a single plain-English sentence
stating a concrete pattern (e.g. "Carousel posts about pricing outperform
single posters", "Posts without a person in frame get more engagement this
quarter"). The evidence above is caption/hashtag/CTA/format text only — no
visual or design data is included, so do NOT write a "visual" category note;
you have no grounding for one. Drop any existing note that is contradicted
by the new evidence. Each note needs a category: one of copy, hashtags, cta,
timing, format. Each note needs a confidence between 0 and 1 based on how
much evidence supports it (one post = low confidence, five+ consistent
posts = high confidence).

Return ONLY a JSON object shaped EXACTLY like this — a top-level object with
one key, "notes", holding the array. Do not use any other key name, and put
nothing else at the top level:
{
  "notes": [
    { "text": "...", "category": "copy", "confidence": 0.7 }
  ]
}
`;

function formatEvidenceForPrompt(performanceRecords) {
  return performanceRecords
    .map((p) => {
      const parts = [
        `- Score ${p.learning?.score ?? '?'} (${p.learning?.tier ?? '?'})`,
        p.caption ? `Caption: "${String(p.caption).slice(0, 200)}"` : '',
        p.hashtags?.length ? `Hashtags: ${p.hashtags.slice(0, 8).join(', ')}` : '',
        p.cta ? `CTA: "${p.cta}"` : '',
        p.contentType ? `Format: ${p.contentType}` : ''
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');
}

async function distillMemoryForUser(userId, organizationId) {
  const [winners, losers, brandMemory] = await Promise.all([
    AIContentPerformance.find({ organizationId, userId, 'learning.tier': { $in: ['high', 'winner'] } })
      .sort({ measuredAt: -1 }).limit(WINNER_LIMIT).lean(),
    AIContentPerformance.find({ organizationId, userId, 'learning.tier': 'low' })
      .sort({ measuredAt: -1 }).limit(LOSER_LIMIT).lean(),
    AIBrandMemory.findOne({ organizationId, userId }).lean()
  ]);

  if (!winners.length && !losers.length) return null; // nothing to learn from yet

  // Skip if nothing new has been measured since the last successful run —
  // bounds LLM cost instead of re-summarizing unchanged evidence weekly.
  const newestEvidence = [...winners, ...losers]
    .map((p) => new Date(p.measuredAt).getTime())
    .reduce((max, t) => Math.max(max, t), 0);
  const lastRun = brandMemory?.learnedNotesUpdatedAt ? new Date(brandMemory.learnedNotesUpdatedAt).getTime() : 0;
  if (newestEvidence <= lastRun) return null;

  const existingNotesText = (brandMemory?.learnedNotes || [])
    .map((n) => `- [${n.category}] ${n.text}`)
    .join('\n') || '(none yet)';

  const prompt = DISTILLATION_PROMPT
    .replace('{{WINNERS}}', formatEvidenceForPrompt(winners) || '(none)')
    .replace('{{LOSERS}}', formatEvidenceForPrompt(losers) || '(none)')
    .replace('{{EXISTING_NOTES}}', existingNotesText);

  const response = await callTextLLM(prompt, { jsonMode: true, temperature: 0.4, maxTokens: 2000, skipCache: true });
  const parsed = parseGeminiJSON(response);
  const rawNotes = Array.isArray(parsed?.notes) ? parsed.notes : [];

  const sourceIds = [...winners, ...losers].map((p) => p._id);
  const llmNotes = rawNotes
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .map((n) => ({
      text: n.text.trim(),
      category: ['copy', 'hashtags', 'cta', 'visual', 'timing', 'format'].includes(n.category) ? n.category : 'copy',
      sourceIds,
      confidence: Number.isFinite(Number(n.confidence)) ? Math.max(0, Math.min(1, Number(n.confidence))) : 0.5,
      userEdited: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

  // User-edited notes are deliberate human corrections and must survive a
  // distillation run verbatim — the LLM only ever sees them as unlabeled
  // prose in EXISTING_NOTES, so nothing stops it from rewording or quietly
  // dropping one. Carry them forward untouched, then fill whatever room is
  // left (up to MAX_NOTES) with the LLM's fresh output — user-edited notes
  // win the cap over freshly generated ones. Skip any fresh note whose text
  // duplicates a preserved user-edited note.
  const existingUserEditedNotes = (brandMemory?.learnedNotes || []).filter((n) => n.userEdited);
  const preservedTexts = new Set(existingUserEditedNotes.map((n) => n.text.trim().toLowerCase()));
  const freshNotes = llmNotes.filter((n) => !preservedTexts.has(n.text.toLowerCase()));

  const notes = [
    ...existingUserEditedNotes.slice(0, MAX_NOTES),
    ...freshNotes
  ].slice(0, MAX_NOTES);

  // A bad/unparseable LLM response yields rawNotes === [], which combined
  // with no user-edited notes to preserve would otherwise wipe out every
  // existing note and stamp learnedNotesUpdatedAt to now — permanently
  // blocking retries until fresh evidence arrives (see the skip-check
  // above). Bail out without writing so existing notes are untouched and
  // the next scheduled run can retry freely.
  if (!notes.length) return null;

  await AIBrandMemory.findOneAndUpdate(
    { organizationId, userId },
    { $set: { learnedNotes: notes, learnedNotesUpdatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return notes;
}

async function runDistillationOnce({ limit = 50 } = {}) {
  // Any account with an AIBrandMemory doc is a candidate — distillMemoryForUser
  // itself no-ops when there's no new evidence, so this doesn't need its own
  // "has this account been active" filter.
  // Sorted so never-yet-distilled accounts (learnedNotesUpdatedAt: null) and
  // the longest-stale ones come first — without this, the same first `limit`
  // accounts (in whatever order Mongo happens to return) get processed every
  // run once the account base exceeds `limit`, and every account past that
  // is never distilled. Ascending order means the whole account base cycles
  // through over successive runs as learnedNotesUpdatedAt advances.
  const accounts = await AIBrandMemory.find({}).select('userId organizationId').sort({ learnedNotesUpdatedAt: 1 }).limit(limit).lean();
  let distilled = 0;
  for (const acct of accounts) {
    try {
      const result = await distillMemoryForUser(acct.userId, acct.organizationId);
      if (result) distilled += 1;
    } catch (err) {
      console.warn(`[MemoryDistillation] Failed for user ${acct.userId}:`, err.message);
    }
  }
  return { accountsChecked: accounts.length, distilled };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startMemoryDistillationScheduler({ intervalMs = WEEK_MS, logger = console } = {}) {
  if (String(process.env.ENABLE_MEMORY_DISTILLATION || 'true').toLowerCase() === 'false') {
    logger.log('[MemoryDistillation] Scheduler disabled via ENABLE_MEMORY_DISTILLATION=false');
    return () => {};
  }
  logger.log(`[MemoryDistillation] Scheduler started (interval ${intervalMs}ms)`);
  const timer = setInterval(() => {
    runDistillationOnce().catch((err) => logger.error('[MemoryDistillation] Scheduler error:', err));
  }, intervalMs);
  // Deliberately NOT run immediately on startup, unlike the other schedulers
  // — this one costs a real LLM call per account and a week-old server
  // restart shouldn't trigger an immediate re-run for everyone.
  return () => clearInterval(timer);
}

module.exports = {
  distillMemoryForUser,
  runDistillationOnce,
  startMemoryDistillationScheduler
};
