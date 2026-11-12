import fs from "node:fs";
import { createHash } from "node:crypto";
import { careerOpsRoot, findReportFile } from "@/lib/career-ops";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { readPdfReviewQueue } from "@/lib/pdf-review-queue.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reviewing an indexed PDF never authorizes an application or writes a package.
export async function GET(req: Request) {
  const report = new URL(req.url).searchParams.get("n") ?? "";
  if (!/^\d{1,10}$/.test(report)) {
    return new Response("Invalid report number", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const indexPath = await resolvePdfIndexPath();
  const item = readPdfReviewQueue(careerOpsRoot(), indexPath, findReportFile)
    .find(entry => Number(entry.report) === Number(report));
  if (!item || item.status !== "ready_for_review" ||
      !("filePath" in item) || typeof item.filePath !== "string" ||
      !("sha256" in item) || typeof item.sha256 !== "string") {
    return new Response("Verified PDF unavailable; regenerate or review source evidence.", {
      status: 404, headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    // A file may have changed since the queue was read: re-check exact bytes.
    const bytes = fs.readFileSync(item.filePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== item.sha256 || bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("PDF changed");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="tailored-resume-review.pdf"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("PDF changed; review required.", { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
