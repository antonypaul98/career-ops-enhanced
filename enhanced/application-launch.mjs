/**
 * Candidate-controlled application start.
 *
 * This is the narrow bridge between the fully reviewed C12/Candidate handoff
 * and the candidate's ordinary browser. It can authorize opening one exact
 * HTTPS URL. It cannot fill a form, advance a form step, submit, write a
 * tracker status, or manufacture lifecycle evidence.
 */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { prepareCandidateSubmissionHandoff } from './candidate-submission-handoff.mjs';

export const START_CONFIRMATION_STATEMENT =
  'I approve opening this exact application URL in my ordinary browser. I will review and submit it myself.';

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];
const digest = value => createHash('sha256').update(String(value)).digest('hex');

function blocked(reason) {
  return {
    schema_version: 1,
    decision: 'blocked',
    reason,
    application_action: 'none',
    browser_actions: 0,
    tracker_mutation: false,
    career_ops_submit_allowed: false,
  };
}

export function validateApplicationLaunchUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    return { valid: false, reason: 'invalid_application_url' };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { valid: false, reason: 'invalid_application_url' };
  }
  if (parsed.protocol !== 'https:') return { valid: false, reason: 'application_url_must_use_https' };
  if (parsed.username || parsed.password) return { valid: false, reason: 'application_url_credentials_forbidden' };
  const host = parsed.hostname.toLocaleLowerCase('en-US').replace(/\.$/, '');
  if (!host || host === 'localhost' || BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix)) || isIP(host)) {
    return { valid: false, reason: 'application_url_host_not_public' };
  }
  return { valid: true, url: value, hostname: host, url_digest: digest(value) };
}

export function createApplicationStartConfirmation(handoff, confirmation = {}) {
  if (handoff?.decision !== 'candidate_action_required') throw new Error('candidate handoff must be ready');
  const checkedUrl = validateApplicationLaunchUrl(handoff.application?.url);
  if (!checkedUrl.valid) throw new Error(`cannot confirm start: ${checkedUrl.reason}`);
  if (confirmation.confirmed !== true) throw new Error('explicit candidate start confirmation is required');
  if (confirmation.statement !== START_CONFIRMATION_STATEMENT) {
    throw new Error('exact application-start confirmation statement is required');
  }
  const confirmedAt = String(confirmation.confirmed_at ?? '').trim();
  if (!confirmedAt || Number.isNaN(Date.parse(confirmedAt))) throw new Error('confirmed_at must be a valid timestamp');
  return {
    schema_version: 1,
    application_key: handoff.application.key,
    content_digest: handoff.approved_content_digest,
    url_digest: checkedUrl.url_digest,
    confirmed_by: 'candidate',
    confirmed_at: confirmedAt,
    statement: START_CONFIRMATION_STATEMENT,
    scope: 'open_exact_url_only',
    submit_allowed: false,
  };
}

function validStartConfirmation(confirmation, handoff, urlDigest) {
  return confirmation?.schema_version === 1
    && confirmation.application_key === handoff.application.key
    && confirmation.content_digest === handoff.approved_content_digest
    && confirmation.url_digest === urlDigest
    && confirmation.confirmed_by === 'candidate'
    && confirmation.statement === START_CONFIRMATION_STATEMENT
    && confirmation.scope === 'open_exact_url_only'
    && confirmation.submit_allowed === false
    && typeof confirmation.confirmed_at === 'string'
    && !Number.isNaN(Date.parse(confirmation.confirmed_at));
}

export function prepareCandidateApplicationStart({ readiness_input, approval, start_confirmation } = {}) {
  const handoff = prepareCandidateSubmissionHandoff({ readiness_input, approval });
  if (handoff.decision !== 'candidate_action_required') return blocked(`handoff:${handoff.reason}`);

  const checkedUrl = validateApplicationLaunchUrl(handoff.application.url);
  if (!checkedUrl.valid) return blocked(checkedUrl.reason);

  if (!start_confirmation) {
    return {
      schema_version: 1,
      decision: 'needs_candidate_start_confirmation',
      application: { ...handoff.application },
      approved_content_digest: handoff.approved_content_digest,
      url_digest: checkedUrl.url_digest,
      required_statement: START_CONFIRMATION_STATEMENT,
      application_action: 'none',
      browser_actions: 0,
      tracker_mutation: false,
      career_ops_submit_allowed: false,
    };
  }
  if (!validStartConfirmation(start_confirmation, handoff, checkedUrl.url_digest)) {
    return blocked('start_confirmation_invalid_or_stale');
  }

  const resumeToken = digest([
    handoff.application.key,
    handoff.approved_content_digest,
    checkedUrl.url_digest,
  ].join('\n'));
  return {
    schema_version: 1,
    decision: 'ready_to_open',
    application: { ...handoff.application },
    launch_url: checkedUrl.url,
    approved_content_digest: handoff.approved_content_digest,
    reviewed_fields: handoff.reviewed_fields.map(field => ({ ...field })),
    reviewed_artifacts: handoff.reviewed_artifacts.map(artifact => ({ ...artifact })),
    resume: {
      token: resumeToken,
      state: 'ready_to_open',
      pause_points: ['login', 'mfa', 'captcha', 'new_or_changed_fields', 'final_submit'],
      instruction: 'Resume with this same package after the candidate completes the blocking browser step. Re-run all gates if any reviewed content, artifact, job identity, or URL changes.',
    },
    boundaries: {
      executor: 'candidate',
      allowed_action: 'open_exact_url',
      form_fill_allowed: false,
      continue_or_next_allowed: false,
      career_ops_submit_allowed: false,
      applied_status_authorized: false,
      actual_receipt_required: true,
      tracker_mutation: false,
    },
  };
}

export function requestCandidateBrowserOpen(plan, openUrl) {
  if (plan?.decision !== 'ready_to_open' || typeof openUrl !== 'function') {
    return blocked('ready_launch_plan_and_opener_required');
  }
  let opened = false;
  try {
    opened = openUrl(plan.launch_url) === true;
  } catch {
    opened = false;
  }
  return {
    schema_version: 1,
    decision: opened ? 'browser_open_requested' : 'browser_open_failed',
    application_key: plan.application.key,
    approved_content_digest: plan.approved_content_digest,
    resume_token: plan.resume.token,
    resume_state: opened ? 'candidate_browser' : 'ready_to_open',
    application_action: opened ? 'open_exact_url' : 'none',
    browser_actions: opened ? 1 : 0,
    form_fill_actions: 0,
    submit_actions: 0,
    tracker_mutation: false,
    applied_status_authorized: false,
    actual_receipt_required: true,
    career_ops_submit_allowed: false,
  };
}
