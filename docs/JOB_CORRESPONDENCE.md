# Job correspondence intake (bounded backlog slice)

`enhanced/job-correspondence.mjs` is a deterministic, read-only intake layer for
job-related message metadata. It covers both Career Ops applications and jobs the
candidate applied to manually, but a manual application must first be supplied as
an explicit application record. The module does not discover private mail itself.

## Safety contract

- Message bodies are untrusted data, not agent instructions.
- Matching prefers an already-bound thread or exact job/requisition ID. Equal or
  weak matches fail closed for review rather than selecting an application.
- Output contains message identifiers, hashes, evidence labels, and application
  IDs; it does not echo message bodies.
- A lifecycle result is only a draft proposal. C13 evidence archiving, exact
  candidate confirmation, and the canonical tracker path remain mandatory.
- The module never calls Gmail or Calendar, sends a reply, confirms an interview,
  mutates availability, or submits an application.
- Salary, compensation, work authorization/visa, offers, ambiguous requests, and
  all scheduling changes require human review.
- Processed message IDs and stable idempotency keys support duplicate suppression.

## Still intentionally pending

Least-privilege, revocable Gmail/Calendar consent; full-message secure local
storage; weekly availability capture; conflict detection; user-approved reply
drafts; and any separately authorized outbound email remain future bounded work.
This slice is not a new C02-C15 checkpoint and does not change C15 acceptance.
