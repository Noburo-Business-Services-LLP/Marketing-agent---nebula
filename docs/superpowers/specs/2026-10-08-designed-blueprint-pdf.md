# Designed Blueprint PDF (image edition)

Date: 2026-10-08. Status: approved direction (owner, 2026-10-07, hand-over 4 section 3); built in this change. Spec and plan in one file.

## Goal
Turn a finished Brand Growth Blueprint into a designed, shareable PDF like the owner's references (`Amalga Proposal.pdf`, `Aval Aran_ Brighter Communities Blueprint.pdf`): every page one A4 image, one idea per page, brand colours, a page marker, "Prepared by Nebulaa" and a closing contact page. The existing HTML Blueprint stays: it is the instant, exact, cheap preview and the fallback.

## What the references show (opened and checked)
- A4 portrait pages (595 x 842 pt), no live text, merged into one PDF. 11 pages (Amalga) and 9 pages (Aval Aran).
- Page 1 is a cover with a big headline and people; the middle pages each carry one idea as an infographic (cards, icons, step flows); the last page is a thank-you page with contact details.
- One colour set and one lettering style across all pages.

## Design
1. **Edition is an add-on to a finished Blueprint.** The customer first gets the HTML Blueprint (existing flow). A button "Get the designed PDF" starts the image edition for that Blueprint.
2. **Pages:** cover + the nine existing content pages + a closing contact page = 11 pages.
3. **Copy deck first (no AI).** `designedDeck.js` builds the exact short text of every page from the finished Blueprint data. Facts keep their tags in the HTML; in the PDF only text that survived the existing QA gate appears. Nothing is invented; digits appear only when they were already in the Blueprint.
4. **Image per page.** OpenAI image model at 1024x1536 (high quality), prompted with a shared style spec (brand colours, industry look, lettering feel), the exact page text, and a reserved empty corner for the real logo. The model never draws the logo.
5. **Check every page.** A vision model transcribes the text it can read in the image; code (not the model) compares the transcript with the planned lines. A page passes when at least 75 percent of the lines are present and no number appears that is not in the planned text. Up to 2 regenerations per page. A page that still fails is replaced by a plain page made by code from the same text, so the PDF is always complete and always exact.
6. **Code finishes each page:** crop to A4 proportions, place the real logo unchanged, add the page number ("03 / 11") and "Prepared by Nebulaa", and a small "Illustrative imagery" note on pages where AI-made people or scenes may appear.
7. **Merge** the pages into one PDF (`pdf-lib`, new dependency) and store it; the app shows page previews and a download button.
8. **Quarks:** price derived in `config/apiCosts.js`: `blueprint_pdf` = 11 pages x (image rate x 1.4 retry factor + vision check) + storage, times the default margin. Image rate verified on 2026-10-08 from OpenAI's own guide: GPT Image 1, high, 1024x1536 = US$0.25 (GPT Image 2 is US$0.165; Image 1.5 is US$0.20). The code keeps a rate table and prices the model it actually uses. Charged once when started, refunded once if nothing usable is produced (claimed atomically, like the existing Blueprint runner).
9. **Free or paid** is the owner's decision once real cost is known; this build charges Quarks like any other action.

## Data
`Blueprint.designed`: `{ status: queued|processing|completed|failed, startedAt, completedAt, pages: [{ n, id, status: pending|ok|fallback, attempts, imageUrl, note }], pdfUrl, charge: { state, quarks }, error }`. Page images are stored as hosted files, not in the database.

## API
- `POST /api/blueprint/:id/designed`: start (owner of a completed Blueprint only; one edition at a time; charge once).
- `GET /api/blueprint/:id` already returns the Blueprint; it now also returns `designed` (status, page list with thumbnails, pdfUrl).

## Tests (no real calls)
- Deck: every page has a title and short lines; no invented digits; the closing page shows only contact details that exist.
- Prompt: contains the exact lines, the colours and the reserved-corner instruction, and forbids drawing the logo.
- Transcript matching: tolerant of case, punctuation and spacing; fails on missing lines and on invented numbers.
- Page compose: A4 crop size, logo and page marker present (sharp on small fake images).
- Fallback page: made from text, exact.
- PDF merge: N pages in, N pages out.
- Runner with a fake image provider and a fake vision checker: a page that fails twice becomes a fallback; the PDF still completes; Quarks are charged once and refunded once when everything fails.
- Price: derived, not hard-coded.

## One real run
After the build, one real run on a throwaway Blueprint, with the image spend stated and approved by the owner first (estimate US$4 to 5).

## Not in this change
Per-page retry buttons, free-versus-paid decision, translating the PDF into other languages.
