# Recruiting intelligence: post-C15 backlog

Planning scope only. Do not start or count as implemented until the current C13-C15 acceptance sequence is complete or the user explicitly reprioritizes.

## P1: Sponsorship verification
- Categorize sponsorship for an exact job as confirmed by hiring employer, historically observed, predicted by a third party, contradictory, or unknown.
- Preserve source, job identifier, evidence date, and freshness. Never present historical petition records or vendor "likely" badges as employer confirmation.
- Candidate-specific visa and work-authorization information must stay in the private candidate data layer and require review before use.

## P2: Introductions and referrals
- Find permitted introductions to recruiting decision-makers and preserve source and relationship.
- Disclose applicant-paid referral fees before opt-in. Draft requests but never contact a person without explicit user approval.
- Track intro requested, accepted/declined, employer reply, interview, and outcome separately from ordinary applications.

## P3: Source coverage and matching
- Investigate publicly documented capabilities and permitted integrations of Jobright, Clera, Jack & Jill, Meteor, and Refer/Lia. Do not assume APIs exist, and do not scrape or share credentials without authorization.
- Reuse C09 discovery, canonical dedup and job freshness, C10 company intelligence and C08 explainable match scores.
- Support FDE, Data/Platform Engineering, AI engineering, Backend and Integration Engineering; experience requirements, geographical and remote/hybrid constraints, and strict applicant-configured exclusions.

## P4: Candidate-controlled applications
- Reuse C05/C06 resume fact checks, C07 eligibility, C11 private approved form answers, C12 exact-content authorization, and C13 submitted-evidence lifecycle.
- Show candidate a final review of resume, job and all answers, especially work authorization, pay, and location. Never permit blanket autonomous submissions.
- Distinguish queued, attempted, submitted, and confirmed. Validate approvals against changes and avoid duplicate submission.

## P5: Conversion analytics
- Measure verified relevant roles, introductions, recruiter responses, interviews and offers. Quality beats application count.
- Vendor-reported match scores and interview gains must be treated as claims until independently validated.

## Acceptance and implementation notes
- Add regression tests for sponsor source conflicts and freshness, authorization/privacy, referral fees, duplicate opportunities, job-site failures, stale approval, candidate claim fabrication, incorrect form answers, and submission evidence.
- Existing acceptance gates still apply: focused and full tests, privacy/integrity, exact-head CI, merged-main CI, and real Mac acceptance where relevant.
- Keep the demo functional without mandatory paid APIs or keys.
- Work/Astra sessions are for explicitly user-initiated work; no background automation may consume them.

## Research sources (recheck terms at implementation)
- https://jobright.ai/h1b-jobs
- https://www.getclera.com/talents
- https://www.getclera.com/jobs
- https://www.getclera.com/autopilot
- https://www.jackandjill.ai/jobs
- https://usemeteor.ai/
- https://www.tryrefer.com/for-your-career
