/**
 * Privacy-safe application-readiness orchestration.
 *
 * This module binds one application identity across opportunity scoring,
 * requirement-fit review, job-quality receipts, and the exact application
 * bundle. It returns review states only and never writes evidence, fills a
 * form, opens a browser, performs a network request, or submits anything.
 */
import { scoreOpportunity } from './opportunity-score.mjs';
import { evaluateMatchQuestionnaire } from './match-questionnaire.mjs';
import { verifyApplicationBundle } from './application-approval.mjs';

const JOB_GATE_RULES = Object.freeze({
  liveness: { pass: 'live', allowed: new Set(['live', 'unverified', 'dead']) },
  dedup: { pass: 'unique', allowed: new Set(['unique', 'unverified', 'duplicate']) },
  legitimacy: { pass: 'verified', allowed: new Set(['verified', 'review', 'suspicious']) },
});

const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');

function requiredString(value, name) {
  const result = clean(value);
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function normalizeJobGates(input = {}) {
  return Object.fromEntries(Object.entries(JOB_GATE_RULES).map(([name, rule]) => {
    const gate = input[name];
    if (!gate || typeof gate !== 'object') throw new Error(`job_gates.${name} is required`);
    const status = clean(gate.status).toLocaleLowerCase('en-US');
    if (!rule.allowed.has(status)) throw new Error(`job_gates.${name}.status is invalid`);
    const source = requiredString(gate.source, `job_gates.${name}.source`);
    const checkedAt = requiredString(gate.checked_at, `job_gates.${name}.checked_at`);
    if (Number.isNaN(Date.parse(checkedAt))) throw new Error(`job_gates.${name}.checked_at must be a timestamp`);
    return [name, { status, source, checked_at: checkedAt, passed: status === rule.pass }];
  }));
}

function jobGateFailures(gates) {
  return Object.entries(gates)
    .filter(([, gate]) => !gate.passed)
    .map(([gate, value]) => ({ gate, status: value.status }));
}

/**
 * Produce a non-mutating application-readiness decision.
 *
 * `opportunity.application_key` and `match.application_key` are mandatory
 * identity leases. They prevent a good score or candidate answer set for one
 * role from authorizing a different role's bundle.
 */
export function prepareApplicationReadiness(input = {}) {
  const applicationKey = requiredString(input.application_key, 'application_key');
  if (requiredString(input.opportunity?.application_key, 'opportunity.application_key') !== applicationKey) {
    throw new Error('opportunity application identity mismatch');
  }
  if (requiredString(input.match?.application_key, 'match.application_key') !== applicationKey) {
    throw new Error('match application identity mismatch');
  }

  const jobGates = normalizeJobGates(input.job_gates);
  const opportunity = scoreOpportunity(input.opportunity);
  const match = evaluateMatchQuestionnaire(input.match);
  const failedJobGates = jobGateFailures(jobGates);
  const bundleSupplied = input.application_bundle !== undefined && input.application_bundle !== null;
  const bundleVerification = bundleSupplied
    ? verifyApplicationBundle(input.application_bundle)
    : { valid: false, reason: 'bundle_not_provided' };
  const bundleApplicationKey = bundleSupplied ? clean(input.application_bundle?.application?.key) : '';

  let decision;
  let reason;
  let nextStep;
  if (failedJobGates.length) {
    decision = 'blocked_job_gate';
    reason = failedJobGates.map(item => `${item.gate}:${item.status}`).join(',');
    nextStep = 'Resolve liveness, deduplication, and posting-legitimacy review before application preparation.';
  } else if (match.questionnaire.questions.length) {
    decision = 'needs_candidate_evidence';
    reason = 'targeted_questions_pending';
    nextStep = 'Ask only the proposed short questions and retain only candidate-confirmed, provenance-backed answers.';
  } else if (match.application_readiness !== 'priority_application_ready') {
    decision = 'review_queue';
    reason = match.unresolved_gaps.length ? 'verified_fit_or_mandatory_gaps' : 'eligibility_not_verified';
    nextStep = 'Keep this opportunity in review unless the candidate explicitly chooses an exception.';
  } else if (!bundleSupplied) {
    decision = 'needs_exact_application_bundle';
    reason = 'bundle_not_provided';
    nextStep = 'Build the exact C12 bundle from candidate-authorized fields and attachment digests.';
  } else if (!bundleVerification.valid) {
    decision = 'blocked_invalid_bundle';
    reason = bundleVerification.reason;
    nextStep = 'Repair and reseal the exact application bundle before requesting content approval.';
  } else if (bundleApplicationKey !== applicationKey) {
    decision = 'blocked_application_mismatch';
    reason = 'bundle_application_identity_mismatch';
    nextStep = 'Create a bundle for this exact application; approvals and evidence cannot cross applications.';
  } else {
    decision = 'ready_for_exact_content_review';
    reason = 'all_readiness_gates_passed';
    nextStep = 'Show the complete sealed content to the candidate and obtain the separate exact C12 approval.';
  }

  return {
    schema_version: 1,
    application_key: applicationKey,
    decision,
    reason,
    next_step: nextStep,
    job_gates: jobGates,
    failed_job_gates: failedJobGates,
    opportunity_score: {
      score: opportunity.score,
      scale: opportunity.scale,
      confidence: opportunity.confidence,
      confidence_gaps: opportunity.confidence_gaps,
    },
    verified_match: {
      before: match.before.verified_fit,
      after: match.after.verified_fit,
      scale: 'percent',
      unresolved_gaps: match.unresolved_gaps,
      mandatory_eligibility: match.mandatory_eligibility,
      questionnaire: match.questionnaire,
      evidence_vault_proposals: match.evidence_vault_proposals,
    },
    exact_bundle: {
      supplied: bundleSupplied,
      valid: bundleVerification.valid === true,
      reason: bundleVerification.valid ? null : bundleVerification.reason,
      content_digest: bundleVerification.valid ? bundleVerification.content_digest : null,
      application_key_matches: bundleSupplied ? bundleApplicationKey === applicationKey : null,
      content_echoed: false,
    },
    safety: {
      opportunity_score_converted_to_fit_percent: false,
      jd_or_job_gate_used_as_candidate_evidence: false,
      automatic_evidence_write: false,
      exact_content_approval_granted: false,
      application_action: 'none',
      network_requests: 0,
      browser_actions: 0,
      files_written: 0,
      submit_allowed: false,
    },
  };
}

