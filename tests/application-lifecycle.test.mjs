import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplicationBundle, createExactApproval, mockExecuteApplication } from '../enhanced/application-approval.mjs';
import { createLifecycleEvent, confirmLifecycleEvent, LIFECYCLE_CONFIRMATION_STATEMENT,
  prepareLifecycleTransition, persistLifecycleEvidence, loadLifecycleEvidence, lifecycleEvidencePath } from '../enhanced/application-lifecycle.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const WHEN = '2026-01-12T12:00:00.000Z';
const REVIEW = '2026-01-12T12:05:00.000Z';
function fixture(t, status = 'Evaluated') {
  const root = mkdtempSync(join(tmpdir(), 'co-lifecycle-synthetic-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(root, 'data'), { recursive: true });
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, '# Synthetic tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n' +
    `| 7 | 2026-01-01 | Example Works | Backend Engineer | 4/5 | ${status} | — | — | — | https://jobs.example.test/7 |\n`);
  const resume = 'Synthetic candidate: built a documented test fixture.\n';
  writeFileSync(join(root, 'cv.md'), resume);
  writeFileSync(join(root, 'data', 'resume.txt'), resume);
  const source = 'Receipt SYNTHETIC-7: application received for Example Works, Backend Engineer.\n';
  writeFileSync(join(root, 'data', 'receipt.txt'), source);
  const bundle = createApplicationBundle({ application: { key: 'example-7', company: 'Example Works',
    role: 'Backend Engineer', url: 'https://jobs.example.test/7' }, fields: [{ key: 'experience',
    value: 'Built a documented test fixture.', source: { type: 'candidate_statement', status: 'user_confirmed',
      ref: 'synthetic-review', quote: 'Built a documented test fixture.' } }],
  artifacts: [{ kind: 'resume', path: 'data/resume.txt', sha256: hash(resume) }] });
  return { root, tracker, source, bundle, originalTracker: readFileSync(tracker, 'utf8'), resume };
}
function event(f, overrides = {}) {
  const { evidence: extraEvidence = {}, ...extra } = overrides;
  const draft = createLifecycleEvent({ bundle: f.bundle, tracker_row: 7, status: 'Applied', observed_at: WHEN,
    evidence: { origin: 'observed_actual', kind: 'submission_receipt', source: 'data/receipt.txt',
      sha256: hash(f.source), reference: 'SYNTHETIC-7', quote: 'application received', ...extraEvidence }, ...extra });
  return confirmLifecycleEvent(draft, { confirmed: true, event_digest: draft.event_digest,
    statement: LIFECYCLE_CONFIRMATION_STATEMENT, confirmed_at: REVIEW });
}
function run(f, e, args = []) {
  writeFileSync(join(f.root, 'data', 'event.json'), JSON.stringify(e));
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'set-status.mjs'), '--row', '7', e.status ?? 'Applied',
    '--lifecycle-event', 'data/event.json', '--json', ...args], {
    cwd: CODE_ROOT, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, CAREER_OPS_ROOT: f.root, CAREER_OPS_TRACKER: f.tracker },
  });
  assert.equal(r.error, undefined, r.error?.message);
  return { ...r, json: JSON.parse(r.stdout), all: r.stdout + r.stderr };
}
function unchanged(f, r) {
  assert.notEqual(r.status, 0, r.all);
  assert.equal(readFileSync(f.tracker, 'utf8'), f.originalTracker);
  assert.equal(readFileSync(join(f.root, 'cv.md'), 'utf8'), f.resume);
  assert.equal(existsSync(join(f.root, 'data', 'lifecycle-evidence')), false);
}

test('real canonical writer records a reviewed receipt, exact content, date and private immutable archive', t => {
  const f = fixture(t), e = event(f), r = run(f, e);
  assert.equal(r.status, 0, r.all);
  assert.equal(r.json.newStatus, 'Applied');
  assert.equal(r.json.lifecycleEvidence.content_digest, f.bundle.content_digest);
  assert.equal(r.json.lifecycleEvidence.submission_executed, false);
  assert.match(readFileSync(f.tracker, 'utf8'), new RegExp(`lifecycle:${e.event_digest}`));
  assert.match(readFileSync(join(f.root, 'data', 'status-log.tsv'), 'utf8'), /7\t2026-01-12\tEvaluated\tApplied/);
  assert.equal(loadLifecycleEvidence(f.root, e.event_digest).source_base64, Buffer.from(f.source).toString('base64'));
  if (process.platform !== 'win32') assert.equal(statSync(lifecycleEvidencePath(f.root, e.event_digest)).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(f.root, 'cv.md'), 'utf8'), f.resume);
});
test('retry is idempotent for state, evidence note, transition log and follow-up', t => {
  const f = fixture(t), e = event(f);
  assert.equal(run(f, e).status, 0);
  const tracker = readFileSync(f.tracker, 'utf8'), log = readFileSync(join(f.root, 'data', 'status-log.tsv'), 'utf8');
  const r = run(f, e);
  assert.equal(r.status, 0, r.all);
  assert.equal(r.json.changed, false);
  assert.equal(readFileSync(f.tracker, 'utf8'), tracker);
  assert.equal(readFileSync(join(f.root, 'data', 'status-log.tsv'), 'utf8'), log);
});
test('dry run validates but writes no tracker, archive, transition or follow-up', t => {
  const f = fixture(t), r = run(f, event(f), ['--dry-run']);
  assert.equal(r.status, 0, r.all);
  assert.equal(r.json.lifecycleEvidence.recorded, false);
  assert.equal(readFileSync(f.tracker, 'utf8'), f.originalTracker);
  for (const name of ['lifecycle-evidence', 'status-log.tsv', 'follow-ups.md']) assert.equal(existsSync(join(f.root, 'data', name)), false);
});
test('draft observations without candidate confirmation cannot change state', t => {
  const f = fixture(t), e = event(f); delete e.confirmation;
  unchanged(f, run(f, e));
});
test('mock approval and successful mock execution are never submission evidence', t => {
  const f = fixture(t);
  const approval = createExactApproval(f.bundle, { confirmed: true, approved_at: REVIEW,
    statement: 'I approve this exact application content for mock execution only.' });
  const mock = mockExecuteApplication(f.bundle, approval);
  assert.equal(mock.decision, 'mock_ready');
  unchanged(f, run(f, mock));
  assert.throws(() => event(f, { evidence: { origin: 'mock' } }), /Actual lifecycle evidence/);
  assert.throws(() => event(f, { evidence: { kind: 'intent_to_submit' } }), /Actual lifecycle evidence/);
});
test('changed exact application content invalidates the observation', t => {
  const f = fixture(t), e = event(f); e.bundle.fields[0].value = 'Invented production experience';
  unchanged(f, run(f, e));
});
test('changed actual attachment bytes cannot be recorded as the approved submission', t => {
  const f = fixture(t), e = event(f); writeFileSync(join(f.root, 'data', 'resume.txt'), 'Changed bytes');
  unchanged(f, run(f, e));
});
test('changed receipt, missing reference and absent quote fail closed', t => {
  const f = fixture(t), e = event(f); writeFileSync(join(f.root, 'data', 'receipt.txt'), 'tampered');
  unchanged(f, run(f, e));
  writeFileSync(join(f.root, 'data', 'receipt.txt'), f.source);
  unchanged(f, run(f, event(f, { evidence: { reference: 'OTHER-RECEIPT' } })));
  unchanged(f, run(f, event(f, { evidence: { quote: 'not in this source' } })));
});
test('wrong tracker number, company, role and posting never select a similar application', t => {
  for (const [field, value] of [['company', 'Other Works'], ['role', 'Frontend Engineer'], ['url', 'https://jobs.example.test/8']]) {
    const f = fixture(t); const bundle = createApplicationBundle({ ...f.bundle,
      application: { ...f.bundle.application, [field]: value } });
    unchanged(f, run(f, event(f, { bundle })));
  }
  const f = fixture(t); unchanged(f, run(f, event(f, { tracker_row: 8 })));
});
test('confirmation cannot be replayed onto another event digest', t => {
  const f = fixture(t), e = event(f); e.confirmation.event_digest = 'a'.repeat(64);
  unchanged(f, run(f, e));
});
test('unknown fields and a claimed submission permission cannot enter the observation contract', t => {
  const f = fixture(t), e = event(f); e.submit_allowed = true;
  unchanged(f, run(f, e));
});
test('future or impossible dates and review before observation are refused', t => {
  const f = fixture(t);
  for (const observed_at of ['2099-01-01T00:00:00Z', '2026-02-30T12:00:00Z', 'not a date']) {
    assert.throws(() => event(f, { observed_at }), /timestamp|calendar/);
  }
  const e = event(f); e.confirmation.confirmed_at = '2026-01-11T00:00:00Z';
  unchanged(f, run(f, e));
});
test('an explicit event date cannot disagree with --on', t => {
  const f = fixture(t); unchanged(f, run(f, event(f), ['--on', '2026-01-11']));
});
test('--force cannot bypass lifecycle order or evidence validation', t => {
  const f = fixture(t, 'Interview'); unchanged(f, run(f, event(f), ['--force']));
});
test('terminal states cannot be silently reopened', t => {
  for (const status of ['Rejected', 'Discarded', 'SKIP', 'Hired']) {
    const f = fixture(t, status); unchanged(f, run(f, event(f)));
  }
});
test('source traversal and external tracker overrides are fenced to the private root', t => {
  const f = fixture(t), e = event(f, { evidence: { source: '../outside.txt' } });
  unchanged(f, run(f, e));
  assert.throws(() => prepareLifecycleTransition({ root: f.root, eventPath: 'data/event.json',
    trackerPath: join(f.root, '..', 'other-tracker.md'), target: { num: 7 }, newStatus: 'Applied' }), /root/);
});
test('symlinked evidence directories cannot escape the candidate root', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), other = fixture(t);
  symlinkSync(other.root, join(f.root, 'escape'), 'dir');
  unchanged(f, run(f, event(f, { evidence: { source: 'escape/data/receipt.txt' } })));
  symlinkSync(other.root, join(f.root, 'data', 'lifecycle-evidence'), 'dir');
  assert.notEqual(run(f, event(f)).status, 0);
  assert.equal(readFileSync(f.tracker, 'utf8'), f.originalTracker);
});
test('archive write failure prevents the tracker transition', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'data', 'lifecycle-evidence'), 'not a directory');
  const r = run(f, event(f));
  assert.notEqual(r.status, 0, r.all);
  assert.equal(readFileSync(f.tracker, 'utf8'), f.originalTracker);
});
test('interrupted tracker write recovers by reusing its archived observation', t => {
  const f = fixture(t), e = event(f);
  writeFileSync(join(f.root, 'data', 'event.json'), JSON.stringify(e));
  const prepared = prepareLifecycleTransition({ root: f.root, eventPath: 'data/event.json', trackerPath: f.tracker,
    target: { num: 7, company: 'Example Works', role: 'Backend Engineer', status: 'Evaluated', notes: '—' }, newStatus: 'Applied' });
  persistLifecycleEvidence(f.root, prepared); // interruption after archive, before canonical tracker write
  assert.equal(readFileSync(f.tracker, 'utf8'), f.originalTracker);
  const r = run(f, e);
  assert.equal(r.status, 0, r.all);
  assert.equal(r.json.newStatus, 'Applied');
});
test('corrupted existing evidence is preserved and refuses new tracker writes', t => {
  const f = fixture(t), e = event(f);
  mkdirSync(join(f.root, 'data', 'lifecycle-evidence'));
  const file = lifecycleEvidencePath(f.root, e.event_digest); writeFileSync(file, '{"corrupt":true}');
  const r = run(f, e);
  assert.notEqual(r.status, 0, r.all);
  assert.equal(readFileSync(f.tracker, 'utf8'), f.originalTracker);
  assert.equal(readFileSync(file, 'utf8'), '{"corrupt":true}');
});
test('evidence note cannot be replaced or overridden by an ordinary note', t => {
  const f = fixture(t); unchanged(f, run(f, event(f), ['--note', 'not submitted']));
});
test('full canonical lifecycle retains original submission content and ends at Hired', t => {
  const f = fixture(t); assert.equal(run(f, event(f)).status, 0);
  for (const [index, status] of ['Responded', 'Interview', 'Offer', 'Hired'].entries()) {
    const observed_at = `2026-01-${13 + index}T12:00:00.000Z`;
    const quote = { Responded: 'Recruiter response received', Interview: 'Interview scheduled',
      Offer: 'Written offer received', Hired: 'Candidate accepted the written offer' }[status];
    const source = `SYNTHETIC-7: ${quote} for Example Works, Backend Engineer.\n`;
    writeFileSync(join(f.root, 'data', 'receipt.txt'), source);
    const draft = createLifecycleEvent({ bundle: f.bundle, tracker_row: 7, status, observed_at,
      evidence: { origin: 'observed_actual', kind: status === 'Hired' ? 'accepted_offer' : 'employer_message',
        source: 'data/receipt.txt', sha256: hash(source), reference: 'SYNTHETIC-7', quote } });
    const e = confirmLifecycleEvent(draft, { confirmed: true, event_digest: draft.event_digest,
      statement: LIFECYCLE_CONFIRMATION_STATEMENT, confirmed_at: observed_at });
    const r = run(f, e); assert.equal(r.status, 0, r.all);
  }
  assert.match(readFileSync(f.tracker, 'utf8'), /\| Hired \|/);
  assert.equal(readFileSync(join(f.root, 'cv.md'), 'utf8'), f.resume);
});
test('older observations and changed application identities cannot replace recorded history', t => {
  const f = fixture(t); assert.equal(run(f, event(f)).status, 0);
  const otherBundle = createApplicationBundle({ ...f.bundle, application: { ...f.bundle.application, key: 'other-application' } });
  const r = run(f, event(f, { bundle: otherBundle, status: 'Interview', evidence: { kind: 'employer_message' } }));
  assert.notEqual(r.status, 0, r.all);
  const old = run(f, event(f, { status: 'Interview', observed_at: '2026-01-11T12:00:00.000Z', evidence: { kind: 'employer_message' } }));
  assert.notEqual(old.status, 0, old.all);
  assert.match(readFileSync(f.tracker, 'utf8'), /\| Applied \|/);
});
