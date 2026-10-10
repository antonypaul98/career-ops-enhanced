# Enhanced Career Ops — verified state

Public repository: `antonypaul98/career-ops-enhanced`.

C02–C06 are accepted (5 of 14 enhanced checkpoints). Their evidence remains in
`CHECKPOINT_STATE.json`. Live GitHub evidence takes precedence over old records.

## C07 reviewed input adapter — awaiting final CI

PR #7 merged the advisory foundation at
`4b898ce2263c6da20239cefe459fc695eea7145e`. Its exact merged-main Tests run
`37922616185` succeeded. The existing PR #9 and branch
`work/c07-reviewed-input-adapter` were adopted at
`87bbf918934b40d38a87c9baa660561a621eedfd`, retaining all newer adapter fixes
and tests. The missing `enhanced/eligibility-input.mjs` updater registration is
repaired; the coverage guard failed before the repair and passes afterwards.

The adapter binds complete explicit review decisions to exact original JD bytes
and C03 extraction records/spans, and keeps separately reviewed candidate facts
scoped to candidate, jurisdiction and period. Missing, ambiguous, contradictory,
unsupported and malformed information remains `needs_review`. The assessment
is advisory; profile/location defaults never imply authorization or approval.
See `docs/C07_ELIGIBILITY.md` for the contract and private runtime boundary.

Local C07 regression: 56 passed, 0 failed, 0 skipped, including 37 new integration
and adversarial tests plus all 19 preserved tests. Full repository validation:
11,701 passed, 0 failed, 13 environment/upstream warnings; syntax checks pass for
1,043 modules. Local Go/browser capabilities are absent and their required CI
jobs remain mandatory. Acceptance requires final exact-head CI, merge and exact
merged-main CI.
C08 has not started.

## Writer ownership

Owner: interactive C07 completion task, token `C07-PR9-20261010`.
The hourly Career Ops automation stays enabled and strictly read-only until this
owner publishes an explicit release. After verified C07 acceptance and release,
the hourly task resumes C08 automatically on its next run after a live-state check.

All tests use synthetic data. Candidate declarations and assessments remain
private runtime inputs. Optional release-publisher credentials are separate from
product CI; macOS CI does not claim real user Mac acceptance.
