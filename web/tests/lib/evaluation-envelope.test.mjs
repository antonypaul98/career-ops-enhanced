import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvaluationEnvelopeFilter, parseEvaluationEnvelope } from "../../src/lib/evaluation-envelope.mjs";

const report = "# Evaluation: Acme — Engineer\n\n**URL:** https://example.com/jobs/1\n\n## Machine Summary\n\n```yaml\ncompany: Acme\nrole: Engineer\nscore: 4\nfinal_decision: REVIEW\nconfidence: high\nwork_auth: confirmed\nrisk_summary: none\nscore_evidence: strong match\n```\n\n## A — Fit\nGood.\n## B — Requirements\nMet.\n## C — Evidence\nVerified.\n## D — Gaps\nNone.\n## E — Eligibility\nConfirmed.\n## F — Recommendation\nReview.\n## G — Posting Legitimacy\nVerified.\n## H — Draft Application Answers\nDraft only.\n## Risk Summary\nNone.\n## Score Evidence\nStrong match.\n## Keywords extracted\nNode.js\n## Keyword Coverage\nCovered.\n## Job Description\nSynthetic fixture description.\n";
const payload = { company: "Acme", role: "Engineer", score: 4, note: "Synthetic fixture only", postingUrl: "https://example.com/jobs/1", reportMarkdown: report };
const envelope = `before\n<<evaluation-json>>\n${JSON.stringify(payload)}\n<</evaluation-json>>\nafter\n`;

test("accepts one complete sealed evaluation", () => {
  const result = parseEvaluationEnvelope(envelope, { expectedUrl: payload.postingUrl });
  assert.equal(result.ok, true);
  assert.equal(result.company, "Acme");
});

test("changed URL and incomplete reports fail closed", () => {
  assert.equal(parseEvaluationEnvelope(envelope, { expectedUrl: "https://example.com/jobs/2" }).ok, false);
  const incomplete = envelope.replace("## A — Fit", "## Missing");
  assert.equal(parseEvaluationEnvelope(incomplete, { expectedUrl: payload.postingUrl }).ok, false);
});

test("stream filter withholds private report body while retaining it for validation", () => {
  const filter = createEvaluationEnvelopeFilter({ expectedUrl: payload.postingUrl });
  const visible = [filter.push(envelope.slice(0, 80)), filter.push(envelope.slice(80)), filter.flush()].join("");
  assert.ok(!visible.includes("Synthetic fixture description"));
  assert.equal(filter.result().ok, true);
});


test("oferta only requires draft answers for scores at least 4.5", () => {
  const low = { ...payload, reportMarkdown: report.replace("## H — Draft Application Answers\nDraft only.\n", "") };
  const wrap = value => `<<evaluation-json>>\n${JSON.stringify(value)}\n<</evaluation-json>>`;
  assert.equal(parseEvaluationEnvelope(wrap(low)).ok, true);
  const high = { ...low, score: 4.5, reportMarkdown: low.reportMarkdown.replace("score: 4", "score: 4.5") };
  assert.equal(parseEvaluationEnvelope(wrap(high)).ok, false);
});
