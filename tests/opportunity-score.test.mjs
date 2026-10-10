import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOpportunity } from '../enhanced/opportunity-score.mjs';

const dimensions = () => ({
  cv_match: { score: 4, evidence: 'supported', explanation: 'Reviewed requirement mapping' },
  north_star: { score: 4, evidence: 'supported', explanation: 'Reviewed role shape' },
  compensation: { score: 3, evidence: 'partial', explanation: 'Base range only' },
  culture: { score: 3, evidence: 'supported', explanation: 'Team details present' },
  red_flags: { score: 4, evidence: 'supported', explanation: 'No material red flags' },
});

const base = () => ({
  dimensions: dimensions(),
  jd_keywords: ['Python', 'Airflow', 'Kubernetes'],
  candidate_text: 'Verified Python and Apache Airflow experience.',
  candidate_evidence: { status: 'verified', source: 'master_profile' },
  detected_archetype: 'Data Engineer',
  archetype_review_status: 'reviewed',
  profile: { target_roles: { archetypes: [{ name: 'Data Engineer', fit: 'primary' }] } },
});

test('combines evaluation, keyword and archetype signals deterministically', () => {
  const a = scoreOpportunity(base());
  const b = scoreOpportunity(base());
  assert.deepEqual(a, b);
  assert.equal(a.signals.keyword_coverage.coverage.presentCount, 2);
  assert.equal(a.signals.profile_archetype.configured_match.fit, 'primary');
  assert.ok(a.score >= 1 && a.score <= 5);
});

test('keyword coverage uses only explicitly verified candidate text', () => {
  const input = base();
  input.candidate_evidence.status = 'needs_review';
  input.candidate_text = 'Python Airflow Kubernetes';
  const result = scoreOpportunity(input);
  assert.equal(result.signals.keyword_coverage.status, 'unavailable');
  assert.equal(result.dimensions.cv_match.score, 4);
  assert.match(result.confidence_gaps[0], /Verified candidate text/);
  assert.equal(result.safety.jd_keywords_are_candidate_evidence, false);
});

test('missing keyword and archetype evidence stays visible instead of becoming neutral', () => {
  const input = base();
  input.jd_keywords = [];
  input.archetype_review_status = 'needs_review';
  const result = scoreOpportunity(input);
  assert.equal(result.confidence, 'Low');
  assert.equal(result.confidence_gaps.length, 2);
  assert.equal(result.dimensions.cv_match.score, 4);
  assert.equal(result.dimensions.north_star.score, 4);
});

test('reviewed unmatched archetype lowers only North Star through an explicit component', () => {
  const input = base();
  input.detected_archetype = 'Quantitative Researcher';
  const result = scoreOpportunity(input);
  assert.equal(result.signals.profile_archetype.score, 1);
  assert.equal(result.dimensions.north_star.components.profile_archetype, 1);
  assert.equal(result.dimensions.cv_match.components.keyword_coverage > 1, true);
});

test('profile fit mapping distinguishes primary, secondary and adjacent', () => {
  const scores = ['primary', 'secondary', 'adjacent'].map((fit) => {
    const input = base();
    input.profile.target_roles.archetypes[0].fit = fit;
    return scoreOpportunity(input).signals.profile_archetype.score;
  });
  assert.deepEqual(scores, [5, 4, 3]);
});

test('eligibility and legitimacy inputs cannot change the score', () => {
  const clean = scoreOpportunity(base());
  const extra = base();
  extra.eligibility = { verdict: 'ineligible' };
  extra.posting_legitimacy = 'suspicious';
  extra.requirement_importance = [{ importance: 'critical' }];
  const withExcluded = scoreOpportunity(extra);
  assert.equal(withExcluded.score, clean.score);
  assert.deepEqual(withExcluded.excluded_signals,
    ['eligibility', 'requirement_importance', 'posting_legitimacy', 'historical_outcomes']);
  assert.equal(withExcluded.safety.eligibility_changes_score, false);
});

test('evidence confidence is separate from the numeric score', () => {
  const input = base();
  const high = scoreOpportunity(input);
  input.dimensions.compensation.evidence = 'unknown';
  const lowerConfidence = scoreOpportunity(input);
  assert.equal(lowerConfidence.score, high.score);
  assert.equal(lowerConfidence.confidence, 'Medium');
});

test('invalid dimensions and weights fail closed', () => {
  const invalidScore = base();
  invalidScore.dimensions.cv_match.score = 8;
  assert.throws(() => scoreOpportunity(invalidScore), /1 to 5/);

  const invalidWeights = base();
  invalidWeights.weights = { cv_match: 0, north_star: 0, compensation: 0, culture: 0, red_flags: 0 };
  assert.throws(() => scoreOpportunity(invalidWeights), /positive total/);
});
