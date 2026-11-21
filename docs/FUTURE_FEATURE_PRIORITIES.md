# Career Ops: Future Features & Execution Priority

**Reviewed:** 2026-11-09  
**Repository:** `antonypaul98/career-ops-enhanced`  
**Purpose:** planning backlog only. This is not authorization to resume automated builds, add product scope to the current MVP, send messages, or submit applications.

## Gate 0 — finish the existing demo and real-user acceptance first

The latest handoff (2026-11-08) reports green main-branch CI, usable Desktop Explorer, and preserved local files. Do not rebuild completed work solely to satisfy this roadmap. The live private-data/model-to-PDF acceptance is **not yet proven**.

1. Read-only preflight of the privately reviewed candidate authority; confirm factual provenance and locked work authorization/sponsorship/other sensitive answers, flag unknowns for the candidate.
2. Find one live, eligible US posting with verified employment type, role-specific sponsorship evidence, and clearance status; unknowns remain `needs_review`.
3. When the free model quota is actually available, run at most one bounded real-job evaluation (no paid fallback).
4. Prove: real JD → evaluation → saved report/tracker → evidence-bound CV proposal → HTML/PDF and SHA sidecar → Approval Center.
5. Check that no submission, recruiter communication, or `Applied` status happens without explicit authorization. Treat safe browser submission as a separate acceptance gate.

## Ranked future improvements — implement only after Gate 0

Priorities are ordered by **candidate usefulness, dependency and risk**, not novelty. Existing foundations should be reused and verified, not rewritten.

| Order | Feature | Concrete result and limits |
| ---: | --- | --- |
| **1** | **Safe job application completion** | ATS/browser field preparation and validation; candidate reviews, clicks Submit, and records a real receipt; never invent success or silently auto-submit. Complete the separate submission acceptance gate before scaling. |
| **2** | **Reliable nationwide job discovery and eligibility** | Live native-ATS sources, job liveness, dedupe, >=75% fit threshold where configured, full-time/C2C policy, role-specific sponsorship and clearance evidence, remote → hybrid → onsite preference, role-family coverage (engineering, data, AI, security). Do not conflate employer history with job-specific eligibility. |
| **3** | **Truthful Resume Studio and application packages** | Role-specific CV variants, reviewed skills, evidence-aware JD alignment, concise ATS-friendly PDF, cover letters and answers. Never fabricate experience or guarantee a numeric ATS score; the candidate can confirm personally known work even if no external document exists. |
| **4** | **Complete application records and status reconciliation** | Immutable JD, source, date, resume version, exact answers, decision/approval history, ATS receipt, recruiter/interview events, and distinct Draft/Prepared/Submitted/Applied/Rejected statuses; reliable retries and no duplicate applications. |
| **5** | **Gmail/recruiter response intake** | Link authorized incoming recruiter/ATS mail to the right application, identify interview invitations, missing documents, and decisions; draft replies for explicit human approval only. |
| **6** | **Recruiter/referral discovery and human-led outreach** | Grounded company/interviewer/recruiter research, contact verification, referral paths, concise individualized drafts; no undisclosed impersonation or bulk unsolicited sends. |
| **7** | **Screening-vendor diversity and rejection-pattern intelligence (NEW)** | When reliably observable, label assessment vendor, channel, and applicant-visible workflow; compare outcomes by channel/vendor/job family; suggest diversifying pipelines, referrals, and direct contact when same-stack rejections recur. Do not infer hidden algorithms, exploit assessments, collect unnecessary protected data, or claim to beat ATS. Research source below. |
| **8** | **Follow-up workflow and reminders** | Based on actual application dates and recruiter replies, propose sensible follow-ups and one-click reviewed drafts; no autonomous sending or false status changes. |
| **9** | **Interview dossier and QuietCue handoff** | For confirmed applications, preload the exact submitted JD/CV, facts, employer research, interviewer identity if verified, likely questions and prior answers. Use tools only where permitted during interviews. |
| **10** | **Calendar/scheduling** | Detect proposed interviews, check availability and draft/reschedule invitations with approval; do not accept or cancel on the user's behalf without authorization. |
| **11** | **Outcome analytics and skill-gap learning** | Funnel from eligible lead to submission, reply, interview and offer, segmented by source/role/channel; identify verified qualification gaps and improve ranking based on real outcomes. Guard against misleading causal conclusions from small samples. |
| **12** | **Timely notifications** | Optional opt-in email, mobile or Telegram alerts for strong job matches, recruiter replies, interviews and overdue follow-ups. Control cadence/cost; don't turn on hourly automation merely by adding this roadmap. |
| **13** | **Secure cross-device access** | Mac, iPad and iPhone access to the same approved jobs, resume packages and status, with local-first privacy, access control, backups and safe syncing. |
| **14** | **More ATS portals and browser compatibility** | Expand tested workflows beyond initial ATS providers and Chromium when the core receipt path works; add Safari where feasible. Respect site terms and handle CAPTCHA/manual blockers honestly. |
| **15** | **Authorized voice/phone assistance** | Prepare call briefs and on-call notes; any automated speech to real people requires consent and clear disclosure. Do not impersonate the user. |
| **16** | **Advanced Jarvis/Memory Search orchestration** | Integrate cross-agent retrieval, proactive workflows, and more autonomy only after the individual pipelines and privacy controls pass live acceptance; avoid duplicating QuietCue and Memory Search services. |

## New idea: algorithmic monoculture in hiring

- **Source:** Bommasani et al. (2026), *Algorithmic Monocultures in Hiring*, Stanford Digital Economy Lab: https://digitaleconomy.stanford.edu/publication/algorithmic-monocultures-in-hiring/
- **Evidence:** ~3.37 million candidates, 4.2 million applications, assessment algorithms from one vendor (pymetrics); correlated rejections and adverse-impact disparities were observed.
- **Interpretation:** This does **not** establish that every ATS filters resumes the same way or that ATS keyword optimization solves assessment-model rejections.
- **Product hypothesis:** When explicit vendor/assessment evidence or applicant-provided results exist, Career Ops can surface concentration risk and encourage multiple valid routes (other employers, hiring channels, referrals, direct human contact).
- **Initial implementation:** start with manual evidence-backed vendor/channel tags on application records, simple outcome reports, and a diversity suggestion. Only consider automated detection if technically reliable and privacy-safe.
- **Acceptance:** never infer vendor from absence of evidence; no fake guarantees; no sensitive-demographic profiling; no attempt to circumvent security, screening, or platform controls.

## Planning safeguards

- Never equate this ordered list with features currently missing. C01–C15 have substantial existing implementations; re-check code and tests when a phase begins.
- Treat 95% JD match as an aspirational description-quality goal, **not** a guaranteed ATS score and never a reason to invent experience.
- Keep current Career Ops build status and scheduled automations unchanged; this file is documentation only.
- Before building any future item, first verify latest code, linked candidate authority, existing tests, actual dependency, scope, and documented acceptance criterion.