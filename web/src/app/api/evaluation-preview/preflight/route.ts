/**
 * Read-only local acceptance preflight. Uses the same candidate gate as POST
 * /api/evaluation-preview, but never reserves a model attempt, starts a worker,
 * writes files, contacts an employer, or claims to verify a live posting.
 */
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { resolveCli } from "@/lib/clis";
import { checkPreviewAccess } from "@/lib/evaluation-preview-security.mjs";
import { validatePreviewRequest, FREE_PREVIEW_MODEL } from "@/lib/evaluation-preview-guard.mjs";
import { loadPreviewCandidate } from "@/lib/evaluation-preview-authority.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const errorReply = (error: string, status: number) =>
  Response.json({ localInputsReady: false, error, noModelCall: true, attemptReserved: false },
    { status, headers: noStore });

export async function POST(req: Request) {
  const access = checkPreviewAccess({
    enabled: process.env.CAREER_OPS_ENABLE_REPORT_PREVIEW,
    configuredToken: process.env.CAREER_OPS_PREVIEW_TOKEN,
    providedToken: req.headers.get("x-career-ops-preview-token"),
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
  });
  if (!access.ok) return errorReply(
    "error" in access ? access.error : "Preview access denied.",
    "status" in access ? access.status : 403,
  );

  let body: unknown;
  try { body = await req.json(); }
  catch { return errorReply("Invalid JSON.", 400); }
  const checked = validatePreviewRequest(body);
  if ("error" in checked) return errorReply(checked.error || "Invalid evaluation-only input.", 400);

  const candidate = await loadPreviewCandidate({
    root: careerOpsRoot(),
    codeRoot: resolveCodeRoot(process.cwd(), process.env),
  });
  if ("error" in candidate) return errorReply(candidate.error || "Candidate authority requires review.", 409);

  // Lookup only; deliberately no provider credential or quota probes.
  const cli = resolveCli("opencode");
  if (!cli || cli.spec.id !== "opencode") {
    return errorReply("OpenCode is not installed. No other provider is permitted for this preview.", 409);
  }
  return Response.json({
    localInputsReady: true,
    noModelCall: true,
    attemptReserved: false,
    model: FREE_PREVIEW_MODEL,
    checks: {
      postingUrlAndDescriptionShape: true,
      candidateSourceAuthority: true,
      evaluationFormat: true,
      openCodeBinaryPresent: true,
    },
    unverified: [
      "job-posting-liveness-and-origin",
      "visa-and-employment-eligibility",
      "free-model-provider-quota",
      "OpenCode-provider-authentication",
    ],
  }, { headers: noStore });
}
