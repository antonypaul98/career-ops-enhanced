/**
 * Candidate-controlled application submission handoff.
 *
 * Re-evaluates the complete application-readiness input and exact C12 mock
 * approval before exposing the reviewed values the candidate may use in their
 * ordinary browser. This module has no filesystem, browser, HTTP, tracker, or
 * submission capability. Its output is private candidate-facing content, not
 * evidence that an application was submitted.
 */

import { mockExecuteApplication } from './application-approval.mjs';
import { prepareApplicationReadiness } from './application-readiness.mjs';

function blocked(reason, readiness = null) {
  return {
    schema_version: 1,
    decision: 'blocked',
    reason,
    readiness_decision: readiness?.decision ?? null,
    application_action: 'none',
    network_requests: 0,
    browser_actions: 0,
    files_written: 0,
    tracker_mutation: false,
    career_ops_submit_allowed: false,
  };
}

/**
 * Prepare an exact, candidate-controlled handoff without performing an action.
 *
 * `readiness_input` is the same explicit input accepted by
 * `prepareApplicationReadiness`. The gate is intentionally rerun here so a
 * stale caller-provided decision cannot bypass job, fit, eligibility, identity,
 * or bundle checks.
 */
export function prepareCandidateSubmissionHandoff({ readiness_input: input, approval } = {}) {
  let readiness;
  try {
    readiness = prepareApplicationReadiness(input);
  } catch {
    return blocked('invalid_readiness_input');
  }

  if (readiness.decision !== 'ready_for_exact_content_review') {
    return blocked(`readiness:${readiness.decision}`, readiness);
  }

  const bundle = input.application_bundle;
  const mock = mockExecuteApplication(bundle, approval);
  if (mock.decision !== 'mock_ready') return blocked(`approval:${mock.reason}`, readiness);

  return {
    schema_version: 1,
    decision: 'candidate_action_required',
    application: { ...bundle.application },
    approved_content_digest: mock.approved_content_digest,
    reviewed_fields: mock.would_fill.map(field => ({ ...field })),
    reviewed_artifacts: mock.would_attach.map(artifact => ({ ...artifact })),
    candidate_steps: [
      'Open the exact application URL in an ordinary browser.',
      'Enter only the reviewed field values and attach only the reviewed artifact bytes.',
      'Review the rendered form, account profile, disclosures, and attachments.',
      'The candidate alone decides whether to press Submit.',
      'If submitted, preserve the actual portal success page or employer acknowledgement.',
      'Use that actual receipt in the reviewed C13 lifecycle flow before marking the tracker Applied.',
    ],
    boundaries: {
      executor: 'candidate',
      application_action: 'none',
      network_requests: 0,
      browser_actions: 0,
      files_written: 0,
      tracker_mutation: false,
      career_ops_submit_allowed: false,
      applied_status_authorized: false,
      actual_receipt_required: true,
      lifecycle_evidence_created: false,
    },
  };
}
