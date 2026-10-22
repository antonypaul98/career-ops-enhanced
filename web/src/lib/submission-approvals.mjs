import fs from "node:fs";
import path from "node:path";

const INPUT_SUFFIX = "-browser-approved.json";
const MAX_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function text(value) {
  return typeof value === "string" ? value : "";
}
function statusFor(input) {
  const observation = input?.observation;
  if (observation?.login_required) return { kind: "paused", label: "Paused for login" };
  if (observation?.mfa_required) return { kind: "paused", label: "Paused for MFA" };
  if (observation?.captcha_required) return { kind: "paused", label: "Paused for CAPTCHA" };
  if (Array.isArray(observation?.unexpected_fields) && observation.unexpected_fields.length) {
    return { kind: "paused", label: "Changed fields need review" };
  }
  if (observation && observation.final_review !== true) return { kind: "paused", label: "Final review incomplete" };

  const approval = input?.submit_approval;
  const exact = approval?.schema_version === 1
    && approval.approved_by === "candidate"
    && approval.scope === "submit_exact_application_once"
    && approval.max_consequential_actions === 1
    && SHA256.test(text(approval.approval_digest));
  if (exact) return { kind: "approved", label: "Exact approval recorded" };
  if (observation?.final_review === true) return { kind: "review", label: "Awaiting exact approval" };
  return { kind: "inspect", label: "Needs browser inspection" };
}
function summarize(input, source) {
  const bundle = input?.readiness_input?.application_bundle;
  const application = bundle?.application;
  if (!bundle || !application || !Array.isArray(bundle.fields) || !Array.isArray(bundle.artifacts)) {
    throw new Error("approval package is missing the reviewed application bundle");
  }
  if (!text(application.key) || !text(application.company) || !text(application.role) || !text(application.url)) {
    throw new Error("approval package application identity is incomplete");
  }
  let hostname;
  try {
    const url = new URL(application.url);
    if (url.protocol !== "https:") throw new Error();
    hostname = url.hostname;
  } catch {
    throw new Error("approval package target must be an HTTPS URL");
  }

  return {
    source,
    applicationKey: application.key,
    company: application.company,
    role: application.role,
    url: application.url,
    hostname,
    contentDigest: text(bundle.content_digest),
    fields: bundle.fields.map((field) => ({
      key: text(field?.key),
      label: text(field?.label || field?.key),
      value: text(field?.value),
      sensitive: field?.sensitive === true,
      evidence: text(field?.source?.ref),
    })),
    artifacts: bundle.artifacts.map((artifact) => ({
      kind: text(artifact?.kind),
      name: path.basename(text(artifact?.path)),
      sha256: text(artifact?.sha256),
    })),
    observedAt: text(input?.observation?.observed_at),
    approvedAt: text(input?.submit_approval?.approved_at),
    status: statusFor(input),
  };
}

/** Read only exact browser-submission input files from the private data folder. */
export function readSubmissionApprovals(root) {
  const privateDir = path.join(root, "data", "private");
  let entries;
  try {
    entries = fs.readdirSync(privateDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(INPUT_SUFFIX))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      try {
        const file = path.join(privateDir, entry.name);
        if (fs.statSync(file).size > MAX_BYTES) throw new Error("approval package exceeds 1 MiB");
        return summarize(JSON.parse(fs.readFileSync(file, "utf8")), entry.name);
      } catch (error) {
        return { source: entry.name, error: error instanceof Error ? error.message : "invalid approval package" };
      }
    });
}
