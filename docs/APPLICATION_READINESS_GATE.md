# Application readiness gate

`enhanced/application-readiness.mjs` is the read-only bridge between opportunity scoring, verified requirement fit, job-quality checks and the exact C12 application bundle.

- One application key must match the opportunity input, match input and sealed bundle.
- Liveness must be `live`, deduplication `unique`, and posting legitimacy `verified`, each with a source and timestamp.
- The 1–5 opportunity score remains separate from the verified match percentage; it is never converted into an ATS or hiring probability.
- Missing material evidence is routed through the strictly-above-75 questionnaire. A score at or below 75 remains in the review queue by default.
- Exact-content review is reachable only at a truthful verified fit of at least 99%, with all mandatory requirements and eligibility satisfied.
- Bundle fields are never echoed. The gate returns only the digest and validation state.
- Passing the gate does not grant exact-content approval and never fills, sends or submits an application.

