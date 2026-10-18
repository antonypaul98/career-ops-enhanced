#!/usr/bin/env node

/**
 * Redacted runtime report for the application-readiness gate.
 *
 * Input is explicit JSON from a file or stdin. Output contains operational
 * decisions and counts only: candidate text, requirement/question wording,
 * provenance quotes, bundle values, artifact paths and content digests are
 * deliberately excluded. This module never writes a file or performs an
 * application, browser, email, calendar or network action.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readSync, statSync } from 'node:fs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { prepareApplicationReadiness } from './application-readiness.mjs';

const MAX_INPUT_BYTES = 1024 * 1024;

function applicationRef(applicationKey) {
  return createHash('sha256').update(applicationKey, 'utf8').digest('hex').slice(0, 16);
}

/** Return a correlation-safe, content-redacted runtime report. */
export function buildApplicationReadinessReport(input = {}) {
  const result = prepareApplicationReadiness(input);
  return {
    schema_version: 1,
    application_ref: applicationRef(result.application_key),
    decision: result.decision,
    reason: result.reason,
    next_step: result.next_step,
    job_gates: Object.fromEntries(Object.entries(result.job_gates).map(([name, gate]) => [
      name,
      { status: gate.status, passed: gate.passed, checked_at: gate.checked_at },
    ])),
    failed_job_gate_count: result.failed_job_gates.length,
    metrics: {
      opportunity_score: result.opportunity_score.score,
      opportunity_scale: result.opportunity_score.scale,
      opportunity_confidence: result.opportunity_score.confidence,
      verified_fit_before: result.verified_match.before,
      verified_fit_after: result.verified_match.after,
      verified_fit_scale: result.verified_match.scale,
      unresolved_gap_count: result.verified_match.unresolved_gaps.length,
      pending_question_count: result.verified_match.questionnaire.questions.length,
      evidence_proposal_count: result.verified_match.evidence_vault_proposals.length,
      mandatory_eligibility: result.verified_match.mandatory_eligibility,
    },
    exact_bundle: {
      supplied: result.exact_bundle.supplied,
      valid: result.exact_bundle.valid,
      reason: result.exact_bundle.reason,
      application_key_matches: result.exact_bundle.application_key_matches,
      content_digest_present: Boolean(result.exact_bundle.content_digest),
    },
    safety: result.safety,
    privacy: {
      candidate_content_included: false,
      requirement_content_included: false,
      provenance_content_included: false,
      bundle_content_included: false,
      application_key_included: false,
      output_written: false,
    },
  };
}

function readStdinBounded() {
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - total));
    const count = readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    total += count;
    if (total > MAX_INPUT_BYTES) throw new Error('input_too_large');
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readInput(path) {
  if (path === '-') return readStdinBounded();
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error('input_not_file');
  if (stat.size > MAX_INPUT_BYTES) throw new Error('input_too_large');
  const input = readFileSync(path);
  if (input.length > MAX_INPUT_BYTES) throw new Error('input_too_large');
  return input.toString('utf8');
}

function usage() {
  return 'Usage: node enhanced/application-readiness-report.mjs <input.json|-> [--compact]';
}

export function runApplicationReadinessReport(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const positional = argv.filter(arg => !arg.startsWith('--'));
  const flags = argv.filter(arg => arg.startsWith('--'));
  if (positional.length !== 1 || flags.some(flag => flag !== '--compact')) throw new Error('invalid_arguments');

  let input;
  try {
    input = JSON.parse(readInput(positional[0]));
  } catch {
    throw new Error('invalid_or_unreadable_input');
  }
  const report = buildApplicationReadinessReport(input);
  console.log(JSON.stringify(report, null, argv.includes('--compact') ? 0 : 2));
}

if (isMainModule(import.meta.url)) {
  try {
    runApplicationReadinessReport();
  } catch (error) {
    const allowed = new Set(['invalid_arguments', 'invalid_or_unreadable_input']);
    const code = allowed.has(error.message) ? error.message : 'readiness_validation_failed';
    console.error(`application-readiness-report: ${code}`);
    process.exitCode = 1;
  }
}
