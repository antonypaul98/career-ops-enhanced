/**
 * Approval-triggered application submission safety kernel.
 *
 * This module is deliberately browser-adapter agnostic. It re-runs all existing
 * readiness and exact-content gates, binds a candidate's final approval to the
 * observed final-review form, permits one injected submit action, then requires
 * independently observed receipt evidence before it can authorize Applied.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from './application-approval.mjs';
import { prepareCandidateApplicationStart, validateApplicationLaunchUrl } from './application-launch.mjs';
import { createLifecycleEvent } from './application-lifecycle.mjs';

export const SUBMIT_CONFIRMATION_STATEMENT =
  'I approve submitting this exact application, with this exact URL, fields, and artifacts, one time.';

const SHA256 = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
const receiptKinds = new Set(['ats_success_page', 'employer_acknowledgement']);

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function timestamp(value, name, now = Date.now()) {
  const text = requiredText(value, name);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(text)
    || !Number.isFinite(Date.parse(text)) || Date.parse(text) > now) {
    throw new Error(`${name} must be a valid non-future UTC timestamp`);
  }
  return new Date(text).toISOString();
}

function blocked(reason, resumeToken = null) {
  return { schema_version: 1, decision: 'blocked', reason, resume_token: resumeToken,
    consequential_actions: 0, tracker_mutation: false, applied_status_authorized: false };
}

function paused(reason, resumeToken) {
  return { schema_version: 1, decision: 'paused', reason, resume_token: resumeToken,
    consequential_actions: 0, tracker_mutation: false, applied_status_authorized: false };
}

function packageSeal(start) {
  const reviewedFields = start.reviewed_fields.map(({ key, label, value }) => ({ key, label, value }));
  const reviewedArtifacts = start.reviewed_artifacts.map(({ kind, sha256 }) => ({ kind, sha256 }));
  return {
    application_key: start.application.key,
    content_digest: start.approved_content_digest,
    url_digest: hash(start.launch_url),
    fields_digest: hash(reviewedFields),
    artifacts_digest: hash(reviewedArtifacts),
    reviewed_fields: reviewedFields,
    reviewed_artifacts: reviewedArtifacts,
  };
}

function normalizeObservation(observation = {}) {
  return {
    application_key: observation.application_key,
    current_url: observation.current_url,
    rendered_fields: Array.isArray(observation.rendered_fields)
      ? observation.rendered_fields.map(({ key, label, value }) => ({ key, label, value })) : [],
    attached_artifacts: Array.isArray(observation.attached_artifacts)
      ? observation.attached_artifacts.map(({ kind, sha256 }) => ({ kind, sha256 })) : [],
    unexpected_fields: Array.isArray(observation.unexpected_fields) ? [...observation.unexpected_fields] : [],
    observed_at: observation.observed_at,
    login_required: observation.login_required === true,
    mfa_required: observation.mfa_required === true,
    captcha_required: observation.captcha_required === true,
    final_review: observation.final_review === true,
  };
}

function checkObservation(start, observation) {
  const seal = packageSeal(start);
  const observed = normalizeObservation(observation);
  if (typeof observed.observed_at !== 'string' || !Number.isFinite(Date.parse(observed.observed_at))) {
    return blocked('observation_timestamp_invalid', start.resume.token);
  }
  if (observed.login_required) return paused('login_required', start.resume.token);
  if (observed.mfa_required) return paused('mfa_required', start.resume.token);
  if (observed.captcha_required) return paused('captcha_required', start.resume.token);
  if (observed.unexpected_fields.length) return paused('new_or_changed_fields', start.resume.token);
  if (!observed.final_review) return paused('final_review_required', start.resume.token);
  const checkedUrl = validateApplicationLaunchUrl(observed.current_url);
  if (!checkedUrl.valid || checkedUrl.url_digest !== seal.url_digest) return blocked('observed_url_changed', start.resume.token);
  if (observed.application_key !== seal.application_key) return blocked('observed_application_changed', start.resume.token);
  if (hash(observed.rendered_fields) !== seal.fields_digest) return blocked('observed_fields_changed', start.resume.token);
  if (hash(observed.attached_artifacts) !== seal.artifacts_digest) return blocked('observed_artifacts_changed', start.resume.token);
  return { decision: 'exact_final_review', seal, observed,
    observation_digest: hash(observed), resume_token: start.resume.token };
}

/** Create the final consequential-action approval, bound to the exact observed form. */
export function createExactSubmissionApproval({ readiness_input, approval, start_confirmation, observation, confirmation } = {},
  { now = Date.now() } = {}) {
  const start = prepareCandidateApplicationStart({ readiness_input, approval, start_confirmation });
  if (start.decision !== 'ready_to_open') throw new Error(`application start is not ready: ${start.reason ?? start.decision}`);
  const checked = checkObservation(start, observation);
  if (checked.decision !== 'exact_final_review') throw new Error(`final review is not exact: ${checked.reason}`);
  if (confirmation?.confirmed !== true || confirmation.statement !== SUBMIT_CONFIRMATION_STATEMENT) {
    throw new Error('explicit application-specific submit confirmation is required');
  }
  const approvedAt = timestamp(confirmation.approved_at, 'approved_at', now);
  if (Date.parse(approvedAt) < Date.parse(checked.observed.observed_at)) {
    throw new Error('submit approval predates the observed final review');
  }
  const core = {
    schema_version: 1,
    application_key: checked.seal.application_key,
    content_digest: checked.seal.content_digest,
    url_digest: checked.seal.url_digest,
    fields_digest: checked.seal.fields_digest,
    artifacts_digest: checked.seal.artifacts_digest,
    observation_digest: checked.observation_digest,
    resume_token: checked.resume_token,
    approved_by: 'candidate',
    approved_at: approvedAt,
    statement: SUBMIT_CONFIRMATION_STATEMENT,
    scope: 'submit_exact_application_once',
    max_consequential_actions: 1,
  };
  return { ...core, approval_digest: hash(core) };
}

function validSubmissionApproval(submitApproval, checked) {
  if (!submitApproval || submitApproval.schema_version !== 1) return false;
  const { approval_digest: claimed, ...core } = submitApproval;
  return SHA256.test(claimed ?? '') && hash(core) === claimed
    && submitApproval.application_key === checked.seal.application_key
    && submitApproval.content_digest === checked.seal.content_digest
    && submitApproval.url_digest === checked.seal.url_digest
    && submitApproval.fields_digest === checked.seal.fields_digest
    && submitApproval.artifacts_digest === checked.seal.artifacts_digest
    && submitApproval.observation_digest === checked.observation_digest
    && submitApproval.resume_token === checked.resume_token
    && submitApproval.approved_by === 'candidate'
    && submitApproval.statement === SUBMIT_CONFIRMATION_STATEMENT
    && submitApproval.scope === 'submit_exact_application_once'
    && submitApproval.max_consequential_actions === 1
    && typeof submitApproval.approved_at === 'string'
    && Number.isFinite(Date.parse(submitApproval.approved_at));
}

/** Re-check every gate and the current browser observation immediately before submit. */
export function prepareApprovedSubmission({ readiness_input, approval, start_confirmation,
  submit_approval: submitApproval, observation } = {}) {
  const start = prepareCandidateApplicationStart({ readiness_input, approval, start_confirmation });
  if (start.decision !== 'ready_to_open') return blocked(`start:${start.reason ?? start.decision}`);
  const checked = checkObservation(start, observation);
  if (checked.decision !== 'exact_final_review') return checked;
  if (!validSubmissionApproval(submitApproval, checked)) return blocked('submit_approval_invalid_or_stale', checked.resume_token);
  const executionCore = {
    application_key: checked.seal.application_key,
    content_digest: checked.seal.content_digest,
    url_digest: checked.seal.url_digest,
    fields_digest: checked.seal.fields_digest,
    artifacts_digest: checked.seal.artifacts_digest,
    observation_digest: checked.observation_digest,
    submit_approval_digest: submitApproval.approval_digest,
    resume_token: checked.resume_token,
  };
  return { schema_version: 1, decision: 'ready_to_submit_once', ...executionCore,
    execution_digest: hash(executionCore), allowed_action: 'submit_exact_approved_form',
    max_consequential_actions: 1, tracker_mutation: false, applied_status_authorized: false };
}

/** Invoke exactly one injected browser submit action. A click is never a receipt. */
export async function executeApprovedSubmission(plan, submitExactApprovedForm) {
  if (plan?.decision !== 'ready_to_submit_once' || typeof submitExactApprovedForm !== 'function') {
    return blocked('ready_submission_plan_and_executor_required', plan?.resume_token ?? null);
  }
  let result;
  try {
    result = await submitExactApprovedForm(Object.freeze({
      action: plan.allowed_action,
      application_key: plan.application_key,
      execution_digest: plan.execution_digest,
      submit_approval_digest: plan.submit_approval_digest,
      resume_token: plan.resume_token,
    }));
  } catch {
    return { ...paused('submit_action_failed', plan.resume_token), submission_attempted: true,
      consequential_actions: 1 };
  }
  if (result?.action !== 'submit_exact_approved_form' || result?.execution_digest !== plan.execution_digest
    || result?.submitted !== true) {
    return { ...paused('submit_not_confirmed_by_browser_adapter', plan.resume_token), submission_attempted: true,
      consequential_actions: 1 };
  }
  let submittedAt;
  try {
    submittedAt = timestamp(result.submitted_at, 'submitted_at');
  } catch {
    return { ...paused('submit_timestamp_invalid', plan.resume_token), submission_attempted: true,
      consequential_actions: 1 };
  }
  return { schema_version: 1, decision: 'submitted_awaiting_verified_receipt',
    application_key: plan.application_key, content_digest: plan.content_digest,
    url_digest: plan.url_digest, execution_digest: plan.execution_digest,
    submit_approval_digest: plan.submit_approval_digest, resume_token: plan.resume_token,
    submitted_at: submittedAt, consequential_actions: 1, tracker_mutation: false,
    applied_status_authorized: false, actual_receipt_required: true };
}

/**
 * Bridge verified evidence into the existing C13 canonical lifecycle writer.
 * This creates only an unconfirmed draft; the lifecycle module still requires
 * exact candidate confirmation and re-checks the actual private source bytes.
 */
export function createAppliedLifecycleDraftFromReceipt({ verified, bundle, tracker_row } = {}, options = {}) {
  if (verified?.decision !== 'verified_receipt') throw new Error('verified receipt is required');
  if (bundle?.application?.key !== verified.receipt.application_key
    || bundle?.content_digest !== verified.receipt.content_digest) {
    throw new Error('receipt does not belong to the exact application bundle');
  }
  return createLifecycleEvent({ bundle, tracker_row, status: 'Applied',
    observed_at: verified.receipt.observed_at,
    evidence: { origin: 'observed_actual',
      kind: verified.receipt.kind === 'employer_acknowledgement'
        ? 'employer_acknowledgement' : 'submission_receipt',
      source: verified.receipt.source, sha256: verified.receipt.sha256,
      reference: verified.receipt.reference, quote: verified.receipt.quote } }, options);
}

/** Verify concrete post-submit evidence and mint a single-use Applied authorization. */
export function verifySubmissionReceipt(execution, receipt = {}, { now = Date.now() } = {}) {
  if (execution?.decision !== 'submitted_awaiting_verified_receipt') {
    return blocked('completed_submission_required', execution?.resume_token ?? null);
  }
  try {
    if (!receiptKinds.has(receipt.kind) || receipt.origin !== 'observed_actual') throw new Error('receipt_kind_invalid');
    if (receipt.application_key !== execution.application_key || receipt.content_digest !== execution.content_digest
      || receipt.execution_digest !== execution.execution_digest) throw new Error('receipt_application_mismatch');
    const observedAt = timestamp(receipt.observed_at, 'receipt.observed_at', now);
    if (!Number.isFinite(Date.parse(execution.submitted_at)) || Date.parse(observedAt) < Date.parse(execution.submitted_at)) {
      throw new Error('receipt_predates_submission');
    }
    const source = requiredText(receipt.source, 'receipt.source');
    const reference = requiredText(receipt.reference, 'receipt.reference');
    const quote = requiredText(receipt.quote, 'receipt.quote');
    if (!SHA256.test(receipt.sha256 ?? '')) throw new Error('receipt_sha256_invalid');
    const receiptCore = { schema_version: 1, kind: receipt.kind, origin: 'observed_actual',
      application_key: execution.application_key, content_digest: execution.content_digest,
      execution_digest: execution.execution_digest, observed_at: observedAt,
      source, sha256: receipt.sha256, reference, quote };
    const receiptDigest = hash(receiptCore);
    const authorizationCore = { schema_version: 1, application_key: execution.application_key,
      content_digest: execution.content_digest, execution_digest: execution.execution_digest,
      receipt_digest: receiptDigest, scope: 'record_applied_once', max_tracker_mutations: 1 };
    return { schema_version: 1, decision: 'verified_receipt', receipt: { ...receiptCore, receipt_digest: receiptDigest },
      applied_authorization: { ...authorizationCore, authorization_digest: hash(authorizationCore) },
      applied_status_authorized: true, tracker_mutation: false };
  } catch (error) {
    return blocked(error.message, execution.resume_token);
  }
}

/** Call the canonical lifecycle adapter at most once for this receipt authorization. */
export async function recordAppliedExactlyOnce(verified, store = {}) {
  const auth = verified?.applied_authorization;
  if (verified?.decision !== 'verified_receipt' || !SHA256.test(auth?.authorization_digest ?? '')
    || typeof store.has !== 'function' || typeof store.record !== 'function') {
    return blocked('verified_receipt_and_idempotent_store_required');
  }
  if (await store.has(auth.authorization_digest)) {
    return { schema_version: 1, decision: 'already_recorded', authorization_digest: auth.authorization_digest,
      tracker_mutations: 0, applied_status_authorized: true };
  }
  await store.record(Object.freeze({ authorization: auth, receipt: verified.receipt }));
  return { schema_version: 1, decision: 'applied_recorded', authorization_digest: auth.authorization_digest,
    tracker_mutations: 1, applied_status_authorized: true };
}
