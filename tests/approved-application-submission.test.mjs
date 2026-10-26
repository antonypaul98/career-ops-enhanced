import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationBundle, createExactApproval } from '../enhanced/application-approval.mjs';
import { prepareCandidateSubmissionHandoff } from '../enhanced/candidate-submission-handoff.mjs';
import { START_CONFIRMATION_STATEMENT, createApplicationStartConfirmation,
  prepareCandidateApplicationStart } from '../enhanced/application-launch.mjs';
import { SUBMIT_CONFIRMATION_STATEMENT, createExactSubmissionApproval,
  prepareApprovedSubmission, executeApprovedSubmission, verifySubmissionReceipt,
  recordAppliedExactlyOnce, createAppliedLifecycleDraftFromReceipt } from '../enhanced/approved-application-submission.mjs';

const KEY = 'synthetic-042';
const WHEN = '2026-10-20T20:00:00.000Z';
const NOW = Date.parse('2026-10-20T21:00:00.000Z');

function fixture() {
  const bundle = createApplicationBundle({
    application: { key: KEY, company: 'Synthetic Acme', role: 'Data Engineer',
      url: 'https://jobs.synthetic-acme.example/apply/42' },
    fields: [{ key: 'first_name', label: 'First name', value: 'Synthetic',
      source: { type: 'candidate_statement', status: 'user_confirmed', ref: 'synthetic-review',
        quote: 'My name is Synthetic.' } }],
    artifacts: [{ kind: 'resume', path: 'output/synthetic-resume.pdf', sha256: 'a'.repeat(64) }],
  });
  const readiness_input = {
    application_key: KEY,
    opportunity: { application_key: KEY,
      dimensions: Object.fromEntries(['cv_match', 'north_star', 'compensation', 'culture', 'red_flags']
        .map(name => [name, { score: 5, evidence: 'supported', explanation: 'Synthetic evidence' }])),
      jd_keywords: ['Python'], candidate_text: 'Verified Python experience.',
      candidate_evidence: { status: 'verified', source: 'synthetic-profile' },
      detected_archetype: 'Data Engineer', archetype_review_status: 'reviewed',
      profile: { target_roles: { archetypes: [{ name: 'Data Engineer', fit: 'primary' }] } } },
    match: { application_key: KEY, initial_verified_fit: 100,
      requirements: [{ id: 'python', requirement: 'Python', type: 'technology', weight: 100,
        mandatory: true, evidence_status: 'verified' }], eligibility: { verdict: 'eligible' } },
    job_gates: {
      liveness: { status: 'live', source: 'synthetic-live', checked_at: WHEN },
      dedup: { status: 'unique', source: 'synthetic-dedup', checked_at: WHEN },
      legitimacy: { status: 'verified', source: 'synthetic-legitimacy', checked_at: WHEN },
    },
    application_bundle: bundle,
  };
  const approval = createExactApproval(bundle, { confirmed: true,
    statement: 'I approve this exact application content for mock execution only.', approved_at: WHEN });
  const handoff = prepareCandidateSubmissionHandoff({ readiness_input, approval });
  const start_confirmation = createApplicationStartConfirmation(handoff, { confirmed: true,
    statement: START_CONFIRMATION_STATEMENT, confirmed_at: WHEN });
  const start = prepareCandidateApplicationStart({ readiness_input, approval, start_confirmation });
  const observation = { application_key: KEY, current_url: bundle.application.url,
    rendered_fields: start.reviewed_fields, attached_artifacts: start.reviewed_artifacts,
    unexpected_fields: [], final_review: true, observed_at: WHEN,
    browser_contract_digest: 'e'.repeat(64) };
  const submit_approval = createExactSubmissionApproval({ readiness_input, approval, start_confirmation,
    observation, confirmation: { confirmed: true, statement: SUBMIT_CONFIRMATION_STATEMENT,
      approved_at: WHEN } }, { now: NOW });
  return { readiness_input, approval, start_confirmation, observation, submit_approval, bundle };
}

function plan(f = fixture()) {
  return prepareApprovedSubmission(f);
}

test('no submit occurs without exact explicit application approval', async () => {
  const f = fixture(); let calls = 0;
  const missing = prepareApprovedSubmission({ ...f, submit_approval: undefined });
  assert.equal(missing.decision, 'blocked');
  assert.equal(missing.reason, 'submit_approval_invalid_or_stale');
  const result = await executeApprovedSubmission(missing, () => { calls += 1; });
  assert.equal(calls, 0);
  assert.equal(result.consequential_actions, 0);
});

test('changed package, URL, fields, artifacts and browser contract make approval stale and fail closed', () => {
  for (const mutate of [
    f => { f.readiness_input.application_bundle.fields[0].value = 'Changed'; },
    f => { f.observation.current_url += '?changed=1'; },
    f => { f.observation.rendered_fields[0].value = 'Changed'; },
    f => { f.observation.attached_artifacts[0].sha256 = 'b'.repeat(64); },
    f => { f.observation.browser_contract_digest = 'f'.repeat(64); },
  ]) {
    const f = fixture(); mutate(f);
    const result = prepareApprovedSubmission(f);
    assert.notEqual(result.decision, 'ready_to_submit_once');
    assert.equal(result.consequential_actions, 0);
  }
});

test('executor performs at most the one specifically authorized consequential action', async () => {
  const p = plan(); const calls = [];
  const result = await executeApprovedSubmission(p, request => {
    calls.push(request);
    return { action: request.action, execution_digest: request.execution_digest,
      submitted: true, submitted_at: WHEN };
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['action', 'application_key', 'execution_digest',
    'resume_token', 'submit_approval_digest'].sort());
  assert.equal(result.decision, 'submitted_awaiting_verified_receipt');
  assert.equal(result.consequential_actions, 1);
  assert.equal(result.applied_status_authorized, false);
  const changed = { ...p, max_consequential_actions: 2 };
  const refused = await executeApprovedSubmission(changed, () => { calls.push('unexpected'); });
  assert.equal(refused.decision, 'blocked');
  assert.equal(calls.length, 1);
});

test('login, MFA, CAPTCHA, new fields and missing final review pause rather than bypass', () => {
  for (const [field, reason, value] of [
    ['login_required', 'login_required', true], ['mfa_required', 'mfa_required', true],
    ['captcha_required', 'captcha_required', true], ['unexpected_fields', 'new_or_changed_fields', ['salary']],
    ['final_review', 'final_review_required', false],
  ]) {
    const f = fixture(); f.observation[field] = value;
    const result = prepareApprovedSubmission(f);
    assert.equal(result.decision, 'paused');
    assert.equal(result.reason, reason);
    assert.match(result.resume_token, /^[a-f0-9]{64}$/);
    assert.equal(result.consequential_actions, 0);
  }
});

test('Applied remains false before a concrete verified receipt', async () => {
  const p = plan();
  const execution = await executeApprovedSubmission(p, request => ({ action: request.action,
    execution_digest: request.execution_digest, submitted: true, submitted_at: WHEN }));
  assert.equal(execution.applied_status_authorized, false);
  const bad = verifySubmissionReceipt(execution, { kind: 'ats_success_page', origin: 'intent' });
  assert.equal(bad.decision, 'blocked');
  assert.equal(bad.applied_status_authorized, false);
});

test('verified receipt authorizes Applied exactly once and retries are idempotent', async () => {
  const p = plan();
  const execution = await executeApprovedSubmission(p, request => ({ action: request.action,
    execution_digest: request.execution_digest, submitted: true, submitted_at: WHEN }));
  const verified = verifySubmissionReceipt(execution, { kind: 'ats_success_page', origin: 'observed_actual',
    application_key: KEY, content_digest: execution.content_digest, execution_digest: execution.execution_digest,
    observed_at: '2026-10-20T20:01:00.000Z', source: 'data/private/synthetic-receipt.html',
    sha256: 'c'.repeat(64), reference: 'SYNTHETIC-RECEIPT-42', quote: 'Application received' }, { now: NOW });
  assert.equal(verified.decision, 'verified_receipt');
  const lifecycle = createAppliedLifecycleDraftFromReceipt({ verified, bundle: fixture().bundle, tracker_row: 42 },
    { now: NOW });
  assert.equal(lifecycle.status, 'Applied');
  assert.equal(lifecycle.evidence.kind, 'submission_receipt');
  assert.equal(lifecycle.confirmation, undefined);
  const seen = new Set(); let writes = 0;
  const store = { has: digest => seen.has(digest), record: ({ authorization }) => {
    writes += 1; seen.add(authorization.authorization_digest);
  } };
  assert.equal((await recordAppliedExactlyOnce(verified, store)).decision, 'applied_recorded');
  assert.equal((await recordAppliedExactlyOnce(verified, store)).decision, 'already_recorded');
  assert.equal(writes, 1);
  const tampered = structuredClone(verified);
  tampered.applied_authorization.max_tracker_mutations = 2;
  assert.equal((await recordAppliedExactlyOnce(tampered, store)).decision, 'blocked');
  assert.equal(writes, 1);
});

test('submit failures stay resumable without false Applied state', async () => {
  const p = plan();
  const failed = await executeApprovedSubmission(p, () => { throw new Error('synthetic browser failure'); });
  assert.equal(failed.decision, 'paused');
  assert.equal(failed.reason, 'submit_action_failed');
  assert.equal(failed.resume_token, p.resume_token);
  assert.equal(failed.applied_status_authorized, false);
  assert.equal(failed.tracker_mutation, false);
});

test('fixtures and results contain no real candidate data and receipt cannot predate submit', async () => {
  const text = JSON.stringify(fixture());
  assert.doesNotMatch(text, /antony|gmail|@/i);
  const p = plan();
  const execution = await executeApprovedSubmission(p, request => ({ action: request.action,
    execution_digest: request.execution_digest, submitted: true, submitted_at: WHEN }));
  const result = verifySubmissionReceipt(execution, { kind: 'employer_acknowledgement', origin: 'observed_actual',
    application_key: KEY, content_digest: execution.content_digest, execution_digest: execution.execution_digest,
    observed_at: '2026-10-20T19:59:59.000Z', source: 'data/private/receipt.eml', sha256: 'd'.repeat(64),
    reference: 'SYNTHETIC-42', quote: 'received' }, { now: NOW });
  assert.equal(result.decision, 'blocked');
  assert.equal(result.reason, 'receipt_predates_submission');
});
