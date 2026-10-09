import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { evaluateEligibility as evaluate } from '../enhanced/eligibility.mjs';

// All fixtures are invented. These are declarations, not legal conclusions.
const requirement = (overrides = {}) => ({ id: 'synthetic-requirement', field: 'work_authorized',
  required_value: true, mandatory: true, jurisdiction: 'SYNTHETIC_REGION', period: 'current',
  review_status: 'explicit', candidate_evidence: false,
  provenance: { source_type: 'job_description', source_id: 'synthetic-jd' }, ...overrides });
const fact = (overrides = {}) => ({ id: 'synthetic-fact', candidate_id: 'synthetic-candidate',
  field: 'work_authorized', value: true, jurisdiction: 'SYNTHETIC_REGION', period: 'current',
  status: 'user_confirmed', provenance: { source_type: 'candidate_statement', source_id: 'synthetic-declaration' }, ...overrides });
const run = (requirements = [requirement()], facts = [fact()], candidate = {}) =>
  evaluate({ requirements, candidate: { candidate_id: 'synthetic-candidate', facts, ...candidate } });
const code = result => result.checks[0].reason_code;

test('explicit compatible authorization and sponsorship declarations are eligible with provenance', () => {
  const result = run([requirement(), requirement({ id: 'sponsorship', field: 'needs_sponsorship', required_value: false, period: 'future' })],
    [fact(), fact({ id: 'sponsorship-fact', field: 'needs_sponsorship', value: false, period: 'future', status: 'source_verified',
      provenance: { source_type: 'candidate_document', source_id: 'synthetic-reviewed-document' } })]);
  assert.equal(result.status, 'eligible');
  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[0].provenance.requirement.candidate_evidence, false);
  assert.equal(result.checks[0].provenance.candidate[0].review_status, 'user_confirmed');
  assert.match(result.checks[0].provenance.candidate[0].record_ref, /^[a-f0-9]{64}$/);
  assert.equal(result.checks[0].provenance.candidate[0].source_ref,
    createHash('sha256').update('synthetic-declaration').digest('hex'));
  assert.equal(result.checks[0].provenance.requirement.record_ref,
    createHash('sha256').update('synthetic-requirement').digest('hex'));
  assert.equal(result.advisory_only, true);
  assert.equal(result.application_action, 'none');
});

test('only a reviewed explicit conflict with a mandatory requirement is ineligible', () => {
  assert.equal(run([requirement()], [fact({ value: false })]).status, 'ineligible');
  assert.equal(code(run([requirement()], [fact({ value: false })])), 'mandatory_explicit_conflict');
  assert.equal(run([requirement({ mandatory: false })], [fact({ value: false })]).status, 'needs_review');
  assert.equal(run([requirement({ field: 'needs_sponsorship', required_value: false })],
    [fact({ field: 'needs_sponsorship', value: true })]).status, 'ineligible');
});

test('missing facts, unsupported values and absent candidate scope require review', () => {
  assert.equal(code(run([requirement()], [])), 'missing_candidate_fact');
  for (const value of [null, undefined, 'false', 0, 'unknown']) {
    assert.equal(code(run([requirement()], [fact({ value })])), 'unsupported_candidate_evidence');
  }
  assert.equal(code(run([requirement()], [fact()], { candidate_id: undefined })), 'candidate_scope_missing');
});

test('ambiguous sponsorship, unspecified strength and unsupported requirements cannot reject', () => {
  const req = requirement({ field: 'needs_sponsorship', required_value: false, review_status: 'needs_review' });
  assert.equal(code(run([req], [fact({ field: 'needs_sponsorship', value: true })])), 'requirement_not_explicit');
  for (const change of [{ mandatory: undefined }, { field: 'citizenship' }, { period: undefined },
    { jurisdiction: '' }, { candidate_evidence: true }, { provenance: undefined }]) {
    assert.equal(code(run([requirement(change)], [fact({ value: false })])), 'unsupported_requirement');
  }
});

test('contradictory declarations require review rather than cherry-picking an answer', () => {
  const result = run([requirement()], [fact(), fact({ id: 'contradiction', value: false })]);
  assert.equal(result.status, 'needs_review');
  assert.equal(code(result), 'conflicting_candidate_evidence');
  assert.equal(result.checks[0].provenance.candidate.length, 2);
});

test('unverified or unsupported evidence cannot authorize even an otherwise matching declaration', () => {
  for (const status of ['needs_review', 'rejected', 'verified', undefined]) {
    assert.equal(code(run([requirement()], [fact({ status })])), 'unsupported_candidate_evidence');
  }
  for (const source_type of ['job_description', 'resume_keywords', 'inference', 'education', 'location', 'nationality']) {
    assert.equal(code(run([requirement()], [fact({ provenance: { source_type, source_id: 'synthetic' } })])), 'unsupported_candidate_evidence');
  }
  assert.equal(run([requirement()], [fact(), fact({ id: 'unreviewed', status: 'needs_review' })]).status, 'needs_review');
});

test('nationality, location, education and resume keywords never become authorization facts', () => {
  const result = run([requirement()], [], { nationality: 'SYNTHETIC_REGION', location: { country: 'SYNTHETIC_REGION',
    authorized_in: ['SYNTHETIC_REGION'], needs_sponsorship: false }, education: 'SYNTHETIC_REGION university',
    resume: 'Authorized citizen no sponsorship needed' });
  assert.equal(result.status, 'needs_review');
  assert.equal(code(result), 'missing_candidate_fact');
});

test('jurisdiction and current/future declarations do not imply each other', () => {
  assert.equal(code(run([requirement()], [fact({ jurisdiction: 'ANOTHER_SYNTHETIC_REGION' })])), 'missing_candidate_fact');
  assert.equal(code(run([requirement({ period: 'future' })], [fact()])), 'missing_candidate_fact');
  assert.equal(code(run([requirement({ field: 'needs_sponsorship' })], [fact()])), 'missing_candidate_fact');
});

test('other candidate evidence is neither consulted nor returned', () => {
  const foreign = fact({ candidate_id: 'another-candidate', id: 'FOREIGN_PRIVATE_SENTINEL', value: false,
    provenance: { source_type: 'candidate_statement', source_id: 'FOREIGN_PRIVATE_SOURCE' } });
  assert.equal(run([requirement()], [fact(), foreign]).status, 'eligible');
  const result = run([requirement()], [foreign]);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.checks[0].provenance.candidate.length, 0);
  assert.equal(JSON.stringify(result).includes('FOREIGN_PRIVATE'), false);
});

test('output retains traceable references without copying private quotes, paths, IDs or arbitrary fields', () => {
  const privateFact = fact({ id: 'SYNTHETIC_PRIVATE_ID', quote: 'SYNTHETIC_PRIVATE_QUOTE',
    provenance: { source_type: 'candidate_statement', source_id: '/SYNTHETIC_PRIVATE/path', quote: 'SYNTHETIC_PRIVATE_QUOTE' } });
  const result = run([requirement({ id: 'SYNTHETIC_PRIVATE_REQUIREMENT', extra: 'SYNTHETIC_PRIVATE_EXTRA' })], [privateFact],
    { salary: 'SYNTHETIC_PRIVATE_SALARY', immigration: 'SYNTHETIC_PRIVATE_IMMIGRATION' });
  assert.equal(result.status, 'eligible');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false);
  assert.notEqual(result.checks[0].provenance.candidate[0].source_ref, null);
});

test('review dominates a separate known conflict and empty/malformed inputs never pass vacuously', () => {
  const result = run([requirement(), requirement({ id: 'missing', field: 'needs_sponsorship' })], [fact({ value: false })]);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.checks[0].status, 'ineligible');
  for (const input of [undefined, null, false, 4, 'invalid', {}, { requirements: [], candidate: { facts: [] } }, { requirements: [null], candidate: { facts: [] } }]) {
    assert.equal(evaluate(input).status, 'needs_review');
  }
});

test('results are deterministic, independent of fact order and leave inputs unchanged', () => {
  const input = { requirements: [requirement()], candidate: { candidate_id: 'synthetic-candidate',
    facts: [fact(), fact({ id: 'second', value: false })] } };
  const before = structuredClone(input);
  const first = evaluate(input);
  for (let i = 0; i < 10; i++) assert.deepEqual(evaluate(input), first);
  assert.deepEqual(evaluate({ ...input, candidate: { ...input.candidate, facts: [...input.candidate.facts].reverse() } }), first);
  assert.deepEqual(input, before);
});

test('an isolated invocation neither reads private runtime files nor writes or makes network requests', () => {
  const root = mkdtempSync(join(tmpdir(), 'c07-synthetic-'));
  try {
    writeFileSync(join(root, 'cv.md'), 'SYNTHETIC_RUNTIME_PRIVATE');
    const before = readdirSync(root);
    const url = new URL('../enhanced/eligibility.mjs', import.meta.url).href;
    const input = { requirements: [requirement()], candidate: { candidate_id: 'synthetic-candidate', facts: [fact()] } };
    const script = `const { evaluateEligibility } = await import(${JSON.stringify(url)});
      const fs = (await import('node:fs')).default;
      for (const name of ['readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'rmSync']) {
        fs[name] = () => { throw new Error('Runtime filesystem access forbidden'); };
      }
      (await import('node:module')).syncBuiltinESMExports();
      globalThis.fetch = () => { throw new Error('Network forbidden'); };
      console.log(JSON.stringify(evaluateEligibility(${JSON.stringify(input)})));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.includes('SYNTHETIC_RUNTIME_PRIVATE'), false);
    assert.equal(JSON.parse(child.stdout).status, 'eligible');
    assert.deepEqual(readdirSync(root), before);
    assert.equal(readFileSync(join(root, 'cv.md'), 'utf8'), 'SYNTHETIC_RUNTIME_PRIVATE');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
