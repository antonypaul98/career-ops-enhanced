import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareReviewedEligibilityInput, fingerprintRequirements } from '../enhanced/eligibility-input.mjs';

function checked(text, words) {
  const sha = createHash('sha256').update(text).digest('hex');
  const span = (word, from = 0) => {
    const start = text.indexOf(word, from);
    const before = text.slice(0, start);
    const col = before.length - before.lastIndexOf('\n');
    return { line: before.split('\n').length, column_start: col,
      column_end: col + word.length, offset_start: start,
      offset_end: start + word.length, text: word };
  };
  const occurrences = words.map(([word, line]) => ({ source_span: span(word), requirement_span: span(line), section: 'Requirements' }));
  const requirements = [{ id: 'synthetic', provenance: 'job_description', candidate_evidence: false,
    kind: 'required', polarity: 'positive', requirement: words[0][0],
    source_span: occurrences[0].source_span, occurrences }];
  const extraction = { schema_version: 1, span_units: 'UTF-16; lines/columns 1-based; end exclusive; offsets 0-based',
    source_type: 'job_description', candidate_evidence: false, extraction_status: 'ok',
    source_sha256: sha, requirements };
  const review = { complete: true, source_sha256: sha,
    requirements_sha256: fingerprintRequirements(requirements), decisions: [{ requirement_id: 'synthetic',
      review_status: 'explicit', relevant: true, field: 'work_authorized', required_value: true,
      mandatory: true, jurisdiction: 'SYNTHETIC_REGION', period: 'current' }] };
  const candidate = { candidate_id: 'synthetic', facts: [{ id: 'synthetic-fact', candidate_id: 'synthetic',
    field: 'work_authorized', value: true, jurisdiction: 'SYNTHETIC_REGION', period: 'current',
    status: 'user_confirmed', provenance: { source_type: 'candidate_statement', source_id: 'synthetic' } }] };
  return prepareReviewedEligibilityInput({ jdText: text, extraction, review, candidate });
}

test('inline C03 requirement heading is accepted when source matches', () => {
  const text = 'Requirements: authorization for SYNTHETIC_REGION.\n';
  assert.equal(checked(text, [['authorization', 'authorization for SYNTHETIC_REGION.']]).status, 'ready');
});

test('different source tokens in later occurrence fail closed', () => {
  const text = 'Required: authorization for SYNTHETIC_REGION.\nRequired: TypeScript for SYNTHETIC_REGION.\n';
  const result = checked(text, [['authorization', 'Required: authorization for SYNTHETIC_REGION.'],
    ['TypeScript', 'Required: TypeScript for SYNTHETIC_REGION.']]);
  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.reason_codes, ['jd_record_unverified']);
  assert.equal(result.application_action, 'none');
});
