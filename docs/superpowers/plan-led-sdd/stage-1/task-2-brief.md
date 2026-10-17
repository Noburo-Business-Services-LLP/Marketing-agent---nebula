### Task 2: From business profile to plan input

**Files:**
- Create: `backend/services/plan/profileInput.js`
- Test: `backend/tests/planProfileInput.test.js`

**Interfaces:**
- Produces: `profileComplete(user): { complete: boolean, missing: string[] }` and `inputFromProfile(user): object` shaped for `normaliseInput` (`businessName, website, instagram, whatYouSell, whoItsFor, goal, competitors:[{name}], offers:[]`).
- Mapping: `businessName` = `businessProfile.name || companyName`; `website` = `businessProfile.website`; `instagram` = handle of the connected Instagram account if the user object has one in `connectedSocials` (platform 'instagram', field `username`), else ''; `whatYouSell` = `description || heroProduct || problemSolved` (first with at least 10 characters); `whoItsFor` = `targetCustomerProfile || targetAudience` (first with at least 5 characters); `goal` from `marketingGoals` (first goal text containing: 'enquir' or 'lead' -> `enquiries`; 'sale' or 'sell' -> `sales`; 'follow' or 'awareness' or 'brand' -> `followers`; 'launch' -> `launch`; default `enquiries`); `competitors` = `businessProfile.competitors` names (strings, max 3) as `{ name }`.
- `profileComplete` requires: a name of at least 2 characters, at least one of website or instagram, whatYouSell and whoItsFor as above. `missing` lists plain-English labels: `'business name'`, `'website or Instagram page'`, `'what you sell'`, `'who it is for'`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planProfileInput.test.js
const test = require('node:test');
const assert = require('node:assert');
const { profileComplete, inputFromProfile } = require('../services/plan/profileInput');
const { normaliseInput } = require('../services/blueprint/input');

const full = () => ({ companyName: 'Sweet Co', businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order for birthdays', targetAudience: 'Families in Chennai', marketingGoals: ['Get more enquiries'], competitors: ['Cake House', 'Bake Lab', 'Third', 'Fourth'] }, connectedSocials: [] });

test('a full profile is complete and its input passes the Blueprint validator', () => {
  assert.deepStrictEqual(profileComplete(full()), { complete: true, missing: [] });
  const input = inputFromProfile(full());
  assert.strictEqual(input.goal, 'enquiries');
  assert.strictEqual(input.competitors.length, 3);
  const n = normaliseInput(input, { allowGuided: true });
  assert.strictEqual(n.ok, true, JSON.stringify(n.errors));
});

test('missing pieces are named in plain words', () => {
  const u = full(); u.businessProfile.website = ''; u.businessProfile.description = 'short'; u.businessProfile.heroProduct = '';
  const r = profileComplete(u);
  assert.strictEqual(r.complete, false);
  assert.deepStrictEqual(r.missing, ['website or Instagram page', 'what you sell']);
});

test('an Instagram account can stand in for the website', () => {
  const u = full(); u.businessProfile.website = ''; u.connectedSocials = [{ platform: 'instagram', username: 'sweetco.in' }];
  assert.strictEqual(profileComplete(u).complete, true);
  assert.strictEqual(inputFromProfile(u).instagram, 'sweetco.in');
});

test('goals map to the four Blueprint goals', () => {
  for (const [text, goal] of [['Increase sales', 'sales'], ['More followers', 'followers'], ['Launch our new range', 'launch'], ['Something else', 'enquiries']]) {
    const u = full(); u.businessProfile.marketingGoals = [text];
    assert.strictEqual(inputFromProfile(u).goal, goal, text);
  }
});

test('an empty or missing user is incomplete and never throws', () => {
  assert.strictEqual(profileComplete(null).complete, false);
  assert.strictEqual(profileComplete({}).complete, false);
  assert.ok(inputFromProfile({}));
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement** — `services/plan/profileInput.js` exactly per the mapping above (pure, no requires except none). Keep each helper tiny and total (never throws on missing fields).

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/planProfileInput.test.js`.

- [ ] **Step 5: Commit** — `git add backend/services/plan/profileInput.js backend/tests/planProfileInput.test.js && git commit -m "Plan: business profile to plan input, with a plain list of what is missing"`

---

