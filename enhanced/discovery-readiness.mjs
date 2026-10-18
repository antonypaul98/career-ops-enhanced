/**
 * Pure discovery-to-readiness bridge.
 *
 * It converts C09 discovery/liveness/dedup outcomes into the application
 * readiness gate's job receipts, then returns the redacted runtime report.
 * Legitimacy stays an independent reviewed receipt: discovery evidence never
 * proves candidate facts or posting legitimacy by itself.
 */
import { reviewDiscoveries } from './discovery-review.mjs';
import { buildApplicationReadinessReport } from './application-readiness-report.mjs';

const LIVENESS_STATUS = Object.freeze({ active: 'live', expired: 'dead', uncertain: 'unverified' });

function receipt(value, name) {
  if (!value || typeof value !== 'object') throw new Error(`receipts.${name} is required`);
  return { source: value.source, checked_at: value.checked_at };
}

function dedupStatus(decision) {
  if (decision === 'new') return 'unique';
  if (decision === 'duplicate') return 'duplicate';
  return 'unverified';
}

/**
 * Review exactly one discovery and produce a content-redacted readiness report.
 * No files, browsers, networks, trackers, evidence stores or applications are
 * read or changed.
 */
export function reviewDiscoveryReadiness(input = {}) {
  if (input.readiness_input?.job_gates !== undefined) {
    throw new Error('readiness_input.job_gates must be derived from discovery receipts');
  }
  const [discovery] = reviewDiscoveries([input.posting], {
    prior_postings: input.prior_postings,
    ...(input.discovery_options ?? {}),
  });
  const liveness = receipt(input.receipts?.liveness, 'liveness');
  const dedup = receipt(input.receipts?.dedup, 'dedup');
  const legitimacy = receipt(input.receipts?.legitimacy, 'legitimacy');
  legitimacy.status = input.receipts?.legitimacy?.status;

  const readiness = buildApplicationReadinessReport({
    ...(input.readiness_input ?? {}),
    job_gates: {
      liveness: { ...liveness, status: LIVENESS_STATUS[discovery.liveness.result] ?? 'unverified' },
      dedup: { ...dedup, status: dedupStatus(discovery.decision) },
      legitimacy,
    },
  });

  return {
    schema_version: 1,
    discovery: {
      decision: discovery.decision,
      reason_code: discovery.reason_code,
      liveness: discovery.liveness.result,
      application_action: 'none',
      posting_content_included: false,
      identity_content_included: false,
    },
    readiness,
    safety: {
      candidate_content_included: false,
      automatic_evidence_write: false,
      tracker_mutation: false,
      application_action: 'none',
      network_requests: 0,
      browser_actions: 0,
      files_written: 0,
      submit_allowed: false,
    },
  };
}
