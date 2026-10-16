/**
 * Deterministic, read-only interview availability policy.
 *
 * The caller supplies a user-reviewed weekly schedule, a proposed interval,
 * and optional calendar busy intervals. This module never reads a calendar,
 * sends email, confirms a meeting, or persists private schedule data.
 */
import { createHash } from 'node:crypto';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SOURCES = new Set(['user_upload', 'user_reviewed']);
const SHA256 = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OFFSET_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function assertTimezone(timezone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0)); }
  catch { throw new Error('timezone must be a valid IANA time zone'); }
}

function minutes(value, name) {
  if (!CLOCK.test(value)) throw new Error(`${name} must use HH:MM`);
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function validDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateSlots(slots, name, { requireDays }) {
  if (!Array.isArray(slots) || slots.length > 50) throw new Error(`${name} must be a bounded array`);
  return slots.map((slot, index) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) throw new Error(`${name}[${index}] must be an object`);
    const start = clean(slot.start); const end = clean(slot.end);
    const startMinute = minutes(start, `${name}[${index}].start`);
    const endMinute = minutes(end, `${name}[${index}].end`);
    if (endMinute <= startMinute) throw new Error(`${name}[${index}] must end after it starts`);
    const days = requireDays ? slot.days : [];
    if (requireDays && (!Array.isArray(days) || !days.length || days.length > 7)) {
      throw new Error(`${name}[${index}].days must be a non-empty bounded array`);
    }
    const normalizedDays = requireDays ? [...new Set(days.map(day => clean(day).toLowerCase()))] : [];
    if (normalizedDays.some(day => !DAYS.includes(day))) throw new Error(`${name}[${index}] has an invalid day`);
    return { days: normalizedDays, start, end, startMinute, endMinute };
  });
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function validateAvailabilityProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('availability profile must be an object');
  const schedule_id = clean(raw.schedule_id);
  const timezone = clean(raw.timezone);
  const effective_week = clean(raw.effective_week);
  if (!schedule_id || schedule_id.length > 200) throw new Error('schedule_id is required and bounded');
  if (!timezone) throw new Error('timezone is required');
  assertTimezone(timezone);
  if (!validDate(effective_week)) {
    throw new Error('effective_week must use YYYY-MM-DD');
  }
  if (raw.reviewed !== true || !SOURCES.has(raw.source)) {
    throw new Error('availability must be explicitly user reviewed or uploaded');
  }
  const recurring_slots = validateSlots(raw.recurring_slots, 'recurring_slots', { requireDays: true });
  const exceptions = Array.isArray(raw.exceptions) ? raw.exceptions : [];
  if (exceptions.length > 50) throw new Error('exceptions must be bounded');
  const seenDates = new Set();
  const normalizedExceptions = exceptions.map((exception, index) => {
    if (!exception || typeof exception !== 'object' || Array.isArray(exception)) throw new Error(`exceptions[${index}] must be an object`);
    const date = clean(exception.date);
    if (!validDate(date) || seenDates.has(date)) throw new Error('exception dates must be unique valid YYYY-MM-DD values');
    seenDates.add(date);
    const unavailable = exception.unavailable === true;
    const slots = validateSlots(exception.slots ?? [], `exceptions[${index}].slots`, { requireDays: false });
    if (!unavailable && !slots.length) throw new Error('an available exception needs at least one slot');
    if (unavailable && slots.length) throw new Error('an unavailable exception cannot include slots');
    return { date, unavailable, slots };
  });
  const canonical = JSON.stringify({ schedule_id, timezone, effective_week,
    recurring_slots: recurring_slots.map(({ days, start, end }) => ({ days, start, end })),
    exceptions: normalizedExceptions.map(({ date, unavailable, slots }) => ({ date, unavailable,
      slots: slots.map(({ start, end }) => ({ start, end })) })), reviewed: true, source: raw.source });
  return { schedule_id, timezone, effective_week, effective_through: addDays(effective_week, 6),
    recurring_slots, exceptions: normalizedExceptions, source: raw.source,
    provenance_sha256: SHA256(canonical) };
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day: parts.weekday.toLowerCase(),
    minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function parseInterval(raw, name) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${name} must be an object`);
  const startText = clean(raw.start_at); const endText = clean(raw.end_at);
  if (!OFFSET_TIME.test(startText) || !OFFSET_TIME.test(endText)) return { ambiguous: true };
  const start = new Date(startText); const end = new Date(endText);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return { ambiguous: true };
  return { ambiguous: false, start, end };
}

function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

export function availabilityRequest(profile, { now = new Date() } = {}) {
  if (!profile) return { required: true, reason: 'missing-approved-schedule' };
  let schedule;
  try { schedule = validateAvailabilityProfile(profile); }
  catch { return { required: true, reason: 'invalid-approved-schedule' }; }
  const today = localParts(now, schedule.timezone).date;
  if (today < schedule.effective_week) return { required: false, reason: 'future-week-already-supplied', schedule_id: schedule.schedule_id };
  if (today > schedule.effective_through) return { required: true, reason: 'approved-week-expired', schedule_id: schedule.schedule_id };
  return { required: false, reason: 'approved-week-current', schedule_id: schedule.schedule_id };
}

export function evaluateInterviewProposal(proposal, profile, {
  calendar_busy = [], outbound_email_authorized = false,
} = {}) {
  const schedule = validateAvailabilityProfile(profile);
  const interval = parseInterval(proposal, 'proposal');
  const base = { schema_version: 1, schedule_id: schedule.schedule_id,
    schedule_provenance_sha256: schedule.provenance_sha256,
    outbound: { send: false, authorization_present: outbound_email_authorized === true } };
  if (interval.ambiguous) return { ...base, decision: 'ambiguous_time', reply_eligible: false,
    review_required: true, reasons: ['explicit-offset-times-required'] };
  if (!Array.isArray(calendar_busy) || calendar_busy.length > 500) throw new Error('calendar_busy must be a bounded array');
  const busy = calendar_busy.map((item, index) => parseInterval(item, `calendar_busy[${index}]`));
  if (busy.some(item => item.ambiguous)) return { ...base, decision: 'ambiguous_calendar_data', reply_eligible: false,
    review_required: true, reasons: ['calendar-interval-needs-explicit-offset'] };
  if (busy.some(item => overlaps(interval, item))) return { ...base, decision: 'calendar_conflict', reply_eligible: false,
    review_required: true, reasons: ['calendar-conflict'] };
  const start = localParts(interval.start, schedule.timezone); const end = localParts(interval.end, schedule.timezone);
  if (start.date !== end.date || start.date < schedule.effective_week || start.date > schedule.effective_through) {
    return { ...base, decision: 'outside_approved_slot', reply_eligible: false,
      review_required: true, reasons: ['outside-approved-week-or-crosses-day'] };
  }
  const exception = schedule.exceptions.find(item => item.date === start.date);
  const slots = exception ? (exception.unavailable ? [] : exception.slots)
    : schedule.recurring_slots.filter(slot => slot.days.includes(start.day));
  const inside = slots.some(slot => start.minute >= slot.startMinute && end.minute <= slot.endMinute);
  if (!inside) return { ...base, decision: 'outside_approved_slot', reply_eligible: false,
    review_required: true, reasons: [exception?.unavailable ? 'date-marked-unavailable' : 'outside-approved-hours'] };
  return { ...base, decision: 'within_approved_slot', reply_eligible: outbound_email_authorized === true,
    review_required: outbound_email_authorized !== true,
    reasons: outbound_email_authorized === true ? [] : ['outbound-email-not-authorized'] };
}
