/**
 * Real production Chromium PDF rehearsal using fictional source-verified facts.
 * Opted into the existing cv-visual CI job that installs Chromium and pdftotext.
 * No model, network, real candidate, live job, ATS, tracker or submission.
 */
import { test, expect } from "playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { loadResumeAuthority } from "../../enhanced/resume-authority.mjs";
import { tailorBoundResume } from "../../enhanced/evidence-tailor.mjs";
import { renderBoundResume } from "../../enhanced/tailor-resume.mjs";
import { verifyResumeArtifact } from "../../enhanced/verify-resume.mjs";
import { renderHtmlToPdf } from "../../generate-pdf.mjs";
import {
  prepareApprovedSubmission,
  executeApprovedSubmission,
} from "../../enhanced/approved-application-submission.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const JD = "## Requirements\n- Python\n- Kubernetes\n";
const PERSONA = "data-engineer";
const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_SOURCE = path.join(CODE_ROOT, "web", "src");
const HAS_WEB = fs.existsSync(WEB_SOURCE);
// Core-only installations omit web/; never statically import optional modules.
const webModules = HAS_WEB ? await Promise.all([
  "demo-package.mjs",
  "submission-approvals.mjs",
  "bound-cv.mjs",
  "bound-pdf.mjs",
].map(name => import(pathToFileURL(path.join(WEB_SOURCE, "lib", name)).href))) : [];
const [
  { sealDemoPackage, verifyDemoPackage } = {},
  { readSubmissionApprovals } = {},
  { prepareBoundCv } = {},
  { renderBoundPdf } = {},
] = webModules;
test.skip(!HAS_WEB, "web/ is optional in core-only installs");

function write(root, relative, data) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { mode: 0o600 });
  return file;
}

function fixture() {
  // macOS exposes the same temp directory through /var and /private/var.
  // Match the canonical paths returned by the publication boundary.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-bound-pdf-")));
  const lines = [
    "# Fictional Candidate",
    "## Experience",
    "### Fictional Employer — Data Engineer — 2022–2024",
    "- Built Python ETL pipelines.",
    "## Skills",
    "- Python",
  ];
  const evidence = line => ({ source: "cv.md", line, quote: lines[line - 1] });
  const profile = {
    schema_version: 1, candidate: {}, summary: [], projects: [], education: [],
    certifications: [], skills: [{
      id: "python", text: "Python", review_status: "verified", evidence: evidence(6),
    }], experiences: [{
      id: "employer", label: lines[2].slice(4), review_status: "verified",
      evidence: evidence(3), facts: [{
        id: "pipelines", text: "Built Python ETL pipelines.",
        review_status: "verified", evidence: evidence(4),
      }],
    }],
  };
  write(root, "cv.md", lines.join("\n") + "\n");
  write(root, "data/career-profile.yml", yaml.dump(profile));
  write(root, "data/career-evidence.yml", yaml.dump({ schema_version: 1, entries: [] }));
  write(root, "config/profile.yml", yaml.dump({
    name: "Fictional Candidate", email: "fictional@example.invalid",
  }));
  write(root, "jds/job.md", JD);

  const proposal = {
    persona_id: PERSONA,
    payload: {
      page_format: "letter",
      candidate: { name: "Fictional Candidate", email: "fictional@example.invalid" },
      experience: [{
        company: "Fictional Employer", role: "Data Engineer", dates: "2022–2024",
        bullets: ["Built Python ETL pipelines."],
      }],
      skills: [{ category: "Technologies", items: ["Python", "Kubernetes"] }],
    },
    bindings: {
      "/candidate/name": "config:name",
      "/candidate/email": "config:email",
      "/experience/0/company": "master_profile:employer",
      "/experience/0/role": "master_profile:employer",
      "/experience/0/dates": "master_profile:employer",
      "/experience/0/bullets/0": "master_profile:pipelines",
      "/skills/0/items/0": "master_profile:python",
      "/skills/0/items/1": "inference:kubernetes",
    },
  };
  return { root, proposal };
}

test("source-bound fictional CV becomes a real, extractable PDF and non-submittable review package", async () => {
  const { root, proposal } = fixture();
  try {
    const authority = loadResumeAuthority({ root, persona: { id: PERSONA } });
    const bound = tailorBoundResume({ proposal, authority, jdText: JD });
    expect(bound.safety.candidate_facts_from_jd).toBe(0);
    expect(bound.payload.skills[0].items).toEqual(["Python"]);
    expect(bound.excluded.some(item => item.reason === "missing-or-unauthorized-evidence")).toBe(true);

    const htmlArtifact = renderBoundResume({
      root, result: bound, format: "html", output: "output/cv-fictional",
    });
    const independent = verifyResumeArtifact({
      root, artifact: htmlArtifact.artifact, evidence: htmlArtifact.evidence,
      jdText: JD, persona: PERSONA,
    });
    expect(independent.faithfulness.verdict).toBe("pass");

    const html = fs.readFileSync(htmlArtifact.artifact, "utf8");
    const pdfPath = path.join(root, "output", "cv-fictional.pdf");
    const render = await renderHtmlToPdf(html, pdfPath, {
      format: "letter", workspaceRoot: root, baseDir: root,
      strictPages: true, maxPages: 2, deferManifest: true,
    });
    const pdf = fs.readFileSync(pdfPath);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(render.size).toBe(pdf.length);
    expect(render.pageCount).toBeGreaterThanOrEqual(1);
    expect(render.pageCount).toBeLessThanOrEqual(2);

    // Inspect the PDF, not just the HTML or the metadata the renderer supplied.
    const extracted = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(extracted).toContain("Fictional Candidate");
    expect(extracted).toMatch(/Built Python ETL pipelines/);
    expect(extracted).not.toMatch(/Kubernetes|Invented experience|100 engineers/);

    const inputHash = relative => sha(fs.readFileSync(path.join(root, relative)));
    const sourceSnapshot = {
      profile_sha256: inputHash("data/career-profile.yml"),
      config_sha256: inputHash("config/profile.yml"),
      vault_sha256: inputHash("data/career-evidence.yml"),
      primary_sources_sha256: {
        "cv.md": inputHash("cv.md"),
        "jds/job.md": inputHash("jds/job.md"),
      },
    };
    write(root, "output/cv-fictional.pdf.evidence.json",
      JSON.stringify({
        pdf_sha256: sha(pdf),
        snapshot: sourceSnapshot,
        html_artifact_sha256: sha(fs.readFileSync(htmlArtifact.artifact)),
        independent_faithfulness: independent.faithfulness.verdict,
      }));
    const packageData = sealDemoPackage({
      demo_only: true, submission_allowed: false, application_action: "none",
      application: {
        key: "fictional-source-bound-pdf",
        company: "Fictional Test Company",
        role: "Fictional Data Engineer",
        url: "https://example.com/jobs/fictional-not-live",
      },
      eligibility: {
        status: "unverified_fictional_job", demo_allowed: true,
        submission_allowed: false, human_confirmation_required: true,
      },
      warning: "FICTIONAL REHEARSAL ONLY - no live job or eligibility approval",
      candidate_match: { limitations: ["Unverified fictional posting; never submit."] },
      artifacts: [{
        kind: "resume", path: "output/cv-fictional.pdf", sha256: sha(pdf),
      }],
      source_snapshot: sourceSnapshot,
    });
    write(root, "data/private/fictional-demo-package.json", JSON.stringify(packageData));
    expect(verifyDemoPackage(root, packageData)).toBe(true);
    const [view] = readSubmissionApprovals(root);
    expect(view.error).toBeUndefined();
    expect(view.status.kind).toBe("paused");
    expect(view.status.label).toMatch(/Demo only/);
    expect(view.artifacts[0].sha256).toBe(sha(pdf));

    const decision = prepareApprovedSubmission(packageData);
    expect(decision.reason).toBe("demo_submission_disabled");
    let submitCalls = 0;
    const submission = await executeApprovedSubmission(packageData, () => { submitCalls++; });
    expect(submission.decision).toBe("blocked");
    expect(submitCalls).toBe(0);
    expect(fs.existsSync(path.join(root, "data", "applications.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "data", "pdf-index.tsv"))).toBe(false);

    // Changes to either actual PDF bytes or candidate evidence invalidate review.
    fs.appendFileSync(pdfPath, "TAMPERED");
    expect(() => verifyDemoPackage(root, packageData)).toThrow(/Demo PDF changed/);
    expect(readSubmissionApprovals(root)[0].error).toMatch(/Demo PDF changed/);
    fs.writeFileSync(pdfPath, pdf);
    fs.appendFileSync(path.join(root, "cv.md"), "\nRevoked source evidence.\n");
    expect(() => verifyDemoPackage(root, packageData)).toThrow(/Demo source changed/);
    expect(readSubmissionApprovals(root)[0].error).toMatch(/Demo source changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});


/**
 * Dashboard C05 publication boundary, not merely the PDF renderer.
 * The renderer subprocess is injected; the success case invokes real Chromium
 * and all failures use deterministic synthetic subprocess exits.
 */


async function publicationFixture() {
  const { root, proposal } = fixture();
  // Dashboard C05 deliberately rejects a proposal with unsupported fields.
  // Use only source-backed facts for this synthetic, general-persona proposal.
  proposal.persona_id = "general";
  proposal.payload.skills[0].items = ["Python"];
  delete proposal.bindings["/skills/0/items/1"];
  fs.symlinkSync(path.join(CODE_ROOT, "enhanced"), path.join(root, "enhanced"), "junction");
  fs.symlinkSync(path.join(CODE_ROOT, "generate-pdf.mjs"), path.join(root, "generate-pdf.mjs"));
  const prepared = await prepareBoundCv(root, path.join(root, "jds", "job.md"));
  const bound = tailorBoundResume({ proposal, authority: prepared.authority, jdText: prepared.jdText });
  const saved = renderBoundResume({
    root, result: bound, format: "html", output: "output/cv-dashboard-fixture",
  });
  expect(verifyResumeArtifact({
    root, evidence: saved.evidence, artifact: saved.artifact,
    jdText: JD, persona: "general",
  }).faithfulness.verdict).toBe("pass");
  return {
    root, prepared, saved,
    pdfPaths: {
      html: saved.artifact, finalPdf: path.join(root, "output", "cv-dashboard.pdf"),
    },
  };
}

function publisherStages(root) {
  return fs.readdirSync(path.join(root, "output")).filter(name => name.startsWith(".pdf-stage-"));
}
function bundles(root) {
  return fs.readdirSync(path.join(root, "output")).filter(name => name.startsWith("c05-"));
}
function createPdfWorker(onRun) {
  let launches = 0;
  const spawnFn = (_bin, args, options) => {
    launches++;
    expect(args[0]).toMatch(/generate-pdf\.mjs$/);
    expect(args).toContain("--defer-manifest");
    expect(args).toContain("--format=letter");
    expect(options.cwd).toBeTruthy();
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(async () => {
      try {
        await onRun(args);
        child.emit("close", 0);
      } catch (error) {
        child.stderr.write(error.message || "Synthetic PDF worker failure");
        child.emit("close", 1);
      }
    });
    return child;
  };
  return { spawnFn, get launches() { return launches; } };
}

test("dashboard C05 publication seals real PDF and sidecar without changing tracker", async () => {
  const f = await publicationFixture();
  try {
    const worker = createPdfWorker(async args => {
      const html = fs.readFileSync(args[1], "utf8");
      await renderHtmlToPdf(html, args[2], {
        format: "letter", workspaceRoot: f.root, baseDir: f.root,
        maxPages: 2, strictPages: true, deferManifest: true,
      });
    });
    const result = await renderBoundPdf({
      spawnFn: worker.spawnFn, execPath: process.execPath, root: f.root,
      pdfPaths: f.pdfPaths, format: "letter", reportNum: "0",
      prepared: f.prepared, evidencePath: f.saved.evidence, demoOnly: true,
    });
    expect(result.kind).toBe("rendered");
    expect(worker.launches).toBe(1);
    expect(publisherStages(f.root)).toEqual([]);
    expect(bundles(f.root)).toHaveLength(1);
    const pdf = fs.readFileSync(result.finalPdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const sidecar = JSON.parse(fs.readFileSync(result.finalPdf + ".evidence.json", "utf8"));
    expect(sidecar.pdf_sha256).toBe(sha(pdf));
    expect(sidecar.render.artifact_sha256).toBe(sha(fs.readFileSync(f.saved.artifact)));
    const text = execFileSync("pdftotext", ["-layout", result.finalPdf, "-"], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(text).toContain("Fictional Candidate");
    expect(text).toContain("Built Python ETL pipelines.");
    expect(text).not.toContain("Kubernetes");
    expect(fs.existsSync(path.join(f.root, "data/applications.md"))).toBe(false);
    expect(fs.existsSync(path.join(f.root, "data/pdf-index.tsv"))).toBe(false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("dashboard C05 rejects a changed source or HTML evidence before starting renderer", async () => {
  for (const alter of ["source", "html"]) {
    const f = await publicationFixture();
    try {
      if (alter === "source") fs.appendFileSync(path.join(f.root, "cv.md"), "\nRevoked source\n");
      else fs.appendFileSync(f.saved.artifact, "\n<!-- changed HTML -->");
      const worker = createPdfWorker(async () => { throw Error("should not run"); });
      const result = await renderBoundPdf({
        spawnFn: worker.spawnFn, execPath: process.execPath, root: f.root,
        pdfPaths: f.pdfPaths, format: "letter", reportNum: "0",
        prepared: f.prepared, evidencePath: f.saved.evidence, demoOnly: true,
      });
      expect(result.kind).toBe("render-failed");
      expect(worker.launches).toBe(0);
      expect(bundles(f.root)).toEqual([]);
      expect(publisherStages(f.root)).toEqual([]);
      expect(fs.existsSync(path.join(f.root, "data/pdf-index.tsv"))).toBe(false);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 5 });
    }
  }
});

test("dashboard C05 rejects bad PDF output and removes uncommitted staging", async () => {
  for (const bad of ["missing", "not-pdf", "worker-failed"]) {
    const f = await publicationFixture();
    try {
      const worker = createPdfWorker(async args => {
        if (bad === "worker-failed") throw Error("synthetic failure");
        if (bad === "not-pdf") fs.writeFileSync(args[2], "not a PDF");
      });
      const result = await renderBoundPdf({
        spawnFn: worker.spawnFn, execPath: process.execPath, root: f.root,
        pdfPaths: f.pdfPaths, format: "letter", reportNum: "0",
        prepared: f.prepared, evidencePath: f.saved.evidence, demoOnly: true,
      });
      expect(result.kind).toBe("render-failed");
      expect(worker.launches).toBe(1);
      expect(bundles(f.root)).toEqual([]);
      expect(publisherStages(f.root)).toEqual([]);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 5 });
    }
  }
});

test("dashboard C05 rejects source changed during rendering before publishing a bundle", async () => {
  const f = await publicationFixture();
  try {
    let sourceChangedAfterRender = false;
    const worker = createPdfWorker(async args => {
      await renderHtmlToPdf(fs.readFileSync(args[1], "utf8"), args[2], {
        format: "letter", workspaceRoot: f.root, baseDir: f.root,
        maxPages: 2, strictPages: true, deferManifest: true,
      });
      fs.appendFileSync(path.join(f.root, "cv.md"), "\nChanged while rendering\n");
      sourceChangedAfterRender = true;
    });
    const result = await renderBoundPdf({
      spawnFn: worker.spawnFn, execPath: process.execPath, root: f.root,
      pdfPaths: f.pdfPaths, format: "letter", reportNum: "0",
      prepared: f.prepared, evidencePath: f.saved.evidence, demoOnly: true,
    });
    expect(sourceChangedAfterRender, result.error).toBe(true);
    expect(result.kind).toBe("render-failed");
    expect(result.error).toMatch(/Candidate evidence or report changed/);
    expect(worker.launches).toBe(1);
    expect(bundles(f.root)).toEqual([]);
    expect(publisherStages(f.root)).toEqual([]);
    expect(fs.existsSync(path.join(f.root, "data/pdf-index.tsv"))).toBe(false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 5 });
  }
});


test("dashboard C05 pre-cancelled runs launch no PDF worker and publish nothing", async () => {
  const f = await publicationFixture();
  try {
    const controller = new AbortController();
    controller.abort();
    const worker = createPdfWorker(async () => { throw Error("cancelled run launched worker"); });
    const result = await renderBoundPdf({
      spawnFn: worker.spawnFn, execPath: process.execPath, root: f.root,
      pdfPaths: f.pdfPaths, format: "letter", reportNum: "0",
      prepared: f.prepared, evidencePath: f.saved.evidence, demoOnly: true,
      signal: controller.signal,
    });
    expect(result.kind).toBe("render-failed");
    expect(result.error).toMatch(/cancelled/i);
    expect(worker.launches).toBe(0);
    expect(publisherStages(f.root)).toEqual([]);
    expect(bundles(f.root)).toEqual([]);
    expect(fs.existsSync(path.join(f.root, "data/pdf-index.tsv"))).toBe(false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 5 });
  }
});
