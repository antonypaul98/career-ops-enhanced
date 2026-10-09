# C07 eligibility foundation

`evaluateEligibility` in `enhanced/eligibility.mjs` compares explicit reviewed
authorization and sponsorship declarations. It is a pure advisory function:
it does not load profiles, read files, discover jobs, score opportunities,
reject applications or submit anything. Candidate review and source validation
must happen before its inputs are constructed. A supplied review label is not
independent proof that a statement is true.

The supported fields are `work_authorized` and `needs_sponsorship`, with Boolean
values, exact jurisdiction identifiers and an explicit `current` or `future`
period. These declarations never imply each other. Different jurisdiction
spellings require upstream review, rather than a guessed equivalence.

Employer requirements and candidate declarations use separate arrays:

```js
import { evaluateEligibility } from '../enhanced/eligibility.mjs';
const result = evaluateEligibility({
  requirements: [{
    id: 'synthetic-requirement', field: 'needs_sponsorship', required_value: false,
    mandatory: true, jurisdiction: 'SYNTHETIC_REGION', period: 'future',
    review_status: 'explicit', candidate_evidence: false,
    provenance: { source_type: 'job_description', source_id: 'synthetic-jd' },
  }],
  candidate: {
    candidate_id: 'synthetic-candidate',
    facts: [{
      id: 'synthetic-declaration', candidate_id: 'synthetic-candidate',
      field: 'needs_sponsorship', value: false,
      jurisdiction: 'SYNTHETIC_REGION', period: 'future', status: 'user_confirmed',
      provenance: { source_type: 'candidate_statement', source_id: 'synthetic-source' },
    }],
  },
});
```

Candidate review reuses the Evidence Vault's `user_confirmed`/`source_verified`
policy. Only explicitly reviewed `candidate_statement` or `candidate_document`
sources may supply declarations. Job text, inferred prerequisites, resume
keywords, nationality, residence and education never supply authorization.
The evaluator does not read profile defaults: omitted sponsorship information
must stay unknown, even where upstream scan filters use permissive defaults.

Every check contains a machine-readable reason and separate employer/candidate
provenance. Source and record identifiers are SHA-256 references to caller-held
records; quotes, paths, raw identifiers and arbitrary properties are not copied.
Other candidates' declarations are ignored and never included in diagnostics.
The assessment itself is private candidate information; do not publish it.

`ineligible` requires an explicit conflict between reviewed candidate evidence
and a mandatory explicit requirement. Missing, ambiguous, unsupported or
contradictory inputs produce `needs_review`. Review takes precedence over a
separate known conflict, while individual diagnostics retain that conflict.
Empty inputs cannot pass. `eligible` covers only the supplied supported
requirements, and never constitutes application approval or a legal judgment.

Remaining C07 work: a private, source-bound input/review adapter that can map
explicit profile declarations and C03 JD source records without promoting
location-filter or visa-keyword results to candidate facts. Broader eligibility
conditions and integration require separately scoped tests and CI. This
foundation does not complete those tasks or authorize C08.
