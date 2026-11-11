/**
 * Fail-closed access and one-attempt guard for the explicitly opt-in, local
 * report-only acceptance probe. No candidate data or API secrets are persisted.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const denied = (status, error) => ({ ok: false, status, error });

function loopbackHost(value) {
  if (typeof value !== "string" || !value || /[/\\@#?\s]/.test(value)) return null;
  try {
    const parsed = new URL("http://" + value);
    if (!LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

/** The Host header alone is NOT security; a strong non-cookie secret is required. */
export function checkPreviewAccess({ enabled, configuredToken, providedToken, host, origin }) {
  if (enabled !== "1") return denied(404, "Evaluation-only preview is disabled.");
  if (typeof configuredToken !== "string" || !SECRET_RE.test(configuredToken)) {
    return denied(503, "Preview requires a separately configured strong session token.");
  }
  const acceptedHost = loopbackHost(host);
  if (!acceptedHost) return denied(403, "Preview accepts only loopback hostnames.");
  // Browser callers may not invoke this from another site even if a token was
  // inadvertently exposed to their JS. CLI callers usually send no Origin.
  if (origin !== undefined && origin !== null) {
    try {
      const parsed = new URL(origin);
      if (origin !== parsed.origin || (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.host !== acceptedHost) return denied(403, "Cross-origin preview requests are forbidden.");
    } catch {
      return denied(403, "Invalid request origin.");
    }
  }
  if (typeof providedToken !== "string" || !SECRET_RE.test(providedToken)) {
    return denied(401, "Preview session token is missing or invalid.");
  }
  // Compare fixed-length digests instead of short-circuiting at the first
  // differing character. Never reflect or log either token.
  const expected = createHash("sha256").update(configuredToken).digest();
  const received = createHash("sha256").update(providedToken).digest();
  if (!timingSafeEqual(expected, received)) return denied(401, "Preview session token is missing or invalid.");
  return { ok: true };
}

/**
 * One successful reservation means one worker launch opportunity for this
 * token/root/model combination, across concurrent requests and server restarts.
 * EEXIST is an intentional permanent stop until a NEW session token is supplied.
 * The marker contains no job, candidate, URL, token or provider credential.
 */
export function reservePreviewAttempt({ configuredToken, root, model, directory = os.tmpdir() }) {
  if (!SECRET_RE.test(String(configuredToken ?? "")) || typeof root !== "string" || !root ||
      typeof model !== "string" || !model) throw new Error("Invalid preview attempt configuration.");
  const name = createHash("sha256").update([
    "career-ops-report-preview-v1", configuredToken, path.resolve(root), model,
  ].join("\0")).digest("hex");
  const marker = path.join(directory, `career-ops-report-preview-once-${name}.lock`);
  const fd = openSync(marker, "wx", 0o600);
  closeSync(fd);
  return { reserved: true };
}

/** Classify a worker exit without ever treating a cancelled/partial run as success. */
export function previewCompletion({ aborted, timedOut, failed, exitCode, envelope }) {
  if (aborted) return { ok: false, error: "Preview was cancelled." };
  if (timedOut) return { ok: false, error: "Preview timed out." };
  if (failed) return { ok: false, error: "Provider reported an error." };
  if (exitCode !== 0) return { ok: false, error: "Model process did not exit successfully." };
  if (envelope?.ok !== true) return { ok: false, error: "Report envelope was missing or invalid." };
  return { ok: true };
}
