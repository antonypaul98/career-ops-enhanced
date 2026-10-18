# Application readiness gate

`enhanced/application-readiness.mjs` is the read-only bridge between opportunity scoring, verified requirement fit, job-quality checks and the exact C12 application bundle.

- One application key must match the opportunity input, match input and sealed bundle.
- Liveness must be `live`, deduplication `unique`, and posting legitimacy `verified`, each with a source and timestamp.
- The 1–5 opportunity score remains separate from the verified match percentage; it is never converted into an ATS or hiring probability.
- Missing material evidence is routed through the strictly-above-75 questionnaire. A score at or below 75 remains in the review queue by default.
- Exact-content review is reachable only at a truthful verified fit of at least 99%, with all mandatory requirements and eligibility satisfied.
- Bundle fields are never echoed. The gate returns only the digest and validation state.
- Passing the gate does not grant exact-content approval and never fills, sends or submits an application.

## Redacted runtime report

`enhanced/application-readiness-report.mjs` turns one explicit JSON payload into
an operational decision report. It accepts a file path or `-` for stdin, emits
JSON to stdout, and does not persist output.

```sh
node enhanced/application-readiness-report.mjs private-input.json
node enhanced/application-readiness-report.mjs - --compact < private-input.json
```

The report includes decisions, gate statuses, fit values and counts. It excludes
the raw application key, candidate text, requirement and question wording,
provenance quotes, job-gate sources, bundle fields, artifact paths and content
digest. It performs no network, browser, email, calendar or application action.

## Discovery-to-review contract

`enhanced/discovery-readiness.mjs` connects the existing C09 discovery review
to this redacted report. Liveness and dedup statuses are derived from the
discovery decision rather than accepted from the caller. Posting legitimacy
remains a separately sourced, timestamped review receipt.

The bridge handles one explicit posting and returns only the discovery decision,
reason code, liveness class and redacted readiness report. It does not include
the posting URL, company, role, requisition, description, candidate content or
canonical identity, and it cannot write the pipeline, tracker or Evidence Vault.

