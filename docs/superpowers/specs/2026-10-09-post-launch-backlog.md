# Post-launch backlog (agreed 2026-10-09, build AFTER the Sunday public launch)

Owner decisions are recorded; nothing here is built yet unless marked.

## 1. Hero video realism strength (owner chose "Medium")
Replace the single Realism toggle with a strength choice: **Off, Natural (today's mild grade), Phone (the "Medium" test), Raw (the "Strong" test)**. Default: **Phone for UGC style, Natural for Brand film**. The new strengths REPLACE the mild grade, they are not stacked on it.
The Medium recipe the owner approved (tested 2026-10-09 on "Travel influencer in Pondy Villa", 720x1280):
`eq=contrast=0.88:saturation=0.86:gamma=1.04, gblur=sigma=0.45, noise=alls=9:allf=t+u, vignette=PI/7, handheld crop (scale 1.06, sway amplitude 9 and 3 px at 1.3 and 3.1 Hz), scale 560x996 then back to 720x1280 (bicubic), x264 crf 25`.
Raw/Strong: contrast 0.84, saturation 0.78, gamma 1.05, warm colorbalance rs=0.03 bs=-0.03, gblur 0.8, noise 15, vignette PI/6, sway 13 and 4 px, scale via 480x854, crf 27.
The test videos are in the owner's `Downloads/grade-test/`. Work lives in `backend/services/heroVideoFinish.js` (`buildFinishFilterGraph`, `normalizeFinishOptions`); the logo overlay must stay after the grade.
Also: UGC prompt changes (no grin straight to the lens, mid-action expressions, everyday uneven-light settings, imperfect framing).

## 2. Regional-language voice for Hero videos (ElevenLabs voice + lip sync)
Finding (owner, 2026-10-09): Seedance generates its own audio (`generate_audio: true`) and its Tamil speech sounds synthetic; ElevenLabs gives real-sounding Tamil narration with the right voice. The same is expected for other Indian languages.

**Routing rule (owner decision):** use the ElevenLabs + lip-sync path ONLY when BOTH are true:
1. the video language is a regional language (Tamil, Telugu, Hindi and the other Indian languages we support), AND
2. the video has a character who speaks (the plan has dialogue lines).
Everything else is unchanged: English videos, and any video with no talking (actions, silence, music and effects only) stay on the current flow with no ElevenLabs call and no lip-sync call, and no extra cost.

**Pipeline when the rule applies:** (1) Seedance makes the clip as today (the mouth moves; its own speech is discarded). (2) ElevenLabs makes the audio from the dialogue lines in the chosen voice (voice and model per language, chosen by the owner after listening). (3) A lip-sync model re-animates the mouth to the new audio (model chosen after the test below). (4) The existing finishing step adds music and effects and the realism grade.

**Lip-sync test result (2026-10-09, owner's verdict): Sync Lipsync 2.0 looks best.** Tested on the Pondy clip (15 s, 720x1280) with the owner's ElevenLabs audio (voice "Yazhini - Dynamic Influencer", file `ElevenLabs_2026-10-09T07_34_25_Yazhini - Dynamic Influencer_pvc_sp99_s33_sb8_v4.mp3`, 17 s; the speed, stability and similarity settings are encoded in that filename: confirm before building). Total test spend about US$3.71 of the approved US$5.
- **Chosen:** `fal-ai/sync-lipsync/v2`, `model: lipsync-2` (inputs `video_url`, `audio_url`, `sync_mode`; test used `bounce`). About US$3 per minute of video, so about US$0.75 to 0.85 for a 15 to 17 second clip. Took about 6.5 minutes: show the honest generation clock and keep polling. Fallback upgrade to try if quality is not enough: `lipsync-2-pro` (about 1.67 times the price).
- **Not chosen:** Kling LipSync (works, about US$0.14, but accepts only 2 to 10 second clips), OmniHuman 1.5 (builds a new video from a still, about US$0.16 per second, changes the shot), LatentSync (failed: "No face detected" on the close moving selfie face).
- **Design points to handle:** keep the spoken audio no longer than the clip (the plan caps dialogue at two short lines; if the ElevenLabs audio runs longer than the clip, shorten the line or speed up by at most about 10 percent before choosing a sync mode); the lip-sync step takes the Seedance clip (its own speech discarded) plus the ElevenLabs audio, then the finishing step adds music, effects and the grade; model, voice and per-language voice choice go in config, not code; add the extra cost to the Quark price ONLY for videos that use the path.
- **Still to test before launching other languages:** Hindi and Telugu through the same pipeline (voice choice per language by the owner).

**Safety:** if ElevenLabs or lip sync fails, the video is still delivered with the Seedance audio (never a failed video) and the extra charge is not made. The extra cost is added to the Quark price ONLY for videos that use the path, derived from real provider rates in `apiCosts.js`. Customer messages never name vendors.

**Test before building (needs the owner's OK for the spend):** run the owner's Pondy clip and his ElevenLabs audio through LatentSync (fal, about US$0.20 per clip up to 40 s), Sync Lipsync 2.0 (about US$3 a minute), Kling LipSync and OmniHuman 1.5 (about US$0.16 a second), estimated total under US$5; fal.ai balance must be topped up first. Output to `Downloads/lipsync-test/`. Then test Hindi and Telugu the same way.

## 3. Prospect Studio
See `2026-10-09-prospect-studio.md`.

## 4. Security follow-ups (from the 2026-10-08 review)
Encrypt stored social and calendar tokens; self-service account delete and export (DPDP); session revocation and sign out everywhere; end sessions on password reset; optional customer MFA; Content-Security-Policy header; third-party penetration test within 60 days; SOC 2 readiness. AWS tasks (owner): root keys and MFA, WAF, 2+ containers with autoscaling, CloudTrail, GuardDuty, alarms, HTTPS redirect on port 80, SSH on the old server.

## 5. Small items
- Labels on the Logo position grid in Create (top left, bottom right and so on).
- Alert in the staff area and to `ALERT_EMAILS` when a provider reports an exhausted balance (found 2026-10-09: the fal.ai balance ran out and Hero videos failed; Quarks were refunded correctly).
- Per-page retry and the free-or-paid decision for the designed Blueprint PDF; logo placement on a real Blueprint.
