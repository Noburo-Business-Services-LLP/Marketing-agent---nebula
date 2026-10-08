# Security answers for enterprise buyers (Bosch, Arcane Chemicals and similar)

Date: 2026-10-08. Prepared by Nebulaa engineering from the code and the AWS setup as checked on this date.
**Use this as the base for questionnaires. Each answer is marked: DONE (in place and checked), PARTLY, PLANNED (with a date) or NOT YET. Do not change a status to DONE unless it is true. Lines marked "owner to confirm" depend on something only the owner can check.**

## 1. Short version you can send first
Nebulaa runs on Amazon Web Services in the Mumbai region (ap-south-1). The application is served over HTTPS (modern TLS policy on the production load balancer). Customer passwords are stored only as salted bcrypt hashes. Every account has its own data and every request is checked for a signed sign-in token. Payments are handled by Razorpay and confirmed by signature, so card details never reach our servers. Sign-up has abuse controls, sensitive actions are rate-limited, and uploaded files and websites we read on a customer's behalf are checked before use. We have completed an internal security review and fixed the findings, and an independent penetration test is planned within 60 days of launch. We do not yet hold SOC 2 or ISO 27001 certification.

## 2. Answers by topic

### Governance and certifications
| Question | Answer | Status |
|---|---|---|
| ISO 27001 / SOC 2 certified? | No. Not certified. Following the main controls; certification not started. | NOT YET (plan after launch, owner to set a date) |
| Independent penetration test? | Internal automated attack-style tests run 2026-10-08 (57 checks, results kept in `docs/security`). Independent third-party test planned within 60 days of launch. | PLANNED |
| Named security contact | owner to fill in (suggest security@nebulaa.ai) | owner to confirm |
| Security policies | One-page incident plan (see `INCIDENT-RESPONSE-AND-SUBPROCESSORS.md`). Full policy set not written. | PARTLY |
| Staff access and background checks | owner to confirm | owner to confirm |

### Data location, storage and encryption
| Question | Answer | Status |
|---|---|---|
| Where is data hosted? | Application and containers: AWS ap-south-1 (Mumbai). Database: MongoDB Atlas (region: owner to confirm). Media files: Cloudinary. | PARTLY |
| Encryption in transit | HTTPS with TLS 1.2/1.3 on the production load balancer. Port 80 currently forwards instead of redirecting (fix scheduled). The test environment has no HTTPS yet. | PARTLY |
| Encryption at rest | AWS Secrets Manager is encrypted with a customer KMS key. MongoDB Atlas encrypts disks at rest by default (owner to confirm the cluster tier setting). | PARTLY |
| Password storage | bcrypt, 12 rounds, salted. Sign-in codes (OTP) are stored hashed. | DONE |
| Stored third-party sign-in tokens (social media accounts, Google Calendar) | Stored in the database as plain text fields today. Field-level encryption is not yet in place. | NOT YET (planned; high priority after launch) |
| Secrets management | Secrets are in AWS Secrets Manager; the production container role can read only the production secret. No secrets in the code repository (checked). | DONE |
| Backups and recovery | owner to confirm Atlas backup settings and that a restore has been tested | owner to confirm |
| Data retention and deletion | No self-service "delete my account / export my data" yet; done on request by support. | NOT YET (needed for DPDP; plan with date) |

### Access control and authentication
| Question | Answer | Status |
|---|---|---|
| Customer authentication | Email + password with verification code by email at signup. Sign-in token valid 7 days. | DONE |
| Multi-factor authentication for customers | Not available. | NOT YET |
| Brute-force protection | Account locks for 30 minutes after 5 failed logins; strict per-address limits on login, signup, reset and admin login; reset codes die after 5 wrong tries. | DONE |
| Session revocation | Tokens cannot be revoked individually; a deactivated account is refused immediately. A password reset does not end other active sessions. | PARTLY (fix planned) |
| Tenant separation | Every data query is scoped to the signed-in user. Cross-account tests on products and ideas passed; a full per-route review is recommended in the independent test. | PARTLY |
| Staff access | Staff area has per-person accounts and roles (Owner and others); the old shared admin login is retired except for a one-time Owner setup, now rate-limited. | DONE |
| Staff access to customer accounts | Managed-service staff can open assigned clients only; payments, plans and passwords are blocked while acting for a client. | DONE |

### Application security
| Question | Answer | Status |
|---|---|---|
| Input validation / injection | Database-operator injection stripped, text inputs stripped of HTML, request size limits (1 MB default, 40 MB only where pictures are sent). | DONE |
| Server-side request forgery | Websites read for customers go through address checks that refuse internal and private addresses, odd ports and redirect loops. Tested. | DONE |
| Security headers | HSTS, nosniff, frame protection, no server version header. Content-Security-Policy is not set. | PARTLY |
| Error handling | Customers never see raw server errors; details go to logs only. | DONE |
| Dependency vulnerabilities | 2026-10-08: backend and frontend scanned and patched; remaining known issues: 2 moderate in a spreadsheet library (not exploitable in our use). | DONE |
| Payment security | Razorpay checkout; each payment verified by signature and applied once; webhook signature required. We never store card numbers. | DONE |
| Cost-abuse protection | Atomic Quark deduction (no overdraw by parallel requests), signup limits, disposable-email block, daily new-account cap, optional bot check and invitation mode, video held back for brand-new unverified-business accounts. | DONE |
| Secure development | Automated tests (800+ backend, 200+ frontend) run before each commit; no formal code-review policy documented. | PARTLY |

### Infrastructure and operations (as of 2026-10-08)
| Question | Answer | Status |
|---|---|---|
| Network isolation | Backend containers have no public address and accept traffic only from the load balancer. | DONE |
| Web application firewall / DDoS protection | None yet. AWS WAF planned before launch (owner task). | PLANNED |
| Logging and audit trail | Application logs in CloudWatch. AWS CloudTrail not enabled yet. | PARTLY (owner task) |
| Monitoring and alerting | Application-level failure alerts exist; CloudWatch alarms not yet set (owner task). | PARTLY |
| Intrusion detection | AWS GuardDuty not enabled yet (owner task). | PLANNED |
| Capacity | One backend container today; 2+ with autoscaling planned (owner task). | PLANNED |
| Privileged cloud access | A root-account key is in use on one machine; to be replaced by an IAM user with MFA and the root keys deleted (owner task, urgent). | PLANNED |
| Vulnerability scanning | Dependency scans and internal attack tests run; scheduled scanning not set up. | PARTLY |

### Privacy and AI use
| Question | Answer | Status |
|---|---|---|
| Applicable law | India: Digital Personal Data Protection Act, 2023. | |
| Privacy policy and terms | Drafts exist in the app; a lawyer has not yet reviewed them. | PARTLY (owner/lawyer) |
| Do you use customer data to train AI models? | Nebulaa does not train models on customer data. Content is sent to AI providers through their business APIs to generate the customer's output. Owner to confirm each provider's data-use terms before stating that none of them retains or trains on it. | owner to confirm |
| Subprocessors | See list in `INCIDENT-RESPONSE-AND-SUBPROCESSORS.md`. | DONE |
| Data subject requests | Handled by support on request; no self-service tool yet. | PARTLY |

## 3. Known gaps and the plan (be open about these)
1. Independent penetration test: book within 60 days; fix the findings; share the summary.
2. Encrypt stored social and calendar tokens in the database (field-level).
3. Self-service delete and export, and a retention policy (DPDP).
4. Session revocation and "sign out everywhere"; end sessions on password reset.
5. Optional customer MFA.
6. Content-Security-Policy header.
7. WAF, CloudTrail, GuardDuty, alarms, autoscaling, HTTPS redirect (AWS owner tasks, before launch).
8. SOC 2 readiness assessment (3 to 12 months).
