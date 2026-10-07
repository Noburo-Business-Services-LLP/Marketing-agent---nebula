# Admin console: design

Date: 2026-10-07. Status: approved in conversation, section by section; waiting for owner review of this document.

## Goal
Replace the single shared-login `/admin` page with a staff area inside the Nebulaa app that answers, every morning: is anything broken, which clients need attention, and is the business growing. Then give clear views of clients, the team, money and product usage.

## Decisions made
- Users of the admin area: the owner plus a few senior staff, and CSMs with a filtered view (Q1 answered B, then refined by the owner's roles).
- Each person signs in with their own Nebulaa account; no shared admin password (Q2: B).
- Home answers: health, attention needed, growth. Money, team and usage are separate pages (Q3: A, D, B).
- Approach: a new admin section inside the main app, light design, its own menu. The old `/admin` page stays until the new one covers everything, then it is removed (option 1).

## 1. Roles and access
Three roles on a normal user account: **Owner**, **Admin**, **CSM**. Field: `staffRole: 'owner' | 'admin' | 'csm' | null` on User. The existing `isCsm` flag maps to `staffRole: 'csm'` (keep `isCsm` in sync during the change so the live CSM features keep working).

| Capability | Owner | Admin | CSM |
|---|---|---|---|
| Home | all | all | own clients |
| Clients list and client page | all | all | own clients |
| Open a client's account | yes | yes | own clients |
| Add Quarks | yes | no | no |
| Disable or enable an account | yes | yes | no |
| Assign clients to CSMs (single and bulk) | yes | yes | no |
| Add CSM | yes | yes | no |
| Add or remove Admin | yes | no | no |
| Reset staff account, Reset Ayrshare IDs | yes | no | no |
| Money | yes | no | no |
| Usage | full | summary | no |
| Coupons | yes | no | no |
| Export CSV | yes | no | no |
| Activity log | all | all except money | own actions |

Rules:
- The server checks every action with one permission function (`can(staffUser, action, targetClient?)`), unit-tested against this table. The screens only hide what the server already refuses.
- Only an Owner can create or remove Admins or Owners. The last Owner cannot be removed or demoted.
- Becoming the first Owner: the existing shared admin login gets one action, "Make this account the Owner", used once by the founder; after an Owner exists, that action is refused.
- Staff accounts (any `staffRole`) never appear in client lists or client numbers (they are already `isHidden` for CSMs; extend to all staff).
- Staff can never change a client's password or payment details.

**Activity log.** Collection `StaffAction`: `actor`, `actorRole`, `action`, `client` (optional), `details` (small object, never secrets), `at`. Written for: add Quarks, disable/enable, assign CSM, role changes, resets, open account (existing `CsmSession` folds into this or stays and is shown alongside).

## 2. Home
1. **Health strip:** images, publishing, payments, Ayrshare, video. Green/amber/red from failures in the last hour (same sources as `opsAlerts`, which needs a small read API: last N failures per category, kept in memory and also counted from logs where possible). Click for the latest errors in plain words.
2. **Attention needed:** clients with a reason and a one-click action, most urgent first. Reasons: Quarks under 100, drafts waiting more than 3 days, no activity for 7+ days, onboarding not finished, no social account connected, failed posts in the last 7 days. CSMs see only their clients.
3. **Growth:** sign-ups today / this week / this month with the previous period; active clients this week; trials that became paid (count and percent); a 30-day chart of sign-ups and active clients.

## 3. Clients
- **List:** quick filters with counts (All, Active 7d, Inactive 7d+, Disabled, On trial, Paying, Needs attention, No CSM); search (name, email, company, phone); columns: client and company, plan with add-on tags, Quarks, connected-account logos, feature ticks (Publish, Schedule, Inbox, Auto-reply, Video, computed with `config/entitlements.canUse`), CSM, last active, status; sortable; server-side paging; CSV export (Owner).
- **Client page:** summary, plan and money (Owner), access with reasons, activity (posts made/published/failed, videos, Blueprint, last 30 days), connections, Quarks balance and recent spend by feature, actions allowed for the viewer's role, history from `StaffAction`.
- **Bulk:** select clients, assign to one CSM (Owner, Admin).

## 4. Team, Money, Usage
- **Team:** staff list (name, email, role, clients managed, last active, status); add team member (name, email, role; invite email; set password via Forgot password); change role or remove (removing unassigns clients); workload per CSM (clients, drafts waiting, clients needing attention).
- **Money (Owner):** this month (revenue collected, top-up packs sold, new paying clients); clients per plan and add-on; payments list (date, client, what for, amount, status) from our payment records; renewals in the next 14 days; failed or cancelled subscriptions; costs panel (Ayrshare profiles used vs the 30 included; Quarks spent by feature), labelled as counted by us, not vendor invoices.
- **Usage (Owner full, Admin summary):** clients using each feature in the last 7 and 30 days and how often; funnel (signed up, finished onboarding, created a post, connected an account, published, paid) with drop-off; Quarks spent per day and per feature; posts published per platform and failure rate.
- **Data honesty:** every number comes from data the app already stores (FeatureEvent, Draft, Campaign, credits history, payment records, connections). Each source is verified while building; anything not measurable shows "not tracked yet".

## Architecture
- **Backend:** new router `/api/staff/*` with `protect` plus a `requireStaff(action)` middleware built on the permission function. Small, focused modules: `services/staff/permissions.js` (pure, tested), `services/staff/clientSummary.js` (one client's summary from several collections), `services/staff/clientList.js` (filters, paging, counts), `services/staff/metrics.js` (home, money, usage aggregates), `services/staff/activityLog.js`. Aggregations use indexed fields; heavy numbers are cached for 5 minutes.
- **Frontend:** `/staff/*` routes in the existing app with their own left menu (Home, Clients, Team, Money, Usage), light Nebulaa design, plain wording (voice scanner applies). The main app menu shows "Staff area" only for staff.
- **Old `/admin`:** keeps working; removed after Coupons, Ayrshare risk panel, trial funnel and content stats are covered.

## Error handling
- Every staff route returns plain messages; permission failures say "This area is for Nebulaa staff" or "Your role cannot do this".
- Partial data never breaks a page: each panel loads separately and shows its own "could not load" state.

## Testing
- Permission table: one test per row and role.
- Last-Owner protection, first-Owner bootstrap refused once an Owner exists.
- Client list filters and counts against fixture data (staff excluded).
- Attention rules (each reason) against fixtures.
- Money and usage aggregates against fixtures; "not tracked yet" when a source is empty.
- Route-order test already guards limiter declarations.

## Build order
1. Roles, permission function, first-Owner bootstrap, activity log, staff menu shell.
2. Clients list and client page.
3. Home.
4. Team.
5. Money.
6. Usage.
7. Remove old `/admin` once covered.
Each step is released and usable on its own.

## Out of scope for now
- Real vendor invoices (Ayrshare, fal, Google, OpenAI) in Money.
- Per-feature permissions beyond the table above.
- Pulsar and Orbit data (added when those apps join the single account).
