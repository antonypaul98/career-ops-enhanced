import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeReviewedOutcomes } from '../enhanced/reviewed-outcome-learning.mjs';
import { createApplicationBundle } from '../enhanced/application-approval.mjs';
import { createLifecycleEvent, confirmLifecycleEvent, persistLifecycleEvidence,
  LIFECYCLE_CONFIRMATION_STATEMENT } from '../enhanced/application-lifecycle.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'co-c14-synthetic-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  mkdirSync(join(root, 'data'));
  return { root, rows: [], nextId: 1 };
}
function addRow(f, stages = ['Applied'], { orphan = false, company = 'SYNTHETIC_PRIVATE_COMPANY' } = {}) {
  const n = f.nextId++;
  const key = 'fixture-' + n;
  const source = 'SYNTHETIC_PRIVATE_RECEIPT_' + n + ' employer response for unit tests';
  const sourcePath = 'data/source-' + n + '.txt';
  writeFileSync(join(f.root, sourcePath), source);
  const bundle = createApplicationBundle({
    application: { key, company, role: 'Synthetic Engineer', url: 'https://example.test/job/' + n },
    fields: [{ key: 'summary', value: 'Synthetic test-only fact',
      source: { type: 'candidate_statement', status: 'user_confirmed', ref: 'synthetic',
        quote: 'Synthetic test-only fact' } }],
  });
  const tags = [];
  for (const [index, status] of stages.entries()) {
    const kind = status === 'Applied' ? 'submission_receipt' : status === 'Hired' ? 'accepted_offer'
      : ['Discarded', 'SKIP'].includes(status) ? 'candidate_decision' : 'employer_message';
    const day = String(10 + index).padStart(2, '0');
    const draft = createLifecycleEvent({ bundle, tracker_row: n, status,
      observed_at: '2026-01-' + day + 'T11:00:00.000Z',
      evidence: { kind, origin: 'observed_actual', source: sourcePath, sha256: sha(source),
        reference: 'SYNTHETIC_PRIVATE_RECEIPT_' + n, quote: 'employer response' } });
    const event = confirmLifecycleEvent(draft, { confirmed: true, event_digest: draft.event_digest,
      statement: LIFECYCLE_CONFIRMATION_STATEMENT, confirmed_at: '2026-01-' + day + 'T12:00:00.000Z' });
    persistLifecycleEvidence(f.root, { event, source_base64: Buffer.from(source).toString('base64') });
    tags.push('lifecycle:' + event.event_digest);
  }
  f.rows.push({ n, company, notes: orphan ? '—' : tags.join('; ') || '—', status: stages.at(-1) });
  return tags;
}
function save(f) {
  const lines = ['| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...f.rows.map(r => '| ' + r.n + ' | 2026-01-01 | ' + r.company +
      ' | Synthetic Engineer | 4/5 | ' + r.status + ' | — | — | ' + r.notes +
      ' | https://example.test/job/' + r.n + ' |')];
  const path = join(f.root, 'data', 'applications.md');
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}
test('only canonical tracker-linked, confirmed actual receipts count as submitted', t => {
  const f = fixture(t); addRow(f, ['Applied']); addRow(f, ['Applied','Responded','Interview']);
  addRow(f, ['Applied','Rejected']); addRow(f, ['Applied'], { orphan: true });
  const result = summarizeReviewedOutcomes(f.root, { trackerPath: save(f), minSubmitted: 2 });
  assert.deepEqual(result.sample, { submitted: 3, minimum: 2, sufficient: true });
  assert.deepEqual(result.counts, { responded: 2, interviewed: 1, offers: 0, hired: 0, rejected: 1, awaiting: 1 });
  assert.equal(result.rates.response_percent, 66.7);
  assert.equal(result.rates.recorded_interview_percent, 33.3);
  assert.equal(result.advisory_only, true);
  assert.equal(result.application_action, 'none');
  assert.equal(result.score_changes, false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false);
});
test('counts are displayed while rates are withheld below the sample floor', t => {
  const f = fixture(t); addRow(f, ['Applied']);
  const result = summarizeReviewedOutcomes(f.root, { trackerPath: save(f) });
  assert.equal(result.sample.sufficient, false);
  assert.equal(result.counts.awaiting, 1);
  assert.deepEqual(Object.values(result.rates), [null, null, null]);
});
test('an offer cannot imply an interview, and silence is not rejection', t => {
  const f = fixture(t); addRow(f, ['Applied', 'Offer']); addRow(f, ['Applied']);
  const result = summarizeReviewedOutcomes(f.root, { trackerPath: save(f), minSubmitted: 2 });
  assert.equal(result.counts.interviewed, 0);
  assert.equal(result.counts.offers, 1);
  assert.equal(result.counts.rejected, 0);
  assert.equal(result.counts.awaiting, 1);
});
test('events without actual recorded Applied transition are excluded', t => {
  const f = fixture(t); addRow(f, ['Responded']);
  const result = summarizeReviewedOutcomes(f.root, { trackerPath: save(f) });
  assert.equal(result.sample.submitted, 0);
});
test('missing archives and mismatched company fail closed', t => {
  const f = fixture(t); const tags = addRow(f, ['Applied']);
  f.rows[0].notes = 'lifecycle:' + 'a'.repeat(64);
  assert.throws(() => summarizeReviewedOutcomes(f.root, { trackerPath: save(f) }));
  f.rows[0].notes = tags[0]; f.rows[0].company = 'DIFFERENT';
  assert.throws(() => summarizeReviewedOutcomes(f.root, { trackerPath: save(f) }), /does not match/);
});
test('duplicate tracker rows, repeated notes and bad sample floors fail closed', t => {
  const f = fixture(t); const tags = addRow(f, ['Applied']);
  f.rows[0].notes = tags[0] + '; ' + tags[0];
  assert.throws(() => summarizeReviewedOutcomes(f.root, { trackerPath: save(f) }), /Duplicate lifecycle/);
  f.rows[0].notes = tags[0]; f.rows.push({ ...f.rows[0] });
  assert.throws(() => summarizeReviewedOutcomes(f.root, { trackerPath: save(f) }), /duplicate application/);
  assert.throws(() => summarizeReviewedOutcomes(f.root, { trackerPath: save(f), minSubmitted: 1 }), /minSubmitted/);
});
