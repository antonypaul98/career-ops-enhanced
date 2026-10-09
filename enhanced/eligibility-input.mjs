/**
 * C07 bounded adapter: build evaluator inputs only from a reviewed C03 JD
 * snapshot and separately approved private candidate declarations.
 * Pure and fail-closed: no filesystem, network, extraction, or inference.
 * The caller must collect review decisions; this function does not verify law.
 */
import { createHash } from 'node:crypto';

const FIELDS = new Set(['work_authorized', 'needs_sponsorship']);
const PERIODS = new Set(['current', 'future']);
const C03_SPAN_UNITS = 'UTF-16; lines/columns 1-based; end exclusive; offsets 0-based';
const CANDIDATE_SOURCES = new Set(['candidate_statement', 'candidate_document']);
const CANDIDATE_STATUSES = new Set(['user_confirmed', 'source_verified']);
const hasText = x => typeof x === 'string' && x.trim().length > 0;
const digest = x => createHash('sha256').update(x).digest('hex');
// The review must bind to the *exact* C03 extraction records, not just JD text.
// Re-parsing or changing strength/spans after review invalidates the decision.
export const fingerprintRequirements = requirements => digest(JSON.stringify(requirements));
const fail = code => ({ status: 'needs_review', reason_codes: [code], input: null,
  advisory_only: true, application_action: 'none' });

function validSpan(jdText, span) {
  if (!span || !Number.isSafeInteger(span.offset_start) || !Number.isSafeInteger(span.offset_end)
    || span.offset_start < 0 || span.offset_end <= span.offset_start
    || span.offset_end > jdText.length || !hasText(span.text)
    || jdText.slice(span.offset_start, span.offset_end) !== span.text
    || span.text.includes('\n') || span.text.includes('\r')) return false;
  // C03 uses 1-based UTF-16 line/column and 0-based UTF-16 offsets.
  const prefix = jdText.slice(0, span.offset_start);
  const line = prefix.split('\n').length;
  const column = prefix.length - prefix.lastIndexOf('\n');
  return span.line === line && span.column_start === column
    && span.column_end === column + span.text.length;
}

function validOccurrences(jdText, item) {
  if (!Array.isArray(item.occurrences) || item.occurrences.length === 0
    || !hasText(item.requirement) || !validSpan(jdText, item.source_span)) return false;
  const first = item.occurrences[0]?.source_span;
  if (JSON.stringify(first) !== JSON.stringify(item.source_span)
    || first.text !== item.requirement) return false;
  return item.occurrences.every(occurrence => {
    const source = occurrence?.source_span;
    const full = occurrence?.requirement_span;
    // C03 requirement_span is the complete scanned line through its last
    // non-whitespace character. A shortened suffix could conceal context
    // while preserving a seemingly valid source token and source offset.
    // C03 may strip a list marker before recording the requirement span,
    // but it must not omit substantive leading text (especially a negation).
    const lineStart = jdText.lastIndexOf('\n', (full?.offset_start ?? 0) - 1) + 1;
    const leading = jdText.slice(lineStart, full?.offset_start ?? 0);
    if (!/^[ \t]*(?:(?:[-*+•>]|[0-9]+[.)])[ \t]+)?[ \t]*$/u.test(leading)) return false;
    const lineEnd = jdText.indexOf('\n', full?.offset_end ?? 0);
    const rawEnd = lineEnd < 0 ? jdText.length : lineEnd;
    const expectedEnd = rawEnd - (jdText.slice(full?.offset_end ?? rawEnd, rawEnd).match(/[\s]*$/u)?.[0].length ?? 0);
    return validSpan(jdText, source) && validSpan(jdText, full)
      && full.offset_end === expectedEnd
      && source.offset_start >= full.offset_start && source.offset_end <= full.offset_end;
  });
}

function normalizeFact(fact, candidateId) {
  if (!fact || !hasText(fact.id) || fact.candidate_id !== candidateId
    || !FIELDS.has(fact.field) || typeof fact.value !== 'boolean'
    || !hasText(fact.jurisdiction) || !PERIODS.has(fact.period)
    || !CANDIDATE_STATUSES.has(fact.status)
    || !CANDIDATE_SOURCES.has(fact.provenance?.source_type)
    || !hasText(fact.provenance?.source_id)) return null;
  return { id: fact.id, candidate_id: candidateId, field: fact.field, value: fact.value,
    jurisdiction: fact.jurisdiction, period: fact.period, status: fact.status,
    provenance: { source_type: fact.provenance.source_type, source_id: fact.provenance.source_id } };
}

/**
 * review: { source_sha256, requirements_sha256, complete: true, decisions: [
 *   { requirement_id, review_status: 'explicit', relevant: false } OR
 *   { requirement_id, review_status: 'explicit', relevant: true,
 *     field, required_value, mandatory, jurisdiction, period }
 * ] }
 * No keyword/visa/location parser can supply these human-reviewed decisions.
 * C03 requirements are all reviewed, including explicit non-eligibility ones;
 * incomplete coverage fails closed instead of silently excluding conditions.
 */
function prepareUnchecked({ jdText, extraction, review, candidate } = {}) {
  if (typeof jdText !== 'string' || !jdText.length || !extraction ||
    extraction.schema_version !== 1 || extraction.span_units !== C03_SPAN_UNITS ||
    extraction.source_type !== 'job_description' || extraction.candidate_evidence !== false ||
    extraction.extraction_status !== 'ok' || !Array.isArray(extraction.requirements) ||
    !hasText(extraction.source_sha256) || extraction.source_sha256 !== digest(jdText)) {
    return fail('jd_snapshot_unverified');
  }
  if (!review || review.complete !== true || review.source_sha256 !== extraction.source_sha256 ||
    !Array.isArray(review.decisions)) return fail('eligibility_review_incomplete');
  if (review.requirements_sha256 !== fingerprintRequirements(extraction.requirements)) {
    return fail('eligibility_review_snapshot_mismatch');
  }

  const records = extraction.requirements;
  const recordIds = new Set();
  for (const item of records) {
    if (!item || !hasText(item.id) || recordIds.has(item.id) ||
      item.provenance !== 'job_description' || item.candidate_evidence !== false ||
      !validOccurrences(jdText, item)) return fail('jd_record_unverified');
    recordIds.add(item.id);
  }
  const decisions = new Map();
  for (const decision of review.decisions) {
    if (!decision || !hasText(decision.requirement_id) ||
      decisions.has(decision.requirement_id) || !recordIds.has(decision.requirement_id) ||
      decision.review_status !== 'explicit' || typeof decision.relevant !== 'boolean') {
      return fail('eligibility_review_incomplete');
    }
    decisions.set(decision.requirement_id, decision);
  }
  if (decisions.size !== recordIds.size) return fail('eligibility_review_incomplete');

  const requirements = [];
  for (const item of records) {
    const decision = decisions.get(item.id);
    if (!decision.relevant) continue;
    if (!FIELDS.has(decision.field) || typeof decision.required_value !== 'boolean'
      || typeof decision.mandatory !== 'boolean' || !hasText(decision.jurisdiction)
      || !PERIODS.has(decision.period)) return fail('eligibility_review_incomplete');
    // Negated or unknown employer meaning cannot be normalized into a
    // positive eligibility test, even when the reviewer calls it optional.
    if (item.polarity !== 'positive' || !['required', 'preferred'].includes(item.kind)) {
      return fail('requirement_meaning_unverified');
    }
    // A preferred employer condition can never become a mandatory exclusion.
    if (decision.mandatory && item.kind !== 'required') {
      return fail('mandatory_strength_unverified');
    }
    requirements.push({ id: item.id, field: decision.field,
      required_value: decision.required_value, mandatory: decision.mandatory,
      jurisdiction: decision.jurisdiction, period: decision.period,
      review_status: 'explicit', candidate_evidence: false,
      provenance: { source_type: 'job_description', source_id: extraction.source_sha256 } });
  }
  if (!requirements.length) return fail('no_reviewed_eligibility_requirement');
  // Conflicting reviewed employer conditions in the same scope cannot justify
  // automatic exclusion. Require a new human review instead of picking one.
  const expectedByScope = new Map();
  for (const requirement of requirements) {
    const key = JSON.stringify([requirement.field, requirement.jurisdiction, requirement.period]);
    if (expectedByScope.has(key) && expectedByScope.get(key) !== requirement.required_value) {
      return fail('conflicting_employer_requirements');
    }
    expectedByScope.set(key, requirement.required_value);
  }
  if (!candidate || !hasText(candidate.candidate_id) || !Array.isArray(candidate.facts)) {
    return fail('candidate_declarations_missing');
  }
  const facts = candidate.facts.map(fact => normalizeFact(fact, candidate.candidate_id));
  if (facts.includes(null)) return fail('candidate_declaration_unverified');
  // Duplicate identifiers make provenance ambiguous even if values match.
  if (new Set(facts.map(fact => fact.id)).size !== facts.length) {
    return fail('candidate_declaration_duplicate');
  }
  return { status: 'ready', reason_codes: [], input: {
    requirements, candidate: { candidate_id: candidate.candidate_id, facts } },
  advisory_only: true, application_action: 'none' };
}


/** Untrusted review/extraction objects must fail closed even if malformed or cyclic. */
export function prepareReviewedEligibilityInput(args = {}) {
  try {
    return prepareUnchecked(args);
  } catch {
    // Do not echo untrusted employer or private candidate data in exceptions.
    return fail('malformed_review_input');
  }
}
