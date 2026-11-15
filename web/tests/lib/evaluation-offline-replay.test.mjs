/**
 * Offline replay of the read-only evaluation boundary.
 * Uses synthetic job/candidate facts and a mocked tracker merge; no provider,
 * private candidate data, application submission or token spend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseOpenCodeEvent } from "../../src/lib/run-cli-support.mjs";
import { createEvaluationEnvelopeFilter } from "../../src/lib/evaluation-envelope.mjs";
import { persistEvaluation } from "../../src/lib/evaluation-persist.mjs";
import { readJobStream } from "../../src/lib/job-stream.mjs";

const url = "https://example.com/jobs/synthetic-engineer";
const fence = String.fromCharCode(96).repeat(3);
const report = [
  "# Evaluation: Example Co — Synthetic Engineer",
  "",
  "**URL:** " + url,
  "",
  "## Machine Summary",
  "",
  fence + "yaml",
  "company: Example Co",
  "role: Synthetic Engineer",
  "score: 2.5",
  "final_decision: HOLD",
  "confidence: medium",
  "work_auth: not verified",
  "risk_summary: six-year requirement unresolved",
  "score_evidence: synthetic experience below requirement",
  fence,
  "",
  "## A — Fit", "Partial.",
  "## B — Requirements", "Six years required.",
  "## C — Evidence", "Synthetic candidate facts only.",
  "## D — Gaps", "Experience gap.",
  "## E — Eligibility", "Unconfirmed.",
  "## F — Recommendation", "Hold.",
  "## G — Posting Legitimacy", "Synthetic posting.",
  "## Risk Summary", "Experience and work-authorization checks pending.",
  "## Score Evidence", "Not a full match.",
  "## Keywords extracted", "Node.js.",
  "## Keyword Coverage", "Partial.",
  "## Job Description", "Synthetic engineer position.",
  "",
].join("\n");

const metadata = {
  company: "Example Co", role: "Synthetic Engineer", score: 2.5,
  note: "Synthetic fixture: six-year requirement is a gap", postingUrl: url,
};
const sealed = [
  "<<evaluation-json>>",
  JSON.stringify(metadata),
  "<<evaluation-report>>",
  report.trimEnd(),
  "<</evaluation-report>>",
  "<</evaluation-json>>",
  "",
].join("\n");

const encoder = new TextEncoder();
function response(records) {
  return new ReadableStream({
    start(controller) {
      for (const item of records) controller.enqueue(encoder.encode(JSON.stringify(item) + "\n"));
      controller.close();
    },
  });
}

test("fragmented OpenCode -> private filter -> validated report -> synthetic write -> trusted score receipt", async () => {
  const filter = createEvaluationEnvelopeFilter({ expectedUrl: url });
  let displayed = "";
  for (let i = 0; i < sealed.length; i += 11) {
    const fragment = sealed.slice(i, i + 11);
    const event = parseOpenCodeEvent(JSON.stringify({ type: "text", part: { type: "text", text: fragment } }));
    displayed += filter.push(event.text);
  }
  displayed += filter.flush();
  assert.ok(!displayed.includes("Synthetic candidate facts only."), "report must never appear in UI logs");
  assert.ok(!displayed.includes("work_auth:"), "machine summary must never appear in UI logs");

  const payload = filter.result();
  assert.equal(payload.ok, true, payload.error);
  assert.equal(payload.score, 2.5);

  const root = mkdtempSync(path.join(tmpdir(), "career-ops-offline-replay-"));
  let mergeCalls = 0;
  let released = 0;
  const saved = await persistEvaluation(
    { root, payload, today: "2026-11-15" },
    {
      reserveFn: async () => ({ num: "012", release: async () => { released++; } }),
      mergeFn: async () => { mergeCalls++; return { synthetic: true }; },
    },
  );
  assert.equal(mergeCalls, 1, "tracker merge stage must be reached");
  assert.equal(released, 1, "report-number reservation must be released");
  assert.match(saved.reportRelative, /^reports\/012-example-co-2026-11-15\.md$/);
  assert.equal(readFileSync(path.join(root, saved.reportRelative), "utf8"), report.trimEnd() + "\n");
  const addition = readFileSync(saved.additionPath, "utf8");
  assert.match(addition, /\tEvaluated\t2\.5\/5\t/);
  assert.ok(addition.includes(url));

  // Model narration has no verdict because the report is privacy-filtered.
  // Only the server's post-persistence confirmation carries the true score.
  const progress = [];
  const completion = await readJobStream(response([
    { type: "status", label: "Saved report 012 and merged tracker" },
    { type: "done", tokens: 184, evaluation: {
      score: payload.score, note: payload.note, reportNum: saved.num,
    } },
  ]), (event) => progress.push(event));
  assert.deepEqual(completion, {
    status: "done", tokens: 184,
    evaluation: { score: 2.5, note: metadata.note, reportNum: "012" },
  });
  assert.equal(progress.length, 1);
});

test("bad metadata and incomplete reports are rejected before persistence", () => {
  const variants = [
    sealed.replace('"score":2.5', '"score":5'),
    sealed.replace("## G — Posting Legitimacy", "## Unrecognized"),
    sealed.replace(metadata.postingUrl, "https://example.com/jobs/other"),
    sealed.replace("<</evaluation-report>>", "<</evaluation-report>>\n<</evaluation-report>>"),
    sealed.replace('"note":"Synthetic fixture: six-year requirement is a gap"', '"note":"line one\\nline two"'),
  ];
  for (const bad of variants) {
    const filter = createEvaluationEnvelopeFilter({ expectedUrl: url });
    filter.push(bad);
    assert.equal(filter.result().ok, false, "invalid content must fail before persistence");
  }
});
