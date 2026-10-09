/**
 * C07 foundation: advisory comparison of explicit, reviewed declarations only.
 * No file/network access, profile discovery, legal interpretation or actions.
 * The caller must review requirement meaning and candidate evidence first;
 * a status label is not independent verification of the underlying statement.
 */
import { createHash } from 'node:crypto';
import { ENTRY_STATUSES, usableEvidenceEntries } from './evidence-vault.mjs';

const FIELDS = new Set(['work_authorized', 'needs_sponsorship']);
const PERIODS = new Set(['current', 'future']);
const SOURCES = new Set(['candidate_statement', 'candidate_document']);
const text = value => typeof value === 'string' && value.trim().length > 0;
const ref = value => text(value) ? createHash('sha256').update(value).digest('hex') : null;

function requirementProvenance(requirement) {
  return { source_type: requirement?.provenance?.source_type === 'job_description' ? 'job_description' : 'unsupported',
    source_ref: ref(requirement?.provenance?.source_id),
    record_ref: ref(requirement?.id), candidate_evidence: false,
    review_status: ['explicit', 'needs_review'].includes(requirement?.review_status) ? requirement.review_status : 'unsupported' };
}

function candidateProvenance(fact) {
  return { source_type: SOURCES.has(fact?.provenance?.source_type) ? fact.provenance.source_type : 'unsupported',
    source_ref: ref(fact?.provenance?.source_id), record_ref: ref(fact?.id),
    review_status: ENTRY_STATUSES.has(fact?.status) ? fact.status : 'unsupported' };
}

function validRequirement(requirement) {
  return requirement && text(requirement.id) && FIELDS.has(requirement.field)
    && typeof requirement.required_value === 'boolean' && typeof requirement.mandatory === 'boolean'
    && text(requirement.jurisdiction) && PERIODS.has(requirement.period)
    && requirement.provenance?.source_type === 'job_description'
    && text(requirement.provenance.source_id) && requirement.candidate_evidence === false;
}

function validFact(fact) {
  // Reuse the Vault's accepted review statuses without reading a Vault file.
  return usableEvidenceEntries({ entries: [fact] }).length === 1 && text(fact.id)
    && typeof fact.value === 'boolean' && SOURCES.has(fact.provenance?.source_type)
    && text(fact.provenance.source_id);
}

function inspectRequirement(requirement, index, facts, candidateId) {
  const result = (status, code, evidence = []) => ({ requirement_index: index, status, reason_code: code,
    provenance: { requirement: requirementProvenance(requirement),
      candidate: evidence.map(candidateProvenance).sort((a, b) => {
        const left = JSON.stringify(a), right = JSON.stringify(b);
        return left < right ? -1 : left > right ? 1 : 0;
      }) } });

  if (!validRequirement(requirement)) return result('needs_review', 'unsupported_requirement');
  if (requirement.review_status !== 'explicit') return result('needs_review', 'requirement_not_explicit');
  if (!text(candidateId)) return result('needs_review', 'candidate_scope_missing');

  // Exact jurisdiction AND time period: current authorization says nothing
  // about future sponsorship. No country aliases or residence-based inference.
  const relevant = facts.filter(fact => fact && fact.field === requirement.field
    && fact.jurisdiction === requirement.jurisdiction && fact.period === requirement.period);
  const scoped = relevant.filter(fact => fact.candidate_id === candidateId);
  if (scoped.length === 0) return result('needs_review', 'missing_candidate_fact');
  if (scoped.some(fact => !validFact(fact))) return result('needs_review', 'unsupported_candidate_evidence', scoped);
  if (new Set(scoped.map(fact => fact.value)).size !== 1) return result('needs_review', 'conflicting_candidate_evidence', scoped);
  if (scoped[0].value === requirement.required_value) return result('eligible', 'explicitly_compatible', scoped);
  return requirement.mandatory ? result('ineligible', 'mandatory_explicit_conflict', scoped)
    : result('needs_review', 'non_mandatory_conflict', scoped);
}

/**
 * requirements: [{ id, field, required_value, mandatory, jurisdiction, period,
 *   review_status: 'explicit' | 'needs_review', candidate_evidence: false,
 *   provenance: { source_type: 'job_description', source_id } }]
 * candidate: { candidate_id, facts: [{ id, candidate_id, field, value,
 *   jurisdiction, period, status: 'user_confirmed' | 'source_verified',
 *   provenance: { source_type: 'candidate_statement' | 'candidate_document', source_id } }] }
 * Unknown properties (including location, nationality, CV text) never supply facts.
 * IDs/source references are hashed in output; no quotes, paths or values copied.
 * Results are private advisory eligibility data, never application permission.
 */
export function evaluateEligibility(input = {}) {
  const { requirements, candidate } = input && typeof input === 'object' ? input : {};
  const envelopeValid = Array.isArray(requirements) && Array.isArray(candidate?.facts);
  const checks = Array.isArray(requirements) ? requirements.map((requirement, index) =>
    inspectRequirement(requirement, index, Array.isArray(candidate?.facts) ? candidate.facts : [], candidate?.candidate_id)) : [];
  const reasons = [];
  if (!envelopeValid) reasons.push('invalid_input');
  if (checks.length === 0) reasons.push('no_explicit_requirements');
  // Review dominates even a separate known conflict: do not auto-reject an
  // incomplete or conflicting assessment. Per-requirement diagnostics survive.
  const status = reasons.length || checks.some(check => check.status === 'needs_review') ? 'needs_review'
    : checks.some(check => check.status === 'ineligible') ? 'ineligible' : 'eligible';
  return { schema_version: 1, scope: 'explicit_authorization_and_sponsorship_only', status,
    reason_codes: [...new Set([...reasons, ...checks.map(check => check.reason_code)])], checks,
    advisory_only: true, application_action: 'none' };
}
