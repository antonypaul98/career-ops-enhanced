/**
 * Process-local duplicate evaluation guard.
 *
 * Only one active AI evaluation for an exact posting URL may spend tokens at a
 * time in this web instance. This does not replace the core's cross-process
 * tracker file lock, or prevent separately launched CLI/web processes.
 */
import { normalizeUrl } from "./core/url-key.mjs";

const active = new Set();

/** @param {string} url
 *  @returns {(() => void) | null} null if this URL is already evaluating.
 */
export function acquireEvaluation(url) {
  if (typeof url !== "string") return null;
  // Share the tracker/discovery identity contract: tracking links are one job,
  // but known SPA job fragments and functional query parameters identify jobs.
  const key = normalizeUrl(url);
  if (!key) return null;
  if (active.has(key)) return null;
  active.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(key);
  };
}
