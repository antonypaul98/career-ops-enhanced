# C11 — Private factual-answer memory

`enhanced/answer-memory.mjs` keeps reviewed factual answers in the user's data
root at `data/application-answer-memory.json`. The file is covered by the
repository's blanket `data/` ignore rule and is never a system-update payload.

The contract deliberately separates two scopes:

- `reusable`: a stable, non-sensitive candidate fact supported by an explicit
  candidate statement or candidate-controlled document.
- `application_specific`: an answer tied to the exact application artifact key
  and SHA-256 digest. Authorization, sponsorship, salary, relocation,
  availability, legal, demographic, disability, veteran, background-check and
  self-identification answers may use only this scope.

Only `user_confirmed` and `source_verified` records can produce a proposal.
`needs_review`, rejected, conflicting, mismatched-application and changed-
artifact records cannot. Employer requirements and JD text are never candidate
evidence. Matching is by an explicit canonical `fact_key`, not fuzzy question
similarity.

Resolution is advisory: it returns a draft proposal, provenance and a review
decision. Sensitive proposals still require candidate confirmation. The module
has no browser/form integration and no submission action.

All examples and automated tests use synthetic facts. Real answers remain in
the private runtime data root.

