import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createApplicationBundle, createExactApproval } from '../enhanced/application-approval.mjs';
import { prepareCandidateSubmissionHandoff } from '../enhanced/candidate-submission-handoff.mjs';
import { START_CONFIRMATION_STATEMENT, createApplicationStartConfirmation,
  prepareCandidateApplicationStart } from '../enhanced/application-launch.mjs';
import { SUBMIT_CONFIRMATION_STATEMENT, prepareApprovedSubmission }
  from '../enhanced/approved-application-submission.mjs';
import { buildExactSubmissionApprovedPackage, buildExactSubmissionReview }
  from '../approve-application-submission.mjs';

const KEY = 'synthetic-approval-cli-042';
const WHEN = '2026-10-20T20:00:00.000Z';
const NOW = Date.parse('2026-10-20T21:00:00.000Z');

function fixture() {
  const bundle = createApplicationBundle({
    application: { key: KEY, company: 'Synthetic Example', role: 'Systems Analyst',
      url: 'https://jobs.synthetic-example.invalid/apply/42' },
    fields: [{ key: 'first_name', label: 'First name', value: 'Synthetic',
      source: { type: 'candidate_statement', status: 'user_confirmed', ref: 'synthetic-review',
        quote: 'Synthetic test identity.' } }],
    artifacts: [{ kind: 'resume', path: 'output/synthetic-resume.pdf', sha256: 'a'.repeat(64) }],
  });
  const readiness_input = {
    application_key: KEY,
    opportunity: { application_key: KEY,
      dimensions: Object.fromEntries(['cv_match', 'north_star', 'compensation', 'culture', 'red_flags']
        .map(name => [name, { score: 5, evidence: 'supported', explanation: 'Synthetic evidence' }])),
      jd_keywords: ['Python'], candidate_text: 'Verified synthetic Python experience.',
      candidate_evidence: { status: 'verified', source: 'synthetic-profile' },
      detected_archetype: 'Systems Analyst', archetype_review_status: 'reviewed',
      profile: { target_roles: { archetypes: [{ name: 'Systems Analyst', fit: 'primary' }] } } },
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
  const input = { readiness_input, approval, start_confirmation,
    browser_contract: { submit: { selector: '#submit', text: 'Submit' },
      receipt: { selector: '#success', allowed_path_patterns: ['/apply/success'] } } };
  const inspection = { schema_version: 1, decision: 'exact_final_review_observed',
    resume_token: start.resume.token, observation, consequential_actions: 0,
    tracker_mutation: false, applied_status_authorized: false };
  return { input, inspection };
}

test('review mints one exact challenge and approval package is submit-ready only with that challenge', () => {
  const f = fixture();
  const review = buildExactSubmissionReview(f.input, f.inspection);
  assert.equal(review.decision, 'needs_exact_submission_approval');
  assert.equal(review.application.key, KEY);
  assert.equal(review.scope, 'submit_exact_application_once');
  assert.equal(review.max_consequential_actions, 1);
  assert.equal(review.consequential_actions, 0);
  assert.equal(review.applied_status_authorized, false);

  assert.throws(() => buildExactSubmissionApprovedPackage(f.input, f.inspection,
    { challenge_digest: '0'.repeat(64), statement: SUBMIT_CONFIRMATION_STATEMENT }, { now: NOW }),
  /exact displayed review challenge is required/);

  const approved = buildExactSubmissionApprovedPackage(f.input, f.inspection,
    { challenge_digest: review.challenge_digest, statement: SUBMIT_CONFIRMATION_STATEMENT }, { now: NOW });
  assert.equal(approved.submit_approval.review_digest, review.challenge_digest);
  assert.equal(prepareApprovedSubmission(approved).decision, 'ready_to_submit_once');

  const changed = structuredClone(f.inspection);
  changed.observation.rendered_fields[0].value = 'Changed';
  assert.throws(() => buildExactSubmissionApprovedPackage(f.input, changed,
    { challenge_digest: review.challenge_digest, statement: SUBMIT_CONFIRMATION_STATEMENT }, { now: NOW }),
  /final review is not exact/);
});

test('packaged CLI creates private review then one approved output without overwrite or private fixtures', t => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-submit-approval-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture();
  writeFileSync(join(root, 'input.json'), JSON.stringify(f.input));
  writeFileSync(join(root, 'inspection.json'), JSON.stringify(f.inspection));
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' };
  const run = args => spawnSync(process.execPath, ['approve-application-submission.mjs', ...args],
    { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });

  const reviewed = run(['--mode', 'review', '--input', 'input.json', '--inspection', 'inspection.json',
    '--output', 'review.json']);
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const review = JSON.parse(readFileSync(join(root, 'review.json'), 'utf8'));
  assert.equal(review.decision, 'needs_exact_submission_approval');

  const approved = run(['--mode', 'approve', '--input', 'input.json', '--inspection', 'inspection.json',
    '--output', 'approved.json', '--challenge', review.challenge_digest,
    '--statement', SUBMIT_CONFIRMATION_STATEMENT]);
  assert.equal(approved.status, 0, approved.stderr);
  const packageJson = JSON.parse(readFileSync(join(root, 'approved.json'), 'utf8'));
  assert.equal(packageJson.submit_approval.review_digest, review.challenge_digest);
  assert.equal(prepareApprovedSubmission(packageJson).decision, 'ready_to_submit_once');

  const overwrite = run(['--mode', 'approve', '--input', 'input.json', '--inspection', 'inspection.json',
    '--output', 'approved.json', '--challenge', review.challenge_digest,
    '--statement', SUBMIT_CONFIRMATION_STATEMENT]);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /EEXIST/);
  assert.doesNotMatch(JSON.stringify({ review, packageJson }), /antony|gmail|@/i);
});
