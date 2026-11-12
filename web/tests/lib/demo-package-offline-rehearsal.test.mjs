/**
 * Offline synthetic approval-package rehearsal. No provider, browser, ATS,
 * credentials, real CV, report persistence, or application submission.
 * The PDF is a one-page fictional test artifact, not a tailored resume.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { sealDemoPackage, verifyDemoPackage } from "../../src/lib/demo-package.mjs";
import { readSubmissionApprovals } from "../../src/lib/submission-approvals.mjs";
import {
  inspectApplicationObservation,
  createExactSubmissionReview,
  createExactSubmissionApproval,
  prepareApprovedSubmission,
  executeApprovedSubmission,
} from "../../../enhanced/approved-application-submission.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const PDF_PATH = "output/fictional-resume.pdf";
const PACKAGE_NAME = "fictional-demo-package.json";

function fictionalPdf() {
  // Standards-shaped, readable one-page PDF generated only in this tmp fixture.
  const draw = "BT /F1 15 Tf 50 740 Td (FICTIONAL TEST RESUME - NOT FOR SUBMISSION) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + Buffer.byteLength(draw) + " >>\nstream\n" + draw + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += (i + 1) + " 0 obj\n" + object + "\nendobj\n";
  }
  const xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + (objects.length + 1) +
    " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(pdf, "ascii");
}

function write(root, relative, bytes) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes, { mode: 0o600 });
  return filename;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-package-rehearsal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const cv = Buffer.from("# Fictional Candidate\nVerified synthetic experience: SQL and Python.\n");
  const profile = Buffer.from("review_status: source_verified\ncandidate: fictional\n");
  const config = Buffer.from("persona: fictional\n");
  const vault = Buffer.from("sources: synthetic-only\n");

  write(root, "cv.md", cv);
  write(root, "data/career-profile.yml", profile);
  write(root, "config/profile.yml", config);
  write(root, "data/career-evidence.yml", vault);

  const pdf = fictionalPdf();
  write(root, PDF_PATH, pdf);
  const sourceSnapshot = {
    profile_sha256: sha(profile),
    config_sha256: sha(config),
    vault_sha256: sha(vault),
    primary_sources_sha256: { "cv.md": sha(cv) },
  };
  write(root, PDF_PATH + ".evidence.json",
    JSON.stringify({ pdf_sha256: sha(pdf), snapshot: sourceSnapshot }));

  const input = sealDemoPackage({
    demo_only: true,
    submission_allowed: false,
    application_action: "none",
    eligibility: {
      status: "fictional_unverified",
      demo_allowed: true,
      submission_allowed: false,
      human_confirmation_required: true,
    },
    application: {
      key: "fictional-offline-rehearsal",
      company: "Fictional Test Company",
      role: "Synthetic Data Engineer",
      url: "https://example.com/jobs/fictional-no-submission",
    },
    warning: "SYNTHETIC DEMO ONLY - no real applicant, job, or authorization evidence",
    candidate_match: {
      limitations: ["Synthetic CV is not evidence for a real application."],
    },
    artifacts: [{ kind: "resume", path: PDF_PATH, sha256: sha(pdf) }],
    source_snapshot: sourceSnapshot,
  });
  const packagePath = write(root, "data/private/" + PACKAGE_NAME, JSON.stringify(input));
  return { root, input, packagePath, pdfPath: path.join(root, PDF_PATH) };
}

test("sealed fictional PDF package is readable, but Approval Center labels it demo-only", t => {
  const { root, input } = fixture(t);
  assert.equal(verifyDemoPackage(root, input), true);
  const views = readSubmissionApprovals(root);
  assert.equal(views.length, 1);
  const view = views[0];
  assert.equal(view.error, undefined);
  assert.equal(view.status.kind, "paused");
  assert.match(view.status.label, /Demo only.*submission disabled/i);
  assert.match(view.demoWarning, /SYNTHETIC DEMO ONLY/);
  assert.equal(view.artifacts.length, 1);
  assert.equal(view.artifacts[0].name, "fictional-resume.pdf");
  assert.equal(view.artifacts[0].sha256, input.artifacts[0].sha256);
  assert.equal(view.fields.length, 0);
  assert.equal(fs.existsSync(path.join(root, "data/applications.md")), false);
  assert.equal(fs.existsSync(path.join(root, "applications.md")), false);
});

test("fictional demo package cannot obtain submission approval or invoke a submit callback", async t => {
  const { input } = fixture(t);
  assert.equal(inspectApplicationObservation(input).reason, "demo_submission_disabled");
  assert.throws(() => createExactSubmissionReview(input), /demo_submission_disabled/);
  assert.throws(() => createExactSubmissionApproval(input), /demo_submission_disabled/);
  assert.equal(prepareApprovedSubmission(input).reason, "demo_submission_disabled");
  let submitted = 0;
  const result = await executeApprovedSubmission(input, () => { submitted++; });
  assert.equal(result.decision, "blocked");
  assert.equal(submitted, 0);
});

for (const [name, mutate, error] of [
  ["reviewed CV source", root => fs.appendFileSync(path.join(root, "cv.md"), "Tampered\n"), /Demo source changed/],
  ["candidate authority", root => fs.appendFileSync(path.join(root, "data/career-profile.yml"), "tampered\n"), /Demo authority changed/],
  ["candidate configuration", root => fs.appendFileSync(path.join(root, "config/profile.yml"), "tampered\n"), /Demo authority changed/],
  ["candidate evidence vault", root => fs.appendFileSync(path.join(root, "data/career-evidence.yml"), "tampered\n"), /Demo authority changed/],
  ["PDF bytes", root => fs.appendFileSync(path.join(root, PDF_PATH), "Tampered"), /Demo PDF changed/],
  ["PDF evidence sidecar", root => {
    const filename = path.join(root, PDF_PATH + ".evidence.json");
    const json = JSON.parse(fs.readFileSync(filename, "utf8"));
    json.pdf_sha256 = "0".repeat(64);
    fs.writeFileSync(filename, JSON.stringify(json));
  }, /Demo PDF sidecar changed/],
]) {
  test("sealed demo rejects changed " + name, t => {
    const { root, input } = fixture(t);
    mutate(root);
    assert.throws(() => verifyDemoPackage(root, input), error);
    const [view] = readSubmissionApprovals(root);
    assert.match(view.error, error);
    assert.equal(fs.existsSync(path.join(root, "data/applications.md")), false);
  });
}

test("resealing hostile flags cannot promote the fictional package", t => {
  const { root, input } = fixture(t);
  for (const change of [
    { demo_only: false },
    { submission_allowed: true },
    { application_action: "submit" },
    { eligibility: { ...input.eligibility, submission_allowed: true } },
    { readiness_input: { application_bundle: {} } },
    { submit_approval: { approved_by: "candidate" } },
  ]) {
    const altered = sealDemoPackage({ ...input, ...change });
    assert.throws(() => verifyDemoPackage(root, altered), /Invalid demo safety boundary/);
  }
});

test("renaming fictional demo bytes as a browser approval does not create an approval", t => {
  const { root, packagePath } = fixture(t);
  const forged = path.join(root, "data/private/fictional-browser-approved.json");
  fs.renameSync(packagePath, forged);
  const [view] = readSubmissionApprovals(root);
  assert.match(view.error, /missing the reviewed application bundle/);
  assert.equal(view.status, undefined);
  assert.equal(fs.existsSync(path.join(root, "data/applications.md")), false);
});
