import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationBundle, createExactApproval } from '../enhanced/application-approval.mjs';
import { prepareCandidateSubmissionHandoff } from '../enhanced/candidate-submission-handoff.mjs';
import {
  START_CONFIRMATION_STATEMENT,
  createApplicationStartConfirmation,
  prepareCandidateApplicationStart,
  requestCandidateBrowserOpen,
  validateApplicationLaunchUrl,
} from '../enhanced/application-launch.mjs';
import { systemBrowserCommand } from '../start-application.mjs';

const KEY = '042-synthetic-acme-data-engineer';
const CHECKED = '2026-10-20T06:00:00Z';

function fixture(url = 'https://jobs.synthetic-acme.example/apply/42') {
  const bundle = createApplicationBundle({
    application: { key: KEY, company: 'Synthetic Acme', role: 'Data Engineer', url },
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
      application_key: KEY,
      initial_verified_fit: 100,
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
  const handoff = prepareCandidateSubmissionHandoff({ readiness_input, approval });
  const start_confirmation = createApplicationStartConfirmation(handoff, {
    confirmed: true,
    statement: START_CONFIRMATION_STATEMENT,
    confirmed_at: CHECKED,
  });
  return { readiness_input, approval, start_confirmation, bundle };
}

test('requires separate candidate confirmation before exposing a ready browser launch', () => {
  const { readiness_input, approval, bundle } = fixture();
  const result = prepareCandidateApplicationStart({ readiness_input, approval });
  assert.equal(result.decision, 'needs_candidate_start_confirmation');
  assert.equal(result.application.url, bundle.application.url);
  assert.equal(result.required_statement, START_CONFIRMATION_STATEMENT);
  assert.equal(result.browser_actions, 0);
  assert.equal(result.career_ops_submit_allowed, false);
});

test('prepares exact reviewed fields, artifacts, URL and pause/resume token', () => {
  const input = fixture();
  const result = prepareCandidateApplicationStart(input);
  assert.equal(result.decision, 'ready_to_open');
  assert.equal(result.launch_url, input.bundle.application.url);
  assert.deepEqual(result.reviewed_fields, [{ key: 'first_name', label: 'First name', value: 'Synthetic' }]);
  assert.deepEqual(result.reviewed_artifacts, input.bundle.artifacts);
  assert.match(result.resume.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.resume.pause_points, ['login', 'mfa', 'captcha', 'new_or_changed_fields', 'final_submit']);
  assert.equal(result.boundaries.form_fill_allowed, false);
  assert.equal(result.boundaries.career_ops_submit_allowed, false);
});

test('stale start confirmation and changed approved content fail closed without candidate values', () => {
  const stale = fixture();
  stale.start_confirmation.url_digest = 'b'.repeat(64);
  const staleResult = prepareCandidateApplicationStart(stale);
  assert.equal(staleResult.decision, 'blocked');
  assert.equal(staleResult.reason, 'start_confirmation_invalid_or_stale');
  assert.equal(JSON.stringify(staleResult).includes('Synthetic'), false);

  const changed = fixture();
  changed.readiness_input.application_bundle.fields[0].value = 'Changed';
  const changedResult = prepareCandidateApplicationStart(changed);
  assert.equal(changedResult.decision, 'blocked');
  assert.equal(JSON.stringify(changedResult).includes('Changed'), false);
});

test('rejects unsafe or non-public application URLs before a browser action', () => {
  for (const url of [
    'javascript:alert(1)',
    'http://jobs.example.com/42',
    'https://user:pass@jobs.example.com/42',
    'https://127.0.0.1/42',
    'https://jobs.internal/42',
  ]) assert.equal(validateApplicationLaunchUrl(url).valid, false, url);
});

test('dispatches exactly one URL-open request and preserves candidate-only submission', () => {
  const plan = prepareCandidateApplicationStart(fixture());
  const opened = [];
  const result = requestCandidateBrowserOpen(plan, url => { opened.push(url); return true; });
  assert.deepEqual(opened, [plan.launch_url]);
  assert.equal(result.decision, 'browser_open_requested');
  assert.equal(result.browser_actions, 1);
  assert.equal(result.form_fill_actions, 0);
  assert.equal(result.submit_actions, 0);
  assert.equal(result.tracker_mutation, false);
  assert.equal(result.actual_receipt_required, true);
  assert.equal(result.career_ops_submit_allowed, false);
});

test('failed browser open remains resumable without inventing an application start', () => {
  const plan = prepareCandidateApplicationStart(fixture());
  const result = requestCandidateBrowserOpen(plan, () => false);
  assert.equal(result.decision, 'browser_open_failed');
  assert.equal(result.resume_state, 'ready_to_open');
  assert.equal(result.resume_token, plan.resume.token);
  assert.equal(result.application_action, 'none');
  assert.equal(result.browser_actions, 0);
});

test('cross-platform launch commands avoid a shell and preserve the URL as one argument', () => {
  const url = 'https://jobs.example.com/apply/42?source=a&campaign=b';
  assert.deepEqual(systemBrowserCommand(url, 'darwin'), { command: 'open', args: [url] });
  assert.deepEqual(systemBrowserCommand(url, 'linux'), { command: 'xdg-open', args: [url] });
  assert.deepEqual(systemBrowserCommand(url, 'win32'), {
    command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url],
  });
});
