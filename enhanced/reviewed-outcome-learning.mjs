/** C14: read-only advisory summary of C13 lifecycle events actually committed to the canonical tracker.
 * This does not send applications, write candidate facts, or calibrate scoring rules.
 * Existing analyze-patterns/calibrate remain the authority for general and score-band analysis.
 */
import { readFileSync } from 'node:fs';
import { loadLifecycleEvidence } from './application-lifecycle.mjs';
import { privatePath, normalize } from './resume-authority.mjs';
import { parseTrackerRow, resolveColumns } from '../tracker-parse.mjs';
import { resolveTrackerPath } from '../tracker-utils.mjs';

const TAG = /\blifecycle:([a-f0-9]{64})\b/g;
const SHA256 = /^[a-f0-9]{64}$/;
const RESPONSE = new Set(['Responded', 'Interview', 'Offer', 'Rejected', 'Hired']);
const INTERVIEW = new Set(['Interview']);
const OFFER = new Set(['Offer', 'Hired']);
const MAX_EVENTS_PER_ROW = 32;
const MAX_ROWS = 10000;

const clean = value => normalize(value).toLowerCase();

function percent(count, denominator, sufficient) {
  return sufficient ? Math.round((count / denominator) * 1000) / 10 : null;
}

function scanCanonicalRows(root, trackerPath, now) {
  const file = privatePath(root, trackerPath ?? resolveTrackerPath(root));
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const columns = resolveColumns(lines);
  const parsed = lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
  if (parsed.length > MAX_ROWS) throw new Error('Tracker exceeds advisory scan limit');
  const seenRows = new Set();
  const applications = [];
  for (const row of parsed) {
    if (!Number.isSafeInteger(row.num) || row.num < 1 || seenRows.has(row.num)) {
      throw new Error('Tracker has an invalid or duplicate application row number');
    }
    seenRows.add(row.num);
    const tags = [...String(row.notes ?? '').matchAll(TAG)].map(match => match[1]);
    if (tags.length === 0) continue; // Legacy/manual tracker entries have no C13 acceptance proof.
    if (tags.length > MAX_EVENTS_PER_ROW) throw new Error('Too many lifecycle events in one tracker row');
    if (new Set(tags).size !== tags.length) throw new Error('Duplicate lifecycle note requires manual review');

    let key = null, contentDigest = null, submitted = false;
    let lastObserved = -Infinity;
    const statuses = new Set();
    for (const digest of tags) {
      if (!SHA256.test(digest)) throw new Error('Invalid lifecycle reference');
      // Validates archived original receipt bytes, confirmation digest, and reviewed C13 bundle.
      const record = loadLifecycleEvidence(root, digest, { now });
      const event = record.event;
      const application = event.bundle.application;
      if (event.tracker_row !== row.num || clean(application.company) !== clean(row.company)
        || clean(application.role) !== clean(row.role)
        || (row.url && row.url !== '—' && row.url !== application.url)) {
        throw new Error('Reviewed lifecycle event does not match the canonical application');
      }
      if (key !== null && (key !== application.key || contentDigest !== event.bundle.content_digest)) {
        throw new Error('Conflicting application identity or content in lifecycle history');
      }
      key = application.key;
      contentDigest = event.bundle.content_digest;
      const observed = Date.parse(event.observed_at);
      if (!Number.isFinite(observed) || observed < lastObserved) throw new Error('Lifecycle event observation order is inconsistent');
      lastObserved = observed;
      statuses.add(event.status);
      if (event.status === 'Applied') submitted = true;
    }
    // The archive alone does not prove submission. Even canonical notes for later
    // observed stages cannot substitute for a recorded C13 actual-submission receipt.
    if (!submitted) continue;
    applications.push(statuses);
  }
  return applications;
}

/**
 * Only confirmed C13 evidence referenced by the canonical tracker is eligible.
 * Returns aggregate counts only. Missing/corrupt evidence fails closed rather
 * than silently distorting rates. Employer silence is never a rejection.
 */
export function summarizeReviewedOutcomes(root, { trackerPath, minSubmitted = 5, now = Date.now() } = {}) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Private candidate root is required');
  if (!Number.isSafeInteger(minSubmitted) || minSubmitted < 2 || minSubmitted > 1000) {
    throw new Error('minSubmitted must be an integer between 2 and 1000');
  }
  if (!Number.isFinite(now)) throw new Error('A finite observation cutoff is required');
  const groups = scanCanonicalRows(root, trackerPath, now);
  const submitted = groups.length;
  const responded = groups.filter(s => [...s].some(status => RESPONSE.has(status))).length;
  const interviewed = groups.filter(s => [...s].some(status => INTERVIEW.has(status))).length;
  const offers = groups.filter(s => [...s].some(status => OFFER.has(status))).length;
  const hired = groups.filter(s => s.has('Hired')).length;
  const rejected = groups.filter(s => s.has('Rejected')).length;
  const awaiting = groups.filter(s => ![...s].some(status => RESPONSE.has(status) || status === 'Discarded')).length;
  const sufficient = submitted >= minSubmitted;
  return {
    schema_version: 1,
    advisory_only: true,
    application_action: 'none',
    score_changes: false,
    source: 'canonical_tracker_confirmed_c13_events',
    sample: { submitted, minimum: minSubmitted, sufficient },
    counts: { responded, interviewed, offers, hired, rejected, awaiting },
    rates: {
      response_percent: percent(responded, submitted, sufficient),
      recorded_interview_percent: percent(interviewed, submitted, sufficient),
      observed_offer_percent: percent(offers, submitted, sufficient),
    },
    guidance: sufficient
      ? 'Descriptive observations only; no automatic scoring changes or causal conclusions.'
      : 'Insufficient evidence for percentage guidance; keep collecting reviewed lifecycle events.',
  };
}
