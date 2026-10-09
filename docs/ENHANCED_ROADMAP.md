# Enhanced roadmap

Extend upstream's local-first architecture; do not duplicate its scanners, tracker, renderers, skill vocabulary, or updater. Each acceptance requires implementation, meaningful tests, green current-head CI, merge, and green merged-main CI. Mac acceptance is separate and cannot be inferred from GitHub's macOS runner.

| Checkpoint | Small coherent scope | Existing upstream to reuse |
|---|---|---|
| C02 | Approved scoped Evidence Vault, gap classification, fact-gate and prompt integration | path-resolver, pipeline-lock, skill-extract, verify-cv-facts, update-system |
| C03 | Structured JD requirements with source spans and explicit uncertainty; no candidate claims | jd-skill-gap, skill-extract |
| C04 | Persona selection over one evidence-backed truth layer | master-profile mode, profile archetypes, CV payloads |
| C05 | Tailoring with auditable source bindings; unsupported gaps excluded | openai-tailor, PDF/text/LaTeX modes |
| C06 | Separate relevance and faithfulness verdicts, unsupported claims fail | verify-ats, verify-cv-facts, ats-payload, cv-title-check |
| C07 | Eligibility from private runtime inputs with unknown/needs-review outcomes | profile config and location filters |
| C08 | Explainable multi-signal opportunity scoring | evaluation blocks, keyword-match, profile archetypes |
| C09 | Discovery and duplicate/stale posting handling | scan/providers, URL keys, liveness, dedup-tracker |
| C10 | Source-attributed company intelligence | company-funded, deep mode |
| C11 | Private reusable versus application-specific factual answer memory | user data root, application artifacts |
| C12 | Explicit approval tied to exact application content; mock execution only | prepare-application, apply mode |
| C13 | Accurate lifecycle with submission evidence | canonical tracker, set-status, outcome |
| C14 | Advisory outcome learning without changing career truth | analyze-patterns, calibrate, outcome |
| C15 | End-to-end privacy, integrity, upgrade, regression and Mac acceptance | existing test runners and doctor |

C03 extraction is employer-side information. CV evidence, approved Vault evidence, scoped user statements, and unsupported requirements stay distinguishable. Neither a JD keyword nor a prerequisite inference establishes a candidate skill. Personas may select and reorder facts; they may not manufacture them. Runtime eligibility, compensation and answer memory never belong in this public repository.

There was no enhanced checkpoint ledger in the fetched main/PR branch. Acceptance counts cover the 14 checkpoints listed here, equally weighted; they are not estimates of effort or of inherited upstream functionality. No historical percentage is asserted without evidence.

C05 implementation uses a bound JSON proposal over the existing HTML payload schema. Every factual scalar has a current source binding; unsupported fields and incomplete entries are excluded with reasons. The same sanitized payload feeds upstream HTML/LaTeX builders and the text adapter, with a private audit sidecar and source/payload/artifact digests. Approved experience stays attached to its original parent. Scoped Vault audit quotes never expand resume authority. Source reads and output paths are fenced to one private data root. The OpenAI-compatible tailoring entrypoint uses this gate automatically.

C05 deliberately selects approved wording rather than claiming to prove arbitrary paraphrases. Explicit negations of known technologies are conservatively withheld; other semantic contradictions remain review work. This implementation does not represent C06 independent verification acceptance.

C04 acceptance is live-verified: PR #3 head `b916a91abbd0de7061ac7f9e530cdbc914b8492e` had successful Tests run `37838802520`; merge commit `14fd62e4d179753af79483cd22c9b00ae811e26e` has successful Tests run `37853186830`, attempt 2. The original Windows web-unit failure was transient in this measurement; no permanent underlying fix is claimed from a passing retry. All required matrix, visual, and upgrade jobs completed successfully.

C05 PR #4 head `289699a0fefffe94069c63bf5668e337832ca135` passed every exact-head check, including Tests run `37858476200` on Linux, macOS, and Windows, plus visual, upgrade, privacy, dependency, and direction gates. It merged at `399e0ca17290420933eb5a6fa96ad4d865bcac1c`. Exact merged-main Tests run `37859614770` succeeded. Final C05 acceptance also includes the source-field correction below. The earlier Actions approval gate was resolved through authenticated synchronization. Optional release-publisher credentials and Discord webhook configuration remain separate from product gates.

C05 also verifies the normal upstream CV import path: separately reviewed employer/title/date metadata is joined using `cv-title-check.mjs` and source block context, while original profile ids, parent ids, and exact source quotes remain in the audit. Unreviewed titles cannot be replaced with location text. Source aliases into JD files cannot gain primary-source authority. Canonical path checks support macOS `/var`/`/private/var` aliases without allowing a different candidate root. Contextual experience cannot be relabeled as a certification through either facts or presentation headings.

C05 acceptance also includes a follow-up source-field safety correction: reviewed combined headings use fixed company/role/date positions, rather than allowing any approved heading part in any resume field. A new regression was observed failing before this repair and passes after it. Ambiguous headers cannot authorize a role; the normal upstream title/date mapping remains intact. This follow-up needs its own successful exact-head and merged-main CI before C05 is accepted.

C05 final source-field safety PR #5 head `9634a1c317c7c46d481761e61e0f17f159579d10` passed every exact-head check, including Tests run `37861312581`, then merged at `d06682bb1899b6897a7ef09b6b1ab2d30310812a`. Its exact merged-main Tests run `37862350661`, attempt 1, succeeded across Linux, macOS, Windows, visual, and upgrade jobs. C05 is accepted; C06 may now begin. Targeted validation is 59 passing tests, including 29 C05 tests and two regressions observed failing before their repairs.
