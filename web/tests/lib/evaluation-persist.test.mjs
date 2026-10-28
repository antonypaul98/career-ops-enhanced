import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { persistEvaluation } from "../../src/lib/evaluation-persist.mjs";

test("backend chooses canonical paths and writes a headered tracker addition", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-persist-"));
  mkdirSync(path.join(root, "data"), { recursive: true });
  writeFileSync(path.join(root, "data", "applications.md"), "| # | Date | Company | Role | Status | Score | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n");
  const payload = { company: "Acme", role: "Engineer", score: 4, note: "Synthetic fixture only", postingUrl: "https://example.com/jobs/1", reportMarkdown: "# Evaluation: Acme — Engineer\n\n**URL:** https://example.com/jobs/1\n\n## Machine Summary\n\n```yaml\ncompany: Acme\nrole: Engineer\nscore: 4\nfinal_decision: REVIEW\nconfidence: high\nwork_auth: confirmed\nrisk_summary: none\nscore_evidence: strong match\n```\n\n## A — Fit\nGood.\n## B — Requirements\nMet.\n## C — Evidence\nVerified.\n## D — Gaps\nNone.\n## E — Eligibility\nConfirmed.\n## F — Recommendation\nReview.\n## G — Posting Legitimacy\nVerified.\n## H — Draft Application Answers\nDraft only.\n## Risk Summary\nNone.\n## Score Evidence\nStrong match.\n## Keywords extracted\nNode.js\n## Keyword Coverage\nCovered.\n## Job Description\nSynthetic fixture description.\n" };
  let merged = 0;
  const result = await persistEvaluation({ root, payload, today: "2026-10-28", postedAt: "2026-10-27" }, { reserveFn: async () => ({ num: "001", release: async () => {} }), mergeFn: async () => { merged++; } });
  assert.equal(merged, 1);
  assert.match(result.reportRelative, /^reports\/001-acme-2026-10-28\.md$/);
  const addition = readFileSync(result.additionPath, "utf8").split("\n");
  assert.equal(addition[0], "num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl");
  assert.match(addition[1], /Synthetic fixture only; posted: 2026-10-27\thttps:\/\/example\.com\/jobs\/1$/);
  assert.ok(!readFileSync(path.join(root, result.reportRelative), "utf8").includes("real candidate"));
});
