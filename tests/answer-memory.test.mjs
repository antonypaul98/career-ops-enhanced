import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createAnswerRecord, emptyAnswerMemory, getAnswerMemoryPath, loadAnswerMemory,
  resolveAnswer, saveAnswerRecord, upsertAnswerRecord, validateAnswerMemory,
} from '../enhanced/answer-memory.mjs';

const artifactDigest = 'a'.repeat(64);
const provenance = (overrides = {}) => ({
  type: 'candidate_statement', source: 'synthetic candidate review',
  quote: 'I use TypeScript professionally.', confirmed_at: '2026-10-10', ...overrides,
});
const application = (overrides = {}) => ({
  key: '042-acme-engineer', company: 'Synthetic Acme', role: 'Engineer',
  artifact_digest: artifactDigest, ...overrides,
});
const record = (overrides = {}) => createAnswerRecord({
  fact_key: 'typescript_experience', question: 'Do you use TypeScript?', answer: 'Yes',
  category: 'experience', scope: 'reusable', status: 'user_confirmed', provenance: provenance(),
  ...overrides,
});

test('reuses only an explicit confirmed candidate fact and stays draft-only', () => {
  const memory = upsertAnswerRecord(emptyAnswerMemory(), record());
  const result = resolveAnswer(memory, { fact_key: 'typescript_experience' });
  assert.equal(result.decision, 'candidate_fact_found');
  assert.equal(result.proposed_answer, 'Yes');
  assert.equal(result.needs_candidate_confirmation, false);
  assert.equal(result.application_action, 'none');
  assert.equal(result.files_written, false);
});

test('does not fuzzy-match similar employer wording or missing fact keys', () => {
  const memory = upsertAnswerRecord(emptyAnswerMemory(), record());
  assert.equal(resolveAnswer(memory, { fact_key: 'typescript_years' }).decision, 'no_match');
  assert.equal(resolveAnswer(memory, { fact_key: '' }).decision, 'no_match');
});

test('needs-review and rejected records are never answer authority', () => {
  let memory = upsertAnswerRecord(emptyAnswerMemory(), record({ status: 'needs_review' }));
  memory = upsertAnswerRecord(memory, record({ fact_key: 'go_experience', answer: 'No', status: 'rejected' }));
  assert.equal(resolveAnswer(memory, { fact_key: 'typescript_experience' }).decision, 'no_match');
  assert.equal(resolveAnswer(memory, { fact_key: 'go_experience' }).decision, 'no_match');
});

test('sensitive answers must be bound to an exact application and artifact digest', () => {
  const sensitive = record({
    fact_key: 'future_sponsorship', question: 'Will you require sponsorship?', answer: 'Yes',
    category: 'sponsorship', scope: 'application_specific', application: application(),
  });
  const memory = upsertAnswerRecord(emptyAnswerMemory(), sensitive);
  assert.equal(resolveAnswer(memory, { fact_key: 'future_sponsorship', application_key: application().key, artifact_digest: artifactDigest }).decision, 'needs_candidate_confirmation');
  assert.equal(resolveAnswer(memory, { fact_key: 'future_sponsorship', application_key: '043-other-role', artifact_digest: artifactDigest }).decision, 'no_match');
  assert.equal(resolveAnswer(memory, { fact_key: 'future_sponsorship', application_key: application().key, artifact_digest: 'b'.repeat(64) }).decision, 'no_match');
});

test('rejects reusable sensitive answers and JD/application evidence as reusable authority', () => {
  assert.throws(() => record({ category: 'salary' }), /application_specific/);
  assert.throws(() => record({ provenance: provenance({ type: 'employer_requirement' }) }), /provenance.type/);
  assert.throws(() => record({ provenance: provenance({ type: 'application_artifact' }) }), /cannot authorize reusable/);
});

test('requires complete provenance and a valid application binding', () => {
  assert.throws(() => record({ provenance: provenance({ quote: '' }) }), /provenance.quote/);
  assert.throws(() => record({ provenance: provenance({ confirmed_at: '2026-99-99' }) }), /YYYY-MM-DD/);
  assert.throws(() => record({ scope: 'application_specific', application: application({ artifact_digest: 'not-a-digest' }) }), /sha256/);
  assert.throws(() => record({ scope: 'application_specific', application: application({ company: '' }) }), /application.company/);
});

test('reports conflicting confirmed values instead of choosing silently', () => {
  let memory = upsertAnswerRecord(emptyAnswerMemory(), record({ answer: 'Yes' }));
  memory = upsertAnswerRecord(memory, record({ answer: 'No' }));
  const result = resolveAnswer(memory, { fact_key: 'typescript_experience' });
  assert.equal(result.decision, 'conflicting_candidate_facts');
  assert.equal(result.proposed_answer, undefined);
  assert.equal(result.needs_candidate_confirmation, true);
});

test('persists only under the supplied private data root with restrictive mode', async () => {
  const root = mkdtempSync(join(tmpdir(), 'answer-memory-'));
  try {
    await saveAnswerRecord(root, {
      fact_key: 'typescript_experience', question: 'Do you use TypeScript?', answer: 'Yes',
      category: 'experience', scope: 'reusable', status: 'source_verified',
      provenance: provenance({ type: 'candidate_document', source: 'synthetic CV fixture' }),
    });
    const path = getAnswerMemoryPath(root);
    assert.equal(path, join(root, 'data', 'application-answer-memory.json'));
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.match(readFileSync(path, 'utf8'), /synthetic CV fixture/);
    assert.equal(loadAnswerMemory({ root, required: true }).records.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('validation catches duplicate IDs and application data on reusable records', () => {
  const first = record();
  assert.match(validateAnswerMemory({ schema_version: 1, records: [first, first] }).join('\n'), /duplicate id/);
  assert.match(validateAnswerMemory({ schema_version: 1, records: [{ ...first, application: application() }] }).join('\n'), /only allowed/);
});

