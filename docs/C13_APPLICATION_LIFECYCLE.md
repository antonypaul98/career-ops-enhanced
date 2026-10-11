# Reviewed application lifecycle

`set-status.mjs --lifecycle-event` records observed events through the existing
canonical tracker lock, atomic writer, status log and follow-up seeding. It never
opens a browser, sends mail, or submits an application. C12 approval authorizes
only its mock plan and is never evidence that an application was sent.

The application remains `Evaluated` while content is drafted, reviewed, approved
or mock-executed. Record `Applied` only after the candidate reviews an actual
submission receipt or employer acknowledgment. Missing, ambiguous, unmatched or
mock evidence leaves the tracker unchanged and the answer report `filled`.

## Private event contract

Use `createLifecycleEvent` from `enhanced/application-lifecycle.mjs` with:

- The original C12 sealed bundle, exact tracker row, canonical target status and
  non-future UTC observation time.
- Evidence kind, `origin: observed_actual`, private source path, SHA-256 of its
  actual bytes, receipt/message reference and verbatim quote. Both the reference
  and quote must occur in that source. Preserve the original evidence privately.
- For `Applied`, a `submission_receipt` or `employer_acknowledgement`. The actual
  attachment bytes must still match the bundle. A form-fill, upload success,
  submit-button click, intent, draft, or mock plan does not qualify.
- For employer stages, an `employer_message`; for `Discarded`/`SKIP`, a reviewed
  `candidate_decision`; for `Hired`, an `accepted_offer` after `Offer`.

The resulting event is a draft. Show its application, status, source quote,
reference, observation time and event digest to the candidate. Only after their
explicit review use `confirmLifecycleEvent`, passing `confirmed: true`, that
exact digest, the candidate's confirmation time and this exact statement:

> I confirm this evidence records this application's actual lifecycle event.

This confirms an observation; it grants no permission to send or submit. The
source label and candidate confirmation are an audit contract, not independent
verification of an employer or arbitrary natural-language semantics. Never
generate a confirmation for the candidate or mislabel a synthetic fixture as a
real application. Persist the confirmed event JSON only in the private data root.

```bash
CAREER_OPS_ROOT=/private/candidate-data node set-status.mjs --row 7 Applied \
  --lifecycle-event data/events/application-7.json --dry-run --json
CAREER_OPS_ROOT=/private/candidate-data node set-status.mjs --row 7 Applied \
  --lifecycle-event data/events/application-7.json --json
```

Use the actual canonical state for later reviewed events. The event date supplies
the status-log date; an explicit `--on` must agree. Exact company, role, row and
any tracker URL must match the bundle. Earlier events, conflicting submitted
content, backward transitions and reopening a terminal state fail closed.
`--force` cannot relax these checks. Hired follows an observed Offer, never an
optimistic prediction. An offer can still end in rejection or candidate withdrawal.

## Recovery and compatibility

Before changing the tracker, the writer archives the event and exact evidence
bytes in `data/lifecycle-evidence/<event-digest>.json` with mode 0600 (where
supported). The tracker stores only the digest reference. This preserves evidence
when the original message later changes or disappears. Paths, existing ancestors
and symlinks must remain inside the same private root, including custom trackers.

An archive alone never proves a tracker write succeeded. After an interruption,
rerun the same confirmed event: an identical archive is reused, and the existing
writer prevents duplicate notes, transitions or follow-ups. Conflicting archives
are preserved and rejected. A dry run creates no archive or tracker state.

Ordinary upstream manual `set-status` and `outcome` calls retain their interfaces
for human backfills and corrections. Enhanced automated observations must use
the evidence flag. After recording a verified outcome event, the existing
`outcome.mjs` can archive artifacts and verbatim feedback; its journal is not
submission evidence and must not invent an employer rejection from silence.

Tests use disposable synthetic private roots and include actual canonical writes,
all lifecycle stages, content and artifact replay, tampering, terminal states,
private path escapes, failure before tracker write, interrupted-write recovery,
dry runs and idempotency. Automated macOS CI is separate from user Mac acceptance.
