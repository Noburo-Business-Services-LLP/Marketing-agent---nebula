### Task 11: Frontend: plans page, usage view and pool display

**Files:**
- Modify: `frontend/pages/TrialExpired.tsx` (plans page: show the Agency plan), `frontend/pages/GravityHome.tsx` (agency usage block), `frontend/components/AgencyUsage.tsx` (create), `frontend/services/api.ts` (`getPlanCatalogue` type gets `agency`), `frontend/utils/plans.ts` (`tierLabel('agency')`)
- Test: add cases to `frontend/tests/plans.test.mjs`

**Interfaces:**
- Consumes: `planCatalogue().agency` (Task 1), `getAgencyUsage` (Task 10).
- Produces: `tierLabel('agency') === 'Agency'`; `AgencyUsage` component (month picker, table of client / posts / videos, "Download CSV", pool shown as roughly N posts or M videos left using the existing `outputsFor`-style numbers the server returns as `poolPosts`).

- [ ] **Step 1: Write the failing test** (append to `tests/plans.test.mjs`)

```js
test('the Agency plan has a plain label and its wording never says credits or trial', () => {
  assert.equal(tierLabel('agency'), 'Agency');
  assert.doesNotMatch(upgradeMessage('quarks'), /credit|trial/i);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && node --test tests/plans.test.mjs` → FAIL (`tierLabel('agency')`).

- [ ] **Step 3: Implement**

- `utils/plans.ts`: add `agency: 'Agency'` to the label map used by `tierLabel`.
- `TrialExpired.tsx`: the plans page maps over `catalogue.plans`; add the Agency card from `plan.id === 'agency'` showing price, "5 client brands included", the listed features, and under it one line "Extra clients ₹{slotInr} + GST a month each, up to {maxClients}". Subscribing uses the existing plan checkout with `planId: 'agency'` (the server already accepts any id in `PLAN_PRESENTATION`). Hide the Agency card for accounts inside a client (`user.actingAgency`).
- `components/AgencyUsage.tsx`: month `<input type="month">`, table, CSV button; no Quark numbers anywhere.
- `GravityHome.tsx` (the dashboard): render `<AgencyUsage />` above the existing content when `isAgencyUser(user)`.
- Server: `GET /api/agency/usage` includes `poolPosts` using `outputsFor(walletBalance).posts` (Task 7 step already returns it; verify and add if missing).

- [ ] **Step 4: Run, audit, browser check**

Run the frontend tests, `gen-layer-lists.mjs`, brand and voice audits as in Task 10. In the browser: as an agency throwaway user the dashboard shows the usage table and the plans page shows the Agency card with the slot line; as a Starter user the Agency card shows too (it is a plan anyone may choose) and checkout opens.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "Agency: plan on the plans page, usage table and CSV on the dashboard"
```

---

