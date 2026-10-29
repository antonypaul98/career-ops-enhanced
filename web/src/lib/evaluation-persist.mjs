import { link, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createProcessTreeStopper } from "./process-tree.mjs";

const HEADER = "num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl";

function abortError(message) {
  return Object.assign(new Error(message), { code: "ABORT_ERR" });
}

function slugify(value) {
  const slug = String(value).toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!slug) throw new Error("Company name does not produce a safe report slug.");
  return slug;
}

function safeCell(value, label) {
  const text = String(value ?? "");
  if (!text || /[\t\r\n]/.test(text)) throw new Error(`${label} must be one non-empty line.`);
  return text;
}

async function writeExclusiveAtomic(finalPath, data, fsOps = {}) {
  const mkdirFn = fsOps.mkdir ?? mkdir;
  const openFn = fsOps.open ?? open;
  const linkFn = fsOps.link ?? link;
  const unlinkFn = fsOps.unlink ?? unlink;
  await mkdirFn(path.dirname(finalPath), { recursive: true });
  const temporary = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const handle = await openFn(temporary, "wx", 0o600);
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await linkFn(temporary, finalPath);
  } finally {
    // A write/sync/close/link failure must never strand a temp file. The final
    // path remains exclusive: link() fails rather than replacing an artifact.
    await unlinkFn(temporary).catch(() => {});
  }
}

function runScript(root, args, options = {}) {
  if (options.signal?.aborted) {
    return Promise.reject(abortError("Evaluation persistence was cancelled before starting a helper process."));
  }
  const spawnFn = options.spawnFn ?? spawn;
  const child = spawnFn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, CAREER_OPS_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const stopper = createProcessTreeStopper(child, options.stopOptions);
  let stdout = "";
  let stderr = "";
  let settled = false;
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stopper.settled();
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => { void stopper.stop(); };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    // Close the spawn -> listener registration race. If cancellation happened
    // in that interval, stop the just-created process tree immediately.
    if (options.signal?.aborted) onAbort();

    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, signal) => {
      if (options.signal?.aborted) {
        return finish(reject, abortError("Evaluation persistence was cancelled; no false completion was recorded."));
      }
      if (code !== 0) {
        return finish(reject, new Error(`${path.basename(args[0])} failed (${signal || code}): ${stderr.trim().slice(0, 500)}`));
      }
      finish(resolve, { stdout, stderr });
    });
  });
}

async function reserve(root, options) {
  if (options.reserveFn) return options.reserveFn({ root, signal: options.signal });
  const result = await runScript(root, [path.join(root, "reserve-report-num.mjs")], options);
  const num = String(result.stdout).trim();
  if (!/^\d{3,}$/.test(num)) throw new Error("reserve-report-num.mjs returned an invalid report number.");
  return {
    num,
    release: () => runScript(root, [path.join(root, "reserve-report-num.mjs"), "--release", num], { ...options, signal: undefined }),
  };
}

/**
 * Persist one already-validated evaluation. The trusted backend determines every
 * path; no model-supplied path or report number crosses this boundary.
 */
export async function persistEvaluation({ root, payload, today, postedAt, signal }, options = {}) {
  if (signal?.aborted) throw abortError("Evaluation persistence cancelled before validation.");

  // Validate every model-derived value before reserving a globally serialized
  // report number. Invalid envelopes cannot acquire or strand a reservation.
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(today || ""))) {
    throw new Error("Evaluation date must use YYYY-MM-DD.");
  }
  const company = safeCell(payload?.company, "Company");
  const role = safeCell(payload?.role, "Role");
  const note = safeCell(payload?.note, "Note");
  const postingUrl = safeCell(payload?.postingUrl, "Posting URL");
  const score = safeCell(payload?.score, "Score");
  const reportMarkdown = String(payload?.reportMarkdown ?? "");
  if (!reportMarkdown.trim()) throw new Error("Report markdown must be non-empty.");
  const slug = slugify(company);

  const reservation = await reserve(root, { ...options, signal });
  try {
    const num = String(reservation.num);
    if (!/^\d{3,}$/.test(num)) throw new Error("Report reservation returned an invalid number.");
    if (signal?.aborted) throw abortError("Evaluation persistence cancelled after reservation.");

    const reportRelative = `reports/${num}-${slug}-${today}.md`;
    const reportPath = path.join(root, reportRelative);
    const additionPath = path.join(root, "batch", "tracker-additions", `${num}-${slug}.tsv`);
    const postedSegment = /^20\d{2}-\d{2}-\d{2}$/.test(String(postedAt || "")) ? `; posted: ${postedAt}` : "";
    const row = [
      num, today, company, role, "Evaluated", `${score}/5`, "❌",
      `[${num}](${reportRelative})`, note + postedSegment, postingUrl,
    ].join("\t");
    let reportWritten = false;
    let additionWritten = false;
    try {
      await writeExclusiveAtomic(
        reportPath,
        reportMarkdown.endsWith("\n") ? reportMarkdown : reportMarkdown + "\n",
        options.fsOps,
      );
      reportWritten = true;
      await writeExclusiveAtomic(additionPath, HEADER + "\n" + row + "\n", options.fsOps);
      additionWritten = true;

      // The hook exists only to make the cancellation boundary deterministic in
      // tests. Re-check afterwards so cancellation can never start a merge.
      await options.beforeMergeFn?.({ root, signal });
      if (signal?.aborted) throw abortError("Evaluation persistence cancelled before tracker merge.");
      const merged = options.mergeFn
        ? await options.mergeFn({ root, signal })
        : await runScript(root, [path.join(root, "merge-tracker.mjs")], { ...options, signal });
      return { num, reportRelative, additionPath, merged };
    } catch (error) {
      // Before an addition exists there is nothing resumable, so remove the
      // newly-created report. Once both exist, retain both for a safe retry.
      if (!additionWritten && reportWritten) await unlink(reportPath).catch(() => {});
      throw error;
    }
  } finally {
    await reservation.release?.().catch(() => {});
  }
}
