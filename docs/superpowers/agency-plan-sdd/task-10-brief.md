### Task 10: Frontend: switcher, pass handling and the Clients page

**Files:**
- Create: `frontend/utils/agency.ts`, `frontend/components/ClientSwitcher.tsx`, `frontend/pages/AgencyClients.tsx`, `frontend/tests/agency.test.mjs`
- Modify: `frontend/services/api.ts`, `frontend/types.ts`, `frontend/components/Layout.tsx`, `frontend/App.tsx`

**Interfaces:**
- Consumes: the `/api/agency/*` endpoints of Task 4 and 9, `plan.tier === 'agency'` on the user.
- Produces in `utils/agency.ts`:
  - `isAgencyUser(user): boolean`
  - `clientsLeft(used: number, limit: number): number`
  - `limitLabel(used, limit): string` → e.g. `"3 of 5 clients"`
  - `actingBannerText(name): string`
- `apiService` methods: `getAgencyClients()`, `createAgencyClient({name, industry})`, `renameAgencyClient(id, name)`, `removeAgencyClient(id, password)`, `openAgencyClient(id)` (stores the keys below and reloads), `getAgencyUsage(month)`, `downloadAgencyUsage(month)`.
- Pass handling reuses the existing CSM keys so `getCurrentUser`'s fall-back and the Layout banner keep working: opening a client sets `csmReturnToken` to the agency's current token, `csmActingClient` to the client name, `csmReturnTo` to `'#/agency/clients'`, then sets the client's token; the existing `apiService.returnToCsmAccount()` returns.

- [ ] **Step 1: Write the failing test**

```js
// frontend/tests/agency.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgencyUser, clientsLeft, limitLabel, actingBannerText } from '../utils/agency.ts';

test('only an account on the Agency plan is an agency, and a client inside it is not', () => {
  assert.equal(isAgencyUser({ plan: { tier: 'agency' } }), true);
  assert.equal(isAgencyUser({ plan: { tier: 'professional' } }), false);
  assert.equal(isAgencyUser(null), false);
  assert.equal(isAgencyUser({ plan: { tier: 'agency' }, actingAgency: { name: 'Studio X' } }), false);
});

test('slots left and the label never go negative', () => {
  assert.equal(clientsLeft(3, 5), 2);
  assert.equal(clientsLeft(7, 5), 0);
  assert.equal(limitLabel(3, 5), '3 of 5 clients');
  assert.equal(limitLabel(1, 5), '1 of 5 clients');
});

test('the banner inside a client names the client and says where money is handled', () => {
  assert.match(actingBannerText('Sweet Co'), /Sweet Co/);
  assert.doesNotMatch(actingBannerText('Sweet Co'), /credit|trial/i);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && node --test tests/agency.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

`utils/agency.ts`:

```ts
/** Small rules for the agency screens, kept apart so they can be tested. */
export function isAgencyUser(user: { plan?: { tier?: string | null } | null; actingAgency?: unknown } | null | undefined): boolean {
  return !!user && user.plan?.tier === 'agency' && !user.actingAgency;
}
export const clientsLeft = (used: number, limit: number): number => Math.max(0, limit - used);
export const limitLabel = (used: number, limit: number): string => `${used} of ${limit} clients`;
export const actingBannerText = (name: string): string =>
  `You are working in ${name || 'a client'}'s brand. Payments, plans and passwords are handled in your agency account.`;
```

`types.ts`: add to `User`: `actingAgency?: { name: string } | null;`.

`services/api.ts` methods (follow the `getBillingDetails` style; `openAgencyClient` implements the key hand-off):

```ts
  getAgencyClients: async (): Promise<{ success: boolean; clients: Array<{ id: string; name: string; createdAt: string; frozen: boolean }>; limit: number; used: number; slotInr: number; slotQuarks: number }> =>
    apiCall('/agency/clients', { method: 'GET' }, true),
  createAgencyClient: async (d: { name: string; industry?: string }): Promise<{ success: boolean; message?: string }> => {
    try { return await apiCall('/agency/clients', { method: 'POST', body: JSON.stringify(d) }, true); }
    catch (e: any) { return { success: false, message: e?.message || 'We could not add this client. Please try again.' }; }
  },
  renameAgencyClient: async (id: string, name: string): Promise<{ success: boolean; message?: string }> =>
    apiCall(`/agency/clients/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }, true),
  removeAgencyClient: async (id: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try { return await apiCall(`/agency/clients/${id}`, { method: 'DELETE', body: JSON.stringify({ password, confirm: 'REMOVE' }) }, true); }
    catch (e: any) { return { success: false, message: e?.message || 'We could not remove this client. Nothing was changed.' }; }
  },
  openAgencyClient: async (id: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const r: any = await apiCall(`/agency/clients/${id}/open`, { method: 'POST' }, true);
      if (!r?.success) return { success: false, message: r?.message };
      // Same hand-off the CSM pass uses, so "back" and the banner already work.
      if (!localStorage.getItem('csmReturnToken')) localStorage.setItem('csmReturnToken', getToken() || '');
      localStorage.setItem('csmActingClient', r.client.name);
      localStorage.setItem('csmReturnTo', '#/agency/clients');
      setToken(r.token);
      return { success: true };
    } catch (e: any) { return { success: false, message: e?.message || 'We could not open this client.' }; }
  },
  getAgencyUsage: async (month?: string): Promise<{ success: boolean; month: string; poolPosts: number; clients: Array<{ id: string; name: string; posts: number; videos: number }> }> =>
    apiCall(`/agency/usage${month ? `?month=${month}` : ''}`, { method: 'GET' }, true),
```
(plus `downloadAgencyUsage(month)` modelled on `downloadMyData`, saving the CSV).

`ClientSwitcher.tsx`: a header dropdown shown for `isAgencyUser(user)` or while `localStorage.csmReturnToken` is set and `user.actingAgency` exists; lists clients from `getAgencyClients()`; choosing one calls `openAgencyClient(id)` then `window.location.hash = '#/dashboard'; window.location.reload()`; has an "All clients" link to `#/agency/clients` and, inside a client, "Back to agency" that calls `apiService.returnToCsmAccount()` then reloads at `#/agency/clients`.

`AgencyClients.tsx` (route `/agency/clients`): heading "Clients"; the `limitLabel`; a list with name, open button, rename (inline), remove (password + type REMOVE, same pattern as `AccountPrivacy`); an "Add a client" form (name, optional industry; shows the server message on the 403/400 refusal); when `clientsLeft === 0` a card "Add a client slot, ₹{slotInr} + GST a month" that calls the Task 6 slot subscription through a new `apiService.createSlotSubscription()` and opens Razorpay the same way `TrialExpired.tsx` does for add-ons (read its add-on purchase code and reuse the helper rather than duplicating it). Style with the same `--gv-*` tokens and card classes as `AccountPrivacy.tsx`. Words: "clients", "posts", "videos"; never "credits", "trial" or "Quarks".

`Layout.tsx`: render `<ClientSwitcher user={user} />` in the header beside the user menu; change the existing acting banner copy to use `actingBannerText(name)` when `user.actingAgency` is set (keep the CSM copy otherwise); the button label is "Back to agency" when `csmReturnTo === '#/agency/clients'`. Add "Clients" to the sidebar menu only for `isAgencyUser(user)`. `App.tsx`: add `<Route path="/agency/clients" element={<AgencyClients user={user} />} />` inside the protected routes.

- [ ] **Step 4: Run, audit, check in the browser**

Run: `cd frontend && node --test tests/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)|^✖"; node scripts/visual-audit/gen-layer-lists.mjs | tail -1; node scripts/brand-audit.mjs | tail -1; node scripts/voice-audit.mjs | tail -1` → all pass, 0 violations.
Browser check (dev servers, throwaway agency user with `plan.tier='agency'` and a token, Task 4's throwaway pattern): the Clients page lists, adds (up to 5 then shows the slot card), renames and removes; the switcher opens a client, the banner shows with "Back to agency", Billing and Settings→Security deletion show the blocked message, and going back restores the agency view. Delete the throwaway users.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "Agency screens: client switcher, back to agency, Clients page"
```

---

