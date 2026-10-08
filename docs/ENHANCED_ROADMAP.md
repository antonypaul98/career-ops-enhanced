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
