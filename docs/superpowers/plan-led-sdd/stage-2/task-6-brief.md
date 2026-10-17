### Task 6: One-shot prefill for the create screens

**Files:**
- Create: `frontend/utils/prefill.ts`, `frontend/tests/prefill.test.mjs`
- Modify: `frontend/pages/GravityCreate.tsx` (read the prefill on mount: topic/description, mode `carousel`, platform, language), `frontend/pages/CreateVideo.tsx` (idea, language), both clearing it after use

**Interfaces:**
- `setPrefill(target: 'carousel'|'video', data: object, storage = sessionStorage)`; `takePrefill(target, storage)` returns the data once and removes it (a second call returns `null`); data older than 15 minutes is discarded; storage errors are swallowed (no prefill, no crash); `PrefillData` types for the two targets.

- [ ] **Step 1: Write the failing test**

```js
// frontend/tests/prefill.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { setPrefill, takePrefill } from '../utils/prefill.ts';
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('a prefill is handed over once and then gone', () => {
  const s = mem();
  setPrefill('video', { idea: 'Behind the oven', language: 'english' }, s, 1000);
  assert.deepEqual(takePrefill('video', s, 2000), { idea: 'Behind the oven', language: 'english' });
  assert.equal(takePrefill('video', s, 2000), null);
});
test('a prefill for one screen is not given to the other', () => {
  const s = mem();
  setPrefill('carousel', { topic: 'Five cakes' }, s, 1000);
  assert.equal(takePrefill('video', s, 1500), null);
  assert.deepEqual(takePrefill('carousel', s, 1500), { topic: 'Five cakes' });
});
test('an old prefill is dropped', () => {
  const s = mem();
  setPrefill('video', { idea: 'x' }, s, 1000);
  assert.equal(takePrefill('video', s, 1000 + 16 * 60 * 1000), null);
});
test('broken storage never throws', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.doesNotThrow(() => setPrefill('video', { idea: 'x' }, bad, 1));
  assert.equal(takePrefill('video', bad, 2), null);
});
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** `prefill.ts` (the extra `now` argument defaults to `Date.now()`), then consume it in the two pages: read the page's own state setters first (GravityCreate: `setMode('single')` or the carousel mode, `setDescription`, `setSelectedPlatforms`, `setLanguage`; CreateVideo: `setIdea`, `setLanguage`), apply the prefill in a one-time `useEffect` on mount, and show a small note "Filled in from your plan. Change anything you like." that disappears on first edit. The page must still work unchanged when no prefill exists. **Step 4:** run `cd frontend && node --test tests/*.test.mjs`, `npx tsc --noEmit` (only the old Influencers error). **Step 5: Commit** — `git add frontend && git commit -m "Create screens accept a one-shot prefill from the plan"`

---

