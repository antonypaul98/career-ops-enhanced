import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationBundle } from '../enhanced/application-approval.mjs';
import { reviewDiscoveryReadiness } from '../enhanced/discovery-readiness.mjs';

const KEY = 'synthetic-application-101';
const PRIVATE = 'PRIVATE-SYNTHETIC-CONTENT-MUST-NOT-LEAK';
const CHECKED = '2026-10-18T10:00:00-04:00';

function readinessInput() {
  return {
    application_key: KEY,
    opportunity: {
      application_key: KEY,
      dimensions: Object.fromEntries(['cv_match', 'north_star', 'compensation', 'culture', 'red_flags']
        .map(name => [name, { score: 5, evidence: 'supported', explanation: PRIVATE }])),
      jd_keywords: ['SyntheticSkill'], candidate_text: PRIVATE,
      candidate_evidence: { status: 'verified', source: PRIVATE },
      detected_archetype: 'Data Engineer', archetype_review_status: 'reviewed',
      profile: { target_roles: { archetypes: [{ name: 'Data Engineer', fit: 'primary' }] } },
    },
    match: {
      application_key: KEY, initial_verified_fit: 100,
      requirements: [{ id: 'private-requirement', requirement: PRIVATE, type: 'technology', weight: 100, mandatory: true, evidence_status: 'verified' }],
      eligibility: { verdict: 'eligible' },
    },
    application_bundle: createApplicationBundle({
      application: { key: KEY, company: PRIVATE, role: PRIVATE, url: 'https://jobs.example.test/101' },
      fields: [{ key: 'answer', label: PRIVATE, value: PRIVATE, source: { type: 'candidate_statement', status: 'user_confirmed', ref: PRIVATE, quote: PRIVATE } }],
      artifacts: [{ kind: 'resume', path: `output/${PRIVATE}.pdf`, sha256: 'c'.repeat(64) }],
    }),
  };
}

function posting(overrides = {}) {
  return {
    company: PRIVATE, title: 'Data Engineer',
    url: 'https://jobs.example.test/101?utm_source=synthetic',
    requisition_id: 'JR-101', description: PRIVATE,
    liveness: { result: 'active', code: 'apply_control_visible', reason: PRIVATE },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    posting: posting(), prior_postings: [], readiness_input: readinessInput(),
    receipts: {
      liveness: { source: PRIVATE, checked_at: CHECKED },
      dedup: { source: PRIVATE, checked_at: CHECKED },
      legitimacy: { status: 'verified', source: PRIVATE, checked_at: CHECKED },
    },
    ...overrides,
  };
}

test('active unseen reviewed posting reaches exact-content review without leaking content', () => {
  const result = reviewDiscoveryReadiness(input());
  const serialized = JSON.stringify(result);
  assert.equal(result.discovery.decision, 'new');
  assert.equal(result.readiness.decision, 'ready_for_exact_content_review');
  assert.equal(result.readiness.job_gates.liveness.status, 'live');
  assert.equal(result.readiness.job_gates.dedup.status, 'unique');
  assert.equal(result.safety.application_action, 'none');
  assert.equal(result.safety.submit_allowed, false);
  assert.equal(serialized.includes(PRIVATE), false);
  assert.equal(serialized.includes(KEY), false);
  assert.equal(serialized.includes('JR-101'), false);
});

test('known duplicate is blocked before application preparation', () => {
  const value = input({ prior_postings: [posting({ url: 'https://jobs.example.test/101' })] });
  const result = reviewDiscoveryReadiness(value);
  assert.equal(result.discovery.decision, 'duplicate');
  assert.equal(result.readiness.job_gates.dedup.status, 'duplicate');
  assert.equal(result.readiness.decision, 'blocked_job_gate');
});

test('uncertain liveness and invalid discovery fail closed', () => {
  const uncertain = input({ posting: posting({ liveness: undefined }) });
  const uncertainResult = reviewDiscoveryReadiness(uncertain);
  assert.equal(uncertainResult.discovery.decision, 'needs_review');
  assert.equal(uncertainResult.readiness.job_gates.liveness.status, 'unverified');
  assert.equal(uncertainResult.readiness.job_gates.dedup.status, 'unverified');
  assert.equal(uncertainResult.readiness.decision, 'blocked_job_gate');

  const invalid = input({ posting: posting({ url: 'TBD' }) });
  assert.equal(reviewDiscoveryReadiness(invalid).readiness.decision, 'blocked_job_gate');
});

test('legitimacy remains an independent reviewed gate', () => {
  const value = input();
  value.receipts.legitimacy.status = 'review';
  const result = reviewDiscoveryReadiness(value);
  assert.equal(result.discovery.decision, 'new');
  assert.equal(result.readiness.job_gates.legitimacy.status, 'review');
  assert.equal(result.readiness.decision, 'blocked_job_gate');
});

test('caller cannot inject job-gate statuses around discovery evidence', () => {
  const value = input();
  value.readiness_input.job_gates = {
    liveness: { status: 'live' }, dedup: { status: 'unique' }, legitimacy: { status: 'verified' },
  };
  assert.throws(() => reviewDiscoveryReadiness(value), /must be derived/);
});
