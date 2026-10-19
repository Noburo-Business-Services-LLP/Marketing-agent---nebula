# Decisions log: overnight autonomous run, 2026-10-20 (owner asleep)

The owner said: "continue building the whole thing and finish it off yourself ... don't ask for any approvals or suggestion ... take a call yourself and keep a record ... when the usage limit reaches 96 or 97%, commit all the changes and create a handover document." This file records every call the assistant made on its own so the owner can check or reverse any of them in the morning. Newest entries at the bottom. Each entry: what, why, how to reverse.

## Standing limits I kept (not decisions, rules that still apply)
- No release to production (the owner runs `release-prod.sh`). No change to production data, keys, or `.env`.
- No paid or real provider call (models, video, images, scrapers, transcription) even though he said "no approvals": his earlier rule was an OK for each paid run, and "no approvals" was not an explicit OK for spending money. Everything is built and tested with fakes; the real-proof runs stay in the owner's list. (Decision D1.)
- Stop at 96 to 97% of the usage window: commit, push, handover (`docs/superpowers/HANDOVER-nebulaa-redesign-<next number>.md`, check numbers first).

## Decisions
- **D1 (2026-10-20, 00:00)** No paid real calls overnight. Why: spending money is not reversible and he did not name an amount; the ledger rule is "OK for that run". Reverse: tell the assistant which real proofs to run (list in the handover owner steps).
