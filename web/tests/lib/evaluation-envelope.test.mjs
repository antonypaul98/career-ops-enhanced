import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvaluationEnvelopeFilter, parseEvaluationEnvelope } from "../../src/lib/evaluation-envelope.mjs";
import { parseOpenCodeEvent } from "../../src/lib/run-cli-support.mjs";

const report = "# Evaluation: Acme — Engineer\n\n**URL:** https://example.com/jobs/1\n\n## Machine Summary\n\n```yaml\ncompany: Acme\nrole: Engineer\nscore: 4\nfinal_decision: REVIEW\nconfidence: high\nwork_auth: confirmed\nrisk_summary: none\nscore_evidence: strong match\n```\n\n## A — Fit\nGood.\n## B — Requirements\nMet.\n## C — Evidence\nVerified.\n## D — Gaps\nNone.\n## E — Eligibility\nConfirmed.\n## F — Recommendation\nReview.\n## G — Posting Legitimacy\nVerified.\n## H — Draft Application Answers\nDraft only.\n## Risk Summary\nNone.\n## Score Evidence\nStrong match.\n## Keywords extracted\nNode.js\n## Keyword Coverage\nCovered.\n## Job Description\nSynthetic fixture description.\n";
const payload = { company: "Acme", role: "Engineer", score: 4, note: "Synthetic fixture only", postingUrl: "https://example.com/jobs/1", reportMarkdown: report };
const envelope = `before\n<<evaluation-json>>\n${JSON.stringify(payload)}\n<</evaluation-json>>\nafter\n`;

test("accepts one complete sealed evaluation", () => {
  const result = parseEvaluationEnvelope(envelope, { expectedUrl: payload.postingUrl });
  assert.equal(result.ok, true);
  assert.equal(result.company, "Acme");
});

test("changed URL and incomplete reports fail closed", () => {
  assert.equal(parseEvaluationEnvelope(envelope, { expectedUrl: "https://example.com/jobs/2" }).ok, false);
  const incomplete = envelope.replace("## A — Fit", "## Missing");
  assert.equal(parseEvaluationEnvelope(incomplete, { expectedUrl: payload.postingUrl }).ok, false);
});

test("report header must contain exactly one exact posting URL, not a prefix or body citation", () => {
  const wrap = reportMarkdown => `<<evaluation-json>>\n${JSON.stringify({ ...payload, reportMarkdown })}\n<</evaluation-json>>`;
  const urlLine = "**URL:** " + payload.postingUrl;
  for (const changed of [
    report.replace(urlLine, urlLine + "0"),
    report.replace(urlLine, urlLine + "?different=1"),
    report.replace(urlLine, "**URL:** https://wrong.example/job") + "\n" + urlLine,
    report.replace(urlLine, urlLine + "\n**URL:** https://wrong.example/job"),
  ]) {
    assert.equal(parseEvaluationEnvelope(wrap(changed), { expectedUrl: payload.postingUrl }).ok, false);
  }
  assert.equal(parseEvaluationEnvelope(wrap(report.replace(urlLine, urlLine + "  "))).ok, true);
  assert.equal(parseEvaluationEnvelope(wrap(report).replaceAll("\n", "\r\n")).ok, true);
});

test("canonical URL accepts compact Score/PDF header fields without accepting impostors", () => {
  const urlLine = "**URL:** " + payload.postingUrl;
  const wrap = reportMarkdown => `<<evaluation-json>>\n${JSON.stringify({ ...payload, reportMarkdown })}\n<</evaluation-json>>`;
  const check = (replacement, accepted) => {
    const changed = report.replace(urlLine, replacement);
    const parsed = parseEvaluationEnvelope(wrap(changed), { expectedUrl: payload.postingUrl });
    assert.equal(parsed.ok, accepted, replacement);
  };

  for (const valid of [
    urlLine + " | **Score:** 4/5 | **PDF:** pending",
    "**Date:** 2026-11-10 | " + urlLine + " | **Score:** 4/5 | **PDF:** pending",
    "**Score:** 4/5 | " + urlLine + " | **PDF:** pending",
    urlLine + " **Score:** 4/5 **PDF:** pending",
  ]) check(valid, true);

  for (const invalid of [
    urlLine + "0 | **Score:** 4/5 | **PDF:** pending",
    urlLine + "?different=1 | **PDF:** pending",
    urlLine + " | **URL:** " + payload.postingUrl + " | **PDF:** pending",
    urlLine + " **URL:** " + payload.postingUrl,
    urlLine + " | **Score:** 4/5 | **PDF:** pending | **URL:** " + payload.postingUrl,
  ]) check(invalid, false);
});

test("stream filter withholds private report body while retaining it for validation", () => {
  const filter = createEvaluationEnvelopeFilter({ expectedUrl: payload.postingUrl });
  const visible = [filter.push(envelope.slice(0, 80)), filter.push(envelope.slice(80)), filter.flush()].join("");
  assert.ok(!visible.includes("Synthetic fixture description"));
  assert.equal(filter.result().ok, true);
});


test("oferta only requires draft answers for scores at least 4.5", () => {
  const low = { ...payload, reportMarkdown: report.replace("## H — Draft Application Answers\nDraft only.\n", "") };
  const wrap = value => `<<evaluation-json>>\n${JSON.stringify(value)}\n<</evaluation-json>>`;
  assert.equal(parseEvaluationEnvelope(wrap(low)).ok, true);
  const high = { ...low, score: 4.5, reportMarkdown: low.reportMarkdown.replace("score: 4", "score: 4.5") };
  assert.equal(parseEvaluationEnvelope(wrap(high)).ok, false);
});

const { reportMarkdown: ignoredReport, ...metadataOnly } = payload;
const splitEnvelope = [
  "narration before",
  "<<evaluation-json>>",
  JSON.stringify(metadataOnly),
  "<<evaluation-report>>",
  report.trimEnd(),
  "<</evaluation-report>>",
  "<</evaluation-json>>",
  "narration after",
].join("\n") + "\n";

test("accepts short JSON metadata and raw, unescaped full Markdown", () => {
  const result = parseEvaluationEnvelope(splitEnvelope, { expectedUrl: payload.postingUrl });
  assert.equal(result.ok, true);
  assert.equal(result.score, 4);
  assert.equal(result.reportMarkdown, report.trimEnd());
  assert.equal(result.machineSummary.company, "Acme");
});

test("split report handles literal quotes, fenced YAML, and raw newlines without JSON escaping", () => {
  const complex = report.replace(
    "Synthetic fixture description.",
    'Synthetic fixture with "double quotes", backslash \\\\ and literal newlines.\n\n' +
      '~~~json\n{"quote":"hello","actual":"raw"}\n~~~\n'
  );
  const raw = splitEnvelope.replace(report.trimEnd(), complex.trimEnd());
  const parsed = parseEvaluationEnvelope(raw, { expectedUrl: payload.postingUrl });
  assert.equal(parsed.ok, true);
  assert.match(parsed.reportMarkdown, /"double quotes"/);
  assert.match(parsed.reportMarkdown, /~~~json/);
});

test("split format fails closed on ambiguous markers, extra data, or invalid metadata", () => {
  const cases = [
    splitEnvelope.replace("<<evaluation-report>>", "<<evaluation-report>>\n<<evaluation-report>>"),
    splitEnvelope.replace("<</evaluation-report>>", "<</evaluation-report>>\n<</evaluation-report>>"),
    splitEnvelope.replace("<<evaluation-report>>", "<</evaluation-report>>\n<<evaluation-report>>"),
    splitEnvelope.replace("<</evaluation-report>>", "<</evaluation-report>>\nINJECTED"),
    splitEnvelope.replace(JSON.stringify(metadataOnly), '{"company":"Acme"\n"role":"Engineer"}'),
    splitEnvelope.replace(JSON.stringify(metadataOnly), JSON.stringify({ ...metadataOnly, reportMarkdown: report })),
    splitEnvelope.replace("## A — Fit", "## Other — Fit"),
    splitEnvelope.replace("https://example.com/jobs/1", "https://example.com/jobs/attacker"),
  ];
  for (const raw of cases) {
    const parsed = parseEvaluationEnvelope(raw, { expectedUrl: payload.postingUrl });
    assert.equal(parsed.ok, false, parsed.error);
  }
});

test("split report streaming filter hides complete Markdown even across character chunks", () => {
  const filter = createEvaluationEnvelopeFilter({ expectedUrl: payload.postingUrl });
  let displayed = "";
  for (const character of splitEnvelope) displayed += filter.push(character);
  displayed += filter.flush();
  assert.equal(filter.result().ok, true);
  assert.ok(!displayed.includes("Synthetic fixture description"));
  assert.ok(!displayed.includes("confidence: high"));
  assert.ok(displayed.includes("narration before"));
  assert.ok(displayed.includes("narration after"));
});


test("OpenCode JSONL fragments reconstruct a complete sealed report byte-for-byte", () => {
  const filter = createEvaluationEnvelopeFilter({ expectedUrl: payload.postingUrl });
  const fragments = splitEnvelope.match(/[\s\S]{1,13}/g) ?? [];
  let visible = "";
  for (const text of fragments) {
    const event = parseOpenCodeEvent(JSON.stringify({ type: "text", part: { type: "text", text } }));
    assert.ok(event?.text);
    visible += filter.push(event.text);
  }
  visible += filter.flush();
  const result = filter.result();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.reportMarkdown, report.trimEnd());
  assert.ok(!visible.includes("Synthetic fixture description"));
});
