#!/usr/bin/env node

/**
 * Candidate-controlled bridge between an inspect-only browser observation and
 * the one-action approval consumed by submit-application-browser.mjs.
 * This command never opens a browser, submits, or writes tracker state.
 */

import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { createExactSubmissionApproval, createExactSubmissionReview,
  SUBMIT_CONFIRMATION_STATEMENT } from './enhanced/approved-application-submission.mjs';

const FLAGS = new Set(['--input', '--inspection', '--mode', '--output', '--challenge', '--statement', '--help', '-h']);

function usage() {
  return [
    'Usage:',
    '  node approve-application-submission.mjs --mode review --input <private-browser.json> --inspection <private-observation.json> --output <private-review.json>',
    '  node approve-application-submission.mjs --mode approve --input <private-browser.json> --inspection <private-observation.json> --output <private-approved.json> --challenge <sha256> --statement "<exact statement>"',
    '',
    'review: validates the exact inspect-only observation and emits one application-specific challenge; authorizes nothing.',
    'approve: requires that exact challenge plus the literal statement and creates the one-action package consumed by browser submit mode.',
    `Exact statement: ${SUBMIT_CONFIRMATION_STATEMENT}`,
    'Any changed URL, field, artifact, observation, browser contract, or readiness package requires a new inspect and review.',
    'This command never opens a browser, submits, mutates the tracker, or marks Applied.',
  ].join('\n');
}

function parseArgs(argv) {
  for (const arg of argv) if (arg.startsWith('-') && !FLAGS.has(arg)) throw new Error(`unknown flag: ${arg}`);
  const value = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  return { help: argv.includes('--help') || argv.includes('-h'), mode: value('--mode'), input: value('--input'),
    inspection: value('--inspection'), output: value('--output'), challenge: value('--challenge'),
    statement: value('--statement') };
}

function rootInfo() {
  const lexical = resolve(getCareerOpsRoot());
  const canonical = existsSync(lexical) ? realpathSync(lexical) : lexical;
  return { lexical, canonical };
}

function privatePath(root, value, { mustExist = false } = {}) {
  if (typeof value !== 'string' || !value || value.startsWith('-')) throw new Error('private path argument is required');
  const candidate = resolve(root.lexical, value);
  const lexicalRel = relative(root.lexical, candidate);
  if (lexicalRel === '' || lexicalRel.startsWith('..') || isAbsolute(lexicalRel)) {
    throw new Error('path must stay inside the private data root');
  }
  let ancestor = existsSync(candidate) ? candidate : dirname(candidate);
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  const canonicalAncestor = realpathSync(ancestor);
  const ancestorRel = relative(root.canonical, canonicalAncestor);
  if (ancestorRel.startsWith('..') || isAbsolute(ancestorRel)) throw new Error('path must stay inside the private data root');
  const resolved = existsSync(candidate) ? realpathSync(candidate) : candidate;
  if (mustExist && (!existsSync(resolved) || !lstatSync(resolved).isFile())) {
    throw new Error('input must be an existing file');
  }
  return resolved;
}

function createPrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  let complete = false;
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    complete = true;
  } finally {
    closeSync(fd);
    if (!complete) unlinkSync(path);
  }
}

function exactObservation(inspection) {
  if (inspection?.decision !== 'exact_final_review_observed' || !inspection.observation) {
    throw new Error('an exact inspect-only browser observation is required');
  }
  if (inspection.consequential_actions !== 0 || inspection.tracker_mutation !== false
    || inspection.applied_status_authorized !== false) {
    throw new Error('inspection must prove zero consequential actions and no state mutation');
  }
  return inspection.observation;
}

export function buildExactSubmissionReview(input, inspection) {
  const observation = exactObservation(inspection);
  return createExactSubmissionReview({ ...input, observation });
}

export function buildExactSubmissionApprovedPackage(input, inspection, confirmation = {}, options = {}) {
  const observation = exactObservation(inspection);
  const review = createExactSubmissionReview({ ...input, observation });
  if (confirmation.challenge_digest !== review.challenge_digest) {
    throw new Error('the exact displayed review challenge is required');
  }
  if (confirmation.statement !== SUBMIT_CONFIRMATION_STATEMENT) {
    throw new Error('the exact submission confirmation statement is required');
  }
  const effectiveNow = options.now ?? Date.now();
  const approvedAt = new Date(effectiveNow).toISOString();
  const submitApproval = createExactSubmissionApproval({ ...input, observation, confirmation: {
    confirmed: true, challenge_digest: confirmation.challenge_digest,
    statement: confirmation.statement, approved_at: approvedAt,
  } }, { now: effectiveNow });
  return { ...input, observation, submit_approval: submitApproval };
}

export function main(argv = process.argv.slice(2), { now = Date.now() } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (error) { console.error(`Error: ${error.message}`); return 1; }
  if (args.help) { console.log(usage()); return 0; }
  try {
    if (!['review', 'approve'].includes(args.mode)) throw new Error('--mode must be review or approve');
    const root = rootInfo();
    const inputPath = privatePath(root, args.input, { mustExist: true });
    const inspectionPath = privatePath(root, args.inspection, { mustExist: true });
    const outputPath = privatePath(root, args.output);
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    const inspection = JSON.parse(readFileSync(inspectionPath, 'utf8'));
    const result = args.mode === 'review'
      ? buildExactSubmissionReview(input, inspection)
      : buildExactSubmissionApprovedPackage(input, inspection,
        { challenge_digest: args.challenge, statement: args.statement }, { now });
    createPrivateJson(outputPath, result);
    console.log(JSON.stringify({ decision: result.decision ?? 'exact_submission_approved',
      application_key: result.application?.key ?? result.submit_approval?.application_key,
      challenge_digest: result.challenge_digest ?? result.submit_approval?.review_digest,
      result: relative(root.canonical, outputPath), consequential_actions: 0,
      tracker_mutation: false, applied_written: false }, null, 2));
    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) process.exitCode = main();
