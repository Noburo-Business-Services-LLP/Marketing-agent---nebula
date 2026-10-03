# Nebulaa app voice — plain, professional language across the product

Status: nav glossary approved 2026-10-03; AI-content voice: decided NO change (written 2026-10-03 from Dinesh's direction). Branch: `nebulaa-redesign`. Companion to `2026-10-03-nebulaa-foundation-design.md` (part 1) and the later page sweep (part 2).

## Why

The app was written in the early website voice: short bursts, social-media and Gen Z phrasing, personified software ("drafted the week ahead while you slept"). The website has since been rewritten into plain professional language. The app is a product people use every day, so its language must do three things: let a customer understand every screen on the first read, make the next step obvious, and feel calm and competent so that returning to work in it is effortless.

## The rule

Every customer-facing sentence in the app is written in **complete, plain, professional sentences** that say what something is, what has happened, or what the customer needs to do next. The standard is the one the website guide already sets: *could this sentence appear in a serious company's product documentation, read aloud, without anyone's tone changing?*

Authority: `nebulaa-ai-website/.claude/brand-voice-guidelines.md` (the 8 "AI copy" tells and the Do/Don't list). That guide is the source of truth for tone. This spec adds only what a product interface needs on top of it.

## Interface rules added for a product (the website guide does not cover these)

1. **Tell the customer what happens next.** Buttons say the action in full ("Approve and schedule", "Save brand profile"). Confirmations say the consequence ("This post will publish on Instagram on 12 October at 9:00 am.").
2. **Empty states explain what will appear here and how to begin**, in one or two complete sentences with a single clear action. They never joke or console ("Enjoy a slower day").
3. **Errors say what went wrong and what to do**, without blame or technical detail ("We could not connect to Instagram. Check that your account is a Business account, then try again.").
4. **Progress and loading text states what is happening** ("Preparing your images. This usually takes about a minute.") and never narrates the product's feelings.
5. **No personification of the product** (it does not "dream", "while you slept", "have a look", "get cracking"). The product does work; it does not have moods.
6. **No slang, no exclamation marks, no emoji in interface text, no rhetorical questions as headings, no mirrored wordplay, no fragment-and-reveal headings** (tells 1 to 8 of the website guide apply to the app unchanged).
7. **One term per concept.** The glossary below fixes the vocabulary; the same thing is never called two names on two screens.
8. **Sentence case** for headings, buttons and labels; numbers and dates written in full and consistently; the customer is addressed as "you", the product as "Nebulaa".
9. **Warm without being casual.** Courtesy is allowed ("Thank you", "Please connect an account to continue"); familiarity is not.
10. **Legal pages (Terms, Privacy) stay in their legal register** and are not rewritten here.

## Before and after (proposals, to show the standard; final wording is written page by page)

| Where | Today | Proposed |
|---|---|---|
| Dashboard heading | "0 posts are ready for your eye." | "No posts are waiting for your review." |
| Dashboard intro | "Nebulaa drafted the week ahead while you slept. Take a minute, tap through, and we'll handle the rest — scheduled, posted, measured." | "Nebulaa prepares your content for the week ahead. Review each post, approve the ones you want, and Nebulaa schedules and publishes them for you." |
| Calendar empty state | "Nothing on the schedule for today. Enjoy a slower day." | "No posts are scheduled for today. Open the calendar to schedule one." |
| Approve empty state | "When Nebulaa drafts new posts, they'll wait here for your approval." | "New posts that Nebulaa prepares will appear here for your approval." |
| Setup banner | "Connect your social accounts and confirm brand voice — 2 minutes." | "Connect your social media accounts and confirm your brand voice. This takes about two minutes." |

## Glossary (navigation names approved by Dinesh on 2026-10-03; Quarks keeps its name until he decides otherwise)

Customer-visible terms stay the same in code (routes, file names, API fields do not change). Only the displayed words change.

| Today | Proposed display term | Note |
|---|---|---|
| Dashboard | Home | or keep "Dashboard"; either is plain |
| Create | Create content | |
| Videos | Videos | unchanged |
| Approve | Review and approve | |
| Calendar | Calendar | unchanged |
| Idea Inbox | Content ideas | removes inbox/creator vocabulary |
| Upload & Schedule | Upload and schedule | |
| Insights | Performance | |
| Brand Assets / Connect Socials / AI Memory | Brand assets / Connected accounts / Brand memory | "AI Memory" is internal jargon |
| Quarks | Credits (display name to be confirmed with Dinesh) | pricing term; **not renamed without his decision** |
| Hero video | Hero video | unchanged |

The navigation names above were approved by Dinesh on 2026-10-03. "Quarks" is not renamed: the pricing term stays as it is until he decides otherwise.

## Scope

**In scope (interface text):** headings, labels, buttons, helper text, placeholders, tooltips, empty states, confirmations, errors, toasts, onboarding, setup banners, nav labels (after approval), Hero Studio copy, and the customer emails and messages the backend sends (OTP, welcome, trial, payment, support).

**Out of scope (Dinesh decided on 2026-10-03: do not change):** the **voice of the AI-written content** (the prompts that tell the AI how to write captions, replies, scripts and image prompts). That text defines what every customer's published posts sound like, so changing it alters generated output and needs before-and-after samples reviewed. Dinesh decided it stays as it is. Do not edit those prompts as part of this work.

Also out of scope: Terms and Privacy wording (apart from the product name already changed), the website itself, and any renaming of routes, files, or API fields.

## How it is applied

Part 2 (the page sweep) already touches every page to move it onto the colour tokens. **The voice rewrite is done in the same per-page pass**, so no file is edited twice. Each page task therefore delivers: tokens, rewritten copy to this spec, and a visual check. Pages already on tokens (the `Gravity*` pages, the shell, Hero Studio, AI Memory) are rewritten first, since they are the most visible and need no restyling.

Per page, the implementer:
1. Lists every customer-visible string on the page (headings, text, buttons, placeholders, titles, aria labels, toasts, errors, empty states).
2. Rewrites each to the rule and the interface rules above, keeping every fact and number unchanged, inventing no claims, and never changing keys, routes, values the code compares, or API fields.
3. Records before and after for every changed string in the task report (a table), so Dinesh can read the whole rewrite page by page.

Review per page uses a voice reviewer with this spec and the website guide as the rubric: any remaining tell, any invented claim, any changed data string, any sentence that does not say what happens next, and any inconsistency with the glossary is a finding.

**Mechanical guard (extends the existing brand scanner):** `frontend/scripts/voice-audit.mjs` flags in customer-visible strings: exclamation marks, emoji, a short list of banned slang and filler words (for example "no fluff", "game-changer", "supercharge", "unlock", "seamless", "vibe", "lit", "gonna", "wanna", "hey"), "Not X — Y" openers, and em-dash reveal patterns. It is a floor, not the whole standard: judgement-based tells (personification, fragments, wordplay) are caught in review. It runs as a test alongside the brand scanner, with a short justified allowlist.

## Success

A new customer can read any screen once and know what it is for and what to do next. No screen contains a slang term, an exclamation mark, a personified product, or a performed fragment. Terms are consistent across the app. Every changed string is recorded before and after.

## Open questions for Dinesh

1. ~~Glossary and nav labels~~ approved 2026-10-03; "Quarks" unchanged.
2. ~~AI-written content voice~~ decided 2026-10-03: no change.

## Risks

- Long rewrites of a large app can drift from the facts; the before/after table and the "no invented claims" rule are the controls.
- Plain complete sentences are longer than the old fragments; buttons and navigation labels must still fit. The visual check at phone width catches overflow.
- Changing display terms (for example Insights to Performance) must not change routes or analytics keys; display-only.
