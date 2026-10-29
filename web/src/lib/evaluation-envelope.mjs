/**
 * Read-only evaluation worker output contract.
 *
 * The model never chooses paths or writes canonical artifacts. It emits one JSON
 * envelope; the backend validates it and owns report/tracker persistence.
 */
import * as yaml from "js-yaml";

export const EVALUATION_OPEN_MARK = "<<evaluation-json>>";
export const EVALUATION_CLOSE_MARK = "<</evaluation-json>>";

const OPEN_RE = /^<<evaluation-json>>[ 	]*$/gm;
const CLOSE_RE = /^<<\/evaluation-json>>[ 	]*$/m;
const CLOSE_ALL_RE = /^<<\/evaluation-json>>[ 	]*$/gm;
const REQUIRED_LETTERS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H"]);
const REQUIRED_HEADINGS = Object.freeze([
  "Machine Summary",
  "Risk Summary",
  "Score Evidence",
  "Keywords extracted",
  "Keyword Coverage",
  "Job Description",
]);
const SAFE_CELL = /^[^\t\r\n]+$/;

export const EVALUATION_ENVELOPE_INSTRUCTION =
  "Do NOT save or edit files, run shell commands, submit applications, or contact anyone. " +
  "Return the completed evaluation inside exactly one JSON envelope. Put " + EVALUATION_OPEN_MARK + " alone on a line, " +
  "then one JSON object with exactly these keys: company, role, score, note, postingUrl, and reportMarkdown; " +
  "then put " + EVALUATION_CLOSE_MARK + " alone on a line. score is the numeric 1-5 Global Score. " +
  "note is one plain line of at most 240 characters. postingUrl must be the exact input URL. " +
  "reportMarkdown is the complete modes/oferta.md report, including the exact header, Machine Summary, A-H blocks, " +
  "Risk Summary, Score Evidence, Keywords sections, and archived JD. Emit no second envelope and no abbreviated report. " +
  "If the JD is blocked, incomplete, behind login/consent/CAPTCHA, or requires candidate confirmation, emit NO envelope; " +
  "explain the pause instead. The trusted backend reserves the report number, writes the report and tracker addition, " +
  "and runs merge-tracker.mjs only after this envelope passes validation.";

/** @param {string} s */
function oneLine(s) {
  return typeof s === "string" && SAFE_CELL.test(s) && s.trim() === s;
}

/** @param {string} markdown */
function machineSummary(markdown) {
  const re = new RegExp("^## Machine Summary[ \\t]*\\r?\\n+\\x60\\x60\\x60ya?ml[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\\x60\\x60\\x60", "mi");
  const match = markdown.match(re);
  if (!match) return { ok: false, error: "The report has no complete Machine Summary YAML fence." };
  try {
    const value = yaml.load(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "Machine Summary must be one YAML mapping." };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: "Machine Summary YAML is invalid: " + error.message };
  }
}

/** @param {string} markdown */
function reportLetters(markdown) {
  const found = new Set();
  const re = /^##[ 	]+(?:Block[ 	]+)?([A-H])(?:[).:]|[ 	]+[—–-])[ 	]*/gmi;
  for (const match of markdown.matchAll(re)) found.add(match[1].toUpperCase());
  return found;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

/**
 * @param {unknown} value
 * @param {{expectedUrl?: string}} [options]
 */
export function validateEvaluationPayload(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "The evaluation envelope must contain one JSON object." };
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = ["company", "note", "postingUrl", "reportMarkdown", "role", "score"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    return { ok: false, error: "Evaluation envelope keys must be exactly " + expectedKeys.join(", ") + "." };
  }

  const { company, role, note, postingUrl, reportMarkdown, score } = value;
  if (!oneLine(company) || company.length > 160) return { ok: false, error: "Company must be one safe line (1-160 characters)." };
  if (!oneLine(role) || role.length > 200) return { ok: false, error: "Role must be one safe line (1-200 characters)." };
  if (!oneLine(note) || note.length > 240) return { ok: false, error: "Note must be one safe line (1-240 characters)." };
  if (!oneLine(postingUrl) || postingUrl.length > 4096) return { ok: false, error: "Posting URL must be one safe line." };
  if (options.expectedUrl !== undefined && postingUrl !== options.expectedUrl) {
    return { ok: false, error: "The evaluation URL changed; refusing to persist a different posting." };
  }
  if (typeof score !== "number" || !Number.isFinite(score) || score < 1 || score > 5) {
    return { ok: false, error: "Global score must be a finite number from 1 through 5." };
  }
  if (typeof reportMarkdown !== "string" || !reportMarkdown.trim() || reportMarkdown.length > 1_000_000) {
    return { ok: false, error: "Report Markdown is empty or exceeds the 1 MB safety limit." };
  }
  if (!/^# Evaluation:/m.test(reportMarkdown)) return { ok: false, error: "Report is missing the canonical Evaluation header." };
  if (!reportMarkdown.includes("**URL:** " + postingUrl)) return { ok: false, error: "Report header URL does not match the sealed posting URL." };

  const letters = reportLetters(reportMarkdown);
  const missingLetters = REQUIRED_LETTERS.filter((letter) => (letter !== "H" || score >= 4.5) && !letters.has(letter));
  if (missingLetters.length) return { ok: false, error: "Report is incomplete; missing section(s): " + missingLetters.join(", ") + "." };
  for (const heading of REQUIRED_HEADINGS) {
    if (!new RegExp("^## " + escapeRegExp(heading) + "\\b", "mi").test(reportMarkdown)) {
      return { ok: false, error: "Report is incomplete; missing " + heading + "." };
    }
  }

  const summary = machineSummary(reportMarkdown);
  if (!summary.ok) return summary;
  const m = summary.value;
  if (m.company !== company || m.role !== role || Number(m.score) !== score) {
    return { ok: false, error: "Envelope metadata does not match the report Machine Summary." };
  }
  for (const key of ["final_decision", "confidence", "work_auth", "risk_summary", "score_evidence"]) {
    if (!(key in m)) return { ok: false, error: "Machine Summary is missing required key " + key + "." };
  }

  return { ok: true, company, role, note, postingUrl, reportMarkdown, score, machineSummary: m };
}

/**
 * @param {string} text
 * @param {{expectedUrl?: string}} [options]
 */
export function parseEvaluationEnvelope(text, options = {}) {
  if (typeof text !== "string") return { ok: false, error: "No agent output to read an evaluation envelope from." };
  const normalized = text.replace(/\r\n/g, "\n");
  const openers = [...normalized.matchAll(OPEN_RE)];
  if (openers.length === 0) return { ok: false, error: "The agent emitted no evaluation envelope; nothing was persisted." };
  if (openers.length > 1) return { ok: false, error: "Found " + openers.length + " evaluation envelopes; refusing to guess." };
  const opener = openers[0];
  const after = normalized.slice(opener.index + opener[0].length);
  const closer = CLOSE_RE.exec(after);
  if (!closer) return { ok: false, error: "The evaluation envelope was never closed." };
  const body = after.slice(0, closer.index).replace(/^\n/, "").replace(/\n$/, "");
  if ([...after.matchAll(CLOSE_ALL_RE)].length !== 1) return { ok: false, error: "Found multiple evaluation envelope closers." };
  let value;
  try {
    value = JSON.parse(body);
  } catch (error) {
    return { ok: false, error: "Evaluation envelope JSON is invalid: " + error.message };
  }
  return validateEvaluationPayload(value, options);
}

/**
 * Streaming display filter. The raw envelope is retained for validation while
 * its potentially private report body is withheld from the dashboard log.
 */
export function createEvaluationEnvelopeFilter(options = {}) {
  let raw = "";
  let pending = "";
  let inBody = false;

  return {
    push(chunk) {
      const text = String(chunk ?? "");
      raw += text;
      pending += text.replace(/\r\n/g, "\n");
      let display = "";
      for (;;) {
        if (!inBody) {
          const match = /^<<evaluation-json>>[ 	]*\n/m.exec(pending);
          if (!match) {
            const cut = pending.lastIndexOf("\n") + 1;
            display += pending.slice(0, cut);
            pending = pending.slice(cut);
            return display;
          }
          display += pending.slice(0, match.index);
          pending = pending.slice(match.index + match[0].length);
          inBody = true;
          continue;
        }
        const match = /^<<\/evaluation-json>>[ 	]*\n?/m.exec(pending);
        if (!match) {
          const cut = pending.lastIndexOf("\n") + 1;
          if (cut > 0) pending = pending.slice(cut);
          return display;
        }
        pending = pending.slice(match.index + match[0].length);
        inBody = false;
      }
    },
    flush() {
      const held = inBody ? "" : pending;
      pending = "";
      return held;
    },
    result() {
      return parseEvaluationEnvelope(raw, options);
    },
  };
}
