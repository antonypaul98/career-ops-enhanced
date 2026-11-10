import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodeRoot } from "../../src/lib/core/code-root.mjs";
import {
  FREE_PREVIEW_MODEL,
  reportOnlyResult,
  validatePreviewRequest,
} from "../../src/lib/evaluation-preview-guard.mjs";

const postingUrl = "https://example.com/careers/role/123";
const jd = "Data Engineer position. ".repeat(20);
const request = { evaluationOnly: true, postingUrl, jobDescription: jd };
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const routePath = path.join(root, "src/app/api/evaluation-preview/route.ts");
const routeText = fs.readFileSync(routePath, "utf8");

test("acceptance preview requires explicit, bounded HTTPS real-input data", () => {
  assert.equal(validatePreviewRequest(request).ok, true);
  assert.equal(validatePreviewRequest({ postingUrl, jobDescription: jd }).ok, false);
  assert.equal(validatePreviewRequest({ ...request, postingUrl: "http://example.com/job" }).ok, false);
  assert.equal(validatePreviewRequest({ ...request, postingUrl: "https://user:secret@example.com/job" }).ok, false);
  assert.equal(validatePreviewRequest({ ...request, postingUrl: "https://example.com/job#fragment" }).ok, false);
  assert.equal(validatePreviewRequest({ ...request, jobDescription: "Too short" }).ok, false);
  assert.equal(validatePreviewRequest({ ...request, jobDescription: "x".repeat(120001) }).ok, false);
  assert.equal(validatePreviewRequest(null).ok, false);
});

test("evaluation-only result remains unverified, non-submittable and unpersisted", () => {
  const input = validatePreviewRequest(request);
  const result = reportOnlyResult({
    ok: true, postingUrl, company: "Example", role: "Data Engineer",
    score: 3, reportMarkdown: "REPORT OUTPUT",
  }, input);
  assert.equal(result.status, "evaluation-only");
  assert.equal(result.persisted, false);
  assert.equal(result.submissionAllowed, false);
  assert.equal(result.applicationPackageAllowed, false);
  assert.equal(result.sourceVerification, "caller-supplied-JD-not-independently-verified");
  assert.deepEqual(result.eligibility, {
    location: "unverified", employment: "unverified",
    sponsorship: "unverified", clearance: "unverified",
  });
  assert.equal(result.model, "opencode/glm-5.3-flash-free");
  assert.equal(FREE_PREVIEW_MODEL, result.model);
  assert.ok(!("trackerId" in result));
  assert.ok(!("applicationId" in result));
  assert.ok(!("pdf" in result));
  assert.throws(() => reportOnlyResult({ ok: false }, input));
  assert.throws(() => reportOnlyResult({ ok: true, postingUrl: "https://wrong.example/job" }, input));
});

test("preview route never imports canonical writers or submission paths", () => {
  assert.match(routeText, /CAREER_OPS_ENABLE_REPORT_PREVIEW/);
  assert.match(routeText, /CAPS\.localReadOnly/);
  assert.match(routeText, /resolveCli\("opencode"\)/);
  assert.match(routeText, /"--model", FREE_PREVIEW_MODEL/);
  assert.match(routeText, /createProcessTreeStopper/);
  assert.match(routeText, /parseEvaluationEnvelope\(/);
  for (const forbidden of [
    "persistEvaluation", "acquireTrackerWrite", "merge-tracker",
    "renderAndMarkPdf", "mark-pdf-ready", "application-approval",
    "submission-kernel", "readApplications", "writeFileSync",
  ]) {
    assert.ok(!routeText.includes(forbidden), `preview route unexpectedly refers to ${forbidden}`);
  }
});

test("preview loads the evaluator from code root while keeping candidate files in the data root", () => {
  const fakeCwd = "/isolated/repo/web";
  const privateDataRoot = "/private/candidate-copy";
  const codeRoot = resolveCodeRoot(fakeCwd, { CAREER_OPS_ROOT: privateDataRoot });
  assert.equal(codeRoot, "/isolated/repo");
  assert.notEqual(codeRoot, privateDataRoot);
  assert.match(routeText, /resolveCodeRoot\(process\.cwd\(\), process\.env\)/);
  assert.match(routeText, /pathToFileURL\(path\.join\(codeRoot, "enhanced", "resume-authority\.mjs"\)\)/);
  assert.doesNotMatch(routeText, /pathToFileURL\(path\.join\(root, "enhanced", "resume-authority\.mjs"\)\)/);
});
