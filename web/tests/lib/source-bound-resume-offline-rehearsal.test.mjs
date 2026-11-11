/**
 * Offline synthetic C05 source -> bound CV -> HTML -> independent verification.
 * This tests the real source-binding renderer without a model, PDF browser,
 * live posting, ATS connection, application submission or private candidate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as yaml from "js-yaml";
import { loadResumeAuthority, digest } from "../../../enhanced/resume-authority.mjs";
import { tailorBoundResume } from "../../../enhanced/evidence-tailor.mjs";
import { renderBoundResume } from "../../../enhanced/tailor-resume.mjs";
import { verifyResumeArtifact } from "../../../enhanced/verify-resume.mjs";

const PERSONA = "data-engineer";
const JD = "## Required skills\n- Python\n- Kubernetes\n";
function write(root, filename, content) {
  const dest = path.join(root, filename);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, { mode: 0o600 });
  return dest;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-c05-offline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const lines = [
    "# Fictional Candidate", "## Experience",
    "### Fictional Employer — Data Engineer — 2022–2024",
    "- Built Python ETL pipelines.",
    "## Skills", "- Python",
  ];
  const evidence = line => ({ source: "cv.md", line, quote: lines[line - 1] });
  const profile = {
    schema_version: 1, candidate: {}, summary: [], projects: [],
    education: [], certifications: [],
    skills: [{
      id: "python", text: "Python", review_status: "verified",
      evidence: evidence(6),
    }],
    experiences: [{
      id: "employer", label: lines[2].slice(4), review_status: "verified",
      evidence: evidence(3), facts: [{
        id: "pipelines", text: "Built Python ETL pipelines.",
        review_status: "verified", evidence: evidence(4),
      }],
    }],
  };
  const source = write(root, "cv.md", lines.join("\n") + "\n");
  write(root, "data/career-profile.yml", yaml.dump(profile));
  write(root, "data/career-evidence.yml", yaml.dump({ schema_version: 1, entries: [] }));
  write(root, "config/profile.yml", yaml.dump({
    name: "Fictional Candidate", email: "fictional@example.invalid",
  }));
  write(root, "jds/job.md", JD);
  const proposal = {
    persona_id: PERSONA,
    payload: {
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
  const authority = () => loadResumeAuthority({ root, persona: { id: PERSONA } });
  const tailor = () => tailorBoundResume({ proposal, authority: authority(), jdText: JD });
  return { root, source, proposal, authority, tailor };
}
function generate(root, result) {
  return renderBoundResume({ root, result, format: "html", output: "output/fictional-bound-resume" });
}
function verify(root, saved) {
  return verifyResumeArtifact({
    root, artifact: saved.artifact, evidence: saved.evidence,
    jdText: JD, persona: PERSONA,
  });
}

test("verified synthetic facts become independently reviewed HTML, without app data", t => {
  const f = fixture(t);
  const beforeCv = fs.readFileSync(f.source);
  const result = f.tailor();
  assert.equal(result.safety.candidate_facts_from_jd, 0);
  assert.ok(result.excluded.some(e => e.reason === "missing-or-unauthorized-evidence"));
  assert.equal(result.payload.experience[0].bullets[0], "Built Python ETL pipelines.");
  assert.deepEqual(result.payload.skills[0].items, ["Python"]);
  const saved = generate(f.root, result);
  const html = fs.readFileSync(saved.artifact, "utf8");
  assert.match(html, /Built Python ETL pipelines/);
  assert.doesNotMatch(html, /Kubernetes/);
  const independent = verify(f.root, saved);
  assert.equal(independent.faithfulness.verdict, "pass", JSON.stringify(independent.faithfulness));
  assert.deepEqual(fs.readFileSync(f.source), beforeCv);
  for (const relative of ["data/applications.md", "applications.md", "data/private", "reports"]) {
    assert.equal(fs.existsSync(path.join(f.root, relative)), false, relative);
  }
});

test("independent verifier rejects post-render HTML tampering, even with rehashed audit", t => {
  const f = fixture(t);
  const saved = generate(f.root, f.tailor());
  const modified = fs.readFileSync(saved.artifact, "utf8").replace(
    "</body>", "<p>Invented experience leading 100 engineers.</p></body>",
  );
  assert.match(modified, /Invented experience/);
  fs.writeFileSync(saved.artifact, modified);
  const audit = JSON.parse(fs.readFileSync(saved.evidence, "utf8"));
  audit.render.artifact_sha256 = digest(modified);
  const verdict = verifyResumeArtifact({
    root: f.root, artifact: saved.artifact, evidence: audit,
    jdText: JD, persona: PERSONA,
  });
  assert.equal(verdict.faithfulness.verdict, "fail");
  assert.ok(verdict.faithfulness.findings.some(f => f.reason === "artifact-not-derived-from-bound-payload"));
});

test("changing approved CV after rendering invalidates the independent audit", t => {
  const f = fixture(t);
  const saved = generate(f.root, f.tailor());
  fs.appendFileSync(f.source, "Revoked evidence.\n");
  const verdict = verify(f.root, saved);
  assert.equal(verdict.faithfulness.verdict, "fail");
});

test("preview-only text cannot be promoted into a source-bound resume", t => {
  const f = fixture(t);
  assert.throws(() => tailorBoundResume({
    proposal: f.proposal,
    authority: f.authority(),
    jdText: "<!-- career-ops:evaluation-only:v1 -->\n# Preview report",
  }), /Evaluation-only/);
});
