import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityRequest, evaluateInterviewProposal, validateAvailabilityProfile }
  from '../enhanced/interview-availability.mjs';

const profile = (overrides = {}) => ({ schedule_id: 'week-2026-10-19', timezone: 'America/New_York',
  effective_week: '2026-10-19', reviewed: true, source: 'user_upload',
  recurring_slots: [{ days: ['monday', 'wednesday'], start: '09:00', end: '12:00' }],
  exceptions: [], ...overrides });

test('accepts an explicitly reviewed weekly schedule with provenance', () => {
  const result = validateAvailabilityProfile(profile());
  assert.equal(result.effective_through, '2026-10-25');
  assert.match(result.provenance_sha256, /^[a-f0-9]{64}$/);
});

test('rejects inferred schedules and invalid time zones', () => {
  assert.throws(() => validateAvailabilityProfile(profile({ reviewed: false })), /explicitly user reviewed/);
  assert.throws(() => validateAvailabilityProfile(profile({ timezone: 'Synthetic/Nowhere' })), /IANA/);
  assert.throws(() => validateAvailabilityProfile(profile({ effective_week: '2026-02-30' })), /YYYY-MM-DD/);
  assert.throws(() => validateAvailabilityProfile(profile({
    exceptions: [{ date: '2026-02-30', unavailable: true }],
  })), /valid YYYY-MM-DD/);
});

test('does not request availability again after a valid current week is supplied', () => {
  assert.deepEqual(availabilityRequest(profile(), { now: new Date('2026-10-20T15:00:00Z') }),
    { required: false, reason: 'approved-week-current', schedule_id: 'week-2026-10-19' });
});

test('requests a new schedule only after the approved week expires', () => {
  assert.equal(availabilityRequest(null).reason, 'missing-approved-schedule');
  assert.equal(availabilityRequest(profile(), { now: new Date('2026-10-26T15:00:00Z') }).reason, 'approved-week-expired');
});

test('marks a proposed time inside an approved slot without sending', () => {
  const result = evaluateInterviewProposal({ start_at: '2026-10-19T09:30:00-04:00',
    end_at: '2026-10-19T10:00:00-04:00' }, profile(), { outbound_email_authorized: true });
  assert.equal(result.decision, 'within_approved_slot');
  assert.equal(result.reply_eligible, true);
  assert.match(result.proposal_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.outbound, { send: false, authorization_present: true });
});

test('requires review when outbound email is not explicitly authorized', () => {
  const result = evaluateInterviewProposal({ start_at: '2026-10-19T09:30:00-04:00',
    end_at: '2026-10-19T10:00:00-04:00' }, profile());
  assert.equal(result.reply_eligible, false);
  assert.ok(result.reasons.includes('outbound-email-not-authorized'));
});

test('fails closed for out-of-slot and ambiguous timezone proposals', () => {
  const outside = evaluateInterviewProposal({ start_at: '2026-10-19T13:00:00-04:00',
    end_at: '2026-10-19T13:30:00-04:00' }, profile());
  const ambiguous = evaluateInterviewProposal({ start_at: '2026-10-19T09:00:00',
    end_at: '2026-10-19T09:30:00' }, profile());
  assert.equal(outside.decision, 'outside_approved_slot');
  assert.equal(ambiguous.decision, 'ambiguous_time');
  assert.equal(ambiguous.proposal_sha256, null);
});

test('calendar conflicts override approved availability', () => {
  const result = evaluateInterviewProposal({ start_at: '2026-10-19T09:30:00-04:00',
    end_at: '2026-10-19T10:00:00-04:00' }, profile(), { calendar_busy: [
    { start_at: '2026-10-19T09:45:00-04:00', end_at: '2026-10-19T10:15:00-04:00' },
  ], outbound_email_authorized: true });
  assert.equal(result.decision, 'calendar_conflict');
  assert.equal(result.reply_eligible, false);
});

test('date exceptions override recurring slots', () => {
  const exception = profile({ exceptions: [{ date: '2026-10-19', unavailable: true }] });
  const result = evaluateInterviewProposal({ start_at: '2026-10-19T09:30:00-04:00',
    end_at: '2026-10-19T10:00:00-04:00' }, exception);
  assert.equal(result.decision, 'outside_approved_slot');
  assert.ok(result.reasons.includes('date-marked-unavailable'));
});

test('DST conversion uses the approved IANA timezone', () => {
  const dstProfile = profile({ effective_week: '2026-11-02', schedule_id: 'dst-week',
    recurring_slots: [{ days: ['monday'], start: '09:00', end: '10:00' }] });
  const result = evaluateInterviewProposal({ start_at: '2026-11-02T14:00:00Z',
    end_at: '2026-11-02T14:30:00Z' }, dstProfile, { outbound_email_authorized: true });
  assert.equal(result.decision, 'within_approved_slot');
});
