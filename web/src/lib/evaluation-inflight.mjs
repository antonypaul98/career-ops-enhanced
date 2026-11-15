/**
 * Process-local duplicate evaluation guard.
 *
 * Only one active AI evaluation for an exact posting URL may spend tokens at a
 * time in this web instance. This does not replace the core's cross-process
 * tracker file lock, or prevent separately launched CLI/web processes.
 */
const active = new Set();

/** @param {string} url
 *  @returns {(() => void) | null} null if this URL is already evaluating.
 */
export function acquireEvaluation(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  if (active.has(url)) return null;
  active.add(url);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(url);
  };
}
