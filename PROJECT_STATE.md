# Enhanced Career Ops — verified state

Repository: `antonypaul98/career-ops-enhanced` (public).

## C02: in validation, not accepted

Starting main: `b866e4b4be1223b27d078facacce7f073e90c31b`.
PR #1: `work/evidence-aware-tailoring-foundation`.
The handoff's `752196f2bd56da185a64e46e9af7f455d3d75128` is superseded.
Repair commit `6f8f7eca2240e92bdf86246059ba30c901b19e56` completes the cover-letter sandbox dependencies and fetches authentic upstream release tags for the upgrade harness. Tests now also run on pushes to main.

The original Tests run `37239381359` failed page-format on all OSes; its upgrade job failed because this fork had no release tags. The local repair passed 28 targeted tests and the two-leg upgrade harness. Follow-up scope/concurrency regressions now have 31 passing targeted tests and the fact gate's 88 self-tests pass. Full-suite/CI evidence for the final follow-up is still required.

Additional fixes: provenance quotes cannot widen approved context; vault read/modify/write is locked; skill-only evidence is blocked from recognized work-experience assertions. The existing fact validator is heuristic, not a semantic proof of arbitrary prose; C05/C06 must retain source bindings and explicitly report coverage limits.

The inherited Gemini test contacted a real API with a synthetic key. It now uses a local fetch stub and isolated synthetic data root, verifying the actual encoded request. The archive egress test now stubs its public DNS answer while preserving private-IP and DNS-blocking assertions.

No merge or Mac acceptance has been performed in this session yet. Do not treat upstream features as completed enhanced checkpoints without integration and validation evidence.

## Resume protocol

Fetch origin, read AGENTS.md and CHECKPOINT_STATE.json, then reconcile with live PR and Actions. Required checks must pass at the current PR head before merging. Verify merged-main Tests and applicable Web CI before accepting C02 and proceeding sequentially. Use the roadmap in docs/ENHANCED_ROADMAP.md. Private career inputs stay in the user layer; test fixtures must be synthetic. Never submit applications during this build.
