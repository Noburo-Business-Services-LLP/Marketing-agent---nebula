# Auth cache audit (2026-10-20)

Why: the load test (ledger, NFT item) measured `protect` (`backend/middleware/auth.js`) at about 6.1 ms per request,
because it loads the FULL user document (with `businessProfile`, payments, credit history, socials) from MongoDB on
every signed-in request. Session check, credits, notifications and unread count had p90 276 to 660 ms at 50 TPS.

This file is the audit that decides how far a lean, cached user can go. The design that follows from it is in
`auth-cache.md`.

## How `req.user` is used (counts from grep over routes, controllers, middleware, services, server)

60 files read `req.user`.

| Read | Count | Lean-safe? |
|---|---|---|
| `req.user.id` | 145 | Only if `id` is added by hand (it is a Mongoose virtual; a lean object has none). The cached user adds `id` as a string. |
| `req.user.userId` | 115 | Always written as `req.user.userId \|\| req.user.id \|\| req.user._id`; `userId` is undefined on the full document too, so the fallback is what runs today. Same on the cached user. |
| `req.user._id` | 101 (+4 `._id.toString()`) | Yes (ObjectId kept on the lean copy). |
| `toUserId(req.user)`, `idOf(req)`, `userIdOf(req)`, rate-limit `keyGenerator`s | about 70 | Yes (they read `_id` or `id`). |
| Whole `req.user` handed to a function (`user: req.user`, `fn(req.user)`, `const user = req.user`) | about 150 sites in 23 route files | Not without reading each callee. See "needs-document" below. |
| Other direct fields: `isCsm`, `staffRole`, `businessProfile`, `companyName`, `industry`, `ayrshare.profileKey` | 8 | Only with those fields in the projection (they are not, on purpose). |

### (a) `.id` vs `._id`
Both are used everywhere, often mixed in one file (`videoGeneration.js`, `contentCalendar.js`, `campaigns.js`). Any
lean `req.user` must carry both `_id` (ObjectId) and `id` (string), which the cached user does.

### (b) Methods, virtuals, getters on `req.user`
Direct calls on `req.user` itself (`req.user.save()`, `.toObject()`, `.set()`, `.isModified()`, `.comparePassword()`,
`.toPublicJSON()`, `.populate()`): **none found**. The document methods in the code base
(`user.save()` 40+ times in `social.js`, `auth.js`, `googleCalendar.js`, `brand.js`, `payment.js`, `creditGuard.js`;
`comparePassword` in `auth.js` and `accountDeletion.js`; `toPublicJSON` in `auth.js`) are all called on a user the
handler or service loads itself with `User.findById`. Not checked line by line: every service that receives the whole
`req.user` (list below). Some read nested fields (`businessProfile.*`, `plan.tier`, `credits.balance`,
`agency.*`, `ayrshare.*`, `setup.*`, `planState.*`, `connectedSocials`), which a projected copy would lack.

### (c) `req.user.x = ...; await req.user.save()`
None directly on `req.user`. Aliases: `routes/account.js` (`const user = req.user` in `/status` and
`/deletion/request`, then `del.requestDeletion({ user })`), `routes/week.js:126`. These stay on the full document.

### (d) Places that need FRESH money or plan state
Every charge, refund, balance and entitlement path. They mostly reload the user by id themselves
(`trialGuard`, `creditGuard`, `requireFeature`, `quarkBuckets`, `agency.walletBalance`), but some read
`req.user` fields directly (`homeSummary` reads `user.credits.balance`, `plan.tier`, `agency.*`; `photoshoot`,
`homeDrafts`, `blueprint`, `plan`, `week` pass `req.user` into services that resolve the tier or the payer).
All of these keep today's full, fresh document.

### (e) Agency, CSM passes and staff
- Pass tokens: `issueAgencyPass` signs `{ id: workspaceId, actingAgency: ownerId }`; `issueActingToken` signs
  `{ id: clientId, actingCsm: csmId }`. `protect` loads the CLIENT as `req.user` and re-checks the owner or CSM on
  every request (`_agencyPassProblem`, `canActFor`), then blocks payment/plan/password URLs
  (`isBlockedInsideClient`, `isBlockedWhileActing`). So an owner session and a client pass name different users;
  a cache key must still include the pass context, because a CSM pass and the client's own login name the same
  `id` but differ in `req.actingCsm`.
- Checks need from the client: `isActive`, `deletion.status`, `deletion.purgeAfter`, `agency.ownerId`,
  `agency.frozen`, `staffRole`, `isCsm`, `assignedCsm`. From the owner: `isActive plan subscription.status
  agency.ownerId deletion.status` + names. From the CSM: `isCsm staffRole isActive` + names. (Owner and CSM are
  already loaded lean today.)
- Staff: `requireStaff` reloads the staff user by id; `routes/staff.js` uses `router.use(protect)` and writes users
  (roles, CSM assignment) through `User.updateOne/updateMany/findByIdAndUpdate`. `routes/csm.js` reads
  `req.user.isCsm` and calls `canActFor(req.user, client)` (needs `staffRole`, `isCsm`, `isActive`, `_id`).
- Admin uses its own `adminAuth` (a separate `{ role: 'admin' }` token), not `protect`.

## Writes to `User` (for invalidation)

All writes found go through the Mongoose `User` model (or the same model injected as `models().User` /
`UserModel`): `updateOne` (payment 12, staff 9, agencyWorkspaces 7, tour 4, renewalReminders 2, inboxWebhook 2,
accountDeletion 2, account 2, quarkBuckets 1, auth 1), `findOneAndUpdate` (payment 5, quarkBuckets 2, agencyWorkspaces 1,
renewalReminders 1), `findByIdAndUpdate` (auth 6, staff 2, dashboard 2, trialGuard 1), `updateMany` (staff 4,
agencyWorkspaces 1), `deleteOne` (accountDeletion 1), `create` (auth, staff, agencyWorkspaces), and `doc.save()`
(about 40 sites). No raw driver write to the `users` collection exists in app code (only
`services/migrationService.js`, a one-off copy between databases that inserts and never updates).
Conclusion: hooks on the User schema (save, every update/delete query op, bulkWrite, insertMany) catch every write,
including the central spend/refund helpers, the Razorpay webhook paths, password change and reset, deletion, role
changes, workspace create/remove, verification and agency freeze/unfreeze. Nothing has to be hooked route by route.

## Route groups classified

"Lean-safe" = `req.user` is used only for its id (or the handler reloads the user itself) and nothing money/plan
related reads `req.user`. "Needs-document" = whole `req.user` goes into services that read nested fields or may write.
"Needs-fresh" = money, plan, entitlement, password, role or account-state path.

| Class | Count | Route groups (files under `backend/routes/` unless noted) |
|---|---|---|
| lean-safe | 18 | notifications, reminders, brandAssets, ideas, createAssist, googleCalendar, brand, accounts, competitorHandle, competitors, draftLocalize, collaborationRoutes, influencerRoutes, submissionRoutes, analyticsRoutes, credits GET `/` and `/history` (reload the user fresh inside), auth GET `/me` and `/business-context` (reload inside) |
| needs-document | 19 | account, agency, aiMemory, aiMemoryLearned, analytics (`resolveOrganizationId(req.user)`), chat, competitorBestPosts, competitorInsights, csm, listening, performanceView, plan, products, prompts, social (`ayrshare.profileKey`, `requireOwnProfileKey(req.user)`), tour, week, heroVideo, videoGeneration |
| needs-fresh | 19 | payment, studioVideos, drafts, campaigns, carousels, content, contentCalendar (schedule gating), dashboard, adCampaigns, ads, socialInboxRoutes, staff, auth (every write route: change-password, update-profile, onboarding, logout), seoRoutes, photoshoot, homeDrafts, blueprint, home `/summary` (reads balance and plan from the user), admin (own auth) |

## Verdict

A default-lean `protect` with opt-outs is NOT safe without a line-by-line read of about 150 call sites that hand
the whole `req.user` to services (23 files, including every video, plan, week and photoshoot path), several of which
read nested money or plan fields. That is a large rewrite with a high blast radius on plan gating and money.

So the shipped version is the smaller safe one the task allows:
- `protect` is unchanged: full, fresh Mongoose document on every request, never the cache. Every route not listed
  below (all needs-document and needs-fresh groups, and the lean-safe groups not yet switched) behaves exactly as
  before.
- A new `protectCached` is used only on the hot read routes: `GET /api/auth/me`, `GET /api/credits`,
  `GET /api/credits/history`, `GET /api/notifications`, `GET /api/notifications/unread-count`,
  `GET /api/home/summary`. The first four already reload the user (or need only the id); `/home/summary` reloads a
  fresh full document with `req.loadFullUser()` whenever its own 60 s cache misses, so balance and plan are never
  read from the auth cache.
- Invalidation is central (User schema hooks), so it also covers routes added later.
- The other lean-safe groups are candidates for a follow-up switch (one line each), after a check that each GET
  really reads only the id.
