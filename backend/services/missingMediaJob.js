/**
 * Renders only the scene images (or clips) a video draft is missing, one scene at a time, on the
 * server, so closing or reloading the page does not stop it and finished work is never redone.
 *
 * The caller injects how a single scene is rendered. In production that is the existing
 * single-scene route handler, so charging (one scene at a time, just before it renders),
 * refunds and saving to the draft behave exactly as they do for the per-scene buttons.
 */

const KINDS = {
  images: { has: (scene) => Boolean(scene && scene.imageUrl), needs: () => true },
  // A clip needs its image first.
  clips: { has: (scene) => Boolean(scene && scene.clipUrl), needs: (scene) => Boolean(scene && scene.imageUrl) }
};

// Scenes can live in draft.scenes, draft.images.sceneData or draft.clips.sceneData, depending on
// the order the wizard ran in. A scene index counts as having an image or clip if any of them does.
function sceneLists(draft) {
  return [draft && draft.scenes, draft && draft.images && draft.images.sceneData, draft && draft.clips && draft.clips.sceneData]
    .filter((list) => Array.isArray(list));
}

function sceneCount(draft) {
  return sceneLists(draft).reduce((max, list) => Math.max(max, list.length), 0);
}

function merged(draft, index) {
  const out = {};
  for (const list of sceneLists(draft)) {
    const scene = list[index];
    if (!scene) continue;
    if (scene.imageUrl) out.imageUrl = scene.imageUrl;
    if (scene.clipUrl) out.clipUrl = scene.clipUrl;
  }
  return out;
}

function missingIndexes(kind, draft) {
  const rule = KINDS[kind];
  if (!rule) throw new Error(`Unknown media kind: ${kind}`);
  const out = [];
  for (let i = 0; i < sceneCount(draft); i++) {
    const scene = merged(draft, i);
    if (!rule.has(scene) && rule.needs(scene)) out.push(i);
  }
  return out;
}

async function runMissing({ kind, loadDraft, runScene, onProgress = async () => {}, isCancelled = () => false }) {
  const rule = KINDS[kind];
  if (!rule) throw new Error(`Unknown media kind: ${kind}`);
  const first = await loadDraft();
  const total = missingIndexes(kind, first).length;
  const result = { total, done: 0, failed: 0, skipped: 0, stoppedFor: null };
  await onProgress({ ...result });
  for (const index of missingIndexes(kind, first)) {
    if (isCancelled()) { result.stoppedFor = 'cancelled'; break; }
    // Look again before each scene: if it was finished meanwhile (another tab, a restart), skip it.
    const fresh = await loadDraft();
    if (!missingIndexes(kind, fresh).includes(index)) { result.skipped += 1; continue; }
    let outcome;
    try {
      outcome = await runScene(index);
    } catch (error) {
      outcome = { ok: false, message: error && error.message };
    }
    if (outcome && outcome.ok) result.done += 1;
    else {
      result.failed += 1;
      if (outcome && outcome.creditsExhausted) { result.stoppedFor = 'quarks'; await onProgress({ ...result }); break; }
    }
    await onProgress({ ...result });
  }
  return result;
}

module.exports = { missingIndexes, runMissing, sceneCount };
