/**
 * C12: exact-content application approval with mock-only execution.
 *
 * This module deliberately has no filesystem, browser, HTTP, form-fill, or
 * submission dependency. It seals the exact candidate-facing content and
 * artifact digests, records an explicit approval for that seal, and can only
 * produce a reviewable mock plan.
 */

import { createHash } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_SOURCES = new Set([
  'candidate_statement',
  'candidate_document',
  'answer_memory',
  'application_artifact',
]);
const ALLOWED_STATUSES = new Set(['user_confirmed', 'source_verified']);
const FORBIDDEN_FIELD_KEYS = /(^|[_.-])(submit|send|apply|consent_to_submit)([_.-]|$)/i;
const APPROVAL_STATEMENT = 'I approve this exact application content for mock execution only.';

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestApplicationContent(content) {
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

function normalizeSource(source, fieldKey) {
  if (!source || typeof source !== 'object') throw new Error(`field ${fieldKey} source is required`);
  const type = requiredString(source.type, `field ${fieldKey} source.type`);
  const status = requiredString(source.status, `field ${fieldKey} source.status`);
  if (!ALLOWED_SOURCES.has(type)) throw new Error(`field ${fieldKey} source.type is not candidate authority`);
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`field ${fieldKey} source.status is not approved`);
  return {
    type,
    status,
    ref: requiredString(source.ref, `field ${fieldKey} source.ref`),
    quote: requiredString(source.quote, `field ${fieldKey} source.quote`),
  };
}

function normalizeField(field) {
  const key = requiredString(field?.key, 'field.key');
  if (FORBIDDEN_FIELD_KEYS.test(key)) throw new Error(`field ${key} represents a submission action`);
  const sensitive = field.sensitive === true;
  if (sensitive && field.candidate_confirmed !== true) {
    throw new Error(`sensitive field ${key} requires exact candidate confirmation`);
  }
  return {
    key,
    label: requiredString(field.label ?? key, `field ${key} label`),
    value: requiredString(field.value, `field ${key} value`),
    sensitive,
    candidate_confirmed: sensitive ? true : field.candidate_confirmed === true,
    source: normalizeSource(field.source, key),
  };
}

function normalizeArtifact(artifact) {
  const kind = requiredString(artifact?.kind, 'artifact.kind');
  const sha256 = requiredString(artifact?.sha256, `artifact ${kind} sha256`).toLowerCase();
  if (!SHA256.test(sha256)) throw new Error(`artifact ${kind} sha256 must be a lowercase SHA-256 digest`);
  return {
    kind,
    path: requiredString(artifact.path, `artifact ${kind} path`),
    sha256,
  };
}

export function createApplicationBundle({ application, fields, artifacts = [] } = {}) {
  if (!application || typeof application !== 'object') throw new Error('application is required');
  if (!Array.isArray(fields) || fields.length === 0) throw new Error('at least one field is required');
  const normalizedFields = fields.map(normalizeField);
  const duplicate = normalizedFields.find((field, index) => normalizedFields.findIndex(x => x.key === field.key) !== index);
  if (duplicate) throw new Error(`duplicate field key: ${duplicate.key}`);

  const content = {
    schema_version: 1,
    application: {
      key: requiredString(application.key, 'application.key'),
      company: requiredString(application.company, 'application.company'),
      role: requiredString(application.role, 'application.role'),
      url: requiredString(application.url, 'application.url'),
    },
    fields: normalizedFields,
    artifacts: artifacts.map(normalizeArtifact),
    execution_policy: {
      mode: 'mock_only',
      network_requests: false,
      browser_actions: false,
      filesystem_writes: false,
      submit_allowed: false,
    },
  };
  return { ...content, content_digest: digestApplicationContent(content) };
}

export function verifyApplicationBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return { valid: false, reason: 'bundle_required' };
  const { content_digest: claimed, ...content } = bundle;
  if (!SHA256.test(claimed ?? '')) return { valid: false, reason: 'invalid_content_digest' };
  const actual = digestApplicationContent(content);
  if (actual !== claimed) return { valid: false, reason: 'content_changed', claimed, actual };
  if (content.execution_policy?.mode !== 'mock_only' || content.execution_policy?.submit_allowed !== false) {
    return { valid: false, reason: 'unsafe_execution_policy' };
  }
  try {
    const normalized = createApplicationBundle({
      application: content.application,
      fields: content.fields,
      artifacts: content.artifacts,
    });
    const { content_digest: ignored, ...normalizedContent } = normalized;
    if (canonicalJson(content) !== canonicalJson(normalizedContent)) {
      return { valid: false, reason: 'noncanonical_or_unknown_content' };
    }
  } catch (error) {
    return { valid: false, reason: 'invalid_bundle', detail: error.message };
  }
  return { valid: true, content_digest: actual };
}

export function createExactApproval(bundle, confirmation = {}) {
  const checked = verifyApplicationBundle(bundle);
  if (!checked.valid) throw new Error(`cannot approve bundle: ${checked.reason}`);
  if (confirmation.confirmed !== true) throw new Error('explicit candidate confirmation is required');
  if (confirmation.statement !== APPROVAL_STATEMENT) {
    throw new Error('exact mock-only approval statement is required');
  }
  const approvedAt = requiredString(confirmation.approved_at, 'approved_at');
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error('approved_at must be a valid timestamp');
  return {
    schema_version: 1,
    application_key: bundle.application.key,
    content_digest: bundle.content_digest,
    approved_by: 'candidate',
    approved_at: approvedAt,
    statement: confirmation.statement,
    scope: 'mock_execution_only',
    submit_allowed: false,
  };
}

export function mockExecuteApplication(bundle, approval) {
  const checked = verifyApplicationBundle(bundle);
  if (!checked.valid) return { decision: 'blocked', reason: checked.reason, application_action: 'none' };
  if (!approval || approval.application_key !== bundle.application.key) {
    return { decision: 'blocked', reason: 'approval_application_mismatch', application_action: 'none' };
  }
  if (approval.content_digest !== bundle.content_digest) {
    return { decision: 'blocked', reason: 'approval_content_mismatch', application_action: 'none' };
  }
  if (
    approval.schema_version !== 1 ||
    approval.scope !== 'mock_execution_only' ||
    approval.submit_allowed !== false ||
    approval.approved_by !== 'candidate' ||
    approval.statement !== APPROVAL_STATEMENT ||
    typeof approval.approved_at !== 'string' ||
    Number.isNaN(Date.parse(approval.approved_at))
  ) {
    return { decision: 'blocked', reason: 'approval_scope_invalid', application_action: 'none' };
  }
  return {
    decision: 'mock_ready',
    application_key: bundle.application.key,
    approved_content_digest: bundle.content_digest,
    would_fill: bundle.fields.map(({ key, label, value }) => ({ key, label, value })),
    would_attach: bundle.artifacts.map(({ kind, path, sha256 }) => ({ kind, path, sha256 })),
    application_action: 'none',
    network_requests: 0,
    browser_actions: 0,
    files_written: 0,
    submit_allowed: false,
    next_step: 'Candidate reviews the mock plan and performs any real form entry and submission themselves.',
  };
}

