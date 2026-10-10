# Enhanced Career Ops — verified state

Public repository: `antonypaul98/career-ops-enhanced`.
Verified at: `2026-10-10T23:28:34.675Z`.
Authoritative acceptance ledger: `CHECKPOINT_STATE.json` on `records/live-checkpoints`.

## C02 through C07 accepted

Six of the 14 roadmap checkpoints are accepted. Exact earlier acceptance evidence remains in the ledger.
C07 [PR #9](https://github.com/antonypaul98/career-ops-enhanced/pull/9) final head `0abf1c2ccac8b58d8573b90ee8327be484967f58` passed all required exact-head checks before merge,
including [Tests run 38057469130](https://github.com/antonypaul98/career-ops-enhanced/actions/runs/38057469130), attempt 1.
It merged at `015ee9e07e83fa2c12f7d19f40679b263ffff037`, retaining tree `d0058d4dbdc5ac3ffc35e6be19bf018d544b3170`.
[Exact merged-main Tests 38058235055](https://github.com/antonypaul98/career-ops-enhanced/actions/runs/38058235055), attempt 1, succeeded.
Live main was verified at that merge commit when acceptance was recorded.

| Merged-main job | Result | Job ID |
|---|---|---|
| upgrade-regression | success | 114230981122 |
| windows-latest | 11703 passed, 0 failed, 11 warnings | 114230981215 |
| ubuntu-latest | 11705 passed, 0 failed, 11 warnings | 114230981245 |
| macos-latest | 11706 passed, 0 failed, 10 warnings | 114230981255 |
| cv-visual | success | 114230981319 |

All three platform jobs also passed Go dashboard tests. Visual and real-update regression gates succeeded.
The source-bound reviewed C03 eligibility adapter and advisory evaluator preserve separate employer requirements
and candidate declarations, exact snapshot/span/candidate/jurisdiction/period checks, and explicit review outcomes.
`enhanced/eligibility-input.mjs` is registered in updater `SYSTEM_PATHS`.
All 19 prior C07 tests remain; 37 integration/adversarial regressions were added (56 total).
Local full suite: 11,701 passed, zero failures, 13 environment/upstream warnings. Syntax: 1,043 modules passed.

## Explicit writer release — C07-PR9-20261010

The Interactive C07 completion task releases exclusive writer ownership after verified C07 acceptance.
Source writing has stopped. This records-branch update is the final repository write of this task.
The hourly Career Ops automation remains enabled with its existing schedule and resumes C08 automatically
on its next run after refreshing GitHub, repository instructions, this ledger and current writer claims.
This explicit verified release supersedes the historical active/pending C07 fields in the tested main snapshot.
There are no C07 blockers and no required user intervention.

## C08 accepted — explainable multi-signal opportunity scoring

PR #10 final head `dfe589a80e21f1956b8a5daba4133a6f446db05f` passed exact-head Tests run
`38064070985`, plus privacy, dependency and direction gates. It merged with an expected-head
guard at main commit `2b9e0da0874c9b4f94e2f160722c789552b569ae`.

Exact merged-main Tests run `38067072433` succeeded on Ubuntu, macOS and Windows, including
Go dashboard tests, CV visual tests and upgrade regression. Eight new synthetic regressions and
29 related local tests passed. The scoring contract exposes fixed weights, dimension contributions,
evidence confidence and confidence gaps. JD keywords never become candidate facts; eligibility,
requirement importance, posting legitimacy and historical outcomes remain outside the numeric score.
No application action or auto-submission behavior was added.

C02 through C10 are accepted: 9/14 checkpoints (64.3%).

## C09 accepted — discovery and duplicate/stale posting review

[PR #11](https://github.com/antonypaul98/career-ops-enhanced/pull/11) final head
`9a5c74f3cdf489e642829fc90790b1567e2f83bb` passed privacy, dependency, direction, visual,
upgrade, Ubuntu and macOS checks on the first attempt. The initial Windows job hit an inherited
temporary-directory teardown race (`ENOTEMPTY` in scheduled-jobs-runner) after all C09 tests passed;
the isolated Windows retry succeeded without a source change. Exact-head Tests run
[38075554382](https://github.com/antonypaul98/career-ops-enhanced/actions/runs/38075554382),
attempt 2, is successful.

The expected-head guarded merge produced main `b0248ebc25b8e1c9c74a23f2f88b80324600e7e2`,
tree `aee438b8a016c3f0da458d4bb37b5e4ae984ce1a`. Exact merged-main Tests run
[38080027059](https://github.com/antonypaul98/career-ops-enhanced/actions/runs/38080027059),
attempt 1, passed Ubuntu, macOS, Windows, Go dashboard, CV visual and upgrade regression jobs.

C09 adds a pure no-write review API over existing canonical URL, company/role, requisition,
location and liveness primitives. Only explicitly active postings can become new or duplicate;
authoritative expiry becomes stale; uncertain or missing observations remain needs-review.
Distinct requisitions stay distinct, location-aware identity remains opt-in, and no tracker,
pipeline, scan-history or application action is written. Ten synthetic C09 regressions and the
repository-wide local Node suite passed.

## C10 accepted — source-attributed company intelligence

[PR #12](https://github.com/antonypaul98/career-ops-enhanced/pull/12) final head
`3b96f1fc06c94d6f1f4314467d08a0b20aac6639` passed exact-head Tests run
[38083459719](https://github.com/antonypaul98/career-ops-enhanced/actions/runs/38083459719),
attempt 1, plus privacy, dependency and direction gates. The expected-head guarded merge produced
main `bc8e423e71b6e9a9dd6cdb1375290d374d7cee93`, tree
`a6b5419eaed895fbbf52fab14123e4b4feac489a`.

Exact merged-main Tests run
[38094656233](https://github.com/antonypaul98/career-ops-enhanced/actions/runs/38094656233),
attempt 1, passed Ubuntu, macOS, Windows, Go dashboard, CV visual and upgrade regression jobs.
Ten synthetic C10 regressions passed; the full local Node suite passed 1,533 tests with zero failures
and four environment-dependent visual skips.

C10 adds a pure bounded research brief across AI strategy, recent moves, engineering culture,
likely challenges and competitors. Every accepted claim retains a source URL, title, publisher,
source type and retrieval date; conflicts remain disputed and missing axes remain explicit gaps.
It reuses `company-funded.mjs` for funding evidence. External content remains untrusted data,
company claims cannot become candidate facts, and no file write or application action is possible.

## Next: C11

Begin private reusable versus application-specific factual answer memory using the user data root and
application artifacts. Preserve source/provenance scopes, separate reusable facts from one-application
answers, keep private data outside the public repository, and retain explicit approval/no-auto-submit boundaries.
Refresh live ownership and repository state before writing.

## Boundaries and separate issues

Only synthetic test data was used and committed. Private candidate information stays in the private runtime
data root. No applications were submitted. Real user Mac acceptance remains separate from macOS CI.
Optional release-publisher run `38058235065` failed because its GitHub App client-id/app-id input is empty;
this inherited publisher issue is separate from required product CI. No product gate was weakened or waived.
Optional post-merge Discord notification run `38058234976` also failed because its webhook is unconfigured;
this did not run until after the required exact-head checks passed and PR #9 merged.
