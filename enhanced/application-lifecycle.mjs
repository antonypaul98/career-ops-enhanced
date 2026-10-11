/** Reviewed observations, never an application executor or a second tracker. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, verifyApplicationBundle } from './application-approval.mjs';
import { privatePath, normalize } from './resume-authority.mjs';

export const LIFECYCLE_CONFIRMATION_STATEMENT = "I confirm this evidence records this application's actual lifecycle event.";
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 1024 * 1024;
const TRANSITIONS = {
  Evaluated: ['Applied', 'Discarded', 'SKIP'],
  Applied: ['Responded', 'Interview', 'Offer', 'Rejected', 'Discarded'],
  Responded: ['Interview', 'Offer', 'Rejected', 'Discarded'],
  Interview: ['Offer', 'Rejected', 'Discarded'],
  Offer: ['Hired', 'Rejected', 'Discarded'],
  Rejected: [], Discarded: [], SKIP: [], Hired: [],
};
const KINDS = {
  Applied: ['submission_receipt', 'employer_acknowledgement'],
  Responded: ['employer_message'], Interview: ['employer_message'],
  Offer: ['employer_message'], Rejected: ['employer_message'],
  Discarded: ['candidate_decision'], SKIP: ['candidate_decision'],
  Hired: ['accepted_offer'],
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireText = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
};
function timestamp(value, name, now = Date.now()) {
  const text = requireText(value, name);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(text)
    || !Number.isFinite(Date.parse(text)) || Date.parse(text) > now) {
    throw new Error(`${name} must be a valid non-future UTC timestamp`);
  }
  const canonical = new Date(text).toISOString();
  if (canonical.slice(0, 19) !== text.slice(0, 19)) throw new Error(`${name} is not a real calendar time`);
  return canonical;
}

/** A draft has no confirmation and cannot change the tracker. */
export function createLifecycleEvent({ bundle, tracker_row, status, observed_at, evidence } = {}, { now = Date.now() } = {}) {
  if (!verifyApplicationBundle(bundle).valid) throw new Error('A valid exact-content application bundle is required');
  if (!Number.isSafeInteger(tracker_row) || tracker_row < 1) throw new Error('tracker_row must be a positive integer');
  if (!Object.hasOwn(KINDS, status)) throw new Error('Unsupported lifecycle status');
  if (!evidence || evidence.origin !== 'observed_actual' || !KINDS[status].includes(evidence.kind)) {
    throw new Error('Actual lifecycle evidence of the appropriate kind is required; mock plans and intent are not evidence');
  }
  if (!SHA256.test(evidence.sha256 ?? '')) throw new Error('Evidence SHA-256 is required');
  const core = {
    schema_version: 1, bundle, tracker_row, status,
    observed_at: timestamp(observed_at, 'observed_at', now),
    evidence: {
      kind: evidence.kind, origin: 'observed_actual',
      source: requireText(evidence.source, 'evidence.source'), sha256: evidence.sha256,
      reference: requireText(evidence.reference, 'evidence.reference'),
      quote: requireText(evidence.quote, 'evidence.quote'),
    },
  };
  return { ...core, event_digest: hash(canonicalJson(core)) };
}

function checkedEvent(event, now) {
  const normalized = createLifecycleEvent(event, { now });
  const { confirmation, ...core } = event;
  if (canonicalJson(core) !== canonicalJson(normalized)) throw new Error('Lifecycle content changed or contains unknown fields');
  return normalized;
}

/** Record only an explicit candidate review of this particular observation. */
export function confirmLifecycleEvent(event, confirmation = {}, { now = Date.now() } = {}) {
  const draft = checkedEvent(event, now);
  if (confirmation.confirmed !== true || confirmation.event_digest !== draft.event_digest
    || confirmation.statement !== LIFECYCLE_CONFIRMATION_STATEMENT) {
    throw new Error('Explicit candidate confirmation of the exact lifecycle event is required');
  }
  const confirmedAt = timestamp(confirmation.confirmed_at, 'confirmed_at', now);
  if (Date.parse(confirmedAt) < Date.parse(draft.observed_at)) throw new Error('Confirmation predates the observation');
  return { ...draft, confirmation: { confirmed: true, by: 'candidate',
    event_digest: draft.event_digest, statement: LIFECYCLE_CONFIRMATION_STATEMENT, confirmed_at: confirmedAt } };
}

function verifyConfirmedEvent(event, now) {
  if (event?.confirmation?.by !== 'candidate') throw new Error('Candidate-reviewed lifecycle evidence is required');
  const normalized = confirmLifecycleEvent(event, event.confirmation, { now });
  if (canonicalJson(event) !== canonicalJson(normalized)) throw new Error('Lifecycle confirmation changed or contains unknown fields');
  return normalized;
}

function readBounded(root, path, limit = MAX_SOURCE_BYTES) {
  const file = privatePath(root, path);
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('Evidence must be a bounded regular private file');
  const bytes = readFileSync(file);
  if (bytes.length > limit) throw new Error('Evidence exceeds the size limit');
  return bytes;
}

function checkSource(bytes, evidence) {
  if (hash(bytes) !== evidence.sha256) throw new Error('Evidence source changed');
  const text = bytes.toString('utf8');
  if (!text.includes(evidence.quote) || !text.includes(evidence.reference)) {
    throw new Error('Exact evidence quote and receipt/message reference must exist in the source');
  }
}

export function lifecycleEvidencePath(root, eventDigest) {
  if (!SHA256.test(eventDigest ?? '')) throw new Error('Invalid lifecycle evidence digest');
  return privatePath(root, `data/lifecycle-evidence/${eventDigest}.json`);
}

/** An archived observation alone does not mean its tracker write succeeded. */
export function loadLifecycleEvidence(root, eventDigest, { now = Date.now() } = {}) {
  const file = lifecycleEvidencePath(root, eventDigest);
  const record = JSON.parse(readBounded(root, file, 4 * MAX_SOURCE_BYTES).toString('utf8'));
  if (record.schema_version !== 1 || record.event?.event_digest !== eventDigest
    || typeof record.source_base64 !== 'string') throw new Error('Invalid archived lifecycle evidence');
  verifyConfirmedEvent(record.event, now);
  checkSource(Buffer.from(record.source_base64, 'base64'), record.event.evidence);
  return record;
}

/** Called inside set-status's existing canonical tracker lock. No writes here. */
export function prepareLifecycleTransition({ root, eventPath, trackerPath, target, newStatus, on = null, now = Date.now() }) {
  privatePath(root, trackerPath);
  const event = verifyConfirmedEvent(JSON.parse(readBounded(root, eventPath).toString('utf8')), now);
  const app = event.bundle.application;
  if (event.tracker_row !== target.num || normalize(app.company) !== normalize(target.company)
    || normalize(app.role) !== normalize(target.role)
    || (target.url && target.url !== '—' && target.url !== app.url)) {
    throw new Error('Lifecycle evidence belongs to a different tracker application');
  }
  if (event.status !== newStatus) throw new Error('Requested state does not match the reviewed event');
  if (on !== null && on !== event.observed_at.slice(0, 10)) throw new Error('--on does not match the evidence date');
  if (!Object.hasOwn(TRANSITIONS, target.status)
    || (target.status !== newStatus && !TRANSITIONS[target.status].includes(newStatus))) {
    throw new Error(`Refusing lifecycle regression or unsupported transition: ${target.status} → ${newStatus}`);
  }
  const sourceBytes = readBounded(root, event.evidence.source);
  checkSource(sourceBytes, event.evidence);
  // Submission records bind the actual attachment bytes, not just caller hashes.
  if (newStatus === 'Applied') {
    for (const artifact of event.bundle.artifacts) {
      if (hash(readBounded(root, artifact.path, 16 * MAX_SOURCE_BYTES)) !== artifact.sha256) {
        throw new Error('Submitted artifact changed from the reviewed bundle');
      }
    }
  }
  for (const match of String(target.notes ?? '').matchAll(/\blifecycle:([a-f0-9]{64})\b/g)) {
    const previous = loadLifecycleEvidence(root, match[1], { now }).event;
    if (previous.tracker_row !== event.tracker_row || previous.bundle.application.key !== app.key
      || previous.bundle.content_digest !== event.bundle.content_digest) {
      throw new Error('Application identity or submitted content conflicts with existing lifecycle evidence');
    }
    if (match[1] !== event.event_digest && Date.parse(previous.observed_at) > Date.parse(event.observed_at)) {
      throw new Error('Lifecycle evidence is older than an already recorded event');
    }
  }
  return { event, source_base64: sourceBytes.toString('base64'), schema_version: 1,
    note: `lifecycle:${event.event_digest}`, date: event.observed_at.slice(0, 10),
    path: lifecycleEvidencePath(root, event.event_digest) };
}

/** Archive before the tracker write. On failure the tracker remains unchanged.
 * Retrying after an interrupted tracker write is safe: the immutable observation
 * is reused and set-status's whole-note and status idempotency apply. */
export function persistLifecycleEvidence(root, prepared) {
  const file = lifecycleEvidencePath(root, prepared.event.event_digest);
  const record = { schema_version: 1, event: prepared.event, source_base64: prepared.source_base64 };
  if (existsSync(file)) {
    if (canonicalJson(loadLifecycleEvidence(root, prepared.event.event_digest)) !== canonicalJson(record)) {
      throw new Error('Existing lifecycle evidence conflicts; refusing overwrite');
    }
    return file;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  return file;
}
