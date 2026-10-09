# Mode: latex-tex — Tailor a user-owned LaTeX CV in place

## Enhanced evidence-bound tailoring (C05)

In this repository, this boundary takes precedence over free-form rewriting steps below. First review facts with the existing `master-profile` mode and `career-profile.mjs import --review`. No unattended approval is permitted. New tailored CVs use reviewed `data/career-profile.yml` plus approved, scoped Evidence Vault records.

Run `node enhanced/tailor-resume.mjs --persona ID --prepare` to obtain the allowed records. Build a proposal in the private data root (for example `output/proposal.json`) with `persona_id`, the existing HTML CV `payload`, and `bindings` mapping every factual JSON Pointer to its allowed record ref. Select/reorder approved wording; do not invent a title from the persona or job. Keep each experience bullet with its approved employer. `skill_only` permits Skills/competencies only; contextual claims retain their complete approved context. Paraphrases require a newly reviewed profile/Vault statement.

Run `node enhanced/tailor-resume.mjs --persona ID --proposal output/proposal.json --jd jds/job.md --format FORMAT --output output/cv-stem`, where FORMAT is `html` for PDF, `text` for Markdown, or `latex` for the existing LaTeX builder. The HTML and LaTeX renderers are unchanged. PDF generation still runs its existing fact gate. The LaTeX adapter reports any sections its upstream template cannot render.

Inspect the private `.evidence.json` audit, excluded fields, contradictory skills, and evidence gaps. Missing, stale, unreviewed, rejected, wrong-scope and unsupported evidence is excluded. Job-description keywords and inferred prerequisites never become candidate facts. Private input and output paths stay within one candidate data root. `openai-tailor.mjs --persona ID` now runs the same bound-proposal gate before rendering; it sends approved wording rather than Vault audit quotes or unrelated private config. No application is submitted by tailoring.

C06 runs an independent second pass automatically in the bound-tailoring CLI and `openai-tailor.mjs`. Read the private `.verification.json`: factual faithfulness must pass; relevance is a separate advisory technology-coverage verdict with unresolved qualifications shown for review. High keyword coverage never excuses a failed factual check. The verifier reloads current authority, checks source fields, scopes, provenance, persona and employer context, and regenerates HTML/text/LaTeX source artifacts to detect added or modified content even with recomputed hashes. It never calls the tailoring gate to obtain its verdict.

To rerun: `node enhanced/verify-resume.mjs --persona ID --evidence output/cv-stem.evidence.json --artifact output/cv-stem.EXT --jd jds/job.md --output output/cv-stem.verification.json`. All paths remain in the private candidate root. Standard system templates are verified; custom templates and compiled PDFs require separate final-artifact review and cannot inherit a source-artifact pass. LaTeX omissions are reported and excluded from relevance coverage. Failed or inconclusive faithfulness blocks completion; review evidence gaps before using a truthful low-relevance result.


Opt-in mode for candidates who already maintain a hand-tuned `.tex` CV. **Does not change the global source of truth** — `cv.md` remains the default for evaluations, apply mode, and auto-pipeline. Invoke explicitly via `/career-ops latex-tex`.

## When to use

- User has `resume.tex` (or `config/profile.yml → latex.source`) in a supported layout
- User wants JD-tailored bullets/skills while keeping their preamble, macros, colors, and spacing

## Supported layouts (v1)

| Family | Detection | Editable prose |
|--------|-----------|----------------|
| `resumeSubheading` | `\resumeSubheading` + `\resumeItem`/`\resumeItemWithoutTitle`/`\resumeSubItem` | `\resumeItem{...}` and `\resumeItemWithoutTitle{}{...}` bullets; `\textbf{Category}{: items}` and `\resumeSubItem{Category}{items}` skill values |
| `tabularx-itemize` | `tabularx` + `itemize`, no resume macros | `\item` body text in the document body |

Extraction only reads the document body (preamble macro definitions are skipped) and ignores commented-out macro calls — old bullets kept as `%` comments never become editable slots.

Any other layout → stop with the script error and suggest `/career-ops latex` (cv.md → career-ops template).

## Source file resolution

1. `config/profile.yml → latex.source` if set
2. Else `resume.tex` in project root
3. Else `cv.tex` in project root

If none exist, stop and ask the user to add their `.tex` file or set `latex.source`.

```yaml
# config/profile.yml (optional, user layer)
latex:
  source: resume.tex
```

## Pipeline

1. Resolve source `.tex` path (see above)
2. Run: `node extract-latex-content.mjs <source.tex> --out /tmp/cv-slots-{company}.json`
3. If `supported: false` → show `error` + `hint`; do not proceed
4. Read JD (from context, report, or ask user)
5. Tailor **only** the `slots[].text` values for JD fit (same ethics as `modes/latex.md` / `pdf`):
   - Extract 15–20 JD keywords
   - Reorder bullets by relevance (reorder patch list order if needed; patch ids stay stable)
   - Inject keywords into existing achievements — **NEVER invent skills**
   - If `cv.md` exists, cross-check claims against it; omit anything not backed by in-scope sources
6. Write patches file:

```json
{
  "slots": [ "... copy from extract manifest ..." ],
  "patches": [
    { "id": "bullet-0", "text": "Tailored plain-text bullet (no LaTeX escaping — the script escapes)" }
  ]
}
```

7. Run: `node patch-latex-content.mjs <source.tex> /tmp/cv-patches-{company}.json output/cv-{candidate}-{company}-{YYYY-MM-DD}.tex`
8. Run: `node generate-latex.mjs output/cv-{candidate}-{company}-{YYYY-MM-DD}.tex output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf --compile-only`
9. Report: family, slot count, patched count, `.tex` path, `.pdf` path (or compile error)

**Requires:** `tectonic` or `pdflatex` on PATH (same as `latex` mode).

## Ethical rules (mandatory)

Same as `modes/latex.md` and `modes/pdf.md`:

- Keywords get **reformulated, never fabricated**
- Never add tools, skills, or metrics the candidate does not already have in the source `.tex` or `cv.md`
- Preserve inline LaTeX markup inside bullets when possible; when rewriting, output **plain text** in patch JSON (the patch script escapes special characters)
- Do **not** rewrite preamble, macro definitions, section titles, dates, company names, or job titles unless the user explicitly asks

## What this mode does NOT do

- Does not replace `cv.md` as the system source of truth
- Does not parse arbitrary LaTeX templates
- Does not auto-run during auto-pipeline or evaluation
- Does not submit applications

## Relationship to `latex` mode

| Mode | Input | Output |
|------|-------|--------|
| `latex` | `cv.md` | career-ops `templates/cv-template.tex` → `.tex` + PDF |
| `latex-tex` | user's `resume.tex` | same template shape, tailored prose only → `.tex` + PDF |
