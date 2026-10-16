# Agency plan: design

Date: 2026-10-16. Status: for the owner's review. Nothing is built yet.

## Purpose

Marketing agencies and freelancers run social content for several client businesses. Today one Nebulaa account is one business. The agency plan lets one paying account run many client brands, each with its own brand details, calendar, library and connected social accounts, paid from one shared pool of Quarks.

Success looks like this:
- An agency signs up, pays once a month, adds a client, switches into it, and makes and schedules posts and videos exactly as a single-business customer does.
- Every Quark spent is paid from the agency's one pool, and the agency can see how many posts and videos each client used.
- Nothing about a client's brand, files or social accounts leaks into another client's.

Said by the owner: shared pool; 5 clients included and extra clients at Rs 799 up to 25; agencies keep topping up; managed-service customers stay as they are; opened for self-service now.
Assumed by me (to be confirmed): the numbers in "Plan and price", and that agencies invoice their own clients themselves.

## Out of scope for the first version

- Invoices that the agency sends to its own clients. They get a usage report instead.
- Several people logging in to one agency (team seats). The agency has one login.
- A client logging in to see their own brand.
- A separate Quark balance per client.
- Moving an existing single-business account into an agency.

## How it works

### One hidden account per client brand

Each client brand is a normal user record with no login, owned by the agency (`agency.ownerId`). It is called a client workspace in the product and the code. Almost every feature stores its data against a user id (47 collections), so Calendar, Library, brand details, connected socials, inbox and competitors work per client with no change to them. The alternative, adding a workspace id to every collection and every query, touches hundreds of places and risks a client seeing another client's data. We do not take it.

New fields on `User`:
- `agency.ownerId`: set on a client workspace, pointing to the agency account. Unset everywhere else.
- `agency.clientLimit`: on the agency account. 5 plus extra client add-ons, capped at 25.
- `agency.workspaceName`: the client's display name.

A client workspace has no email or password of its own. It is never listed as a customer and never gets customer emails. Its business profile is filled in the same way as onboarding, from inside the client.

### Switching into a client

A client switcher in the header lists the agency's clients. Choosing one issues a short-lived pass for that workspace that names the agency owner, the same way the existing CSM pass works. Every request with such a pass re-checks that the agency account is still active and still owns that workspace.

While inside a client, these stay blocked, so money and identity stay with the agency account: payments and plans, password change, account deletion, and the Clients page itself. Choosing "Back to agency" returns to the agency's own pass.

### One shared pool of Quarks

The pool lives on the agency account, in the same plan and top-up buckets every account already has, with the same month-end expiry for plan Quarks and 60 days for top-ups.

All spending and refunds go through one place (`deductCredits`, `refundCredits` and `quarkBuckets.spend`, used by all 89 call sites). A new step in front of them, `payerFor(userId)`, returns the agency owner when the user is a client workspace, and the user itself otherwise. Charges and refunds then land on the agency's buckets. The ledger row records both the payer and the workspace, so usage per client can be summed.

When the pool is empty, the same "not enough Quarks" prompt appears. Inside a client it points the person to the agency account to top up, because billing is blocked there.

### What a client workspace can use

Plan and add-on checks (`resolveTier`, `canUse`, add-ons) read the agency account's plan for a client workspace. The agency plan includes Publish and schedule, Inbox and automatic replies, and Competitor insights, because an agency with no publishing has no use for the plan. Free Blueprints do not apply inside a client workspace: a Blueprint there runs on the paid path and costs Quarks, so the free offer cannot be farmed with extra clients.

### Plan and price

| | Price (ex-GST) | Includes |
|---|---|---|
| Agency | Rs 6,999 a month | 5 clients, 6,000 shared Quarks, all three feature add-ons |
| Extra client | Rs 799 a month each, up to 25 clients in total | 500 more Quarks each, one more client slot |
| Top-up | Same packs as everyone | Added to the agency's pool |

Roughly 545 posts or 37 videos a month in the pool at 5 clients. The price per Quark is about Rs 1.17 against Growth at Rs 1.00 and top-ups at Rs 2.10. Margin is about 40% if cost is about Rs 0.70 a Quark, which comes from the 30% Growth margin already accepted. This must be re-checked against real costs before launch, see "Open items".

Billing reuses what exists. `agency` becomes a plan id with its Razorpay plan; "extra client" is an add-on with a quantity, built on the existing add-on subscriptions. The numbers are config in `apiCosts.js` only, never written anywhere else. Customers see posts and videos, never Quarks, in line with the other plans.

### What the agency sees

- **Clients page** (agency only): list of clients with name, last activity and this month's use (posts, videos). Add, rename and remove a client. Shows "3 of 5 clients" and a button to add a slot.
- **Header switcher**: the current client's name is always visible when inside one.
- **Dashboard (agency view)**: shared pool left, and a table of use per client for the month.
- **Usage report**: per client and month, downloadable as CSV, built from the ledger.

### Removing a client, and deleting an agency

Removing a client runs the existing deletion engine on that workspace (files, connected social profile, data) after confirming. There is no 14-day wait for a workspace because the agency account is the one that confirms with a password. Deleting the agency account deletes all its workspaces first. The data registry test already fails if a data model is missed, so it covers the new case too. Eligibility for self-delete: an agency account is allowed, and it lists the clients that will go.

Cancelling the agency plan: clients keep their data, nothing can be made, and the agency has until the plan ends to export. Clients above the limit after a downgrade are frozen, never deleted automatically.

### Limits and abuse

- The client limit is enforced when a client is created, in one atomic update, so two requests at once cannot go over it.
- Quarks are shared, so one client cannot starve the platform; the existing per-day spend cap and kill switches apply to the agency account's total.
- A workspace cannot be created without an active agency plan.

### Error handling

- A client workspace whose agency is deactivated or has no active plan shows the "ask the agency to renew" message and cannot spend.
- A pass for a workspace that was removed is rejected on the next request.
- If the payer lookup fails, the spend is refused, never charged to the client record.

### Testing

- Unit tests for `payerFor`, the client limit (including concurrent creation), usage-per-client sums, the blocked-while-inside list, plan and add-on inheritance, and the agency price config.
- A cross-client test: data made in client A is never returned in client B or the agency's own account.
- Frontend tests for the usage and limit helpers.
- A real run on the dev database with throwaway accounts: create agency and two clients, spend in each, check the pool, ledger and report, switch back and forth, remove a client, delete the agency.
- Brand and voice audits, the wording guard (no "credit", "trial", "7 days"), and the visual layer lists.

## Open items

1. **Connected social accounts cost per client.** Each client's connected social accounts are a separate Ayrshare profile, and Ayrshare charges by profile. At 5 to 25 profiles per agency that may change the margin. Check the Ayrshare price per profile before fixing Rs 6,999 and Rs 799.
2. **Real cost per Quark.** Measure instead of using the Growth-derived figure.
3. **GST on agency invoices.** Same as other plans, to be confirmed with Subashni together with the SAC code.
4. **Terms and Privacy.** An agency holds its clients' data, so the Terms need a short clause that the agency has its clients' permission, and the Privacy Policy should say the agency is the one who decides about that data. Lawyer review.
5. **Agency staff seats.** Left for later if agencies ask.
