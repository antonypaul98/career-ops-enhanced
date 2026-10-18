import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationBundle } from '../enhanced/application-approval.mjs';
import { prepareApplicationReadiness } from '../enhanced/application-readiness.mjs';

const KEY = '042-synthetic-acme-data-engineer';
const CHECKED = '2026-10-17T22:00:00-04:00';
const jobGates = () => ({
  liveness: { status: 'live', source: 'synthetic-liveness-receipt', checked_at: CHECKED },
  dedup: { status: 'unique', source: 'synthetic-dedup-receipt', checked_at: CHECKED },
  legitimacy: { status: 'verified', source: 'synthetic-legitimacy-review', checked_at: CHECKED },
});
const dimensions = () => ({
  cv_match: { score: 4.5, evidence: 'supported', explanation: 'Synthetic reviewed mapping' },
  north_star: { score: 4.5, evidence: 'supported', explanation: 'Synthetic target role' },
  compensation: { score: 4, evidence: 'supported', explanation: 'Synthetic range' },
  culture: { score: 4, evidence: 'supported', explanation: 'Synthetic team evidence' },
  red_flags: { score: 5, evidence: 'supported', explanation: 'Synthetic review' },
});
const opportunity = () => ({
  application_key: KEY,
  dimensions: dimensions(),
  jd_keywords: ['Python', 'Airflow'],
  candidate_text: 'Verified Python and Airflow experience.',
  candidate_evidence: { status: 'verified', source: 'synthetic-profile' },
  detected_archetype: 'Data Engineer',
  archetype_review_status: 'reviewed',
  profile: { target_roles: { archetypes: [{ name: 'Data Engineer', fit: 'primary' }] } },
});
const completeMatch = () => ({
  application_key: KEY,
  initial_verified_fit: 100,
  requirements: [
    { id: 'python', requirement: 'Python', type: 'technology', weight: 60, mandatory: true, evidence_status: 'verified' },
    { id: 'airflow', requirement: 'Airflow', type: 'technology', weight: 40, mandatory: true, evidence_status: 'verified' },
  ],
  eligibility: { verdict: 'eligible' },
});
const bundle = (key = KEY) => createApplicationBundle({
  application: { key, company: 'Synthetic Acme', role: 'Data Engineer', url: 'https://jobs.example.test/42' },
  fields: [{
    key: 'first_name', label: 'First name', value: 'Synthetic',
    source: { type: 'candidate_statement', status: 'user_confirmed', ref: 'synthetic-review', quote: 'Synthetic candidate answer.' },
  }],
  artifacts: [{ kind: 'resume', path: 'output/synthetic-resume.pdf', sha256: 'a'.repeat(64) }],
});
const readyInput = () => ({
  application_key: KEY,
  opportunity: opportunity(),
  match: completeMatch(),
  job_gates: jobGates(),
  application_bundle: bundle(),
});

test('joins verified scoring and exact bundle without authorizing submission', () => {
  const result = prepareApplicationReadiness(readyInput());
  assert.equal(result.decision, 'ready_for_exact_content_review');
  assert.equal(result.verified_match.after, 100);
  assert.equal(result.opportunity_score.scale, '1-5');
  assert.equal(result.verified_match.scale, 'percent');
  assert.equal(result.exact_bundle.valid, true);
  assert.equal(result.exact_bundle.content_echoed, false);
  assert.equal(result.safety.exact_content_approval_granted, false);
  assert.equal(result.safety.application_action, 'none');
  assert.equal(result.safety.submit_allowed, false);
});

test('strictly above 75 routes missing evidence to short targeted questions', () => {
  const input = readyInput();
  input.match = {
    application_key: KEY,
    initial_verified_fit: 76,
    requirements: [
      { id: 'python', requirement: 'Python', type: 'technology', weight: 76, mandatory: true, evidence_status: 'verified' },
      { id: 'airflow', requirement: 'Airflow', type: 'technology', weight: 24, mandatory: true, evidence_status: 'missing' },
    ],
    eligibility: { verdict: 'eligible' },
  };
  const result = prepareApplicationReadiness(input);
  assert.equal(result.decision, 'needs_candidate_evidence');
  assert.equal(result.verified_match.before, 76);
  assert.equal(result.verified_match.questionnaire.questions.length, 1);
  assert.equal(result.safety.application_action, 'none');
});

test('75 and below stays in review queue without detailed questions', () => {
  const input = readyInput();
  input.match = {
    application_key: KEY,
    initial_verified_fit: 75,
    requirements: [
      { id: 'supported', requirement: 'Python', type: 'technology', weight: 75, evidence_status: 'verified' },
      { id: 'gap', requirement: 'Airflow', type: 'technology', weight: 25, evidence_status: 'missing' },
    ],
    eligibility: { verdict: 'eligible' },
  };
  const result = prepareApplicationReadiness(input);
  assert.equal(result.decision, 'review_queue');
  assert.deepEqual(result.verified_match.questionnaire.questions, []);
});

test('confirmed provenance can raise fit before the bundle review gate', () => {
  const input = readyInput();
  input.application_bundle = null;
  input.match = {
    application_key: KEY,
    initial_verified_fit: 76,
    requirements: [
      { id: 'python', requirement: 'Python', type: 'technology', weight: 76, mandatory: true, evidence_status: 'verified' },
      { id: 'airflow', requirement: 'Airflow', type: 'technology', weight: 24, mandatory: true, evidence_status: 'missing' },
    ],
    eligibility: { verdict: 'eligible' },
  };
  const preview = prepareApplicationReadiness(input);
  input.match.responses = [{
    question_key: preview.verified_match.questionnaire.questions[0].question_key,
    review_status: 'confirmed', experience_level: 'hands_on', context: 'Built synthetic ETL DAGs.',
    provenance: { source: 'reviewed_conversation', quote: 'I built Airflow DAGs.', confirmed_at: '2026-10-17' },
  }];
  const result = prepareApplicationReadiness(input);
  assert.equal(result.verified_match.before, 76);
  assert.equal(result.verified_match.after, 100);
  assert.equal(result.decision, 'needs_exact_application_bundle');
  assert.equal(result.verified_match.evidence_vault_proposals[0].requires_explicit_vault_write_confirmation, true);
});

test('liveness, dedup and legitimacy failures block application preparation', () => {
  for (const [gate, status] of [['liveness', 'dead'], ['dedup', 'duplicate'], ['legitimacy', 'suspicious']]) {
    const input = readyInput();
    input.job_gates[gate].status = status;
    const result = prepareApplicationReadiness(input);
    assert.equal(result.decision, 'blocked_job_gate');
    assert.deepEqual(result.failed_job_gates, [{ gate, status }]);
    assert.equal(result.safety.submit_allowed, false);
  }
});

test('job-gate receipts and application identities fail closed', () => {
  const missingReceipt = readyInput();
  delete missingReceipt.job_gates.liveness.source;
  assert.throws(() => prepareApplicationReadiness(missingReceipt), /liveness.source is required/);

  const wrongOpportunity = readyInput();
  wrongOpportunity.opportunity.application_key = '043-other-role';
  assert.throws(() => prepareApplicationReadiness(wrongOpportunity), /opportunity application identity mismatch/);

  const wrongMatch = readyInput();
  wrongMatch.match.application_key = '043-other-role';
  assert.throws(() => prepareApplicationReadiness(wrongMatch), /match application identity mismatch/);
});

test('invalid and cross-application bundles never reach exact-content review', () => {
  const wrong = readyInput();
  wrong.application_bundle = bundle('043-other-role');
  assert.equal(prepareApplicationReadiness(wrong).decision, 'blocked_application_mismatch');

  const altered = readyInput();
  altered.application_bundle.fields[0].value = 'Changed';
  const result = prepareApplicationReadiness(altered);
  assert.equal(result.decision, 'blocked_invalid_bundle');
  assert.equal(result.reason, 'content_changed');
  assert.equal(JSON.stringify(result).includes('Changed'), false);
});

