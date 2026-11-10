/**
 * Offline acceptance of the report-only output pipeline.
 * All inputs and OpenCode events are synthetic; no provider, server,
 * candidate directory, or canonical application files are touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenCodeEvent } from "../../src/lib/run-cli-support.mjs";
import { parseEvaluationEnvelope } from "../../src/lib/evaluation-envelope.mjs";
import { previewCompletion } from "../../src/lib/evaluation-preview-security.mjs";
import { validatePreviewRequest, reportOnlyResult } from "../../src/lib/evaluation-preview-guard.mjs";
import { assertNotEvaluationOnly } from "../../src/lib/evaluation-only-boundary.mjs";

const postingUrl = "https://example.com/jobs/synthetic-data-engineer";
const jobDescription = "Synthetic Data Engineer: SQL pipelines, validation, and audit trails. ".repeat(6);
const input = { evaluationOnly: true, postingUrl, jobDescription };

function makePayload() {
  const reportMarkdown = [
    "# Evaluation: Fictional Co — Data Engineer", "",
    "**URL:** " + postingUrl, "",
    "## Machine Summary", "",
    "```yaml", "company: Fictional Co", "role: Data Engineer",
    "score: 3.5", "final_decision: REVIEW",
    "confidence: low", "work_auth: unknown",
    "risk_summary: Synthetic test; eligibility not verified",
    "score_evidence: Only synthetic candidate facts", "```", "",
    "## A — Fit", "Only a synthetic evaluation.",
    "## B — Requirements", "Unverified.",
    "## C — Evidence", "Synthetic evidence only.",
    "## D — Gaps", "Unknown.",
    "## E — Eligibility", "Not established.",
    "## F — Recommendation", "Review only.",
    "## G — Posting Legitimacy", "Caller-supplied description.",
    "## Risk Summary", "No eligibility assertion.",
    "## Score Evidence", "No real-world claims.",
    "## Keywords extracted", "SQL",
    "## Keyword Coverage", "Synthetic.",
    "## Job Description", jobDescription, ""
  ].join("\n");
  return { company: "Fictional Co", role: "Data Engineer",
    score: 3.5, note: "Synthetic acceptance only",
    postingUrl, reportMarkdown };
}

function simulatedEvents(payload, extras = []) {
  const envelope = "<<evaluation-json>>\n" + JSON.stringify(payload) + "\n<</evaluation-json>>\n";
  const events = [
    { type: "step_start" },
    { type: "text", part: { type: "text", text: envelope } },
    { type: "step_finish", part: { type: "step-finish",
      tokens: { input: 20, output: 30, cache: { write: 0 } }, cost: 0 } },
    ...extras
  ];
  return events.map(event => JSON.stringify(event));
}

function runSyntheticPipeline(lines, posted = input) {
  const checked = validatePreviewRequest(posted);
  if (!checked.ok) return { ok: false, stage: "input" };
  let output = "";
  let failed = false;
  let tokens = 0;
  for (const line of lines) {
    const event = parseOpenCodeEvent(line);
    if (event?.error || event?.tool || (typeof event?.costUsd === "number" && event.costUsd > 0))
      failed = true;
    if (event?.text) output += event.text;
    if (typeof event?.tokens === "number") tokens += event.tokens;
  }
  const envelope = parseEvaluationEnvelope(output, { expectedUrl: checked.postingUrl });
  const completion = previewCompletion({
    aborted: false, timedOut: false, failed, exitCode: 0, envelope
  });
  if (!completion.ok || !envelope.ok) return { ok: false, stage: "completion" };
  // Mirror the route's extra JD archive check, with no persistence.
  if (!envelope.reportMarkdown.includes(checked.jobDescription))
    return { ok: false, stage: "archive" };
  return { ok: true, tokens, report: reportOnlyResult(envelope, checked) };
}

test("synthetic OpenCode NDJSON produces complete, non-submittable evaluation-only output", () => {
  const result = runSyntheticPipeline(simulatedEvents(makePayload()));
  assert.equal(result.ok, true);
  assert.equal(result.tokens, 50);
  assert.equal(result.report.status, "evaluation-only");
  assert.equal(result.report.model, "opencode/glm-5.3-flash-free");
  assert.equal(result.report.persisted, false);
  assert.equal(result.report.submissionAllowed, false);
  assert.equal(result.report.applicationPackageAllowed, false);
  assert.equal(result.report.sourceVerification, "caller-supplied-JD-not-independently-verified");
  assert.ok(result.report.reportMarkdown.includes(jobDescription));
  assert.throws(() => assertNotEvaluationOnly(result.report), /Evaluation-only/);
  assert.throws(() => assertNotEvaluationOnly(result.report.reportMarkdown), /Evaluation-only/);
});

test("tool call, paid cost, provider error and malformed envelope block completion", () => {
  const payload = makePayload();
  for (const dangerous of [
    { type: "tool_use", part: { tool: "bash" } },
    { type: "step_finish", part: { type: "step-finish",
      tokens: { input: 1, output: 1 }, cost: 0.01 } },
    { type: "error", error: { data: { statusCode: 429, message: "Free usage limit reached" } } }
  ]) {
    const result = runSyntheticPipeline(simulatedEvents(payload, [dangerous]));
    assert.equal(result.ok, false, JSON.stringify(dangerous));
  }
  assert.equal(runSyntheticPipeline(simulatedEvents({ ...payload,
    reportMarkdown: "# Incomplete report" })).ok, false);
  assert.equal(runSyntheticPipeline(simulatedEvents({ ...payload,
    postingUrl: "https://example.com/jobs/different" })).ok, false);
  assert.equal(runSyntheticPipeline(simulatedEvents({ ...payload,
    reportMarkdown: payload.reportMarkdown.replace(jobDescription, "Omitted JD") })).ok, false);
});
