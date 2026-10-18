# Evidence-bound match questionnaire

`enhanced/match-questionnaire.mjs` implements the application-readiness match policy without writing private candidate data.

- A detailed gap questionnaire is proposed only when the initial verified fit is strictly above 75%.
- Questions cover material missing technology, domain, professional-experience and project-experience evidence.
- Stable question keys suppress repeat questions.
- Answers must be candidate-reviewed and carry concrete provenance. Hands-on experience and familiarity remain distinct.
- The final fit is recalculated from explicit weighted requirements. The module does not claim ATS rank or hiring probability.
- Priority readiness requires a truthful final fit of at least 99%, every mandatory requirement, and an `eligible` verdict.
- Evidence Vault entries are proposals only and still require an explicit write confirmation.
- The module never submits an application or treats a JD requirement as a candidate fact.

