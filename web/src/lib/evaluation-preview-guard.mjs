/**
 * Validation and result contract for the opt-in, report-only OpenCode probe.
 * No file I/O or canonical persistence is permitted in this module.
 */
import { createHash } from "node:crypto";
import { EVALUATION_ONLY_MARKER } from './evaluation-only-boundary.mjs';

export const FREE_PREVIEW_MODEL = "opencode/glm-5.3-flash-free";
export const PREVIEW_KIND = "evaluation-only";
const maxDescriptionChars = 120_000;

export function validatePreviewRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.evaluationOnly !== true) {
    return { ok: false, error: "Explicit evaluationOnly:true is required." };
  }
  const { postingUrl, jobDescription } = value;
  if (typeof postingUrl !== "string" || postingUrl.length > 4096 || postingUrl.trim() !== postingUrl) {
    return { ok: false, error: "A single official HTTPS posting URL is required." };
  }
  try {
    const url = new URL(postingUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
      return { ok: false, error: "Posting URL must be HTTPS with no credentials or fragment." };
    }
  } catch {
    return { ok: false, error: "Posting URL is invalid." };
  }
  if (typeof jobDescription !== "string" || jobDescription.trim().length < 200 ||
      jobDescription.length > maxDescriptionChars) {
    return { ok: false, error: "Supply the complete job description (200-120000 characters)." };
  }
  return { ok: true, postingUrl, jobDescription,
    jobDescriptionSha256: createHash("sha256").update(jobDescription, "utf8").digest("hex") };
}

/** In-memory result only. Neither this function nor its caller may promote it to an application. */
export function reportOnlyResult(validated, input) {
  if (validated?.ok !== true || !input?.ok) {
    throw new Error("Cannot return an unvalidated evaluation-only report.");
  }
  if (validated.postingUrl !== input.postingUrl) {
    throw new Error("Evaluation-only report URL differs from the supplied posting.");
  }
  return {
    type: "preview-report",
    status: PREVIEW_KIND,
    model: FREE_PREVIEW_MODEL,
    postingUrl: input.postingUrl,
    jobDescriptionSha256: input.jobDescriptionSha256,
    sourceVerification: "caller-supplied-JD-not-independently-verified",
    eligibility: {
      location: "unverified",
      employment: "unverified",
      sponsorship: "unverified",
      clearance: "unverified",
    },
    submissionAllowed: false,
    applicationPackageAllowed: false,
    evaluation_only: true,
    submission_allowed: false,
    application_action: "none",
    persisted: false,
    company: validated.company,
    role: validated.role,
    score: validated.score,
    reportMarkdown: EVALUATION_ONLY_MARKER + '\n# EVALUATION ONLY — NOT ELIGIBLE FOR SUBMISSION\n\n' +
      'Unreviewed AI analysis. Not candidate authority, a tailored resume, application or approval.\n\n' + validated.reportMarkdown,
  };
}
