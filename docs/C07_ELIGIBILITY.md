# C07 reviewed eligibility

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

## Reviewed runtime input adapter

`prepareReviewedEligibilityInput` in `enhanced/eligibility-input.mjs` is the
source-bound entry point for this evaluator. The caller supplies the original
JD bytes, the C03 extraction, a complete explicit review, and separately
approved private candidate declarations. It performs no filesystem or network
access and does not read permissive profile or location-filter defaults.

The review binds to both `extraction.source_sha256` and
`fingerprintRequirements(extraction.requirements)`. Every C03 requirement must
have exactly one decision, including an explicit `relevant: false` decision for
unrelated requirements. A relevant decision supplies `field`, `required_value`,
`mandatory`, `jurisdiction` and `period`, with `review_status: 'explicit'`.
The caller collects those decisions from source review; keywords cannot create
them. Changed JD bytes, records, spans or strength invalidate the prior review.

```js
import { prepareReviewedEligibilityInput } from '../enhanced/eligibility-input.mjs';
import { evaluateEligibility } from '../enhanced/eligibility.mjs';

// All four values are private runtime inputs collected and reviewed by the caller.
const prepared = prepareReviewedEligibilityInput({ jdText, extraction, review, candidate });
const assessment = prepared.status === 'ready'
  ? evaluateEligibility(prepared.input)
  : prepared; // needs_review; input is null, with a machine-readable reason
```

`ready` means the input contract is satisfied; the evaluator still determines
`eligible`, `ineligible` or `needs_review`. Missing candidate facts stay unknown.
Candidate ids, review statuses, source types, Boolean values, jurisdiction and
period must be explicit. Duplicate fact ids, conflicting employer requirements,
incomplete reviews, negated/unspecified employer meaning and forged source
spans fail closed. Preferred conditions cannot become mandatory exclusions.
Malformed or cyclic input returns a generic diagnostic without echoing source
text or candidate information.

The adapter validates source token and full-line occurrence spans, including
recognized inline C03 headings, CRLF and UTF-16 offsets. It removes arbitrary
extra fact fields, while retaining private source references for the evaluator
to hash. Both the prepared input and the resulting assessment must remain
private runtime data, never public repository content.

The C07 contract intentionally covers only explicit authorization and
sponsorship declarations. It does not certify legal eligibility, interpret
immigration rules, infer facts from location or nationality, or approve an
application. Other conditions require a separately reviewed extension.

Regression coverage lives in `tests/eligibility.test.mjs`,
`tests/eligibility-input.test.mjs`, `tests/eligibility-input-focused.test.mjs`
and `tests/eligibility-input-regression.test.mjs`: 56 synthetic tests cover
source/review binding, evaluator integration, conflicts, scope, uncertainty,
privacy, determinism and absence of I/O. The updater registers both modules.
C07 acceptance still requires successful exact-head and merged-main CI;
`CHECKPOINT_STATE.json` records that evidence before C08 begins.
