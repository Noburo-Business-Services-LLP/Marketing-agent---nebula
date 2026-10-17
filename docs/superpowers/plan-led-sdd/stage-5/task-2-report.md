# Task 2 report: pure scoring helpers

Commit 4af8e95. Files: `backend/services/listening/helpers.js`, `backend/tests/listeningHelpers.test.js` (58 tests), `backend/config/listening.js` (ABUSE_WORDS extended).

## Signatures (all pure, never throw)
- `eligibleItem(item, now, { userId }?) -> boolean` (optional own-account check when both ids are present)
- `kindOf(item) -> 'public'|'private'` (unknown type is private)
- `makeBatches(items, size = BATCH_SIZE) -> item[][]` (bad size falls back to BATCH_SIZE)
- `buildPrompt(batch) -> string` (items may be objects with `body`/`text`, or strings; markers `<<<COMMENT n>>>`, one `<<<END>>>`)
- `parseReply(raw, batchLength) -> Map<0-based index, {label, reason}>`
- `aggregate(rows, now) -> { period:{from,to,total,positive,neutral,negative,pct:{positive,neutral,negative}}, recent:{total,negative}, baseline:{total,negative}, enough, reasons }`; `from`/`to` are India dates `YYYY-MM-DD`
- `percentages(counts) -> {positive,neutral,negative}` sums to 100
- `trendSentence(agg) -> string|null`
- `safeQuoteText(text) -> string|null`
- `pickQuotes(candidates, now?) -> [{id,label,platform,itemAt,text}]` (label is `pos`/`neg`; `now` optional, filters to the 28 India days)
- `truncateAtWord(text, max)` (grapheme-safe, word boundary; no ellipsis; use for the "Recently negative" preview)

## Decisions and deviations
- Windows are India calendar days ending today, not rolling hours: period = today and the 27 days before (so "20 September to 17 October" is exactly the counted range), recent = last 7 days, baseline = the 28 days before that (days 8 to 35). An item at 28 days and 0 hours back is out. Items later than `now` are ignored.
- Duplicate ids in a model reply: both copies are dropped (neither is trusted), not "keep the first".
- Percentages: largest remainder, ties go to positive, then neutral, then negative; a zero count never gets a point.
- Trend sentence is also null when `enough` is false. The reason tail is appended to all three sentences when the leading negative reason (ties by REASONS order) covers at least half of the period negatives; `other` and `praise` never produce a tail; `product` reads "the product", `question` reads "questions".
- Lengths (body 3 to 1000, quote 20 to 160) count code points so Tamil/Hindi clusters are not split by a UTF-16 count; grapheme clusters (Intl.Segmenter) are used for truncation only (Indic conjuncts make grapheme counts too small for the minimum). Over-long quote text is rejected, never truncated (spec: shown as stored).
- Safety filter is stricter than the brief: any `@` rejects, `at ... dot com` and `[at]` forms, digits in any script (Devanagari, Tamil), common TLDs without a scheme, obfuscated abuse (`f*ck`, `b!tch`, spaced letters, repeated letters). Prompt comment text is collapsed to one line and `<<`/`>>` runs are neutralised so a comment cannot forge a marker.
- ABUSE_WORDS extended (English, slurs, violence/adult, Hindi/Marathi/Tamil/Telugu/Kannada transliterations, a few native-script words) with a comment saying it is a minimum and the final review should confirm. Words like `die`, `kill`, `hell`, `sucks`, `thief`, `liar` are included on purpose (a skipped quote costs nothing).

## Concerns
- Address pattern and the digit rules will reject some harmless comments (dates like 12.10.2025). Accepted: skipping is safe.
- The abuse list cannot be complete for Indian languages; final review should confirm, or the owner should have a native speaker read it.
- ReDoS checked informally on 160-char adversarial strings (under 120 ms including regex compile); text is length-checked before the filters run.
- Tests: backend 1629 pass, 0 fail (1571 + 58).
