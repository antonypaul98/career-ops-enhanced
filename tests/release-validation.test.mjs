import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateReleaseEvidence, validateReleaseEvidenceFile } from '../enhanced/release-validation.mjs';

const head = 'a'.repeat(40), tree = 'b'.repeat(40), merge = 'c'.repeat(40);
const checkpoints = Array.from({ length: 13 }, (_, i) => `C${String(i + 2).padStart(2, '0')}`);
function jobs(receiptHead) {
  return [
    { name: 'test (ubuntu-latest)', head: receiptHead, conclusion: 'success', go_dashboard: 'success' },
    { name: 'test (macos-latest)', head: receiptHead, conclusion: 'success', go_dashboard: 'success' },
    { name: 'test (windows-latest)', head: receiptHead, conclusion: 'success', go_dashboard: 'success' },
    { name: 'cv-visual', head: receiptHead, conclusion: 'success' },
    { name: 'Upgrade regression gate', head: receiptHead, conclusion: 'success' },
  ];
}
function complete() {
  return {
    schema_version: 1,
    source: { head, tree }, merge: { commit: merge, tree }, accepted_checkpoints: checkpoints,
    exact_head: { head, jobs: jobs(head), checks: {
      privacy: { head, conclusion: 'success' }, dependency: { head, conclusion: 'success' },
      direction: { head, conclusion: 'success' },
    } },
    merged_main: { head: merge, jobs: jobs(merge) },
    privacy: { private_data_published: false, applications_submitted: false, recruiter_messages_sent: false },
    physical_mac_acceptance: { environment: 'physical_user_mac', performed_by: 'user', confirmed: true,
      conclusion: 'success', head: merge },
  };
}

test('complete exact-tree, CI, privacy and physical user-Mac receipts are release-ready', () => {
  const result = validateReleaseEvidence(complete());
  assert.equal(result.decision, 'ready');
  assert.deepEqual(result.missing, []);
  assert.equal(result.release_action, 'none');
  assert.equal(result.physical_user_mac_verified, true);
});

test('hosted macOS CI cannot stand in for physical user-Mac acceptance', () => {
  const evidence = complete();
  evidence.physical_mac_acceptance = { environment: 'github_macos_runner', performed_by: 'automation',
    confirmed: true, conclusion: 'success', head: merge };
  const result = validateReleaseEvidence(evidence);
  assert.equal(result.decision, 'blocked');
  assert.ok(result.missing.includes('physical_user_mac:missing_or_invalid'));
});

test('mismatched trees, failed gates and incomplete accepted history fail closed', () => {
  const evidence = complete();
  evidence.merge.tree = 'd'.repeat(40);
  evidence.exact_head.checks.privacy.conclusion = 'failure';
  evidence.merged_main.jobs.find(job => job.name === 'test (windows-latest)').go_dashboard = 'failure';
  evidence.accepted_checkpoints = checkpoints.filter(id => id !== 'C14');
  const result = validateReleaseEvidence(evidence);
  assert.equal(result.decision, 'blocked');
  assert.ok(result.missing.includes('tested_tree_not_merged'));
  assert.ok(result.missing.includes('exact_head:privacy:not_success'));
  assert.ok(result.missing.includes('merged_main:test (windows-latest):go_not_success'));
  assert.ok(result.missing.includes('C14:not_accepted'));
});

test('unsafe side effects remain blocked even when product CI is green', () => {
  const evidence = complete();
  evidence.privacy.applications_submitted = true;
  evidence.privacy.recruiter_messages_sent = true;
  const result = validateReleaseEvidence(evidence);
  assert.equal(result.decision, 'blocked');
  assert.ok(result.missing.includes('privacy:application_action_not_denied'));
  assert.ok(result.missing.includes('privacy:outbound_message_not_denied'));
  assert.equal(result.release_action, 'none');
});

test('result never echoes unknown private evidence fields', () => {
  const evidence = complete();
  evidence.private_candidate_name = 'SYNTHETIC_PRIVATE_NAME';
  evidence.notes = 'SYNTHETIC_PRIVATE_NOTES';
  const serialized = JSON.stringify(validateReleaseEvidence(evidence));
  assert.doesNotMatch(serialized, /SYNTHETIC_PRIVATE/);
});

test('private-root evidence files are read-only and paths cannot escape', t => {
  const root = mkdtempSync(join(tmpdir(), 'co-c15-synthetic-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'release-evidence.json'), JSON.stringify(complete()));
  assert.equal(validateReleaseEvidenceFile(root, 'data/release-evidence.json').decision, 'ready');
  assert.throws(() => validateReleaseEvidenceFile(root, '../outside.json'), /inside the candidate data root/);
  assert.deepEqual(validateReleaseEvidenceFile(root, 'data/missing.json').missing, ['evidence_unreadable']);
});

test('malformed and duplicate receipts do not throw or pass', () => {
  assert.equal(validateReleaseEvidence(null).decision, 'blocked');
  const evidence = complete();
  evidence.exact_head.jobs.push({ ...evidence.exact_head.jobs[0] });
  const result = validateReleaseEvidence(evidence);
  assert.equal(result.decision, 'blocked');
  assert.ok(result.missing.includes('exact_head:duplicate_or_invalid_job'));
});
