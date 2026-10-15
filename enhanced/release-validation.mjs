/**
 * C15: fail-closed, read-only validation of release acceptance receipts.
 *
 * The evidence file belongs in the private data root. This module never runs
 * tests, contacts GitHub, submits applications, sends messages, or mutates
 * candidate data. It only checks that independently collected receipts all
 * describe the same tested tree and merged commit. A hosted macOS runner is
 * deliberately insufficient for the separate physical user-Mac gate.
 */
import { readFileSync } from 'node:fs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { privatePath } from './resume-authority.mjs';

const SHA = /^[a-f0-9]{40}$/;
const REQUIRED_CHECKPOINTS = Array.from({ length: 13 }, (_, i) => `C${String(i + 2).padStart(2, '0')}`);
const REQUIRED_JOBS = new Map([
  ['test (ubuntu-latest)', true],
  ['test (macos-latest)', true],
  ['test (windows-latest)', true],
  ['cv-visual', false],
  ['Upgrade regression gate', false],
]);
const REQUIRED_AUXILIARY = ['privacy', 'dependency', 'direction'];

function validSha(value) {
  return typeof value === 'string' && SHA.test(value);
}

function inspectJobs(stage, expectedHead, missing) {
  if (!Array.isArray(stage?.jobs)) {
    missing.push(`${stage?.name ?? 'stage'}:jobs_missing`);
    return;
  }
  const names = new Set();
  for (const job of stage.jobs) {
    if (typeof job?.name !== 'string' || names.has(job.name)) {
      missing.push(`${stage.name}:duplicate_or_invalid_job`);
      continue;
    }
    names.add(job.name);
    if (job.head !== expectedHead) missing.push(`${stage.name}:${job.name}:head_mismatch`);
  }
  for (const [name, needsGo] of REQUIRED_JOBS) {
    const job = stage.jobs.find(item => item?.name === name);
    if (!job) missing.push(`${stage.name}:${name}:missing`);
    else {
      if (job.conclusion !== 'success') missing.push(`${stage.name}:${name}:not_success`);
      if (needsGo && job.go_dashboard !== 'success') missing.push(`${stage.name}:${name}:go_not_success`);
    }
  }
}

/** Return only release metadata and missing-gate codes; never echo private input. */
export function validateReleaseEvidence(evidence) {
  const missing = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { schema_version: 1, decision: 'blocked', release_action: 'none', missing: ['evidence_required'] };
  }
  if (evidence.schema_version !== 1) missing.push('schema_version');
  const sourceHead = evidence.source?.head;
  const sourceTree = evidence.source?.tree;
  const mergeCommit = evidence.merge?.commit;
  const mergeTree = evidence.merge?.tree;
  if (!validSha(sourceHead)) missing.push('source_head');
  if (!validSha(sourceTree)) missing.push('source_tree');
  if (!validSha(mergeCommit)) missing.push('merge_commit');
  if (!validSha(mergeTree)) missing.push('merge_tree');
  if (sourceTree !== mergeTree) missing.push('tested_tree_not_merged');

  const accepted = new Set(Array.isArray(evidence.accepted_checkpoints) ? evidence.accepted_checkpoints : []);
  for (const checkpoint of REQUIRED_CHECKPOINTS) if (!accepted.has(checkpoint)) missing.push(`${checkpoint}:not_accepted`);

  const exact = { ...evidence.exact_head, name: 'exact_head' };
  if (exact.head !== sourceHead) missing.push('exact_head:mismatch');
  inspectJobs(exact, sourceHead, missing);
  for (const check of REQUIRED_AUXILIARY) {
    const receipt = exact.checks?.[check];
    if (receipt?.head !== sourceHead) missing.push(`exact_head:${check}:head_mismatch`);
    if (receipt?.conclusion !== 'success') missing.push(`exact_head:${check}:not_success`);
  }

  const merged = { ...evidence.merged_main, name: 'merged_main' };
  if (merged.head !== mergeCommit) missing.push('merged_main:mismatch');
  inspectJobs(merged, mergeCommit, missing);

  if (evidence.privacy?.private_data_published !== false) missing.push('privacy:private_data_not_denied');
  if (evidence.privacy?.applications_submitted !== false) missing.push('privacy:application_action_not_denied');
  if (evidence.privacy?.recruiter_messages_sent !== false) missing.push('privacy:outbound_message_not_denied');

  const mac = evidence.physical_mac_acceptance;
  if (mac?.environment !== 'physical_user_mac' || mac?.performed_by !== 'user'
    || mac?.confirmed !== true || mac?.conclusion !== 'success' || mac?.head !== mergeCommit) {
    missing.push('physical_user_mac:missing_or_invalid');
  }

  const unique = [...new Set(missing)].sort();
  return {
    schema_version: 1,
    decision: unique.length ? 'blocked' : 'ready',
    release_action: 'none',
    source_head: validSha(sourceHead) ? sourceHead : null,
    source_tree: validSha(sourceTree) ? sourceTree : null,
    merge_commit: validSha(mergeCommit) ? mergeCommit : null,
    missing: unique,
    physical_user_mac_verified: !unique.includes('physical_user_mac:missing_or_invalid'),
  };
}

export function validateReleaseEvidenceFile(root, evidencePath) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Private data root is required');
  if (typeof evidencePath !== 'string' || !evidencePath.trim()) throw new Error('Evidence path is required');
  const file = privatePath(root, evidencePath);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch { return { schema_version: 1, decision: 'blocked', release_action: 'none', missing: ['evidence_unreadable'] }; }
  return validateReleaseEvidence(parsed);
}

if (isMainModule(import.meta.url)) {
  const index = process.argv.indexOf('--evidence');
  const result = validateReleaseEvidenceFile(getCareerOpsRoot(), index >= 0 ? process.argv[index + 1] : '');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.decision === 'ready' ? 0 : 1;
}
