/**
 * Parse one complete HTTP response from the opt-in report-only endpoint.
 * No storage, file operations, model calls or application promotion exist here.
 */
const MAX_REPLY_CHARS = 1_750_000;
const VERIFIED_SOURCE_LABEL = "caller-supplied-JD-not-independently-verified";
const MODEL = "opencode/glm-5.3-flash-free";

const fail = (error) => ({ ok: false, error });

export function parseReportOnlyReply(httpStatus, body, expectedUrl) {
  if (typeof body !== "string" || body.length > MAX_REPLY_CHARS) {
    return fail("The preview reply is missing or exceeds the safety limit.");
  }
  if (httpStatus !== 200) {
    let message = "The local preview endpoint refused the request.";
    try {
      const json = JSON.parse(body);
      if (typeof json?.error === "string") message = json.error.slice(0, 400);
    } catch { /* Never display arbitrary HTML/error bodies. */ }
    return fail(message);
  }
  if (typeof expectedUrl !== "string" || !expectedUrl) {
    return fail("The requested posting URL is missing.");
  }

  let report = null;
  let count = 0;
  let serverError = null;
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); }
    catch { return fail("Malformed preview response; no report accepted."); }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return fail("Invalid preview event.");
    }
    if (event.type === "error") {
      serverError = typeof event.error === "string"
        ? event.error.slice(0, 400) : "Preview worker reported an error.";
    } else if (event.type === "preview-report") {
      count += 1;
      report = event;
    } else if (event.type !== "status" && event.type !== "keepalive") {
      return fail("Unexpected event in the preview response.");
    }
  }
  if (serverError) return fail(serverError);
  if (count !== 1 || !report) return fail("Exactly one completed report is required.");
  if (report.status !== "evaluation-only" || report.evaluation_only !== true ||
      report.model !== MODEL || report.persisted !== false ||
      report.submissionAllowed !== false || report.submission_allowed !== false ||
      report.applicationPackageAllowed !== false || report.application_action !== "none" ||
      report.sourceVerification !== VERIFIED_SOURCE_LABEL ||
      report.postingUrl !== expectedUrl ||
      report.reportReviewStatus !== "unreviewed-model-output" ||
      typeof report.reportMarkdown !== "string" ||
      !report.reportMarkdown.startsWith("<!-- career-ops:evaluation-only:v1") ||
      report.reportMarkdown.length > 1_100_000) {
    return fail("Preview reply violated the report-only safety contract.");
  }
  if (typeof report.company !== "string" || typeof report.role !== "string" ||
      typeof report.score !== "number" || !Number.isFinite(report.score) ||
      report.score < 1 || report.score > 5) {
    return fail("Preview report metadata is invalid.");
  }
  return { ok: true, report };
}
