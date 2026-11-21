import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { careerOpsRoot } from "@/lib/career-ops";
import { normalizeSponsorLookup } from "@/lib/h1b-triage.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execFileAsync = promisify(execFile);
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    return Response.json({ status: "blocked", note: "Cross-origin lookup refused." }, { status: 403, headers });
  if (!(req.headers.get("content-type") || "").includes("application/json"))
    return Response.json({ status: "blocked", note: "Expected JSON." }, { status: 415, headers });
  let company = "";
  try {
    const raw = await req.text();
    if (raw.length > 1024) throw Error("payload too large");
    const body = JSON.parse(raw);
    company = typeof body.company === "string" ? body.company.trim() : "";
  } catch {
    return Response.json({ status: "blocked", note: "Invalid company request." }, { status: 400, headers });
  }
  if (!company || company.length > 120 || /[\x00-\x1f\x7f]/.test(company))
    return Response.json({ status: "blocked", note: "Invalid company name." }, { status: 400, headers });

  const root = careerOpsRoot();
  const file = path.join(root, "plugins", "h1b-sponsor", "check.mjs");
  // Default to local DOL disclosure index only. No implicit company lookup
  // to any third-party endpoint, even if H1B_API_BASE exists in server env.
  const index = process.env.H1B_INDEX_PATH || path.join(root, "data", "h1b", "index.ndjson.gz");
  if (!fs.existsSync(file) || !fs.existsSync(index))
    return Response.json({
      status: "index_missing",
      note: "Local DOL index is not installed. An explicit download is required; no lookup was sent online.",
    }, { headers });

  const env = { ...process.env };
  delete env.H1B_API_BASE;
  delete env.H1B_API_TOKEN;
  try {
    const { stdout } = await execFileAsync(process.execPath, [file, company, "--json"], {
      cwd: root, env, timeout: 15_000, maxBuffer: 192 * 1024,
      windowsHide: true,
    });
    const result = normalizeSponsorLookup(company, JSON.parse(stdout));
    return Response.json(result, { headers });
  } catch {
    return Response.json({
      status: "unresolved",
      note: "Local filing-history check was inconclusive; do not infer no sponsorship.",
    }, { headers });
  }
}
