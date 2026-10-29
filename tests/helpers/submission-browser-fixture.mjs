import { createHash } from 'node:crypto';
export const resumeBytes = Buffer.from('%PDF-1.4 synthetic resume bytes');
export const resumeHash = createHash('sha256').update(resumeBytes).digest('hex');
import { createApplicationBundle, createExactApproval } from '../../enhanced/application-approval.mjs';
import { prepareCandidateSubmissionHandoff } from '../../enhanced/candidate-submission-handoff.mjs';
import { START_CONFIRMATION_STATEMENT, createApplicationStartConfirmation,
  prepareCandidateApplicationStart } from '../../enhanced/application-launch.mjs';
import { SUBMIT_CONFIRMATION_STATEMENT, createExactSubmissionApproval, createExactSubmissionReview,
  prepareApprovedSubmission, executeApprovedSubmission, verifySubmissionReceipt,
  recordAppliedExactlyOnce, createAppliedLifecycleDraftFromReceipt } from '../../enhanced/approved-application-submission.mjs';

const KEY = 'synthetic-042';
const WHEN = '2026-10-20T20:00:00.000Z';
const NOW = Date.parse('2026-10-20T21:00:00.000Z');

export function fixture({ url = 'https://jobs.synthetic-acme.example/apply/42' } = {}) {
  const bundle = createApplicationBundle({
    application: { key: KEY, company: 'Synthetic Acme', role: 'Data Engineer',
      url },
    fields: [{ key: 'first_name', label: 'First name', value: 'Synthetic',
      source: { type: 'candidate_statement', status: 'user_confirmed', ref: 'synthetic-review',
        quote: 'My name is Synthetic.' } }],
    artifacts: [{ kind: 'resume', path: 'output/synthetic-resume.pdf', sha256: resumeHash }],
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
  const review = createExactSubmissionReview({ readiness_input, approval, start_confirmation, observation });
  const submit_approval = createExactSubmissionApproval({ readiness_input, approval, start_confirmation,
    observation, confirmation: { confirmed: true, statement: SUBMIT_CONFIRMATION_STATEMENT,
      challenge_digest: review.challenge_digest, approved_at: WHEN } }, { now: NOW });
  return { readiness_input, approval, start_confirmation, observation, review, submit_approval, bundle };
}
