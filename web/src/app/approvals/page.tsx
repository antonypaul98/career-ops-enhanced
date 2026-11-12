import Link from "next/link";
import { ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import { careerOpsRoot, findReportFile } from "@/lib/career-ops";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { readPdfReviewQueue } from "@/lib/pdf-review-queue.mjs";
import { readSubmissionApprovals } from "@/lib/submission-approvals.mjs";

export const dynamic = "force-dynamic";

const tone: Record<string, string> = {
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  paused: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  review: "border-brand/30 bg-brand/10 text-brand",
  inspect: "border-white/10 bg-white/5 text-muted",
};

export default async function ApprovalsPage() {
  const packages = readSubmissionApprovals(careerOpsRoot());
  const pdfIndex = await resolvePdfIndexPath();
  const pdfReviews = readPdfReviewQueue(careerOpsRoot(), pdfIndex, findReportFile);
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Approval Center</h1>
      </div>
      <p className="mt-1.5 max-w-3xl text-sm text-muted">
        Review the exact local application package before submission. This dashboard is read-only: the submission
        runner rechecks the live form and every digest, pauses on any difference, and requires a concrete receipt
        before Applied can be recorded.
      </p>

      {packages.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <FileCheck2 className="mx-auto size-8 text-muted" />
          <h2 className="mt-3 font-medium text-landing">No approval packages yet</h2>
          <p className="mt-1 text-sm text-muted">Prepare and inspect an application to make its exact review package appear here.</p>
          <Link href="/evaluation-preview" className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm text-brand hover:underline">
            Local evaluation-only preview (no application package)
          </Link>
        </section>
      ) : (
        <div className="mt-8 space-y-5">
          {packages.map((item: any) => item.error ? (
            <section key={item.source} className="rounded-2xl border border-red-400/30 bg-red-400/10 p-5">
              <h2 className="font-medium text-red-200">Invalid private package</h2>
              <p className="mt-1 font-mono text-xs text-red-200/80">{item.source}: {item.error}</p>
            </section>
          ) : (
            <section key={item.source} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">{item.company}</p>
                  <h2 className="mt-1 text-lg font-semibold text-landing">{item.role}</h2>
                  <p className="mt-1 font-mono text-xs text-muted">{item.applicationKey}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tone[item.status.kind]}`}>
                  {item.status.label}
                </span>
              </div>

              {item.demoWarning && <div className="mt-4 text-sm text-amber-200">
                <p>{item.demoWarning}</p><p>{item.sponsorship}</p>
                <ul>{item.matchLimitations.map((line: string) => <li key={line}>{line}</li>)}</ul>
              </div>}
              <a href={item.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
                {item.hostname}<ExternalLink className="size-3.5" />
              </a>

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Reviewed answers</h3>
                  <dl className="mt-2 divide-y divide-white/10 rounded-xl border border-white/10">
                    {item.fields.map((field: any) => (
                      <div key={field.key} className="px-3 py-2.5">
                        <dt className="text-xs text-muted">{field.label}{field.sensitive ? " · sensitive" : ""}</dt>
                        <dd className="mt-0.5 break-words text-sm text-landing">{field.value}</dd>
                        <dd className="mt-1 font-mono text-[10px] text-muted">Evidence: {field.evidence || "missing"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Exact artifacts</h3>
                  <div className="mt-2 space-y-2">
                    {item.artifacts.map((artifact: any) => (
                      <div key={`${artifact.kind}-${artifact.sha256}`} className="rounded-xl border border-white/10 px-3 py-2.5">
                        <p className="text-sm text-landing">{artifact.kind}: {artifact.name}</p>
                        <p className="mt-1 break-all font-mono text-[10px] text-muted">SHA-256 {artifact.sha256}</p>
                      </div>
                    ))}
                    <div className="rounded-xl border border-white/10 px-3 py-2.5">
                      <p className="text-xs text-muted">Package digest</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted">{item.contentDigest || "missing"}</p>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted">Source: {item.source}</p>
            </section>
          ))}
        </div>
      )}
      <section className="mt-10 border-t border-white/10 pt-7" aria-labelledby="pdf-review-heading">
        <h2 id="pdf-review-heading" className="text-lg font-semibold text-landing">Tailored PDF review queue</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          These are previously rendered PDFs from your local PDF index, shown only when their
          PDF, HTML and current source checksums match. A PDF here is not an application
          package, eligibility confirmation, or permission to submit.
        </p>
        {pdfReviews.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No indexed source-verified PDFs available yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {pdfReviews.map((item: any) => (
              <div key={item.report} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-landing">Report #{item.report}</p>
                    <p className="mt-1 text-xs text-muted">
                      {item.status === "ready_for_review" ? item.name : item.error}
                    </p>
                  </div>
                  {item.status === "ready_for_review" ? (
                    <a href={"/api/review-pdf?n=" + encodeURIComponent(item.report)}
                      target="_blank" rel="noreferrer"
                      className="rounded-lg border border-border px-3 py-2 text-sm text-brand hover:underline">
                      Inspect verified PDF
                    </a>
                  ) : (
                    <span className="text-xs text-amber-200">Evidence requires review</span>
                  )}
                </div>
                {item.status === "ready_for_review" && (
                  <p className="mt-2 break-all font-mono text-[10px] text-muted">
                    SHA-256 {item.sha256}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
