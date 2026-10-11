/**
 * C11 private factual-answer memory.
 *
 * The store lives only in the user's data root. This module never reads a job
 * description as candidate evidence, never fills a form and never submits an
 * application. It returns reviewable answer proposals to the existing apply
 * workflow, preserving provenance and exact application boundaries.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';

export const ANSWER_MEMORY_SCHEMA_VERSION = 1;
export const ANSWER_SCOPES = new Set(['reusable', 'application_specific']);
export const ANSWER_STATUSES = new Set(['user_confirmed', 'source_verified', 'needs_review', 'rejected']);
export const PROVENANCE_TYPES = new Set(['candidate_statement', 'candidate_document', 'application_artifact']);
export const SENSITIVE_CATEGORIES = new Set([
  'authorization', 'sponsorship', 'salary', 'relocation', 'availability',
  'legal', 'demographic', 'disability', 'veteran', 'background_check',
  'self_identification',
]);

const compact = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const factKey = (value) => compact(value).toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const isDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function getAnswerMemoryPath(root = getCareerOpsRoot()) {
  return join(root, 'data', 'application-answer-memory.json');
}

export function emptyAnswerMemory() {
  return { schema_version: ANSWER_MEMORY_SCHEMA_VERSION, records: [] };
}

export function validateAnswerMemory(memory) {
  const errors = [];
  if (!memory || typeof memory !== 'object') return ['memory must be a mapping'];
  if (memory.schema_version !== ANSWER_MEMORY_SCHEMA_VERSION) errors.push(`schema_version must be ${ANSWER_MEMORY_SCHEMA_VERSION}`);
  if (!Array.isArray(memory.records)) return [...errors, 'records must be a list'];
  const ids = new Set();
  memory.records.forEach((record, index) => {
    const path = `records[${index}]`;
    if (!record || typeof record !== 'object') return errors.push(`${path} must be a mapping`);
    if (!compact(record.id)) errors.push(`${path}.id is required`);
    else if (ids.has(record.id)) errors.push(`duplicate id: ${record.id}`);
    else ids.add(record.id);
    if (!factKey(record.fact_key) || record.fact_key !== factKey(record.fact_key)) errors.push(`${path}.fact_key must be canonical`);
    if (!compact(record.question)) errors.push(`${path}.question is required`);
    if (!compact(record.answer)) errors.push(`${path}.answer is required`);
    if (!compact(record.category)) errors.push(`${path}.category is required`);
    if (!ANSWER_SCOPES.has(record.scope)) errors.push(`${path}.scope must be reusable or application_specific`);
    if (!ANSWER_STATUSES.has(record.status)) errors.push(`${path}.status is invalid`);
    if (SENSITIVE_CATEGORIES.has(record.category) && record.scope !== 'application_specific') {
      errors.push(`${path}.scope must be application_specific for sensitive category ${record.category}`);
    }
    const provenance = record.provenance;
    if (!provenance || typeof provenance !== 'object') errors.push(`${path}.provenance is required`);
    else {
      if (!PROVENANCE_TYPES.has(provenance.type)) errors.push(`${path}.provenance.type is invalid`);
      if (!compact(provenance.source)) errors.push(`${path}.provenance.source is required`);
      if (!compact(provenance.quote)) errors.push(`${path}.provenance.quote is required`);
      if (!isDate(provenance.confirmed_at)) errors.push(`${path}.provenance.confirmed_at must be YYYY-MM-DD`);
      if (record.scope === 'reusable' && provenance.type === 'application_artifact') {
        errors.push(`${path}.application_artifact provenance cannot authorize reusable scope`);
      }
    }
    const application = record.application;
    if (record.scope === 'application_specific') {
      if (!application || typeof application !== 'object') errors.push(`${path}.application is required`);
      else {
        if (!compact(application.key)) errors.push(`${path}.application.key is required`);
        if (!compact(application.company)) errors.push(`${path}.application.company is required`);
        if (!compact(application.role)) errors.push(`${path}.application.role is required`);
        if (!/^[a-f0-9]{64}$/.test(String(application.artifact_digest ?? ''))) errors.push(`${path}.application.artifact_digest must be sha256`);
      }
    } else if (application != null) errors.push(`${path}.application is only allowed for application_specific records`);
  });
  return errors;
}

export function createAnswerRecord(input = {}) {
  const key = factKey(input.fact_key || input.question);
  const scope = input.scope || 'application_specific';
  const category = factKey(input.category || 'general');
  const record = {
    id: `answer-${digest([key, scope, compact(input.application?.key), compact(input.answer)].join('\0')).slice(0, 18)}`,
    fact_key: key,
    question: compact(input.question),
    answer: compact(input.answer),
    category,
    scope,
    status: input.status || 'needs_review',
    provenance: {
      type: input.provenance?.type,
      source: compact(input.provenance?.source),
      quote: compact(input.provenance?.quote),
      confirmed_at: input.provenance?.confirmed_at,
    },
    ...(scope === 'application_specific' ? { application: {
      key: compact(input.application?.key),
      company: compact(input.application?.company),
      role: compact(input.application?.role),
      artifact_digest: compact(input.application?.artifact_digest).toLowerCase(),
    } } : {}),
  };
  const errors = validateAnswerMemory({ schema_version: ANSWER_MEMORY_SCHEMA_VERSION, records: [record] });
  if (errors.length) throw new Error(`Answer record rejected:\n- ${errors.join('\n- ')}`);
  return record;
}

export function upsertAnswerRecord(memory, record) {
  const candidate = {
    schema_version: ANSWER_MEMORY_SCHEMA_VERSION,
    records: [...(memory?.records ?? []).filter((item) => item.id !== record.id), record],
  };
  const errors = validateAnswerMemory(candidate);
  if (errors.length) throw new Error(`Answer memory rejected:\n- ${errors.join('\n- ')}`);
  return candidate;
}

export function loadAnswerMemory({ root = getCareerOpsRoot(), required = false } = {}) {
  const path = getAnswerMemoryPath(root);
  if (!existsSync(path)) {
    if (required) throw new Error(`Answer memory not found: ${path}`);
    return emptyAnswerMemory();
  }
  const memory = JSON.parse(readFileSync(path, 'utf8'));
  const errors = validateAnswerMemory(memory);
  if (errors.length) throw new Error(`Invalid answer memory:\n- ${errors.join('\n- ')}`);
  return memory;
}

export async function saveAnswerRecord(root, input) {
  const path = getAnswerMemoryPath(root);
  const record = createAnswerRecord(input);
  return withPipelineLock(path, () => {
    const memory = upsertAnswerRecord(loadAnswerMemory({ root }), record);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(memory, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, path);
      return record;
    } catch (error) {
      try { rmSync(temporary, { force: true }); } catch { /* preserve original */ }
      throw error;
    }
  });
}

/**
 * Resolve one fact by explicit key. There is deliberately no fuzzy question
 * matching: similar employer wording is not authority to reuse an answer.
 */
export function resolveAnswer(memory, request = {}) {
  const key = factKey(request.fact_key);
  const applicationKey = compact(request.application_key);
  const artifactDigest = compact(request.artifact_digest).toLowerCase();
  const candidates = (memory?.records ?? []).filter((record) =>
    record.fact_key === key && ['user_confirmed', 'source_verified'].includes(record.status) &&
    (record.scope === 'reusable' || (
      record.application?.key === applicationKey && record.application?.artifact_digest === artifactDigest
    ))
  );
  const values = new Set(candidates.map((record) => record.answer));
  if (!key || candidates.length === 0) return result('no_match', [], true);
  if (values.size !== 1) return result('conflicting_candidate_facts', candidates, true);
  const chosen = candidates.find((record) => record.scope === 'application_specific') ?? candidates[0];
  const sensitive = SENSITIVE_CATEGORIES.has(chosen.category);
  return {
    ...result(sensitive ? 'needs_candidate_confirmation' : 'candidate_fact_found', candidates, sensitive),
    proposed_answer: chosen.answer,
    selected_record_id: chosen.id,
    provenance: { ...chosen.provenance },
    scope: chosen.scope,
  };
}

function result(decision, records, needsConfirmation) {
  return {
    decision,
    candidate_record_ids: records.map((record) => record.id),
    needs_candidate_confirmation: needsConfirmation,
    draft_only: true,
    files_written: false,
    application_action: 'none',
    employer_requirements_are_candidate_facts: false,
  };
}

