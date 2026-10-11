# Enhanced Career Ops — verified state

Repository: `antonypaul98/career-ops-enhanced`.

The authoritative acceptance ledger is `CHECKPOINT_STATE.json` on
`records/live-checkpoints`. Main's copy is a dated snapshot; live GitHub and the
authoritative branch override it. All original acceptance history is preserved.

C02–C12 are accepted: **11 of 14** equally weighted enhanced checkpoints.
C12 PR #14 exact head `3ab9e607e36757ccd3e1354920dac1411b057f7b` passed
Tests run `38111619670` plus privacy, dependency and direction gates. Its merge
`56e114fa73fa72b9d14746a956c2435d3197f1c0` passed exact-main Tests run
`38112276453`: Linux, macOS, Windows, CV visual and upgrade jobs all succeeded.
Formal C12 acceptance was recorded at ledger commit
`9e8581cc559988160933d9a084d7189d7362e1f5`.

C13 adds reviewed, content-bound lifecycle observations to the existing locked
tracker writer. Actual receipt bytes and submitted attachment digests are
checked before `Applied`; C12 mock approval never establishes submission.
Private immutable evidence, idempotency and interrupted-write recovery are
covered by synthetic regressions. Acceptance is pending exact PR and main CI.
See `docs/C13_APPLICATION_LIFECYCLE.md`.

C14 advisory outcome learning and C15 comprehensive release acceptance follow
in roadmap order. Automated macOS CI is separate from actual user Mac acceptance.
No physical acceptance or real-user workflow result is claimed here.

Writer token `CO-RELEASE-20261011` belongs to the interactive release mission.
The existing hourly task stays enabled and strictly read-only until an explicit
release is recorded in the authoritative ledger and its prompt is restored.
It must then refresh GitHub and continue the next unfinished checkpoint without
reimplementing accepted work. Never infer ownership or release from inactivity.

Only synthetic fixtures are committed. Candidate facts, declarations, answer
memory, application content and evidence remain private runtime data. No real
applications are submitted by these enhancements. Inherited optional release
publisher and notification credentials are separate from required product CI.
