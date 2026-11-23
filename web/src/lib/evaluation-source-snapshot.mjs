import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isNestedCheckout } from "../../../lib/mjs-files.mjs";

// These are candidate facts, targeting/style instructions and the evaluation's
// shared rules. Optional files stay optional for legacy users, but their absence
// is part of the snapshot: adding one while a worker runs invalidates its result.
const OPTIONAL_SOURCES = [
  "config/profile.yml", "modes/_profile.md", "modes/_custom.md",
  "article-digest.md", "voice-dna.md", "data/career-profile.yml",
  "data/career-evidence.yml", "data/blacklist.md", "interview-prep/story-bank.md",
  "modes/_shared.md",
];

function sourceError(changed = false) {
  return Object.assign(new Error(changed
    ? "Candidate or evaluation sources changed or became unreadable during this run. Run the evaluation again."
    : "Candidate and evaluation sources must be readable before evaluation. Make them available locally and try again."),
  { code: changed ? "EVALUATION_SOURCES_CHANGED" : "EVALUATION_SOURCES_UNREADABLE" });
}

function identity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
}

function rejectNestedCheckout() {
  throw sourceError();
}

function fingerprint(file, entry) {
  // Candidate evidence must never silently include a separate Git checkout.
  // Reject it before reading its contents, including when nested in writing-samples.
  if (isNestedCheckout(file)) return rejectNestedCheckout();
  let linkStat;
  try {
    linkStat = lstatSync(file, { bigint: true });
  } catch (error) {
    if (!entry.required && error?.code === "ENOENT") return null;
    throw error;
  }
  const canonical = realpathSync(file);
  if (entry.directory) {
    if (!linkStat.isDirectory()) throw sourceError();
    const children = readdirSync(file).sort().map(name => [name,
      fingerprint(path.join(file, name), { required: true,
        directory: lstatSync(path.join(file, name)).isDirectory() })]);
    if (identity(linkStat) !== identity(lstatSync(file, { bigint: true }))) throw sourceError();
    return [canonical, identity(linkStat), children];
  }
  const before = statSync(file, { bigint: true });
  if (!before.isFile() || (process.platform === "darwin" && before.size > 0n && before.blocks === 0n)) {
    throw sourceError();
  }
  let fd;
  try {
    fd = openSync(file, "r");
    if (identity(before) !== identity(fstatSync(fd, { bigint: true }))) throw sourceError();
    const digest = createHash("sha256").update(readFileSync(fd)).digest("hex");
    if (identity(before) !== identity(fstatSync(fd, { bigint: true })) ||
      identity(before) !== identity(statSync(file, { bigint: true })) ||
      identity(linkStat) !== identity(lstatSync(file, { bigint: true })) ||
      canonical !== realpathSync(file)) throw sourceError();
    return [canonical, identity(linkStat), identity(before), digest];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Capture privately before building the prompt. Never serialize this to clients. */
export function captureEvaluationSources(root, { evalModeFile = "modes/oferta.md", modesDirs = ["modes"] } = {}) {
  try {
    const files = new Map(OPTIONAL_SOURCES.map(file => [file, false]));
    for (const dir of modesDirs) files.set(path.join(dir, "_shared.md"), false);
    files.set("cv.md", true);
    files.set(evalModeFile, true);
    const entries = [...files].map(([file, required]) => Object.freeze({ path: file, required, directory: false }));
    entries.push(Object.freeze({ path: "writing-samples", required: false, directory: true }));
    const base = path.resolve(root);
    return Object.freeze({ root: base, entries: Object.freeze(entries),
      fingerprint: JSON.stringify(entries.map(entry => fingerprint(path.join(base, entry.path), entry))) });
  } catch {
    throw sourceError();
  }
}

/** Revalidate synchronously at each persistence boundary; emit no source data.
 * @param {ReturnType<typeof captureEvaluationSources> | undefined} snapshot
 * @param {{signal?: AbortSignal}} [options]
 */
export function assertEvaluationSourcesCurrent(snapshot, { signal = undefined } = {}) {
  if (signal?.aborted) throw Object.assign(new Error("Evaluation persistence was cancelled."), { code: "ABORT_ERR" });
  try {
    if (!snapshot || JSON.stringify(snapshot.entries.map(entry => fingerprint(path.join(snapshot.root, entry.path), entry))) !== snapshot.fingerprint) {
      throw sourceError(true);
    }
  } catch {
    throw sourceError(true);
  }
}
