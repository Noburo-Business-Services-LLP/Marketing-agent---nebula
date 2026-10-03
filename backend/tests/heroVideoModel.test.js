const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// C1: hero jobs must not live in video_jobs, where the Kling queue worker's
// recovery / GC / drain loops act on every document.
test('HeroVideoJob uses its own collection and model name', () => {
  const HeroVideoJob = require('../models/HeroVideoJob');
  assert.equal(HeroVideoJob.modelName, 'HeroVideoJob');
  assert.equal(HeroVideoJob.schema.options.collection, 'hero_video_jobs');
  assert.equal(HeroVideoJob.collection.name, 'hero_video_jobs');
  assert.equal(HeroVideoJob.schema.options.timestamps, true);
  const p = HeroVideoJob.schema.paths;
  for (const k of ['jobId', 'userId', 'status', 'progress', 'currentStep', 'payload', 'result', 'error.message', 'error.stack', 'logs', 'attempts', 'metadata', 'startedAt', 'completedAt', 'createdAt', 'updatedAt']) {
    assert.ok(p[k], `missing path ${k}`);
  }
  assert.deepEqual(p.status.enumValues, ['queued', 'processing', 'completed', 'failed', 'cancelled']);
  assert.equal(p.jobId.options.unique, true);
  assert.equal(p.userId.options.ref, 'User');
  const idx = HeroVideoJob.schema.indexes().map(([fields]) => JSON.stringify(fields));
  assert.ok(idx.includes(JSON.stringify({ userId: 1, createdAt: -1 })), idx.join(' '));
});

test('hero files no longer reference the Kling VideoJob model', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['services/heroVideoFlow.js', 'services/heroVideoService.js', 'routes/heroVideo.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/models\/VideoJob['"]/.test(src), `${f} still requires models/VideoJob`);
    assert.ok(src.includes("require('../models/HeroVideoJob')"), `${f} should use HeroVideoJob`);
  }
});
