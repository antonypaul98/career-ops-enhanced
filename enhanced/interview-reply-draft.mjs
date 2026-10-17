/**
 * Exact-context, draft-only interview availability replies.
 *
 * Inputs are policy results from job-correspondence.mjs and
 * interview-availability.mjs plus a separately verified recipient and explicit
 * authorization. This module has no connector and never sends email.
 */
import { createHash } from 'node:crypto';

const SHA256 = value => createHash('sha256').update(value).digest('hex');
const HEX64 = /^[a-f0-9]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_TYPES = new Set(['interview_proposal', 'interview_reschedule']);
const ALLOWED_REVIEW_REASONS = new Set(['scheduling-needs-approved-availability-and-calendar-check']);
const MAX_TEXT = 500;
const clean = value => String(value ?? '').trim();

function bounded(value, name) {
  const text = clean(value);
  if (text.length > MAX_TEXT) throw new Error(`${name} exceeds the draft policy limit`);
  return text;
}

function proposalDigest(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const start_at = bounded(proposal.start_at, 'proposal.start_at');
  const end_at = bounded(proposal.end_at, 'proposal.end_at');
  if (!start_at || !end_at) return null;
  return SHA256(JSON.stringify({ start_at, end_at }));
}

function blocked(reason, context = {}) {
  return {
    schema_version: 1,
    status: 'review_required',
    reason,
    message_id: context.message_id ?? null,
    application_id: context.application_id ?? null,
    draft_key: null,
    draft: null,
    notification: { required: true, reason },
    outbound: { send: false, exact_content_approval_required: true },
  };
}

function validateProcessed(values) {
  if (!Array.isArray(values) || values.length > 1000) throw new Error('processed_draft_keys must be a bounded array');
  return new Set(values.map((value, index) => {
    const key = bounded(value, `processed_draft_keys[${index}]`);
    if (!HEX64.test(key)) throw new Error('processed draft keys must be SHA-256 values');
    return key;
  }));
}

export function buildInterviewReplyDraft({
  correspondence, availability, proposal, recipient, authorization,
  processed_draft_keys = [],
} = {}) {
  if (!correspondence || typeof correspondence !== 'object' || Array.isArray(correspondence)) {
    throw new Error('correspondence result is required');
  }
  const message_id = bounded(correspondence.message_id, 'correspondence.message_id');
  const thread_id = bounded(correspondence.thread_id, 'correspondence.thread_id');
  const application_id = bounded(correspondence.match?.application_id, 'correspondence.match.application_id');
  const context = { message_id: message_id || null, application_id: application_id || null };
  if (!message_id || !thread_id || correspondence.duplicate === true) return blocked('message-context-not-actionable', context);
  if (!ALLOWED_TYPES.has(correspondence.classification?.type)) return blocked('not-an-interview-scheduling-message', context);
  if (correspondence.match?.status !== 'linked' || !application_id) return blocked('application-link-not-verified', context);
  if (!HEX64.test(correspondence.content_sha256 ?? '')) return blocked('message-provenance-missing', context);
  const sensitive = correspondence.review?.sensitive_categories ?? [];
  const reasons = correspondence.review?.reasons ?? [];
  if (!Array.isArray(sensitive) || sensitive.length || !Array.isArray(reasons)
    || reasons.some(reason => !ALLOWED_REVIEW_REASONS.has(reason))) {
    return blocked('sensitive-or-substantive-review-required', context);
  }
  if (!availability || availability.decision !== 'within_approved_slot'
    || availability.reply_eligible !== true || availability.review_required !== false
    || availability.outbound?.authorization_present !== true || availability.outbound?.send !== false
    || !HEX64.test(availability.schedule_provenance_sha256 ?? '')) {
    return blocked('approved-availability-required', context);
  }
  const digest = proposalDigest(proposal);
  if (!digest || digest !== availability.proposal_sha256) return blocked('proposal-binding-mismatch', context);
  const address = bounded(recipient?.address, 'recipient.address').toLowerCase();
  if (!EMAIL.test(address) || recipient?.verified !== true
    || bounded(recipient?.source_message_id, 'recipient.source_message_id') !== message_id
    || bounded(recipient?.thread_id, 'recipient.thread_id') !== thread_id
    || bounded(recipient?.application_id, 'recipient.application_id') !== application_id) {
    return blocked('recipient-identity-not-verified', context);
  }
  const authorization_id = bounded(authorization?.authorization_id, 'authorization.authorization_id');
  if (authorization?.granted !== true || authorization?.scope !== 'interview_availability_reply'
    || !authorization_id
    || bounded(authorization?.recipient, 'authorization.recipient').toLowerCase() !== address
    || bounded(authorization?.thread_id, 'authorization.thread_id') !== thread_id
    || bounded(authorization?.application_id, 'authorization.application_id') !== application_id) {
    return blocked('outbound-authorization-not-bound', context);
  }
  const body = correspondence.classification.type === 'interview_reschedule'
    ? 'Thank you for the update. The newly proposed interview time works for me. Please let me know if there are any preparation details I should review.'
    : 'Thank you for the invitation. The proposed interview time works for me. Please let me know if there are any preparation details I should review.';
  const subject = 'Re: Interview scheduling';
  const draft_key = SHA256(JSON.stringify({ message_id, thread_id, application_id, address,
    content_sha256: correspondence.content_sha256, proposal_sha256: digest,
    schedule_provenance_sha256: availability.schedule_provenance_sha256, subject, body }));
  const processed = validateProcessed(processed_draft_keys);
  if (processed.has(draft_key)) return {
    ...blocked('duplicate-draft', context), status: 'duplicate', draft_key,
    notification: { required: false, reason: 'already-processed' },
  };
  return {
    schema_version: 1,
    status: 'draft_ready',
    reason: null,
    message_id,
    application_id,
    draft_key,
    draft: { to: address, subject, body },
    notification: { required: true, reason: 'interview-reply-ready-for-exact-content-review' },
    outbound: { send: false, authorization_id, exact_content_approval_required: true },
  };
}
