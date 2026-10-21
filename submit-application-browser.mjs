#!/usr/bin/env node

/**
 * Headed, persistent-browser runner for one exact approved submission.
 * Private inputs/results stay under CAREER_OPS_ROOT. The command never types
 * credentials, solves challenges, approves content, or writes Applied.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { canonicalJson } from './enhanced/application-approval.mjs';
import { prepareCandidateApplicationStart } from './enhanced/application-launch.mjs';
import { executeApprovedSubmission, prepareApprovedSubmission, verifySubmissionReceipt }
  from './enhanced/approved-application-submission.mjs';
import { capturePlaywrightReceipt, createPlaywrightSubmitExecutor, observeFinalReview }
  from './enhanced/playwright-submission-adapter.mjs';

const FLAGS = new Set(['--input', '--mode', '--profile-dir', '--output', '--receipt', '--help', '-h']);

function usage() {
  return [
    'Usage:',
    '  node submit-application-browser.mjs --mode inspect --input <private.json> --profile-dir <private-dir> --output <private-result.json>',
    '  node submit-application-browser.mjs --mode submit  --input <private.json> --profile-dir <private-dir> --output <private-result.json> --receipt <private-receipt.json>',
    '',
    'inspect: opens the exact URL in persistent headed Chromium and records the current final-review observation; never submits.',
    'submit: requires an exact observation-bound submit_approval, rechecks the live DOM, clicks one exact control, and captures a concrete receipt.',
    'Login, MFA, CAPTCHA, unexpected fields, or any changed content pause/fail closed. Applied is never written by this command.',
  ].join('\n');
}

function parseArgs(argv) {
  for (const arg of argv) if (arg.startsWith('-') && !FLAGS.has(arg)) throw new Error(`unknown flag: ${arg}`);
  const value = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  return { help: argv.includes('--help') || argv.includes('-h'), mode: value('--mode'), input: value('--input'),
    profileDir: value('--profile-dir'), output: value('--output'), receipt: value('--receipt') };
}

function rootInfo() {
  const lexical = resolve(getCareerOpsRoot());
  const canonical = existsSync(lexical) ? realpathSync(lexical) : lexical;
  return { lexical, canonical };
}

function privatePath(root, value, { mustExist = false, directory = false } = {}) {
  if (typeof value !== 'string' || !value || value.startsWith('-')) throw new Error('private path argument is required');
  const candidate = resolve(root.lexical, value);
  const lexicalRel = relative(root.lexical, candidate);
  if (lexicalRel === '' || lexicalRel.startsWith('..') || isAbsolute(lexicalRel)) throw new Error('path must stay inside the private data root');
  let ancestor = existsSync(candidate) ? candidate : dirname(candidate);
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  const canonicalAncestor = realpathSync(ancestor);
  const ancestorRel = relative(root.canonical, canonicalAncestor);
  if (ancestorRel.startsWith('..') || isAbsolute(ancestorRel)) throw new Error('path must stay inside the private data root');
  const resolved = existsSync(candidate) ? realpathSync(candidate) : candidate;
  if (mustExist && (!existsSync(resolved) || !lstatSync(resolved).isFile())) throw new Error('input must be an existing file');
  if (directory && existsSync(resolved) && !lstatSync(resolved).isDirectory()) throw new Error('profile path must be a directory');
  return resolved;
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function atomicText(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, value, { mode: 0o600 });
  renameSync(temp, path);
}

function pauseFromObservation(observation, resumeToken) {
  const reason = observation.login_required ? 'login_required'
    : observation.mfa_required ? 'mfa_required'
      : observation.captcha_required ? 'captcha_required'
        : observation.unexpected_fields.length ? 'new_or_changed_fields'
          : !observation.final_review ? 'final_review_required' : null;
  return reason ? { schema_version: 1, decision: 'paused', reason, resume_token: resumeToken,
    observation, consequential_actions: 0, tracker_mutation: false, applied_status_authorized: false } : null;
}

export async function runBrowserSubmission(input, { mode, profileDir, receiptSource = null,
  launchPersistentContext = (dir, options) => chromium.launchPersistentContext(dir, options) } = {}) {
  if (!['inspect', 'submit'].includes(mode)) throw new Error('--mode must be inspect or submit');
  const start = prepareCandidateApplicationStart(input);
  if (start.decision !== 'ready_to_open') return start;
  if (!input.browser_contract) throw new Error('browser_contract is required');
  const context = await launchPersistentContext(profileDir, { headless: false, viewport: null });
  try {
    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    if (page.url() !== start.launch_url) await page.goto(start.launch_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const approvedObservedAt = mode === 'submit' ? input.observation?.observed_at : undefined;
    if (mode === 'submit' && typeof approvedObservedAt !== 'string') throw new Error('approved observation is required for submit mode');
    const observation = await observeFinalReview(page, input.browser_contract,
      approvedObservedAt ? { observedAt: approvedObservedAt } : undefined);
    const paused = pauseFromObservation(observation, start.resume.token);
    if (mode === 'inspect') return paused ?? { schema_version: 1, decision: 'exact_final_review_observed',
      resume_token: start.resume.token, observation, consequential_actions: 0,
      tracker_mutation: false, applied_status_authorized: false };
    if (paused) return paused;
    if (canonicalJson(observation) !== canonicalJson(input.observation)) {
      return { schema_version: 1, decision: 'blocked', reason: 'browser_observation_changed_after_approval',
        resume_token: start.resume.token, consequential_actions: 0,
        tracker_mutation: false, applied_status_authorized: false };
    }
    const plan = prepareApprovedSubmission({ ...input, observation });
    if (plan.decision !== 'ready_to_submit_once') return plan;
    const executor = createPlaywrightSubmitExecutor({ page, contract: input.browser_contract,
      expected_observation: observation });
    const execution = await executeApprovedSubmission(plan, executor);
    if (execution.decision !== 'submitted_awaiting_verified_receipt') return execution;
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    const receipt = await capturePlaywrightReceipt(page, input.browser_contract, execution,
      { source: receiptSource ?? 'private-browser-receipt.json' });
    if (!receipt) return { ...execution, decision: 'paused', reason: 'verified_receipt_not_observed' };
    return { execution, receipt, verified: verifySubmissionReceipt(execution, receipt),
      tracker_mutation: false, applied_written: false };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (error) { console.error(`Error: ${error.message}`); return 1; }
  if (args.help) { console.log(usage()); return 0; }
  try {
    const root = rootInfo();
    const inputPath = privatePath(root, args.input, { mustExist: true });
    const profileDir = privatePath(root, args.profileDir, { directory: true });
    const outputPath = privatePath(root, args.output);
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    let receiptPath = null;
    if (args.mode === 'submit') receiptPath = privatePath(root, args.receipt);
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    const receiptSource = receiptPath ? relative(root.canonical, receiptPath) : null;
    const result = await runBrowserSubmission(input, { mode: args.mode, profileDir, receiptSource });
    if (result.receipt?.evidence && receiptPath) atomicText(receiptPath, canonicalJson(result.receipt.evidence));
    atomicJson(outputPath, result);
    console.log(JSON.stringify({ decision: result.decision ?? result.verified?.decision,
      result: relative(root.canonical, outputPath), receipt: receiptSource,
      tracker_mutation: false, applied_written: false }, null, 2));
    return result.verified?.decision === 'verified_receipt' || result.decision === 'exact_final_review_observed' ? 0 : 2;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) process.exitCode = await main();
