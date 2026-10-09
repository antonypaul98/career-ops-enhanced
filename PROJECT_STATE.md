# Enhanced Career Ops — verified state

Public repository: `antonypaul98/career-ops-enhanced`.

C02–C06 are accepted (5 of 14 enhanced checkpoints). The full acceptance history
is in `CHECKPOINT_STATE.json`; live GitHub evidence takes precedence over older
records. C06 PR #6 final head is
`0eca310f28cf58100535c41b36c6747ef906e36a`, with successful exact-head Tests
run `37865850360`. Its merge/current-main commit is
`54908ab6f290ae29ae7ed8d483d65fd3fff4b46b`, with successful exact merged-main
Tests run `37866928038` across all three platforms, visual and upgrade jobs.

## C07 small foundation — awaiting CI

Canonical branch: `work/c07-eligibility-foundation`, based on merged C06 and
acceptance ledger `3f4711cd81fde87cd6b7bf2fb2ec911bcce7b1d5`.
The deterministic pure evaluator compares explicit reviewed authorization and
sponsorship declarations, with separate employer/candidate provenance and
conservative review outcomes. It never loads private files, infers authorization
from nationality/location/education/keywords, rejects applications or submits.
The caller must validate and review declarations before constructing inputs;
this function does not independently certify evidence or interpret law.

Local validation: 13 new synthetic tests pass; 105 related Node test results
pass with zero failures or skips (including upstream location/updater assertion
script wrappers). Syntax: 1,039 modules pass, plus final evaluator/test syntax.
Acceptance is not claimed: exact-head CI, merge and merged-main verification
are still required for the foundation, and broader C07 integration is absent.

Next hourly action: adopt this branch/PR, verify its exact-head required CI,
merge only if green, and verify the exact merged main. Then implement one
private source-bound C03/profile input-review adapter slice; do not start C08.

Only synthetic fixtures are committed. Optional release-publisher credentials
and Discord configuration are separate issues. Real user Mac acceptance remains
separate from macOS CI. No applications or private candidate publication occurred.
