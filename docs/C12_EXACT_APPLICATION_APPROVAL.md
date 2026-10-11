# C12 — exact application approval and mock execution

C12 seals the exact application identity, field values, candidate-evidence
provenance, and attachment SHA-256 digests into one deterministic content
digest. Candidate approval is valid only for that digest and application key.
Changing an answer, artifact, role, URL, or execution policy requires a new
approval.

`enhanced/application-approval.mjs` deliberately exposes only a pure mock
executor. It returns `would_fill` and `would_attach` for review while reporting
zero network requests, browser actions, and file writes. It has no submit,
send, apply, browser, HTTP, or filesystem capability.

Only `user_confirmed` or `source_verified` candidate statements, candidate
documents, C11 answer-memory records, and application artifacts can authorize
field values. Employer requirements and job-description text cannot become
candidate answers. Sensitive fields require field-level candidate confirmation
before a bundle can be sealed, in addition to approval of the complete bundle.

The real application remains a candidate action in their ordinary browser.
Approval of a mock plan never authorizes form filling or submission, and no
successful test or CI runner represents real-user Mac acceptance.

