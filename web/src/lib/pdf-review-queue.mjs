/**
 * Read-only PDF review queue for the Approval Center.
 *
 * C05's indexed PDF and source-bound sidecar are NOT an application approval.
 * This reader never creates readiness_input, submit_approval, or an executable
 * application package. Every requested PDF is reverified on read.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const MAX_PDF_BYTES = 16 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;

function within(root, file) {
  const rel = path.relative(root, file);
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}
function safeFile(root, relativeName, maxBytes, optional = false) {
  if (typeof relativeName !== "string" || !relativeName || relativeName.includes("\0") ||
      path.isAbsolute(relativeName)) throw Error("Invalid review path");
  const name = path.resolve(root, relativeName);
  if (!within(root, name)) throw Error("Review path escapes workspace");
  if (optional && !fs.existsSync(name)) return null;
  const stat = fs.lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw Error("Review file is unsafe");
  if (!within(root, fs.realpathSync(name))) throw Error("Review file escapes workspace");
  return name;
}
function sourceMatches(root, name, expected, optional = false) {
  if (!digest(expected)) throw Error("Invalid source checksum");
  const file = safeFile(root, name, MAX_EVIDENCE_BYTES, optional);
  return sha256(file ? fs.readFileSync(file) : Buffer.alloc(0)) === expected;
}
function inspect(root, row, findReportFile) {
  const [report, rawPdf, html, , , kind] = row;
  if (!/^\d+$/.test(report) || (kind && kind.trim() !== "cv")) throw Error("Invalid manifest row");
  const pdfFile = safeFile(root, rawPdf, MAX_PDF_BYTES);
  if (path.extname(pdfFile).toLowerCase() !== ".pdf") throw Error("Invalid PDF extension");
  const pdf = fs.readFileSync(pdfFile);
  if (pdf.subarray(0, 5).toString() !== "%PDF-") throw Error("Invalid PDF signature");
  const evidenceFile = safeFile(root, rawPdf + ".evidence.json", MAX_EVIDENCE_BYTES);
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  const snapshot = evidence.snapshot;
  if (!snapshot || !digest(evidence.pdf_sha256) || sha256(pdf) !== evidence.pdf_sha256)
    throw Error("PDF checksum mismatch");
  if (typeof html !== "string" || !digest(evidence.render?.artifact_sha256))
    throw Error("HTML evidence missing");
  const htmlFile = safeFile(root, html, MAX_EVIDENCE_BYTES);
  if (sha256(fs.readFileSync(htmlFile)) !== evidence.render.artifact_sha256)
    throw Error("HTML checksum mismatch");

  for (const [key, file, optional] of [
    ["profile_sha256", "data/career-profile.yml", false],
    ["config_sha256", "config/profile.yml", true],
    ["vault_sha256", "data/career-evidence.yml", true],
  ]) {
    if (!sourceMatches(root, file, snapshot[key], optional))
      throw Error("Candidate authority changed");
  }
  const primary = snapshot.primary_sources_sha256;
  if (!primary || Array.isArray(primary) || typeof primary !== "object" ||
      Object.keys(primary).length === 0) throw Error("Primary source checksums missing");
  for (const [name, expected] of Object.entries(primary)) {
    if (!sourceMatches(root, name, expected)) throw Error("Primary source changed");
  }

  if (!digest(snapshot.jd_sha256) || typeof findReportFile !== "function")
    throw Error("Job report evidence missing");
  const reportFile = findReportFile(report);
  if (typeof reportFile !== "string") throw Error("Job report not found");
  const rel = path.relative(root, path.resolve(reportFile));
  if (!within(root, path.resolve(reportFile)) || !sourceMatches(root, rel, snapshot.jd_sha256))
    throw Error("Job report changed");

  return {
    report, name: path.basename(pdfFile), sha256: evidence.pdf_sha256,
    status: "ready_for_review", filePath: pdfFile,
  };
}

export function readPdfReviewQueue(root, indexPath, findReportFile) {
  if (!indexPath) return [];
  try {
    root = fs.realpathSync(root);
    const stat = fs.lstatSync(indexPath);
    if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) return [];
    const text = fs.readFileSync(indexPath, "utf8");
    const rows = text.split(/\r?\n/)
      .filter(line => line && !line.startsWith("#"))
      .map(line => line.split("\t"))
      .filter(columns => /^\d+$/.test(columns[0] || "") &&
        (!columns[5]?.trim() || columns[5].trim() === "cv"))
      .slice(-50).reverse();
    const seen = new Set();
    const results = [];
    for (const columns of rows) {
      const report = columns[0];
      if (seen.has(report)) continue;
      seen.add(report);
      try {
        results.push(inspect(root, columns, findReportFile));
      } catch {
        // Never expose local source paths or candidate details through diagnostics.
        results.push({ report, status: "invalid", error: "PDF or source evidence changed; regenerate or review locally." });
      }
    }
    return results;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    return [];
  }
}
