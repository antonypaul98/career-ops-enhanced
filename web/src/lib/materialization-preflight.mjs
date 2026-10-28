import { openSync, closeSync, readSync, statSync } from "node:fs";
import path from "node:path";

const RETRYABLE_CODES = new Set(["EAGAIN", "EBUSY", "EIO", "ENODATA", "ETIMEDOUT"]);

export function classifyMaterializationError(error, relativePath) {
  const code = error?.code || "UNKNOWN";
  if (RETRYABLE_CODES.has(code)) {
    return `${relativePath} is not locally materialized (${code}). Keep the checkout intact and make that file available offline, then resume this run.`;
  }
  return `Cannot safely read ${relativePath} (${code}). No files were changed; resolve access and resume.`;
}

/**
 * Open and sample both ends, forcing cloud-placeholder failures before a worker
 * starts. This never downloads, deletes, resets, reclones, or rewrites anything.
 */
export function preflightMaterialized(root, entries) {
  for (const entry of entries) {
    const relativePath = typeof entry === "string" ? entry : entry.path;
    const required = typeof entry === "string" ? true : entry.required !== false;
    const fullPath = path.join(root, relativePath);
    let fd;
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) throw Object.assign(new Error("not a regular file"), { code: "EINVAL" });
      fd = openSync(fullPath, "r");
      const sample = Buffer.alloc(Math.min(4096, Math.max(1, stat.size)));
      readSync(fd, sample, 0, sample.length, 0);
      if (stat.size > sample.length) readSync(fd, sample, 0, Math.min(sample.length, stat.size), Math.max(0, stat.size - sample.length));
    } catch (error) {
      if (!required && error?.code === "ENOENT") continue;
      return { ok: false, error: classifyMaterializationError(error, relativePath), code: error?.code || "UNKNOWN" };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return { ok: true };
}
