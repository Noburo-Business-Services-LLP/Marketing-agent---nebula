# Brief for the Pulsar session: Pulsar 2 (outreach inside Nebulaa)

Written 2026-10-05 for the Claude session that will work on `Pulsar` (repo `Pulsar`, working branch `dev-dk`, based on `origin/Main`; `Esly` is stale).
Read this first, then `docs/superpowers/HANDOVER-nebulaa-redesign-2.md` in the Gravity repo (`Marketing-agent---nebula`, branch `nebulaa-redesign`) for how Gravity was changed.

## 1. What happened to Gravity (so Pulsar matches it)

- The product is now one platform called **Nebulaa** (two a's). Customers never see "Gravity", "Pulsar" or "Orbit". Each app is just a section of Nebulaa: **Content** (was Gravity), **Outreach** (Pulsar), **Lead generation** (Orbit, later). An app switcher at the top of the sidebar moves between them. Outreach and Lead generation are shown as "Coming soon" in the switcher until they are ready.
- **Light theme only**, matching the Nebulaa website: warm cream background, navy text, orange accent. No dark mode, no theme toggle. Tokens live in `frontend/index.html` of the Gravity repo (`--gv-*`). Logo: `logo-nebulaa.png`.
- **Interface wording** is plain, professional sentences. No slang, no short "punchy chunks", no agent names. The word **Quarks** keeps its name. A voice scanner (`frontend/scripts/voice-audit.mjs`) and a brand-name scanner (`brand-audit.mjs`) enforce this; port them.
- **Errors never leak provider text.** Customers see plain messages, never vendor names, quota numbers, plan names or URLs (`backend/services/providerErrors.js`, `frontend/utils/errors.ts` in Gravity). Do the same for Twilio, Meta, ElevenLabs and email errors.
- Landing, sign-in and onboarding come from the Nebulaa website work (`nebulaa-accounts`, `nebulaa-website-design`). Do not redesign those; reuse them.

## 2. The goal

1. Build Pulsar as a **standalone, finished application first**: new design, all bugs fixed, WhatsApp, SMS, email and voice calls tested end to end. Customers will not know it is a separate app.
2. Then connect all apps to **one account, one login, one brain, one credit balance**.
3. Get to a **voice AI calling** offer quickly: one client from **Canada** is ready to sign up if voice calls work. Price in **USD or CAD**.

## 3. What Pulsar uses today (from the code, verified 2026-10-05)

| Job | Provider in the code | Where |
|---|---|---|
| WhatsApp | **Meta WhatsApp Cloud API** (`graph.facebook.com`, v18) or **Twilio WhatsApp**, chosen per organisation | `services/whatsapp.service.js` (router), `whatsapp.twilio.service.js` |
| SMS | **Twilio** | `src/twilio/*`, `send-test-sms.js` |
| Voice AI calls | **ElevenLabs** conversational agent, bridged to the phone network by **Twilio** and **Exotel** (India) | `services/elevenLabs.service.js`, `exotel.bridge.js`, `exotel.api.service.js`, `callQueue.service.js`, `postCall.orchestrator.js` |
| Email | **AWS SES** (`awsEmail.service.js`), plus **Resend** and **nodemailer** in `email.service.js` | |
| AI text | **Google Gemini** (`gemini.service.js`) | |
| Queues and automation | **BullMQ + Redis**; own workflow engine (`workflow.*.js`) | |
| Billing | **Razorpay** (`billing.service.js`, `payment.service.js`) | |
| Other | Zoho CRM, Google Calendar, Google Sheets | |
| Cost control | `usageControl.service.js`: per-call limits, concurrency, daily caps; assumes 1 USD = ₹83 and Twilio voice at 0.05 USD/min | |

Stack: Fastify + MongoDB + Vite frontend. Per-organisation tenancy already exists (`Organization`, `TenantConfig`).

**Email finding (2026-10-05, read-only check of AWS account 609665073007):** SES is in **sandbox mode** in both ap-south-1 and us-east-1 (production access off, 200 emails per day, nothing sent in the last 24 h) and the only verified sender identity is one Gmail address. In sandbox, SES can only deliver to verified addresses, so campaign email to real contacts cannot work from this account until production access is requested and a sending domain is verified (SPF, DKIM, DMARC). If Pulsar uses a different AWS account or Resend for live email, confirm that first.

**First task: confirm all of this against the real running system** (which provider each live organisation actually uses, which env/credentials exist, which parts have never run). Do not trust this table beyond the code reading above.

## 4. The single brain (the important design)

Gravity already learns a lot about each business: the onboarding questionnaire, the content it creates, competitors it reads, insights, and leads that arrive from Meta campaigns. That knowledge must drive Outreach.

Build one shared **business memory** per customer account, readable by every app:
- who the business is, what it sells, tone of voice, languages, location, brand assets;
- audience and ICP, offers, pricing facts, FAQs, policies;
- what content and campaigns were published and how they performed;
- every contact and lead, where each came from (uploaded list, existing customers, Meta lead form), and every conversation with them.

Outreach then decides, per contact segment, **what to say, on which channel, and when**:
- existing customers vs new leads vs cold uploads get different messages;
- campaigns run automatically from that plan, with the owner able to approve or edit;
- **inbound replies are answered automatically** (WhatsApp first) from the FAQ and business memory, with a clear hand-off to a human when it is unsure.

**Decision (2026-10-05): where the memory lives.** Not on anyone's laptop. In production all customer data is in **MongoDB Atlas** (cloud, Mumbai); a laptop only holds local test copies. Put the shared business memory in the **same Atlas cluster, in its own collections**, owned by the **Nebulaa Accounts service** (one account id per customer, referenced by Content, Outreach and Lead generation). Each app reads it through one small module and writes only the parts it owns (Content writes brand and content facts; Outreach writes contacts and conversations). Reasons: one login and one account id already need that service; one database means one backup and one place to enforce who may see what; and no new infrastructure to run. Keep the existing Gravity brand memory and `buildAIContext` as the reader and migrate it, do not duplicate it. Watch the Atlas disk limit (it has hit its ceiling before; see the Gravity hand-over) and keep conversation logs trimmed.

Leads flow: Meta lead form → Nebulaa lead record → Outreach contact. Customers can also upload a spreadsheet of leads or existing customers (`leads_import_template.xlsx` exists).

## 5. One login and one credit balance

- **One account** across apps. The `nebulaa-accounts` service plan exists (`docs/superpowers/plans`, "Nebulaa Accounts service"). Pulsar's repo already contains its spec and plan; continue it rather than inventing another.
- **One balance of Quarks** (1 Quark = $0.02; recharge once, spend anywhere). All prices come from one table (Gravity: `backend/config/apiCosts.js`). Outreach actions get Quark prices derived from real provider cost plus margin; never hard-code a price.
- Pulsar currently meters in rupees (`usageControl.service.js`) and, for voice, reads an ElevenLabs balance. Replace this with Quark deduction using the same deduct → act → refund-once pattern as Gravity's money path.
- Currency: today's pricing is INR with 18% GST. Add **USD and CAD** display for the Canadian client. Dinesh says Razorpay already has international payments enabled, so keep Razorpay and do not add a second payment provider for now; verify with one small real test payment before promising her anything.

## 6. Providers: decisions and a bake-off (replaces the earlier pricing section)

Do not publish any price until it is built from current vendor rate cards (re-check live; web research for this brief returned nothing, so no numbers are quoted here). Method: unit cost per action, plus margin, rounded, from one price table, in Quarks.

**WhatsApp: use Meta's Cloud API directly (decision).** Twilio sits between you and Meta and charges its own fee on every message on top of Meta's charge. Direct Meta has no middleman fee, and the code already supports it (`whatsapp.service.js` routes per organisation). It needs a verified Meta business, a registered number and approved templates per customer. Keep the Twilio route only as an existing option for organisations already on it. If direct onboarding proves too heavy for non-technical customers, a cheaper Indian WhatsApp provider (a "BSP") is the second choice, evaluated in the bake-off.

**SMS in India: use an Indian SMS aggregator, not Twilio.** Indian SMS must be sent over the telecom operators' regulated DLT system (registered business, sender ID, approved templates). Airtel, Jio and Vi run that system, and Indian aggregators sit on top of it with the same registration; going "direct to Airtel" is an enterprise contract that still needs the same DLT work, and becoming a telecom operator ourselves is not realistic. Candidates to compare: MSG91, Kaleyra, Gupshup, Exotel's SMS, Airtel's enterprise SMS. Keep the SMS sender behind one interface so the provider can be swapped without changing the app. Canada SMS stays on a provider with Canadian numbers (Twilio is acceptable there until volume justifies change).

**Voice AI calls: bake-off, then decide.** Today it is ElevenLabs agents over Twilio/Exotel. Evaluate Indian voice-AI options with real regional-language calls (Hindi, Tamil, Kannada, Telugu, Malayalam, plus Canadian English and French). Candidates to look at: **Sarvam** (its own speech-to-text, text-to-speech and agent products), other India-built voice agent platforms (for example Bolna, Smallest.ai, Gnani; verify they still exist and what they offer), and the current ElevenLabs set-up as the baseline. Judge on: how natural the voice sounds to a native speaker, accuracy on names and numbers, delay, price per minute all-in, and whether they support outbound calling with Canadian numbers (the Canadian client needs this first, and it may need a different stack from India).

**Language quality for Gravity and Outreach: test Sarvam against the current models.** Dinesh's experience is that Gemini, ChatGPT and Claude rate roughly 6 to 7 out of 10 for regional Indian languages. Sarvam builds models for Indian languages (translation, text-to-speech, speech-to-text, chat). Run a **blind bake-off**: 20 to 30 real customer-style texts (captions, WhatsApp messages, FAQ answers, voice scripts) in each target language, produced by each model, scored by native speakers without knowing which is which. Switch a language to Sarvam only where it wins. Gravity already has a model router (`backend/services/llmRouter.js`) and a language module (`languageSupport.js`), so adding a provider is small once the bake-off picks winners.

**Text writing: prefer OpenAI.** Gravity already tries OpenAI first and falls back to Gemini (its production OpenAI key was missing until 2026-10-05, so it silently used Gemini). Do the same in Pulsar: replace `gemini.service.js` calls with a router that tries OpenAI first, then the next provider, and never shows a provider error to a customer.

**Email: verify before anything else.** See the SES sandbox finding above. Decide between getting SES production access with a verified domain, or a transactional email service, then test with a real inbox that Dinesh owns.

## 7. Canada: what to check before selling voice calls there

Outbound AI calling and SMS to Canadian numbers are regulated. Before going live:
- **CRTC rules and the National Do Not Call List**; **CASL** for email and SMS (express or implied consent, sender identification, easy unsubscribe).
- AI voice calls must **identify themselves clearly** and honour opt-out; record consent where required.
- A Canadian (or US) calling number with caller ID registered; check the provider's rules for outbound AI calls.
- Calling hours restrictions.

Dinesh should confirm with the client's own counsel; the app must at least support consent records, opt-out, calling-hours windows and a visible AI disclosure at the start of each call.

## 8. Order of work (proposed)

1. **Audit and read-only inventory**: which providers each live org uses, what works, what has never run (include the SES sandbox finding). Written list of bugs.
2. **Stabilise**: fix bugs; test WhatsApp (send, template approval, inbound replies), SMS, email, voice calls with real test numbers. Never run live sends or calls to real customers without Dinesh's OK for that specific run.
3. **Redesign** Pulsar to the Nebulaa look (light theme, plain wording, no agent names). A design spec for aligning Pulsar to Gravity's v2 tokens is already committed (`92bc273c`); that spec predates the move to a light-only theme, so update it.
4. **Provider bake-off** (voice, regional-language text, SMS aggregator), small and scored by native speakers, then decide.
4b. **Voice AI offer**: outbound calls with a campaign script, FAQ-aware answers, call logging, consent and opt-out, hard cost caps. Target the Canadian client.
5. **Single brain and inbound auto-reply** (WhatsApp first).
6. **One login and one Quark balance** across apps; USD/CAD pricing.
7. App switcher goes live for Outreach.

## 9. Hard rules (same as Gravity)

- Never send a real message, email or call to a real contact, and never spend provider credit on a test, without Dinesh's explicit OK for that run. Use test numbers and a throwaway database.
- Never commit `.env`, keys, or build output. Secrets come from AWS Secrets Manager (see `backend/bootstrap.js` in Gravity for the pattern).
- Do not push or deploy yourself; Dinesh runs the release scripts (`docs/superpowers/ops/release-prod.sh` in Gravity is the model).
- Customers must never see vendor names, raw errors, or the words Gravity / Pulsar / Orbit.
- Use real data and honest claims: no fake reviews, no invented statistics in messages sent to customers' contacts.
