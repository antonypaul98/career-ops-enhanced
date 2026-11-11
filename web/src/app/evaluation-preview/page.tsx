"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, FileSearch, Loader2, ShieldAlert } from "lucide-react";
import { parseReportOnlyReply } from "@/lib/evaluation-preview-client.mjs";

type ReviewReport = {
  company: string;
  role: string;
  score: number;
  postingUrl: string;
  reportMarkdown: string;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export default function EvaluationPreviewPage() {
  const [postingUrl, setPostingUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [token, setToken] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<ReviewReport | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page disconnects the one allowed local worker.
  useEffect(() => () => controller.current?.abort(), []);

  async function runPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attempted || running) return;
    if (!LOCAL_HOSTS.has(window.location.hostname)) {
      setMessage("This tool is available only on the local computer.");
      return;
    }
    let url: URL;
    try { url = new URL(postingUrl); }
    catch { setMessage("Enter the complete official HTTPS posting URL."); return; }
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        postingUrl.trim() !== postingUrl || postingUrl.length > 4096) {
      setMessage("Use an HTTPS posting URL without credentials or a fragment.");
      return;
    }
    if (jobDescription.trim().length < 200 || jobDescription.length > 120000) {
      setMessage("Paste the complete job description (200–120,000 characters).");
      return;
    }
    if (!TOKEN_PATTERN.test(token)) {
      setMessage("Enter the separately configured 32–256 character local preview token.");
      return;
    }

    const requestedUrl = postingUrl;
    const sessionToken = token;
    setToken(""); // Never retain the token after starting an attempt.
    setAttempted(true); // No UI retry with the same token, including after cancellation.
    setRunning(true);
    setReport(null);
    setMessage("Running one local, read-only evaluation. No application will be created.");
    const abort = new AbortController();
    controller.current = abort;

    try {
      const response = await fetch("/api/evaluation-preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-career-ops-preview-token": sessionToken,
        },
        body: JSON.stringify({ evaluationOnly: true, postingUrl: requestedUrl, jobDescription }),
        signal: abort.signal,
        cache: "no-store",
        credentials: "omit",
      });
      const raw = await response.text();
      if (abort.signal.aborted) {
        setMessage("Preview cancelled. The attempt cannot be retried with the same token.");
        return;
      }
      const parsed = parseReportOnlyReply(response.status, raw, requestedUrl);
      if ("error" in parsed) {
        setMessage(parsed.error || "The preview did not return a valid report.");
        return;
      }
      if (!("report" in parsed)) {
        setMessage("The preview did not return a valid report.");
        return;
      }
      setReport(parsed.report as ReviewReport);
      setMessage("Report generated for inspection only. Eligibility and job-posting liveness are not independently verified.");
    } catch (error) {
      setMessage(abort.signal.aborted
        ? "Preview cancelled. No application was submitted or created."
        : "Local preview failed or disconnected. Check the local server and the free-model quota.");
    } finally {
      if (controller.current === abort) controller.current = null;
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/approvals" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> Approval Center
      </Link>
      <div className="mt-6 flex items-center gap-3">
        <FileSearch className="size-6 text-brand" aria-hidden />
        <h1 className="font-display text-2xl tracking-tight text-landing">Local evaluation preview</h1>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-muted">
        An opt-in, report-only acceptance screen. It uses only the fixed free OpenCode model
        and your locally reviewed CV facts. It cannot save a report, prepare a resume or PDF,
        create an Approval Center package, or submit an application.
      </p>
      <section className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <ShieldAlert className="size-4" aria-hidden /> One real model attempt per configured token
        </p>
        <p className="mt-1 text-muted">
          Disabled by default. A separately authorized local server and strong session token
          are required. A failed or cancelled request may still consume that attempt.
          Do not run while the free-model quota is exhausted. The job description is
          supplied by you and is not independently verified.
        </p>
      </section>

      <form onSubmit={runPreview} autoComplete="off" className="mt-7 space-y-5">
        <div>
          <label htmlFor="preview-url" className="mb-1.5 block text-sm font-medium">Official job posting URL</label>
          <input id="preview-url" type="url" required maxLength={4096}
            value={postingUrl} onChange={event => setPostingUrl(event.target.value)}
            disabled={attempted}
            placeholder="https://company.example/careers/role"
            className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-foreground outline-none focus:border-brand" />
        </div>
        <div>
          <label htmlFor="preview-jd" className="mb-1.5 block text-sm font-medium">Complete job description</label>
          <textarea id="preview-jd" required rows={10} maxLength={120000}
            value={jobDescription} onChange={event => setJobDescription(event.target.value)}
            disabled={attempted}
            placeholder="Paste the posting's full requirements and responsibilities."
            className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-foreground outline-none focus:border-brand" />
          <p className="mt-1 text-xs text-muted">{jobDescription.length.toLocaleString()} characters · at least 200 required</p>
        </div>
        <div>
          <label htmlFor="preview-token" className="mb-1.5 block text-sm font-medium">Local session token</label>
          <input id="preview-token" type="password" required minLength={32} maxLength={256}
            autoComplete="off" spellCheck={false} value={token}
            onChange={event => setToken(event.target.value)} disabled={attempted}
            className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm text-foreground outline-none focus:border-brand" />
          <p className="mt-1 text-xs text-muted">Used only for this request; cleared from the form on launch.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={attempted || running}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-50">
            {running && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {attempted ? "Attempt used" : "Start one report-only preview"}
          </button>
          {running && (
            <button type="button" onClick={() => controller.current?.abort()}
              className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm text-foreground">
              Cancel worker
            </button>
          )}
        </div>
      </form>

      {message && (
        <p role="status" aria-live="polite" className="mt-5 rounded-lg border border-border bg-surface/50 p-3 text-sm text-foreground">
          {message}
        </p>
      )}

      {report && (
        <section className="mt-8">
          <div className="rounded-lg border border-amber-500/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
              Unreviewed model output · evaluation only
            </p>
            <h2 className="mt-2 text-xl font-medium">{report.company} · {report.role}</h2>
            <p className="mt-1 text-sm text-muted">Model score: {report.score}/5 · not an eligibility decision or application approval</p>
          </div>
          <h3 className="mt-6 text-sm font-semibold">Complete report (plain text, not saved)</h3>
          <pre className="mt-2 max-h-[900px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-surface p-5 font-mono text-xs leading-relaxed text-foreground">
            {report.reportMarkdown}
          </pre>
        </section>
      )}
    </main>
  );
}
