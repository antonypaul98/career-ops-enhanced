import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readPdfReviewQueue } from "../../src/lib/pdf-review-queue.mjs";

const hash = data => createHash("sha256").update(data).digest("hex");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-pdf-review-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const write = (file, data) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { mode: 0o600 });
    return target;
  };
  const cv = "# Fictional Candidate\n- Built Python ETL pipelines\n";
  const profile = "fictional: reviewed\n";
  const config = "name: Fictional Candidate\n";
  const vault = "fictional: evidence\n";
  const job = "# Fictional Data Engineer job\n";
  const html = "<html><body>Fictional Candidate</body></html>";
  const pdf = Buffer.from("%PDF-1.4\nFICTIONAL-TEST-DOCUMENT\n");
  write("cv.md", cv);
  write("data/career-profile.yml", profile);
  write("config/profile.yml", config);
  write("data/career-evidence.yml", vault);
  const jobFile = write("reports/001-fictional-2026-11-12.md", job);
  write("output/c05-fictional/source.html", html);
  const pdfName = "output/c05-fictional/resume.pdf";
  const pdfFile = write(pdfName, pdf);
  write(pdfName + ".evidence.json", JSON.stringify({
    pdf_sha256: hash(pdf),
    render: { artifact_sha256: hash(html) },
    snapshot: {
      profile_sha256: hash(profile),
      config_sha256: hash(config),
      vault_sha256: hash(vault),
      primary_sources_sha256: { "cv.md": hash(cv) },
      jd_sha256: hash(job),
      authority_sha256: hash("fictional-authority"),
    },
  }));
  const index = write("data/pdf-index.tsv",
    "# report\tpdf\thtml\tformat\tdate\tkind\n" +
    "001\t" + pdfName + "\toutput/c05-fictional/source.html\tletter\t2026-11-12\tcv\n");
  const finder = n => n === "001" ? jobFile : null;
  return { root, index, pdfFile, write, finder };
}

test("indexed candidate-bound PDF is available for read-only inspection, never application approval", t => {
  const f = fixture(t);
  const rows = readPdfReviewQueue(f.root, f.index, f.finder);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "ready_for_review");
  assert.equal(rows[0].report, "001");
  assert.match(rows[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(path.join(f.root, "data/private")), false);
  assert.equal(fs.existsSync(path.join(f.root, "data/applications.md")), false);
  assert.equal(rows[0].submit_approval, undefined);
  assert.equal(rows[0].readiness_input, undefined);
});

test("changed PDF, HTML, candidate authority, or source report cannot be reviewed as verified", t => {
  const cases = [
    ["output/c05-fictional/resume.pdf", "%PDF-1.4\nCHANGED"],
    ["output/c05-fictional/source.html", "<html>CHANGED</html>"],
    ["data/career-profile.yml", "fictional: changed"],
    ["config/profile.yml", "name: changed"],
    ["cv.md", "# CHANGED"],
    ["reports/001-fictional-2026-11-12.md", "# CHANGED"],
  ];
  for (const [name, value] of cases) {
    const f = fixture(t);
    f.write(name, value);
    const rows = readPdfReviewQueue(f.root, f.index, f.finder);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "invalid", name);
    assert.equal(rows[0].filePath, undefined, name);
  }
});

test("a traversal path in the manifest cannot become a reviewable file", t => {
  const f = fixture(t);
  f.write("data/pdf-index.tsv", "001\t../outside.pdf\toutput/c05-fictional/source.html\tletter\t2026-11-12\tcv\n");
  const rows = readPdfReviewQueue(f.root, f.index, f.finder);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "invalid");
  assert.equal(rows[0].filePath, undefined);
});

test("cover letters and unrelated artifacts are not advertised as CVs", t => {
  const f = fixture(t);
  f.write("data/pdf-index.tsv",
    "001\toutput/c05-fictional/resume.pdf\toutput/c05-fictional/source.html\tletter\t2026-11-12\tcover\n");
  assert.deepEqual(readPdfReviewQueue(f.root, f.index, f.finder), []);
});

test("missing index is an empty, read-only review queue", t => {
  const f = fixture(t);
  assert.deepEqual(readPdfReviewQueue(f.root, path.join(f.root, "data/no-pdf-index.tsv"), f.finder), []);
});
