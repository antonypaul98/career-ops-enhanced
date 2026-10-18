import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatchQuestionnaire } from '../enhanced/match-questionnaire.mjs';

const requirements = () => [
  { id: 'python', requirement: 'Python', type: 'technology', weight: 41, mandatory: true, evidence_status: 'verified' },
  { id: 'airflow', requirement: 'Apache Airflow', type: 'technology', weight: 24, mandatory: true, evidence_status: 'missing' },
  { id: 'retail', requirement: 'retail analytics', type: 'domain', weight: 20, evidence_status: 'verified' },
  { id: 'migration', requirement: 'cloud data migrations', type: 'project_experience', weight: 15, evidence_status: 'verified' },
];

const base = () => ({
  initial_verified_fit: 76,
  requirements: requirements(),
  eligibility: { verdict: 'eligible' },
});

test('strictly above 75 asks one short targeted missing-evidence question', () => {
  const result = evaluateMatchQuestionnaire(base());
  assert.equal(result.questionnaire.eligible, true);
  assert.equal(result.questionnaire.questions.length, 1);
  assert.match(result.questionnaire.questions[0].question, /hands-on/);
  assert.equal(result.questionnaire.questions[0].requirement, 'Apache Airflow');
});

test('questions target each allowed material gap type', () => {
  const input = {
    initial_verified_fit: 76,
    eligibility: { verdict: 'eligible' },
    requirements: [
      { id: 'base', requirement: 'Python', type: 'technology', weight: 76, evidence_status: 'verified' },
      { id: 'tech', requirement: 'Kafka', type: 'technology', weight: 6, evidence_status: 'missing' },
      { id: 'domain', requirement: 'payments', type: 'domain', weight: 6, evidence_status: 'missing' },
      { id: 'professional', requirement: 'technical leadership', type: 'professional_experience', weight: 6, evidence_status: 'missing' },
      { id: 'project', requirement: 'data-platform migration', type: 'project_experience', weight: 6, evidence_status: 'missing' },
    ],
  };
  const questions = evaluateMatchQuestionnaire(input).questionnaire.questions;
  assert.deepEqual(questions.map((item) => item.type), [
    'technology', 'domain', 'professional_experience', 'project_experience',
  ]);
  assert.match(questions[0].question, /hands-on/);
  assert.match(questions[1].question, /hands-on experience/);
  assert.match(questions[2].question, /professional experience/);
  assert.match(questions[3].question, /personally do/);
});

test('75 and below do not initiate the detailed questionnaire', () => {
  for (const score of [75, 0, 74.99]) {
    const input = base();
    input.initial_verified_fit = score;
    if (score === 0) input.requirements = requirements().map((item) => ({ ...item, evidence_status: 'missing' }));
    else {
      input.requirements[0].weight = score - 35;
      input.requirements[1].weight = 100 - score;
    }
    const result = evaluateMatchQuestionnaire(input);
    assert.equal(result.questionnaire.eligible, false);
    assert.deepEqual(result.questionnaire.questions, []);
    assert.equal(result.application_readiness, 'review_queue');
  }
});

test('confirmed hands-on answer with provenance raises recalculated fit', () => {
  const preview = evaluateMatchQuestionnaire(base());
  const input = base();
  input.responses = [{
    question_key: preview.questionnaire.questions[0].question_key,
    review_status: 'confirmed', experience_level: 'hands_on',
    context: 'Built scheduled ETL DAGs and monitored production runs.',
    provenance: { source: 'reviewed_conversation', quote: 'I built Airflow DAGs for ETL.', confirmed_at: '2026-10-17' },
  }];
  const result = evaluateMatchQuestionnaire(input);
  assert.equal(result.before.verified_fit, 76);
  assert.equal(result.after.verified_fit, 100);
  assert.equal(result.unresolved_gaps.length, 0);
  assert.equal(result.evidence_vault_proposals.length, 1);
  assert.equal(result.evidence_vault_proposals[0].requires_explicit_vault_write_confirmation, true);
  assert.equal(result.application_readiness, 'priority_application_ready');
});

test('familiarity never satisfies a hands-on requirement', () => {
  const preview = evaluateMatchQuestionnaire(base());
  const input = base();
  input.responses = [{
    question_key: preview.questionnaire.questions[0].question_key,
    review_status: 'confirmed', experience_level: 'familiarity', context: 'Completed tutorials.',
    provenance: { source: 'reviewed_conversation', quote: 'I am familiar with Airflow.', confirmed_at: '2026-10-17' },
  }];
  const result = evaluateMatchQuestionnaire(input);
  assert.equal(result.after.verified_fit, 76);
  assert.equal(result.evidence_vault_proposals.length, 0);
  assert.equal(result.unresolved_gaps[0].reason, 'familiarity_does_not_satisfy_hands_on_requirement');
  assert.equal(result.safety.familiarity_promoted_to_hands_on, false);
});

test('unproven confirmed answer is not used', () => {
  const preview = evaluateMatchQuestionnaire(base());
  const input = base();
  input.responses = [{
    question_key: preview.questionnaire.questions[0].question_key,
    review_status: 'confirmed', experience_level: 'hands_on', context: 'Used it.',
  }];
  const result = evaluateMatchQuestionnaire(input);
  assert.equal(result.after.verified_fit, 76);
  assert.equal(result.unresolved_gaps[0].reason, 'confirmed_answer_missing_provenance');
  assert.equal(result.evidence_vault_proposals.length, 0);
});

test('repeated questions are suppressed by stable key', () => {
  const first = evaluateMatchQuestionnaire(base());
  const input = base();
  input.asked_question_keys = [first.questionnaire.questions[0].question_key];
  const second = evaluateMatchQuestionnaire(input);
  assert.deepEqual(second.questionnaire.questions, []);
  assert.deepEqual(second.questionnaire.repeat_questions_suppressed, input.asked_question_keys);
});

test('99 percent is not priority-ready when a mandatory requirement is unresolved', () => {
  const input = base();
  input.requirements = [
    { id: 'major', requirement: 'Python', type: 'technology', weight: 99, evidence_status: 'verified' },
    { id: 'must', requirement: 'work authorization', type: 'professional_experience', weight: 1, mandatory: true, evidence_status: 'missing' },
  ];
  input.initial_verified_fit = 99;
  const result = evaluateMatchQuestionnaire(input);
  assert.equal(result.after.verified_fit, 99);
  assert.equal(result.mandatory_eligibility.requirements_satisfied, false);
  assert.equal(result.application_readiness, 'review_queue');
});

test('99 percent is not priority-ready when eligibility is unknown', () => {
  const input = base();
  input.requirements = requirements().map((item) => ({ ...item, evidence_status: 'verified' }));
  input.initial_verified_fit = 100;
  input.eligibility = { verdict: 'unknown' };
  const result = evaluateMatchQuestionnaire(input);
  assert.equal(result.after.verified_fit, 100);
  assert.equal(result.application_readiness, 'review_queue');
});

test('JD text alone never becomes candidate evidence', () => {
  const input = base();
  input.requirements[1].provenance = { source: 'job_description', quote: 'Must know Airflow' };
  const result = evaluateMatchQuestionnaire(input);
  assert.equal(result.after.verified_fit, 76);
  assert.equal(result.safety.jd_requirements_are_candidate_evidence, false);
});

test('invalid score, type, or weight fails closed', () => {
  assert.throws(() => evaluateMatchQuestionnaire({ ...base(), initial_verified_fit: 101 }), /0 to 100/);
  const badType = base(); badType.requirements[0].type = 'salary';
  assert.throws(() => evaluateMatchQuestionnaire(badType), /not questionnaire-eligible/);
  const badWeight = base(); badWeight.requirements[0].weight = 0;
  assert.throws(() => evaluateMatchQuestionnaire(badWeight), /positive/);
});

test('score mismatch and duplicate responses fail closed', () => {
  assert.throws(() => evaluateMatchQuestionnaire({ ...base(), initial_verified_fit: 90 }), /does not match/);
  const preview = evaluateMatchQuestionnaire(base());
  const response = {
    question_key: preview.questionnaire.questions[0].question_key,
    review_status: 'confirmed', experience_level: 'hands_on',
    provenance: { source: 'reviewed_conversation', quote: 'Confirmed.', confirmed_at: '2026-10-17' },
  };
  assert.throws(() => evaluateMatchQuestionnaire({ ...base(), responses: [response, response] }), /duplicate response/);
  const duplicateRequirement = base();
  duplicateRequirement.requirements.push({ ...duplicateRequirement.requirements[1] });
  assert.throws(() => evaluateMatchQuestionnaire(duplicateRequirement), /duplicate questionnaire requirement/);
});

