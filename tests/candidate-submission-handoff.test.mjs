import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationBundle, createExactApproval } from '../enhanced/application-approval.mjs';
import { createLifecycleEvent } from '../enhanced/application-lifecycle.mjs';
import { prepareCandidateSubmissionHandoff } from '../enhanced/candidate-submission-handoff.mjs';

const KEY = '042-synthetic-acme-data-engineer';
const CHECKED = '2026-10-18T18:00:00Z';

function fixture() {
  const bundle = createApplicationBundle({
    application: { key: KEY, company: 'Synthetic Acme', role: 'Data Engineer', url: 'https://jobs.example.test/42' },
    fields: [{
      key: 'first_name', label: 'First name', value: 'Synthetic',
      source: { type: 'candidate_statement', status: 'user_confirmed', ref: 'synthetic-review', quote: 'My name is Synthetic.' },
    }],
    artifacts: [{ kind: 'resume', path: 'output/synthetic-resume.pdf', sha256: 'a'.repeat(64) }],
  });
  const readiness_input = {
    application_key: KEY,
    opportunity: {
      application_key: KEY,
      dimensions: Object.fromEntries(['cv_match', 'north_star', 'compensation', 'culture', 'red_flags']
        .map(name => [name, { score: 5, evidence: 'supported', explanation: 'Synthetic reviewed evidence' }])),
      jd_keywords: ['Python'], candidate_text: 'Verified Python experience.',
      candidate_evidence: { status: 'verified', source: 'synthetic-profile' },
      detected_archetype: 'Data Engineer', archetype_review_status: 'reviewed',
      profile: { target_roles: { archetypes: [{ name: 'Data Engineer', fit: 'primary' }] } },
    },
    match: {
      application_key: KEY, initial_verified_fit: 100,
      requirements: [{ id: 'python', requirement: 'Python', type: 'technology', weight: 100, mandatory: true, evidence_status: 'verified' }],
      eligibility: { verdict: 'eligible' },
    },
    job_gates: {
      liveness: { status: 'live', source: 'synthetic-live-receipt', checked_at: CHECKED },
      dedup: { status: 'unique', source: 'synthetic-dedup-receipt', checked_at: CHECKED },
      legitimacy: { status: 'verified', source: 'synthetic-legitimacy-review', checked_at: CHECKED },
    },
    application_bundle: bundle,
  };
  const approval = createExactApproval(bundle, {
    confirmed: true,
    statement: 'I approve this exact application content for mock execution only.',
    approved_at: CHECKED,
  });
  return { readiness_input, approval, bundle };
}

test('rechecks readiness and prepares the exact candidate-controlled handoff', () => {
  const { readiness_input, approval, bundle } = fixture();
  const result = prepareCandidateSubmissionHandoff({ readiness_input, approval });
  assert.equal(result.decision, 'candidate_action_required');
  assert.deepEqual(result.application, bundle.application);
  assert.equal(result.approved_content_digest, bundle.content_digest);
  assert.deepEqual(result.reviewed_fields, [{ key: 'first_name', label: 'First name', value: 'Synthetic' }]);
  assert.deepEqual(result.reviewed_artifacts, bundle.artifacts);
  assert.equal(result.boundaries.executor, 'candidate');
  assert.equal(result.boundaries.career_ops_submit_allowed, false);
  assert.equal(result.boundaries.applied_status_authorized, false);
  assert.equal(result.boundaries.actual_receipt_required, true);
  assert.equal(result.boundaries.network_requests, 0);
  assert.equal(result.boundaries.browser_actions, 0);
  assert.equal(result.boundaries.files_written, 0);
});

test('tampered exact content fails closed even with a previously valid approval', () => {
  const { readiness_input, approval } = fixture();
  readiness_input.application_bundle.fields[0].value = 'Changed';
  const result = prepareCandidateSubmissionHandoff({ readiness_input, approval });
  assert.equal(result.decision, 'blocked');
  assert.equal(result.reason, 'readiness:blocked_invalid_bundle');
  assert.equal(JSON.stringify(result).includes('Changed'), false);
});

test('wrong application and stale content approvals fail closed', () => {
  for (const [field, value, expected] of [
    ['application_key', '043-other-role', 'approval_application_mismatch'],
    ['content_digest', 'b'.repeat(64), 'approval_content_mismatch'],
  ]) {
    const { readiness_input, approval } = fixture();
    approval[field] = value;
    const result = prepareCandidateSubmissionHandoff({ readiness_input, approval });
    assert.equal(result.decision, 'blocked');
    assert.equal(result.reason, `approval:${expected}`);
    assert.equal(result.career_ops_submit_allowed, false);
  }
});

test('unready job, fit, eligibility and bundle states never expose candidate content', () => {
  const cases = [
    input => { input.job_gates.liveness.status = 'dead'; },
    input => { input.match.initial_verified_fit = 75; input.match.requirements[0].evidence_status = 'missing'; },
    input => { input.match.eligibility.verdict = 'unknown'; },
    input => { input.application_bundle = null; },
  ];
  for (const alter of cases) {
    const { readiness_input, approval } = fixture();
    alter(readiness_input);
    const result = prepareCandidateSubmissionHandoff({ readiness_input, approval });
    assert.equal(result.decision, 'blocked');
    assert.equal(JSON.stringify(result).includes('Synthetic'), false);
  }
});

test('invalid readiness input is privacy-safe and non-throwing', () => {
  const result = prepareCandidateSubmissionHandoff({ readiness_input: {}, approval: {} });
  assert.equal(result.decision, 'blocked');
  assert.equal(result.reason, 'invalid_readiness_input');
  assert.equal(result.application_action, 'none');
});

test('handoff is not actual submission evidence for the C13 lifecycle', () => {
  const { readiness_input, approval, bundle } = fixture();
  const handoff = prepareCandidateSubmissionHandoff({ readiness_input, approval });
  assert.throws(() => createLifecycleEvent({
    bundle, tracker_row: 42, status: 'Applied', observed_at: CHECKED, evidence: handoff,
  }), /Actual lifecycle evidence/);
});
