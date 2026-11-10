/**
 * Opt-in built-dashboard HTTP acceptance using a fake, local OpenCode executable.
 * No provider is contacted and no private candidate files are read.
 *
 * npm run build
 * CAREER_OPS_OFFLINE_PREVIEW_E2E=1 node --test tests/lib/evaluation-preview-offline-http.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const enabled = process.env.CAREER_OPS_OFFLINE_PREVIEW_E2E === "1";
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const codeRoot = path.resolve(webRoot, "..");
const postingUrl = "https://example.com/jobs/synthetic-data-engineer";
const jobDescription = "Synthetic data engineer job with SQL and ETL requirements. ".repeat(6);

const fakeOpenCode = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("1.19.4"); process.exit(0); }
if (args[0] === "debug") {
  const config = JSON.parse(fs.readFileSync(process.env.OPENCODE_CONFIG, "utf8"));
  console.log(JSON.stringify(args[1] === "config" ? config : {
    permission: config.permission,
    model: { providerID: "opencode", modelID: "glm-5.3-flash-free" }
  }));
  process.exit(0);
}
if (args[0] !== "run" || args[args.indexOf("--model") + 1] !== "opencode/glm-5.3-flash-free"
    || args[args.indexOf("--agent") + 1] !== "career-ops-readonly") process.exit(2);
const countPath = path.join(__dirname, "calls");
const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, "utf8")) : 0;
fs.writeFileSync(countPath, String(count + 1));
const input = fs.readFileSync(0, "utf8");
const url = input.match(/^Posting URL: (.+)$/m)?.[1];
const jd = input.split("=== SUPPLIED JOB DESCRIPTION ===\\n")[1]?.split("\\n=== END JOB DESCRIPTION ===")[0];
if (!url || !jd || !input.includes("SOURCE-VERIFIED CANDIDATE FACTS")) process.exit(3);
const fence = String.fromCharCode(96).repeat(3);
const report = [
  "# Evaluation: Fictional Co — Data Engineer", "", "**URL:** " + url, "",
  "## Machine Summary", "", fence + "yaml",
  "company: Fictional Co", "role: Data Engineer", "score: 3.5",
  "final_decision: REVIEW", "confidence: low", "work_auth: unknown",
  "risk_summary: Synthetic only", "score_evidence: Synthetic CV evidence",
  fence, "", "## A — Fit", "Synthetic only.",
  "## B — Requirements", "Unverified.",
  "## C — Evidence", "Synthetic.",
  "## D — Gaps", "Unknown.",
  "## E — Eligibility", "Unknown.",
  "## F — Recommendation", "Review only.",
  "## G — Posting Legitimacy", "Caller-supplied.",
  "## Risk Summary", "Unknown eligibility.",
  "## Score Evidence", "Synthetic.",
  "## Keywords extracted", "SQL",
  "## Keyword Coverage", "Synthetic.",
  "## Job Description", jd, ""
].join("\\n");
const payload = { company: "Fictional Co", role: "Data Engineer", score: 3.5,
  note: "Offline synthetic test only", postingUrl: url, reportMarkdown: report };
const envelope = "<<evaluation-json>>\\n" + JSON.stringify(payload) + "\\n<</evaluation-json>>\\n";
console.log(JSON.stringify({ type: "text", part: { type: "text", text: envelope } }));
console.log(JSON.stringify({ type: "step_finish", part: { type: "step-finish",
  tokens: { input: 1, output: 1, cache: { write: 0 } }, cost: 0 } }));
`;

function writeFixture(root) {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "modes"));
  fs.writeFileSync(path.join(root, "cv.md"),
    "# Synthetic Candidate\n## Summary\n- Built synthetic data pipelines.\n");
  fs.writeFileSync(path.join(root, "data/career-profile.yml"), [
    "schema_version: 1", "candidate:", "  identity: []", "summary:",
    "  - id: synthetic-summary", "    text: Built synthetic data pipelines.",
    "    review_status: verified", "    evidence:",
    "      source: cv.md", "      line: 3",
    '      quote: "- Built synthetic data pipelines."',
    "experiences: []", "projects: []", "education: []",
    "certifications: []", "skills: []", ""
  ].join("\n"));
  fs.writeFileSync(path.join(root, "modes/oferta.md"),
    "# Synthetic report format reference\n");
}

function fileSnapshot(root) {
  const rows = [];
  function visit(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, ent.name);
      if (ent.isDirectory()) visit(absolute);
      else {
        assert.ok(ent.isFile(), "No symlinks permitted in synthetic root");
        rows.push([path.relative(root, absolute),
          createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")]);
      }
    }
  }
  visit(root);
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) =>
    socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Next server exited before readiness");
    try {
      const res = await fetch(base + "/api/evaluation-preview",
        { signal: AbortSignal.timeout(700) });
      if (res.status === 405 || res.status === 404) return;
    } catch { /* server not ready */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Isolated Next server failed to start");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await Promise.race([
    new Promise(resolve => child.once("close", resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

test("built HTTP returns synthetic evaluation-only report without canonical writes",
  { skip: !enabled ? "Set CAREER_OPS_OFFLINE_PREVIEW_E2E=1 to run built HTTP acceptance" : false,
    timeout: 45000 }, async t => {
    assert.notEqual(process.platform, "win32", "This fixture uses POSIX process groups");
    assert.ok(fs.existsSync(path.join(webRoot, ".next/BUILD_ID")),
      "Run npm run build before the opt-in HTTP test");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-offline-http-"));
    const candidate = path.join(tmp, "candidate");
    writeFixture(candidate);
    const before = fileSnapshot(candidate);
    const binDir = path.join(tmp, "bin");
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, "opencode"), fakeOpenCode, { mode: 0o700 });
    const port = await freePort();
    const base = "http://127.0.0.1:" + port;
    const token = randomBytes(32).toString("hex");
    const env = { ...process.env,
      PATH: binDir + path.delimiter + process.env.PATH,
      CAREER_OPS_ROOT: candidate, CAREER_OPS_CODE_ROOT: codeRoot,
      CAREER_OPS_ENABLE_REPORT_PREVIEW: "1", CAREER_OPS_PREVIEW_TOKEN: token,
      CAREER_OPS_WEB_ALLOWED_HOSTS: "", CAREER_OPS_ALLOWED_ORIGINS: "" };
    let serverLog = "";
    const child = spawn(process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
      { cwd: webRoot, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", chunk => { serverLog = (serverLog + chunk.toString()).slice(-2500); });
    t.after(async () => { await stopServer(child); fs.rmSync(tmp, { recursive: true, force: true }); });
    await waitForServer(base, child);
    const url = base + "/api/evaluation-preview";
    const headers = { "content-type": "application/json", "x-career-ops-preview-token": token };
    const body = JSON.stringify({ evaluationOnly: true, postingUrl, jobDescription });
    const response = await fetch(url, { method: "POST", headers, body,
      signal: AbortSignal.timeout(22000) });
    assert.equal(response.status, 200, serverLog);
    const events = (await response.text()).split("\n").filter(Boolean).map(line => JSON.parse(line));
    assert.equal(events.some(event => event.type === "error"), false, JSON.stringify(events));
    const result = events.find(event => event.type === "preview-report");
    assert.ok(result, "Missing validated preview-report: " + JSON.stringify(events));
    assert.equal(result.status, "evaluation-only");
    assert.equal(result.model, "opencode/glm-5.3-flash-free");
    assert.equal(result.persisted, false);
    assert.equal(result.submissionAllowed, false);
    assert.equal(result.applicationPackageAllowed, false);
    assert.equal(result.sourceVerification, "caller-supplied-JD-not-independently-verified");
    assert.ok(result.reportMarkdown.includes(jobDescription));
    assert.match(result.reportMarkdown, /career-ops:evaluation-only:v1/);
    assert.equal(result.reportSha256,
      createHash("sha256").update(result.reportMarkdown).digest("hex"));
    assert.deepEqual(fileSnapshot(candidate), before,
      "Candidate inputs and application state must not change");
    assert.equal(fs.existsSync(path.join(candidate, "data/applications.md")), false);
    assert.equal(fs.existsSync(path.join(candidate, "reports")), false);
    assert.equal(fs.existsSync(path.join(candidate, "data/private")), false);
    const replay = await fetch(url, { method: "POST", headers, body,
      signal: AbortSignal.timeout(5000) });
    assert.equal(replay.status, 409, "Replay must not launch another worker");
    assert.equal(fs.readFileSync(path.join(binDir, "calls"), "utf8"), "1",
      "Fake model must run exactly once");
    assert.deepEqual(fileSnapshot(candidate), before);
  });
