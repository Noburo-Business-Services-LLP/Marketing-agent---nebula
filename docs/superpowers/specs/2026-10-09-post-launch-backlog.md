# Post-launch backlog (agreed 2026-10-09, build AFTER the Sunday public launch)

Owner decisions are recorded; nothing here is built yet unless marked.

## 1. Hero video realism strength (owner chose "Medium")
Replace the single Realism toggle with a strength choice: **Off, Natural (today's mild grade), Phone (the "Medium" test), Raw (the "Strong" test)**. Default: **Phone for UGC style, Natural for Brand film**. The new strengths REPLACE the mild grade, they are not stacked on it.
The Medium recipe the owner approved (tested 2026-10-09 on "Travel influencer in Pondy Villa", 720x1280):
`eq=contrast=0.88:saturation=0.86:gamma=1.04, gblur=sigma=0.45, noise=alls=9:allf=t+u, vignette=PI/7, handheld crop (scale 1.06, sway amplitude 9 and 3 px at 1.3 and 3.1 Hz), scale 560x996 then back to 720x1280 (bicubic), x264 crf 25`.
Raw/Strong: contrast 0.84, saturation 0.78, gamma 1.05, warm colorbalance rs=0.03 bs=-0.03, gblur 0.8, noise 15, vignette PI/6, sway 13 and 4 px, scale via 480x854, crf 27.
The test videos are in the owner's `Downloads/grade-test/`. Work lives in `backend/services/heroVideoFinish.js` (`buildFinishFilterGraph`, `normalizeFinishOptions`); the logo overlay must stay after the grade.
Also: UGC prompt changes (no grin straight to the lens, mid-action expressions, everyday uneven-light settings, imperfect framing).

## 2. Tamil (and other Indian language) voice for Hero videos
Seedance generates its own audio (`generate_audio: true`); Tamil speech sounds synthetic. Plan: Stage 1 voice-over with ElevenLabs (Seedance in "Effects only" sound mode, voice mixed in the finish step); Stage 2 lip sync for talking-to-camera clips after testing 3 lip-sync models with Tamil. Needs the owner's OK for a small test spend, and his voice and tone choice. Price from real provider rates in `apiCosts.js`.

## 3. Prospect Studio
See `2026-10-09-prospect-studio.md`.

## 4. Security follow-ups (from the 2026-10-08 review)
Encrypt stored social and calendar tokens; self-service account delete and export (DPDP); session revocation and sign out everywhere; end sessions on password reset; optional customer MFA; Content-Security-Policy header; third-party penetration test within 60 days; SOC 2 readiness. AWS tasks (owner): root keys and MFA, WAF, 2+ containers with autoscaling, CloudTrail, GuardDuty, alarms, HTTPS redirect on port 80, SSH on the old server.

## 5. Small items
- Labels on the Logo position grid in Create (top left, bottom right and so on).
- Alert in the staff area and to `ALERT_EMAILS` when a provider reports an exhausted balance (found 2026-10-09: the fal.ai balance ran out and Hero videos failed; Quarks were refunded correctly).
- Per-page retry and the free-or-paid decision for the designed Blueprint PDF; logo placement on a real Blueprint.
