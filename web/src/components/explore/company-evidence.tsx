"use client";

import { useState } from "react";

type History = {
  status: string; tier?: string; resolvedName?: string; lca?: number | null;
  certified?: number | null; lastYear?: number | null; note?: string; source?: string | null;
};
export function CompanyEvidence({ company, onHistory }: {
  company: string; onHistory: (name: string, history: History) => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const search = "https://www.reddit.com/search/?q=" +
    encodeURIComponent('"' + company + '" (H1B OR visa OR sponsorship)') + "&sort=new&t=year";
  const check = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const response = await fetch("/api/h1b-history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      const data = await response.json();
      if (!data || typeof data.status !== "string") throw Error("Invalid response");
      setHistory(data);
      onHistory(company, data);
    } catch {
      setHistory({ status: "unresolved", note: "Lookup failed; sponsorship remains unknown." });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="mt-1 rounded-lg border border-border bg-surface/30 px-3 py-2 text-xs text-muted">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" onClick={() => void check()} disabled={loading}
          className="font-medium text-brand hover:underline disabled:opacity-60">
          {loading ? "Checking local DOL data…" : history ? "Recheck H-1B history" : "Check H-1B history"}
        </button>
        <a href={search} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline"
          title="Opens a recent Reddit search in a new tab; Reddit claims are not verified sponsorship policy">
          Recent Reddit discussions
        </a>
        <button type="button" className="text-brand hover:underline" onClick={() => setShowSafety(v => !v)}>
          Verify employer
        </button>
      </div>
      {history && (
        <div className="mt-2 space-y-1 leading-relaxed" role="status">
          {history.status === "matched" ? (
            <>
              <p className="font-medium text-foreground">
                DOL employer match: {history.resolvedName} · {history.tier ?? "unknown"} filing history
              </p>
              <p>
                {typeof history.lca === "number" ? history.lca.toLocaleString() : "Unknown count"} LCAs filed
                {typeof history.certified === "number" ? " · " + history.certified.toLocaleString() + " certified" : ""}
                {typeof history.lastYear === "number" ? " · last recorded year " + history.lastYear : ""}
              </p>
            </>
          ) : history.status === "possible_entity" ? (
            <p>Possible DOL legal entity: {history.resolvedName}. Confirm it's the actual employer before using the counts.</p>
          ) : (
            <p>{history.status === "index_missing"
              ? "The optional local DOL index is missing; no online query was made."
              : "Employer history is unknown or unresolved, not evidence of no sponsorship."}</p>
          )}
          {history.note && <p>{history.note}</p>}
        </div>
      )}
      {showSafety && (
        <p className="mt-2 leading-relaxed">
          Verify this exact requisition on the employer's own careers website, the
          recruiting email domain and the actual hiring entity. Never pay to apply
          or send identity documents to an unverified recruiter. A real ATS URL
          alone does not prove the recruiter is legitimate.{" "}
          <a className="text-brand underline" href="https://consumer.ftc.gov/articles/job-scams"
            target="_blank" rel="noopener noreferrer">FTC job-scam advice</a>.
        </p>
      )}
    </div>
  );
}
