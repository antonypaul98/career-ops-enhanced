import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readSubmissionApprovals } from "../../src/lib/submission-approvals.mjs";

function fixture() {
  return {
    readiness_input: { application_bundle: {
      application: { key: "synthetic-42", company: "Synthetic Acme", role: "Engineer", url: "https://jobs.example/apply/42" },
      content_digest: "a".repeat(64),
      fields: [{ key: "name", label: "Name", value: "Synthetic Candidate", source: { ref: "synthetic-profile" } }],
      artifacts: [{ kind: "resume", path: "output/synthetic-resume.pdf", sha256: "b".repeat(64) }],
    } },
    observation: { final_review: true, unexpected_fields: [], observed_at: "2026-10-22T12:00:00Z" },
  };
}

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-approvals-"));
  fs.mkdirSync(path.join(root, "data", "private"), { recursive: true });
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("missing private directory is an empty Approval Center", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-approvals-"));
  try { assert.deepEqual(readSubmissionApprovals(root), []); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("reads only exact private approval-package filenames", () => withRoot((root) => {
  const privateDir = path.join(root, "data", "private");
  fs.writeFileSync(path.join(privateDir, "synthetic-browser-approved.json"), JSON.stringify(fixture()));
  fs.writeFileSync(path.join(privateDir, "unrelated.json"), "{private: true}");
  const rows = readSubmissionApprovals(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].applicationKey, "synthetic-42");
  assert.equal(rows[0].status.kind, "review");
  assert.equal(rows[0].fields[0].value, "Synthetic Candidate");
}));
test("exact one-action approval is visible but never executed", () => withRoot((root) => {
  const input = fixture();
  input.submit_approval = { schema_version: 1, approved_by: "candidate", scope: "submit_exact_application_once",
    max_consequential_actions: 1, approval_digest: "c".repeat(64), approved_at: "2026-10-22T12:01:00Z" };
  fs.writeFileSync(path.join(root, "data", "private", "synthetic-browser-approved.json"), JSON.stringify(input));
  const [row] = readSubmissionApprovals(root);
  assert.equal(row.status.kind, "approved");
  assert.equal(row.artifacts[0].name, "synthetic-resume.pdf");
  assert.equal("submit" in row, false);
}));
test("challenge state pauses and malformed packages fail visibly", () => withRoot((root) => {
  const privateDir = path.join(root, "data", "private");
  const input = fixture(); input.observation.mfa_required = true;
  fs.writeFileSync(path.join(privateDir, "a-browser-approved.json"), JSON.stringify(input));
  fs.writeFileSync(path.join(privateDir, "b-browser-approved.json"), "not-json");
  const rows = readSubmissionApprovals(root);
  assert.equal(rows[0].status.kind, "paused");
  assert.match(rows[1].error, /JSON/);
}));
