import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApplicationBundle,
  createExactApproval,
  digestApplicationContent,
  mockExecuteApplication,
  verifyApplicationBundle,
} from '../enhanced/application-approval.mjs';

const digest = 'a'.repeat(64);
const application = { key: '042-synthetic-acme-engineer', company: 'Synthetic Acme', role: 'Engineer', url: 'https://jobs.example.test/42' };
const source = { type: 'candidate_statement', status: 'user_confirmed', ref: 'synthetic-review-1', quote: 'Synthetic candidate answer.' };
const field = (overrides = {}) => ({ key: 'first_name', label: 'First name', value: 'Synthetic', source, ...overrides });
const bundle = (overrides = {}) => createApplicationBundle({
  application,
  fields: [field()],
  artifacts: [{ kind: 'resume', path: 'output/synthetic-resume.pdf', sha256: digest }],
  ...overrides,
});
const approval = value => createExactApproval(value, {
  confirmed: true,
  statement: 'I approve this exact application content for mock execution only.',
  approved_at: '2026-10-10T21:00:00-04:00',
});

test('seals exact content with a deterministic canonical digest', () => {
  const first = bundle();
  const second = createApplicationBundle({
    fields: [{ source: { quote: source.quote, ref: source.ref, status: source.status, type: source.type }, value: 'Synthetic', label: 'First name', key: 'first_name' }],
    artifacts: [{ sha256: digest, path: 'output/synthetic-resume.pdf', kind: 'resume' }],
    application: { role: application.role, url: application.url, key: application.key, company: application.company },
  });
  assert.equal(first.content_digest, second.content_digest);
  assert.equal(digestApplicationContent({ b: 2, a: 1 }), digestApplicationContent({ a: 1, b: 2 }));
});

test('mock execution exposes exact reviewed values but performs no action', () => {
  const sealed = bundle();
  const result = mockExecuteApplication(sealed, approval(sealed));
  assert.equal(result.decision, 'mock_ready');
  assert.deepEqual(result.would_fill, [{ key: 'first_name', label: 'First name', value: 'Synthetic' }]);
  assert.equal(result.network_requests, 0);
  assert.equal(result.browser_actions, 0);
  assert.equal(result.files_written, 0);
  assert.equal(result.application_action, 'none');
  assert.equal(result.submit_allowed, false);
});

test('any answer change invalidates the sealed content and approval', () => {
  const sealed = bundle();
  const accepted = approval(sealed);
  const changed = structuredClone(sealed);
  changed.fields[0].value = 'Changed';
  assert.equal(verifyApplicationBundle(changed).reason, 'content_changed');
  assert.equal(mockExecuteApplication(changed, accepted).decision, 'blocked');
});

test('artifact digest changes require a new exact approval', () => {
  const sealed = bundle();
  const accepted = approval(sealed);
  const replaced = bundle({ artifacts: [{ kind: 'resume', path: 'output/synthetic-resume.pdf', sha256: 'b'.repeat(64) }] });
  assert.equal(mockExecuteApplication(replaced, accepted).reason, 'approval_content_mismatch');
});

test('approval cannot be reused across applications', () => {
  const sealed = bundle();
  const other = bundle({ application: { ...application, key: '043-synthetic-other-role', role: 'Other role' } });
  assert.equal(mockExecuteApplication(other, approval(sealed)).reason, 'approval_application_mismatch');
});

test('explicit candidate approval and exact mock-only statement are required', () => {
  const sealed = bundle();
  assert.throws(() => createExactApproval(sealed, { confirmed: false }), /explicit candidate confirmation/);
  assert.throws(() => createExactApproval(sealed, { confirmed: true, statement: 'Approved', approved_at: '2026-10-10' }), /exact mock-only/);
});

test('sensitive answers require field-level confirmation before sealing', () => {
  assert.throws(() => bundle({ fields: [field({ key: 'sponsorship', sensitive: true })] }), /exact candidate confirmation/);
  const sealed = bundle({ fields: [field({ key: 'sponsorship', sensitive: true, candidate_confirmed: true })] });
  assert.equal(verifyApplicationBundle(sealed).valid, true);
});

test('employer requirements and unreviewed memory cannot authorize answers', () => {
  assert.throws(() => bundle({ fields: [field({ source: { ...source, type: 'employer_requirement' } })] }), /not candidate authority/);
  assert.throws(() => bundle({ fields: [field({ source: { ...source, status: 'needs_review' } })] }), /not approved/);
});

test('recomputed digest cannot legitimize altered candidate authority', () => {
  const changed = structuredClone(bundle());
  changed.fields[0].source.type = 'employer_requirement';
  changed.content_digest = digestApplicationContent(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'content_digest')));
  assert.equal(verifyApplicationBundle(changed).reason, 'invalid_bundle');
});

test('submission-like fields and unsafe execution policies fail closed', () => {
  assert.throws(() => bundle({ fields: [field({ key: 'submit_application' })] }), /submission action/);
  const sealed = bundle();
  const changed = structuredClone(sealed);
  changed.execution_policy.submit_allowed = true;
  changed.content_digest = digestApplicationContent(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'content_digest')));
  assert.equal(verifyApplicationBundle(changed).reason, 'unsafe_execution_policy');
});

test('missing, malformed, or wrong-scope approval blocks mock execution', () => {
  const sealed = bundle();
  assert.equal(mockExecuteApplication(sealed, null).reason, 'approval_application_mismatch');
  assert.equal(mockExecuteApplication(sealed, { ...approval(sealed), scope: 'submit' }).reason, 'approval_scope_invalid');
  assert.equal(mockExecuteApplication(sealed, { ...approval(sealed), statement: 'Approved' }).reason, 'approval_scope_invalid');
  assert.throws(() => bundle({ artifacts: [{ kind: 'resume', path: 'output/a.pdf', sha256: 'bad' }] }), /SHA-256/);
});

