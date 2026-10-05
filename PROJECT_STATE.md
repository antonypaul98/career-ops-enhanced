# Enhanced Career Ops — verified state

Public repository: `antonypaul98/career-ops-enhanced`.

## C02 accepted

PR #1 final head: `a980bbd8ed26fc609c5bd3a9a055134d931adf6f`.
Merge: `78e1bfc8dd679745d5f449d63cf1ba36b5ce902e`.
PR Tests run `37302419530` passed all three OSes, CV visual and upgrade validation.
Merged-main Tests `37303751631` and Web CI `37303751613` passed.
Acceptance-record main `de3cde6c90a9ad35de35fb5136b9ae806e39fb7f` also passed Tests `37331732154`.

## C03 in validation

PR #2 uses the existing `work/c03-jd-requirements-v2` branch, initially
`af546bbd489d2032a1a732c93fc6b29f31e23cba`. Shared upstream section parsing
and skill vocabulary now provide exact original-source spans, conservative
strength, explicit review reasons, and deterministic duplicate grouping.
Every JD record remains employer information with `candidate_evidence: false`.
Acceptance requires green current-head and merged-main validation.

## Boundaries and outstanding acceptance

Only synthetic fixtures are committed. Runtime career profiles and evidence
stay private. No applications or Mac installation have been performed.
The inherited release publisher lacks upstream GitHub App credentials; it is
separate from build acceptance and no upstream package has been published.
The upstream fact gate is heuristic; later tailoring/validation must retain
claim-to-evidence bindings and report its limits.

Next: finish PR #2 validation/merge, verify main, record C03 acceptance, and
implement C04 over the upstream Master Career Profile and scoped Vault.
