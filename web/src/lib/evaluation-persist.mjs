import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { formatReportNumber, releaseReportNumbers, reserveReportNumbers } from "../../../reserve-report-num.mjs";
import { createProcessTreeStopper } from "./process-tree.mjs";

const HEADER = "num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl";

function slugify(value) {
  const slug = String(value).toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!slug) throw new Error("Company name does not produce a safe report slug.");
  return slug;
}

function safeCell(value, label) {
  const text = String(value);
  if (!text || /[\t\r\n]/.test(text)) throw new Error(`${label} must be one non-empty line.`);
  return text;
}

async function writeExclusiveAtomic(finalPath, data) {
  await mkdir(path.dirname(finalPath), { recursive: true });
  const temporary = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, finalPath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function runMerge(root, options = {}) {
  const spawnFn = options.spawnFn ?? spawn;
  const child = spawnFn(process.execPath, [path.join(root, "merge-tracker.mjs")], {
    cwd: root,
    env: { ...process.env, CAREER_OPS_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const stopper = createProcessTreeStopper(child, options.stopOptions);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const onAbort = () => stopper.stop();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      stopper.settled();
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) return reject(Object.assign(new Error("Evaluation persistence was cancelled; generated files remain resumable and no false completion was recorded."), { code: "ABORT_ERR" }));
      if (code !== 0) return reject(new Error(`merge-tracker.mjs failed (${signal || code}): ${stderr.trim().slice(0, 500)}`));
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Persist one already-validated evaluation. The trusted backend determines every
 * path; no model-supplied path or report number crosses this boundary.
 */
export async function persistEvaluation({ root, payload, today, postedAt, signal }, options = {}) {
  if (signal?.aborted) throw Object.assign(new Error("Evaluation persistence cancelled before reservation."), { code: "ABORT_ERR" });
  const reservations = await reserveReportNumbers(1, { rootDir: root });
  const numeric = reservations[0];
  const num = formatReportNumber(numeric);
  const company = safeCell(payload.company, "Company");
  const role = safeCell(payload.role, "Role");
  const note = safeCell(payload.note, "Note");
  const postingUrl = safeCell(payload.postingUrl, "Posting URL");
  const slug = slugify(company);
  const reportRelative = `reports/${num}-${slug}-${today}.md`;
  const reportPath = path.join(root, reportRelative);
  const additionPath = path.join(root, "batch", "tracker-additions", `${num}-${slug}.tsv`);
  const postedSegment = /^20\d{2}-\d{2}-\d{2}$/.test(String(postedAt || "")) ? `; posted: ${postedAt}` : "";
  const row = [
    num, today, company, role, "Evaluated", `${payload.score}/5`, "❌",
    `[${num}](${reportRelative})`, note + postedSegment, postingUrl,
  ].join("\t");
  let reportWritten = false;
  let additionWritten = false;
  try {
    await writeExclusiveAtomic(reportPath, payload.reportMarkdown.endsWith("\n") ? payload.reportMarkdown : payload.reportMarkdown + "\n");
    reportWritten = true;
    await writeExclusiveAtomic(additionPath, HEADER + "\n" + row + "\n");
    additionWritten = true;
    const merged = await (options.mergeFn ? options.mergeFn({ root, signal }) : runMerge(root, { signal, spawnFn: options.spawnFn, stopOptions: options.stopOptions }));
    return { num, reportRelative, additionPath, merged };
  } catch (error) {
    if (!additionWritten && reportWritten) await unlink(reportPath).catch(() => {});
    throw error;
  } finally {
    await releaseReportNumbers(reservations, { rootDir: root }).catch(() => {});
  }
}
