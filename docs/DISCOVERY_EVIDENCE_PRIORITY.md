# Career Ops discovery: evidence-first prioritization

The Explore **Priority** sort is triage, not an ATS score, match percentage,
immigration determination, or probability of an interview. It keeps every
discovered role visible (including unknown or expressly unsupported sponsorship)
but gives more attention to relevant roles and ones explicitly mentioning
sponsorship. An explicit no-sponsorship statement lowers priority even if the
company historically filed many visas.

## Evidence order and freshness

1. **Exact official job description and recruiter confirmation**:
   current, dated sponsorship/transfer policy matters more than generic filing
   history. A policy can differ by team, division or country.
2. **Employer filing history**: candidate-triggered check through the existing
   plugins/h1b-sponsor local DOL index. It is based on LCAs and PERM data, NOT
   proof of an approved H-1B petition or a job opening. Show the employer legal
   name; names that do not match remain possible_entity and do not boost
   priority. Multiple subsidiaries/FEINs require human entity confirmation.
   For USCIS approved petitions/new vs continuing employment, use the separate
   official H-1B Employer Data Hub where possible.
3. **Recent dated policy reporting, company statements and recruiter confirmations**:
   treat clear official policy changes as more relevant than older counts.
4. **Reddit/employee posts**: leads for questions, NEVER proof of policy or
   a finding of fraud. Check date, role/team, source link and whether independent
   corroboration exists; do not downgrade a company on one unverified allegation.
5. **Posting legitimacy**: verify the same requisition on the actual employer
   domain/careers page and the ATS. A recognizable ATS URL alone does not verify
   the hiring company or recruiter.

## Working without paid APIs

Explore's on-demand **Check H-1B history** button looks up one selected company
locally. It does not query a third-party server even when an optional
H1B_API_BASE exists in the environment. It never installs the index
automatically. To use it, the user must separately approve installing the
local index described at plugins/h1b-sponsor/README.md:

    node plugins/h1b-sponsor/install-h1b-index.mjs

The installer fetches a checksum-verified dataset from GitHub; the user controls
that one network action. If no index exists, the interface reports unknown and
all jobs remain discoverable. The separate **Recent Reddit discussions** link
opens a company search; it is not a background scraper or an automated factual
claim about that employer.

## Prioritization after discovery

Use verified *technical* candidate facts and mandatory skills to evaluate true
match; the free fit band is only title overlap. Separate queues:

- high skill overlap + explicit/current sponsorship evidence, official posting;
- high skill overlap + recent correctly matched company filing history;
- high skill overlap + sponsorship unknown, worth recruiter confirmation;
- lower technical overlap or explicit sponsorship/clearance conflicts, keep
  visible but deprioritized;
- suspicious posting/recruiter: do not apply or share identity documents until
  verified independently.

Check a current live requisition and ask the recruiter directly whether this
specific role permits an H-1B change of employer. Avoid paying for an
application, training, equipment, or unsolicited identity verification. FTC
guidance: https://consumer.ftc.gov/articles/job-scams

No display score authorizes an application, ATS prefill, resume fabrication,
scheduling, recruiter contact, or submission. Approval Center retains its
separate evidence, eligibility and exact-content gates.
