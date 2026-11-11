import test from "node:test";
import assert from "node:assert/strict";
import { parseReportOnlyReply } from "../../src/lib/evaluation-preview-client.mjs";

const postingUrl = "https://example.com/careers/123";
const result = {
  type: "preview-report",
  status: "evaluation-only",
  evaluation_only: true,
  model: "opencode/glm-5.3-flash-free",
  persisted: false,
  submissionAllowed: false,
  submission_allowed: false,
  applicationPackageAllowed: false,
  application_action: "none",
  sourceVerification: "caller-supplied-JD-not-independently-verified",
  postingUrl,
  reportReviewStatus: "unreviewed-model-output",
  reportMarkdown: "<!-- career-ops:evaluation-only:v1 -->\n# EVALUATION ONLY\nSynthetic content",
  company: "Fictional Co",
  role: "Data Engineer",
  score: 3.5,
};
const reply = (...events) => events.map(event => JSON.stringify(event)).join("\n") + "\n";

test("a complete, labelled report is reviewable only after the whole response", () => {
  const parsed = parseReportOnlyReply(200,
    reply({ type: "status", status: "evaluation-only" }, { type: "keepalive" }, result),
    postingUrl);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.report.reportMarkdown, result.reportMarkdown);
});

test("server errors and failed access do not become reports", () => {
  assert.match(parseReportOnlyReply(403, JSON.stringify({ error: "Local only" }), postingUrl).error, /Local only/);
  assert.equal(parseReportOnlyReply(200, reply(result, { type: "error", error: "Provider quota" }), postingUrl).ok, false);
  assert.equal(parseReportOnlyReply(200, reply({ type: "error", error: "Provider quota" }, result), postingUrl).ok, false);
});

test("duplicate, missing, malformed or unexpected events fail closed", () => {
  for (const body of [reply(), reply(result, result), "{not json}\n", reply({ type: "other" }, result)]) {
    assert.equal(parseReportOnlyReply(200, body, postingUrl).ok, false);
  }
});

test("a valid-looking report cannot change URL or promote to an application", () => {
  const mutations = [
    { postingUrl: postingUrl + "?fake=1" },
    { status: "approved" },
    { model: "paid/model" },
    { persisted: true },
    { submissionAllowed: true },
    { submission_allowed: true },
    { applicationPackageAllowed: true },
    { application_action: "submit" },
    { evaluation_only: false },
    { sourceVerification: "official-live-verified" },
    { reportReviewStatus: "approved" },
    { reportMarkdown: "# EVALUATION ONLY\nNo marker" },
    { score: 6 },
  ];
  for (const change of mutations) {
    const parsed = parseReportOnlyReply(200, reply({ ...result, ...change }), postingUrl);
    assert.equal(parsed.ok, false, JSON.stringify(change));
  }
});

test("untrusted oversized replies fail without exposing their content", () => {
  const parsed = parseReportOnlyReply(200, "secret".repeat(300000), postingUrl);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.includes("secret"), false);
});
