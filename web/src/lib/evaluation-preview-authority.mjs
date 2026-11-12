/**
 * Shared candidate authority gate for the actual report-only request and its
 * no-model local preflight. The caller must never serialize the returned
 * records, verification closure, or authority snapshot to a preflight client.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadPreviewCandidate({ root, codeRoot }) {
  try {
    const authorityModule = await import(/* turbopackIgnore: true */
      pathToFileURL(path.join(codeRoot, "enhanced", "resume-authority.mjs")).href);
    const authority = authorityModule.loadResumeAuthority({ root, persona: { id: "general" } });
    const authoritySnapshot = authority.snapshot;
    const originalSnapshot = JSON.stringify(authoritySnapshot);
    const verifyAuthority = () =>
      JSON.stringify(authorityModule.loadResumeAuthority({ root, persona: { id: "general" } }).snapshot)
      === originalSnapshot;

    // Identity records come from local candidate configuration and must never be
    // sent to the model. They are not candidate skill/experience evidence and
    // must not wrongly block otherwise verified CV facts.
    const factualRecords = authority.records.filter(record => record.kind !== "identity");
    if (authority.contradictions.length || authority.excluded.length || factualRecords.some(
      record => !record.ref.startsWith("master_profile:") ||
        record.binding?.evidence?.source !== "cv.md")) {
      return { ok: false, error: "Candidate authority has exclusions or contradictions; review required." };
    }
    const approvedRecords = authorityModule.proposalAuthority(authority).records
      .filter(record => record.kind !== "identity");
    if (!approvedRecords.length) {
      return { ok: false, error: "No source-verified candidate facts are available." };
    }
    const mode = fs.readFileSync(path.join(root, "modes", "oferta.md"), "utf8");
    if (mode.length > 240_000) {
      return { ok: false, error: "Evaluation mode file exceeds the preview size limit." };
    }
    return { ok: true, approvedRecords, mode, authoritySnapshot, verifyAuthority };
  } catch {
    // Never send candidate paths, facts, JS tracebacks, or file contents to UI.
    return { ok: false, error: "Verified authority and evaluation template must be readable before preview." };
  }
}
