# Optional PDF text-layer verification

This verifier is an **opt-in** check for a finished PDF. It is separate from Career Ops' existing CV fact, HTML/ATS, page-budget, and visual verification. It does not alter the generated PDF, its metadata, the tracker, or any application state.

The source is MIT licensed, adapted from [ai-job-search-dev/ai-job-search](https://github.com/ai-job-search-dev/ai-job-search/blob/a3ba937be8b01b9414b09f2f85912139dd72be32/tools/verify_pdf.py) (copyright 2026 Mads Lorentzen). The full upstream license appears in `tools/third_party/ai-job-search/LICENSE`. The only functional adaptation in the copied utility is allowing text dumps under `output/` in addition to the upstream artifact folders.

## Run locally

```sh
# Output file must already exist; the verifier never creates a PDF.
python3 tools/verify_pdf.py output/sample-resume.pdf --min-chars 300 --ascii-dates

# Verify selected fields survived PDF text extraction:
python3 tools/verify_pdf.py output/sample-resume.pdf --contains 'Work Experience'

# Optional inspectable text dump (only inside cv/, cover_letters/, or output/):
python3 tools/verify_pdf.py output/sample-resume.pdf --dump-text output/sample-resume.txt

# Isolated unit tests: do not require PDF tools installed; mock extractor calls.
python3 -m unittest discover -s tests -p test_verify_pdf.py -v
```

For actual PDF extraction the script first attempts the optional Python `pypdf` dependency; if unavailable, it tries Poppler's `pdftotext`. Install **either** tool if needed. `--ascii-dates` checks the *raw extracted text* for Unicode dashes in date ranges; it does not change the document. Do not treat success as proof that every ATS will import the PDF correctly. The existing ATS/parser checks and real application acceptance still matter.

## Scope and acceptance

The standalone GitHub workflow `.github/workflows/pdf-text-verification.yml` exercises the copied unit tests on changes to these files. The verifier is **not** invoked by Career Ops' normal generation or submission flow. Integration into a user-facing demo is deferred until the existing C05/acceptance and independent review gates are complete. Do not merge this branch automatically or alter the active build automation.
