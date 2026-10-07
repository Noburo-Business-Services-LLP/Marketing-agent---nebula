const test = require('node:test');
const assert = require('node:assert');
const { missingIndexes, runMissing } = require('../services/missingMediaJob');

const draft = (scenes, extra = {}) => ({ scenes, ...extra });

test('only scenes without an image are missing for images', () => {
  const d = draft([{ imageUrl: 'a' }, {}, { imageUrl: 'c' }, {}]);
  assert.deepStrictEqual(missingIndexes('images', d), [1, 3]);
});

test('clips need an image first and skip scenes that already have a clip', () => {
  const d = draft([{ imageUrl: 'a', clipUrl: 'x' }, { imageUrl: 'b' }, {}, { imageUrl: 'd' }]);
  assert.deepStrictEqual(missingIndexes('clips', d), [1, 3]);
});

test('a finished scene is found in any of the places a draft keeps scenes', () => {
  const d = { scenes: [{}, {}], images: { sceneData: [{ imageUrl: 'a' }, {}] }, clips: { sceneData: [{ clipUrl: 'x' }, {}] } };
  assert.deepStrictEqual(missingIndexes('images', d), [1]);
  assert.deepStrictEqual(missingIndexes('clips', d), [1].filter(() => false));
});

function harness(initial) {
  let current = JSON.parse(JSON.stringify(initial));
  const calls = [];
  return {
    calls,
    loadDraft: async () => current,
    set: (fn) => { current = fn(current); },
    runScene: (behaviour) => async (i) => {
      calls.push(i);
      const out = behaviour(i);
      if (out.ok) current.scenes[i] = { ...current.scenes[i], imageUrl: 'img' + i, clipUrl: 'clip' + i };
      return out;
    }
  };
}

test('renders only the missing scenes, in order, and reports progress', async () => {
  const h = harness(draft([{ imageUrl: 'a' }, {}, {}]));
  const progress = [];
  const r = await runMissing({ kind: 'images', loadDraft: h.loadDraft, runScene: h.runScene(() => ({ ok: true })), onProgress: async (p) => progress.push(p.done) });
  assert.deepStrictEqual(h.calls, [1, 2]);
  assert.deepStrictEqual([r.total, r.done, r.failed], [2, 2, 0]);
  assert.strictEqual(progress[progress.length - 1], 2);
});

test('running it again does nothing, so nothing is charged twice', async () => {
  const h = harness(draft([{}, {}]));
  await runMissing({ kind: 'images', loadDraft: h.loadDraft, runScene: h.runScene(() => ({ ok: true })) });
  h.calls.length = 0;
  const r = await runMissing({ kind: 'images', loadDraft: h.loadDraft, runScene: h.runScene(() => ({ ok: true })) });
  assert.deepStrictEqual(h.calls, []);
  assert.strictEqual(r.total, 0);
});

test('one failing scene does not stop the others', async () => {
  const h = harness(draft([{}, {}, {}]));
  const r = await runMissing({ kind: 'images', loadDraft: h.loadDraft, runScene: h.runScene((i) => (i === 1 ? { ok: false, message: 'x' } : { ok: true })) });
  assert.deepStrictEqual(h.calls, [0, 1, 2]);
  assert.deepStrictEqual([r.done, r.failed, r.stoppedFor], [2, 1, null]);
});

test('running out of Quarks stops the job at once', async () => {
  const h = harness(draft([{}, {}, {}]));
  const r = await runMissing({ kind: 'images', loadDraft: h.loadDraft, runScene: h.runScene((i) => (i === 1 ? { ok: false, creditsExhausted: true } : { ok: true })) });
  assert.deepStrictEqual(h.calls, [0, 1]);
  assert.strictEqual(r.stoppedFor, 'quarks');
});

test('a scene finished meanwhile is skipped, and a thrown error counts as a failure', async () => {
  const h = harness(draft([{}, {}]));
  const run = h.runScene(() => ({ ok: true }));
  const r = await runMissing({
    kind: 'images', loadDraft: h.loadDraft,
    runScene: async (i) => { if (i === 0) { h.set((d) => { d.scenes[1] = { imageUrl: 'other-tab' }; return d; }); } return run(i); }
  });
  assert.deepStrictEqual(h.calls, [0]);
  assert.strictEqual(r.skipped, 1);
  const h2 = harness(draft([{}]));
  const r2 = await runMissing({ kind: 'images', loadDraft: h2.loadDraft, runScene: async () => { throw new Error('boom'); } });
  assert.strictEqual(r2.failed, 1);
});

test('cancel stops before the next scene', async () => {
  const h = harness(draft([{}, {}, {}]));
  let n = 0;
  const r = await runMissing({ kind: 'images', loadDraft: h.loadDraft, runScene: h.runScene(() => ({ ok: true })), isCancelled: () => n++ >= 1 });
  assert.deepStrictEqual(h.calls, [0]);
  assert.strictEqual(r.stoppedFor, 'cancelled');
});
