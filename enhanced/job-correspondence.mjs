/**
 * Privacy-safe, read-only intake for job correspondence.
 *
 * The caller supplies bounded message metadata and explicit application records.
 * This module never calls Gmail/Calendar, sends mail, writes the tracker, or
 * converts employer text into candidate facts. Its output is review advice.
 */
import { createHash } from 'node:crypto';
import { classifyReply, extractDomain, matchCandidates } from '../reply-matcher.mjs';

const SOURCES = new Set(['career_ops', 'manual']);
const MAX_MESSAGES = 1000;
const MAX_APPLICATIONS = 10000;
const MAX_TEXT = 20000;
const SHA256 = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();

function bounded(value, name) {
  const text = clean(value);
  if (text.length > MAX_TEXT) throw new Error(`${name} exceeds the intake limit`);
  return text;
}

function uniqueStrings(values, name) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100) throw new Error(`${name} must be a bounded array`);
  const result = values.map((value, index) => bounded(value, `${name}[${index}]`)).filter(Boolean);
  return [...new Set(result)];
}

function validateApplications(applications) {
  if (!Array.isArray(applications) || applications.length > MAX_APPLICATIONS) {
    throw new Error('applications must be a bounded array');
  }
  const ids = new Set();
  return applications.map((application, index) => {
    if (!application || typeof application !== 'object' || Array.isArray(application)) {
      throw new Error(`applications[${index}] must be an object`);
    }
    const application_id = bounded(application.application_id, `applications[${index}].application_id`);
    const company = bounded(application.company, `applications[${index}].company`);
    const role = bounded(application.role, `applications[${index}].role`);
    if (!application_id || !company || !role || ids.has(application_id)) {
      throw new Error('Every application needs a unique id, company, and role');
    }
    if (!SOURCES.has(application.source)) throw new Error('Application source must be career_ops or manual');
    ids.add(application_id);
    return {
      application_id, company, role, source: application.source,
      job_id: bounded(application.job_id, `applications[${index}].job_id`),
      thread_ids: uniqueStrings(application.thread_ids, `applications[${index}].thread_ids`),
      employer_domains: uniqueStrings(application.employer_domains, `applications[${index}].employer_domains`)
        .map(value => lower(value).replace(/^@/, '')),
    };
  });
}

function correspondenceType(message) {
  const text = lower(`${message.subject} ${message.body_snippet}`);
  if (/\b(cancel(?:led|ed|ation)?|withdrawn)\b/.test(text) && /\b(interview|meeting|call)\b/.test(text)) {
    return { type: 'interview_cancelled', evidence: ['cancellation wording', 'interview wording'] };
  }
  if (/\b(reschedul(?:e|ed|ing)|different time|another time|move (?:the|our) (?:interview|meeting))\b/.test(text)) {
    return { type: 'interview_reschedule', evidence: ['rescheduling wording'] };
  }
  if (/\b(interview|phone screen|onsite)\b/.test(text)
    && /\b(choose|pick|select|book|schedule|availability|available|time|slot)\b/.test(text)) {
    return { type: 'interview_proposal', evidence: ['interview wording', 'scheduling wording'] };
  }
  if (/\b(recruiter|talent acquisition|sourcing)\b/.test(text)
    && /\b(opportunity|role|position|opening|connect|chat)\b/.test(text)) {
    return { type: 'recruiter_outreach', evidence: ['recruiter outreach wording'] };
  }
  const base = classifyReply(message);
  const mapped = {
    'Auto-confirmation': 'application_acknowledgement',
    'Need Action': /\b(assessment|coding (?:challenge|test)|online test|take-home)\b/.test(text)
      ? 'assessment' : 'action_requested',
    Interview: 'interview_proposal', Rejected: 'rejection', Offer: 'offer',
    Responded: 'employer_update', Noise: 'noise', Unknown: 'ambiguous',
  };
  return { type: mapped[base.type] ?? 'ambiguous', evidence: base.evidence.map(value => `keyword:${value}`) };
}

function exactToken(text, token) {
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
}

function findMatches(message, applications) {
  const text = `${message.from} ${message.subject} ${message.body_snippet}`;
  const domain = extractDomain(message.from);
  const scored = applications.map((application, index) => {
    let score = 0;
    const signals = [];
    if (message.thread_id && application.thread_ids.includes(message.thread_id)) {
      score += 100; signals.push('bound-thread-id');
    }
    if (application.job_id && exactToken(text, application.job_id)) {
      score += 80; signals.push('exact-job-id');
    }
    if (domain && application.employer_domains.some(item => domain === item || domain.endsWith(`.${item}`))) {
      score += 30; signals.push('declared-employer-domain');
    }
    const legacy = matchCandidates([{
      message_id: message.message_id, from: message.from, subject: message.subject,
      body_snippet: message.body_snippet, signal: message.signal,
    }], [{ num: index + 1, company: application.company, role: application.role, notes: '' }])[0];
    if (legacy.application_num && legacy.confidence === 'high') {
      score += 25; signals.push(...legacy.signals.map(value => `matcher:${value}`));
    } else if (legacy.application_num && legacy.confidence === 'medium') {
      score += 10; signals.push(...legacy.signals.map(value => `matcher:${value}`));
    }
    return { application, score, signals: [...new Set(signals)] };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: 'unlinked', application: null, signals: [] };
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { status: 'ambiguous', application: null, signals: ['multiple-equal-matches'] };
  }
  const best = scored[0];
  const reliable = best.score >= 25 || best.signals.includes('bound-thread-id') || best.signals.includes('exact-job-id');
  return reliable
    ? { status: 'linked', application: best.application, signals: best.signals }
    : { status: 'ambiguous', application: null, signals: ['weak-match-only'] };
}

function sensitiveReview(text, type) {
  const categories = [];
  if (/\b(salary|compensation|pay rate|hourly rate|base pay|equity)\b/i.test(text)) categories.push('compensation');
  if (/\b(visa|sponsor(?:ship)?|work authorization|citizen(?:ship)?|immigration|h-?1b|opt)\b/i.test(text)) categories.push('work_authorization');
  if (type === 'offer' || /\b(offer terms|employment agreement|background check)\b/i.test(text)) categories.push('offer_or_terms');
  return [...new Set(categories)];
}

function lifecycleSuggestion(type) {
  return ({ application_acknowledgement: 'Applied', employer_update: 'Responded',
    interview_proposal: 'Interview', interview_reschedule: 'Interview',
    interview_cancelled: 'Interview', rejection: 'Rejected', offer: 'Offer' })[type] ?? null;
}

/** Analyze synthetic or locally fetched metadata without performing an external action. */
export function analyzeJobCorrespondence(messages, applications, { processed_message_ids = [] } = {}) {
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) throw new Error('messages must be a bounded array');
  const apps = validateApplications(applications);
  const processed = new Set(uniqueStrings(processed_message_ids, 'processed_message_ids'));
  const seen = new Set();
  return messages.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`messages[${index}] must be an object`);
    const message = {
      message_id: bounded(raw.message_id, `messages[${index}].message_id`),
      thread_id: bounded(raw.thread_id, `messages[${index}].thread_id`),
      from: bounded(raw.from, `messages[${index}].from`),
      subject: bounded(raw.subject, `messages[${index}].subject`),
      body_snippet: bounded(raw.body_snippet, `messages[${index}].body_snippet`),
      signal: bounded(raw.signal, `messages[${index}].signal`),
    };
    if (!message.message_id || seen.has(message.message_id)) throw new Error('Every message needs a unique message_id');
    seen.add(message.message_id);
    const content = `${message.from}\n${message.subject}\n${message.body_snippet}`;
    const digest = SHA256(content);
    const duplicate = processed.has(message.message_id);
    const classification = correspondenceType(message);
    const match = findMatches(message, apps);
    const sensitive = sensitiveReview(content, classification.type);
    const promptLike = /\b(ignore (?:all )?(?:previous|prior) instructions|system prompt|developer message|execute (?:this )?command)\b/i.test(content);
    const needsReview = duplicate ? false : sensitive.length > 0 || promptLike
      || match.status !== 'linked' || ['ambiguous', 'action_requested', 'interview_proposal',
        'interview_reschedule', 'interview_cancelled', 'offer'].includes(classification.type);
    const lifecycle_status = match.status === 'linked' ? lifecycleSuggestion(classification.type) : null;
    return {
      schema_version: 1,
      message_id: message.message_id,
      thread_id: message.thread_id || null,
      idempotency_key: SHA256(`${message.message_id}\n${message.thread_id}\n${digest}`),
      content_sha256: digest,
      duplicate,
      classification: { type: classification.type, evidence: classification.evidence },
      match: match.application ? {
        status: 'linked', application_id: match.application.application_id,
        application_source: match.application.source, signals: match.signals,
      } : { status: match.status, application_id: null, application_source: null, signals: match.signals },
      review: {
        required: needsReview,
        reasons: [...new Set([
          ...(sensitive.length ? ['sensitive-content'] : []),
          ...(promptLike ? ['untrusted-instructions'] : []),
          ...(match.status !== 'linked' ? [`application-${match.status}`] : []),
          ...(['ambiguous', 'action_requested'].includes(classification.type) ? ['ambiguous-or-substantive-request'] : []),
          ...(['interview_proposal', 'interview_reschedule', 'interview_cancelled'].includes(classification.type)
            ? ['scheduling-needs-approved-availability-and-calendar-check'] : []),
          ...(classification.type === 'offer' ? ['offer-needs-human-review'] : []),
        ])],
        sensitive_categories: sensitive,
      },
      lifecycle_proposal: lifecycle_status && !duplicate ? {
        status: lifecycle_status, action: 'draft_review_only',
        candidate_confirmation_required: true, tracker_mutation: false,
      } : null,
      outbound: { action: 'none', authorized: false },
    };
  });
}
