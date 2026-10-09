# Prospect Studio (internal sandbox for samples)

Date: 2026-10-09. Status: decisions made by the owner on 2026-10-09; spec only, to be built after the public launch (Sunday). Nothing here is built yet.

## Goal
Let Nebulaa staff make sample posts, images, videos, Blueprints and designed PDFs for a new lead in minutes, without onboarding a client or answering the full questionnaire.

## Decisions (owner, 2026-10-09)
1. **Who:** all staff (Owners, Admins, CSMs) can create prospects.
2. **Money:** a monthly Studio allowance per person, tiered by role. The Owner has no limit and can keep topping up. Usage is tracked per person.
3. **Outputs:** clean. No "Sample for ..." label.

## How it works
**A prospect is a lightweight client account flagged as a sandbox.** It reuses everything that already works: the client-opening pass (acting token), brand memory per account, Create, Hero, Blueprint, Library. No second product is built.

1. **New prospect form (staff area).** Fields: business name (required), website, industry, language, optional logo and colours. Everything else is optional. Saving creates one account with: `isSandbox: true`, `sandboxOwner: <staff id>`, `onboardingCompleted: true`, `isHidden: true`, a placeholder email that can never receive mail (`prospect-<id>@sandbox.invalid`), plan tier `managed` (so no video hold-back and no feature blocks), and a minimal business profile built from the form (the website is read once to fill brand details, as at signup).
2. **Open it** with the existing pass (`/api/csm/clients/:id/open`, generalised to staff). Who may open: the creator, and any Owner or Admin. The permission table gets two actions: `create_prospect` (all roles) and `open_prospect` (creator, Owner, Admin).
3. **Safety rails while in a prospect:** publishing, scheduling, social connection and inbox are switched off (no sample can post to a real account); payments, plan and password changes are already blocked while acting. No emails are sent for the account.
4. **Kept out of business numbers:** hidden accounts are already excluded from staff counts; sandboxes are also excluded from client lists, revenue, health and usage-by-client views, and appear only in a "Prospects" list and in the Studio usage view.
5. **Hand-over to the lead:** every output has Download (image, video, PDF). One-click **Convert to real client**: removes the sandbox flag, asks for a real email, sends the invitation, assigns a CSM, and keeps all samples in the Library.
6. **Tidy-up:** a prospect with no activity for 30 days is archived (not deleted). The creator, an Owner or an Admin can delete one, with a confirmation.

## Quark allowance (how it is enforced without touching the atomic spend code)
- Each staff member has a **Studio allowance per month** (Quarks) and a counter of what they have moved into prospects this month.
- A prospect has its own Quark balance, **funded by the staff member**: "Add Quarks to this prospect" moves Quarks from their allowance into the prospect's balance. The existing atomic deduction then spends from the prospect's balance, so overdraw is impossible and no spend code changes.
- Owner: no limit; each top-up is logged. Admin and CSM: a top-up is refused when it would pass the monthly allowance, with a plain message and "ask the Owner to raise your allowance".
- **Default allowances (editable per person by the Owner in the staff area):** Admin 10,000 Quarks a month, CSM 3,000 a month. For scale: a Hero video is 729, a designed PDF 499, a post image 20. Real provider cost is about 40 percent of the Quark price (a Hero video costs us about US$4.56).
- The counter resets on the first of each month (Asia/Kolkata). Unspent prospect Quarks stay in that prospect until it is archived; on archive or delete the remainder returns to the creator's allowance for that month.
- **Usage view (Owner and Admin):** a table by person and by prospect: Quarks moved in, Quarks spent, outputs made, last activity. It uses the existing activity log.

## Data
- `User`: `isSandbox` (bool), `sandboxOwner` (ref User), `sandboxArchivedAt` (date). Staff `User`: `studio: { monthlyAllowance, usedThisMonth, monthKey }`.
- Activity log entries: `create_prospect`, `fund_prospect` (amount, balance after), `convert_prospect`, `archive_prospect`, `delete_prospect`.

## API (all under the staff area, after `protect` and `requireStaff`)
- `GET /api/staff/prospects` (own, or all for Owner and Admin), `POST /api/staff/prospects`, `POST /api/staff/prospects/:id/open`, `POST /api/staff/prospects/:id/fund`, `POST /api/staff/prospects/:id/convert`, `DELETE /api/staff/prospects/:id`, `PUT /api/staff/team/:id/studio-allowance` (Owner).

## Screens
- A "Prospects" entry in the staff area: list with business name, Quarks left, outputs, last activity, and buttons Open, Add Quarks, Convert, Delete; "New prospect" opens the short form.
- While acting in a prospect, the existing banner for acting-as-client shows "Prospect: [name]" with the Quarks balance and an "Add Quarks" button.

## Tests (no real calls)
- Permissions: all roles create; only creator, Owner and Admin open; a CSM cannot open another CSM's prospect.
- Creation builds the minimal profile; no email is sent; the placeholder address is refused by mail sending.
- Funding: Admin and CSM cannot pass the allowance (atomic, race-safe with parallel top-ups); Owner is unlimited and logged; month rollover resets the counter.
- Publish and schedule are refused in a sandbox; payments blocked while acting.
- Hidden from counts, revenue and client lists; shown in the Prospects list.
- Convert removes the flag, requires a real email, keeps drafts; archive returns the remainder.

## Risks and notes
- **Provider spend is real.** The allowance is the control; keep provider-console spend caps as the last safety net.
- **Brand material of a lead is used before consent.** Sample use of a lead's public website and logo is normal sales practice, but samples must not be published. Publishing is switched off for this reason.
- **Do not build before launch.** It touches staff access and permissions; build it after Sunday so the security-sensitive release is not changed late.

## Not in scope
Sharing a live link to a prospect workspace with the lead, a lead-facing portal, automatic follow-up emails, templates of sample packs.
