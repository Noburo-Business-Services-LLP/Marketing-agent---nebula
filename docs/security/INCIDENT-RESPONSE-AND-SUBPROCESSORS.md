# Incident response plan and subprocessor list

Date: 2026-10-08. Owner to review, fill the blanks marked [ ], and keep current. Used for enterprise questionnaires; not shown inside the app.

## Part 1. Incident response plan (one page)

**What counts as an incident:** unauthorised access to customer data or to our systems; a leaked key or password; a customer reporting that they can see another customer's data; payment tampering; a service outage longer than 30 minutes; a large unexplained rise in provider spend; a breach at a provider we use.

**People**
- Incident lead: [owner name, phone, email]. Backup: [name].
- Engineering contact: [name]. Legal contact: [name].
- Security mailbox: [security@nebulaa.ai] (monitored daily, and by phone for urgent cases).

**Steps**
1. **Detect and report.** Anyone who suspects an incident tells the incident lead immediately. Customers can write to [security@nebulaa.ai]. Log the time and what was seen.
2. **Contain (first hour).** Depending on the case:
   - Leaked key: rotate it at once in AWS Secrets Manager (or the provider), restart the backend, and revoke the old key.
   - Compromised account: deactivate it (staff area) and reset its password.
   - Abuse or flood: switch on invitation-only signup (`SIGNUP_MODE=invite`), lower `SIGNUPS_PER_DAY`, and add a WAF block rule.
   - Suspected data exposure: take the affected feature offline, snapshot logs before they expire.
   - Provider spend spike: pause the provider key in its console.
3. **Assess (same day).** What data, whose, from when to when, how it happened. Keep the evidence (CloudWatch logs, database change records).
4. **Notify.**
   - Affected customers: without undue delay, in plain words: what happened, what data, what we have done, what they should do.
   - Regulator and law enforcement: as the DPDP Act 2023 and CERT-In directions require (CERT-In asks for reporting of cyber incidents within 6 hours of noticing); legal contact decides on the notice. [owner/lawyer to confirm timings]
   - Enterprise customers: as their contracts require.
5. **Fix and recover.** Close the cause, restore from backup if needed, re-run `docs/security/attack-tests.js` against a throwaway copy, release the fix.
6. **Review (within 7 days).** Short written post-incident note: cause, impact, what we changed. Update this plan and the gaps list.

**Contacts to keep handy:** AWS support, MongoDB Atlas support, Razorpay support, each AI provider's security contact, and the lawyer.

## Part 2. Subprocessors and where customer data goes

Data flow in one line: the customer's browser talks to Nebulaa's servers on AWS (Mumbai); the servers store records in MongoDB Atlas and files in Cloudinary, and call providers for AI, publishing, email and payments.

| Provider | What it does for us | Customer data it receives |
|---|---|---|
| Amazon Web Services (ap-south-1) | Hosting, containers, load balancer, secrets, logs, email (SES) | Everything the app processes (in transit and in logs); sign-in codes by email |
| MongoDB Atlas (region: [confirm]) | Main database | All account and content records |
| Cloudinary | Image, video and PDF storage and delivery | Uploaded and generated media, logos, designed PDFs |
| OpenAI | Text and image generation, reading text from images | Prompts built from the customer's business details, images |
| Google (Gemini / Vertex, Cloud TTS, Calendar sign-in) | Text and image generation, voices, calendar link | Prompts, images, text to speak; calendar tokens if connected |
| Anthropic (Claude) | Text generation | Prompts built from business details |
| Groq / xAI (Grok) | Text generation (if enabled) | Prompts |
| fal.ai | Video and image generation | Prompts and reference images |
| ElevenLabs | Voice-over | Script text |
| Ayrshare | Publishing and inbox for social accounts | Posts, media, social account links and messages |
| Meta, X (Twitter), LinkedIn, Pinterest, YouTube | Direct sign-in and publishing APIs | Posts and tokens the customer authorises |
| Razorpay | Payments and subscriptions | Name, email, amount; card data is entered at Razorpay only |
| Zoho (Books, Mail) | Invoices; support email | Billing details; support messages |
| Resend / SMTP providers | Transactional email (if used) | Name, email, message |
| Apify, ScrapingDog, Serper | Reading public websites and search results about a customer's business | Public business names and website addresses |

**Owner to confirm before sending to a customer:**
- Which of the optional providers (Groq, Grok, Resend, others) are actually enabled in production; remove the ones not used.
- For each AI provider, the business-API data-use terms: whether inputs are kept, for how long, and that they are not used for training. Quote the provider's terms only after reading them.
- The MongoDB Atlas region and backup settings.

**Change control:** add a provider to this list before it goes into production, and tell enterprise customers who ask for notice of new subprocessors.
