# C15 release-validation contract

`enhanced/release-validation.mjs` is a read-only, fail-closed acceptance check.
It consumes a JSON receipt bundle stored inside the private Career Ops data
root and reports only release metadata plus missing-gate codes.

The validator requires the accepted C02–C14 history, one exact tested source
head and tree, the identical merged tree, successful Linux/macOS/Windows Node
and Go jobs, visual and upgrade jobs, exact-head privacy/dependency/direction
checks, and explicit negative receipts for private-data publication,
application submission and recruiter messaging. It never performs any of
those actions.

Physical user-Mac acceptance is a distinct receipt. A successful hosted macOS
CI job cannot satisfy it. The receipt must identify `physical_user_mac`, be
performed and confirmed by the user, succeed, and bind to the exact merge
commit. This is an audit contract, not independent hardware attestation.

Example read-only invocation:

```bash
node enhanced/release-validation.mjs --evidence data/release-evidence.json
```

The command exits zero only for a complete bundle. Missing, malformed,
cross-head, failed, duplicate, unsafe, or outside-root evidence stays blocked.
Implementation and synthetic tests alone do not accept C15: exact-head CI,
guarded merge, merged-main CI, and a real user-Mac receipt remain required.
