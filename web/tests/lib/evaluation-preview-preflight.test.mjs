import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { loadPreviewCandidate } from "../../src/lib/evaluation-preview-authority.mjs";
import { checkPreviewAccess } from "../../src/lib/evaluation-preview-security.mjs";
import { validatePreviewRequest } from "../../src/lib/evaluation-preview-guard.mjs";

const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const token = "a".repeat(48);

function write(root, relative, data) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, data, { mode: 0o600 });
  return filename;
}
function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-preflight-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const lines = [
    "# Synthetic Candidate",
    "## Experience",
    "### Fictional Employer — Engineer — 2022–2024",
    "- Built Python ETL pipelines.",
    "## Skills", "- Python",
  ];
  const at = n => ({ source: "cv.md", line: n, quote: lines[n - 1] });
  const profile = {
    schema_version: 1, candidate: {}, summary: [], projects: [], education: [],
    certifications: [], skills: [{
      id: "python", text: "Python", review_status: "verified", evidence: at(6),
    }], experiences: [{
      id: "company", label: lines[2].slice(4), review_status: "verified",
      evidence: at(3), facts: [{
        id: "pipelines", text: "Built Python ETL pipelines.",
        review_status: "verified", evidence: at(4),
      }],
    }],
  };
  write(root, "cv.md", lines.join("\n") + "\n");
  write(root, "data/career-profile.yml", yaml.dump(profile));
  write(root, "data/career-evidence.yml", yaml.dump({ schema_version: 1, entries: [] }));
  write(root, "config/profile.yml", yaml.dump({
    name: "Fictional Candidate", email: "fictional@example.invalid",
  }));
  write(root, "modes/oferta.md", "# Report-only format\n");
  return { root, profile };
}

test("shared candidate gate authorizes only source-verified non-identity facts", async t => {
  const { root } = makeFixture(t);
  const ready = await loadPreviewCandidate({ root, codeRoot });
  assert.equal(ready.ok, true, ready.error);
  assert.ok(ready.approvedRecords.length);
  assert.ok(ready.approvedRecords.every(record => record.kind !== "identity"));
  assert.ok(ready.approvedRecords.every(record => record.ref.startsWith("master_profile:")));
  assert.doesNotMatch(JSON.stringify(ready.approvedRecords), /fictional@example.invalid/);
  assert.equal(ready.verifyAuthority(), true);
  assert.equal(fs.existsSync(path.join(root, "data/applications.md")), false);
  assert.equal(fs.existsSync(path.join(root, "reports")), false);
});

test("candidate source changes after a preflight invalidate its original snapshot", async t => {
  const { root } = makeFixture(t);
  const ready = await loadPreviewCandidate({ root, codeRoot });
  assert.equal(ready.ok, true, ready.error);
  fs.appendFileSync(path.join(root, "cv.md"), "New unreviewed claim.\n");
  assert.equal(ready.verifyAuthority(), false);
});

test("an unreviewed parent and missing evaluation format fail closed", async t => {
  const { root, profile } = makeFixture(t);
  profile.experiences[0].review_status = "unreviewed";
  write(root, "data/career-profile.yml", yaml.dump(profile));
  let inspected = await loadPreviewCandidate({ root, codeRoot });
  assert.equal(inspected.ok, false);
  assert.match(inspected.error, /review|required|verified/i);

  profile.experiences[0].review_status = "verified";
  write(root, "data/career-profile.yml", yaml.dump(profile));
  fs.unlinkSync(path.join(root, "modes/oferta.md"));
  inspected = await loadPreviewCandidate({ root, codeRoot });
  assert.equal(inspected.ok, false);
  assert.match(inspected.error, /template|authority/i);
});

test("overlarge evaluation template is refused without transmitting its contents", async t => {
  const { root } = makeFixture(t);
  write(root, "modes/oferta.md", "private marker ".repeat(30000));
  const checked = await loadPreviewCandidate({ root, codeRoot });
  assert.equal(checked.ok, false);
  assert.match(checked.error, /size limit/);
  assert.doesNotMatch(checked.error, /private marker/);
});

test("preflight authentication requires explicit enable, loopback origin and strong token", () => {
  const ok = { enabled: "1", configuredToken: token, providedToken: token,
    host: "localhost:3000", origin: "http://localhost:3000" };
  assert.equal(checkPreviewAccess(ok).ok, true);
  for (const variant of [
    { enabled: "0" }, { providedToken: "b".repeat(48) },
    { host: "public.example:3000" }, { origin: "https://attacker.example" },
  ]) assert.equal(checkPreviewAccess({ ...ok, ...variant }).ok, false);
});

test("preflight accepts shape only, not evidence of a live job or sponsorship", () => {
  const req = { evaluationOnly: true, postingUrl: "https://jobs.example.invalid/123",
    jobDescription: "Fictional listing details. ".repeat(12) };
  assert.equal(validatePreviewRequest(req).ok, true);
  assert.equal(validatePreviewRequest({ ...req, postingUrl: "http://jobs.example.invalid/123" }).ok, false);
});

test("the preflight endpoint has no model launch, reservation, file write or submit entrypoint", () => {
  const file = path.join(codeRoot, "web/src/app/api/evaluation-preview/preflight/route.ts");
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /checkPreviewAccess/);
  assert.match(source, /loadPreviewCandidate/);
  assert.doesNotMatch(source, /reservePreviewAttempt|spawnHeadlessCli|executeApprovedSubmission|writeFileSync|fetch\(/);
  assert.match(source, /attemptReserved: false/);
});
