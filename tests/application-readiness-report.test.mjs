import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApplicationBundle } from '../enhanced/application-approval.mjs';
import { buildApplicationReadinessReport } from '../enhanced/application-readiness-report.mjs';

const KEY = '099-synthetic-private-role';
const SECRET = 'PRIVATE-CANDIDATE-CONTENT-MUST-NOT-LEAK';
const input = () => ({
  application_key: KEY,
  opportunity: {
    application_key: KEY,
    dimensions: Object.fromEntries(['cv_match', 'north_star', 'compensation', 'culture', 'red_flags']
      .map(name => [name, { score: 5, evidence: 'supported', explanation: SECRET }])),
    jd_keywords: ['SyntheticSkill'], candidate_text: SECRET,
    candidate_evidence: { status: 'verified', source: SECRET },
    detected_archetype: 'Synthetic Role', archetype_review_status: 'reviewed',
    profile: { target_roles: { archetypes: [{ name: 'Synthetic Role', fit: 'primary' }] } },
  },
  match: {
    application_key: KEY, initial_verified_fit: 100,
    requirements: [{ id: 'secret-gap-id', requirement: SECRET, type: 'technology', weight: 100, mandatory: true, evidence_status: 'verified' }],
    eligibility: { verdict: 'eligible' },
  },
  job_gates: {
    liveness: { status: 'live', source: SECRET, checked_at: '2026-10-18T05:00:00-04:00' },
    dedup: { status: 'unique', source: SECRET, checked_at: '2026-10-18T05:00:00-04:00' },
    legitimacy: { status: 'verified', source: SECRET, checked_at: '2026-10-18T05:00:00-04:00' },
  },
  application_bundle: createApplicationBundle({
    application: { key: KEY, company: SECRET, role: SECRET, url: 'https://jobs.example.test/99' },
    fields: [{ key: 'answer', label: SECRET, value: SECRET, source: { type: 'candidate_statement', status: 'user_confirmed', ref: SECRET, quote: SECRET } }],
    artifacts: [{ kind: 'resume', path: `output/${SECRET}.pdf`, sha256: 'b'.repeat(64) }],
  }),
});

test('builds a useful operational report without private candidate or bundle content', () => {
  const report = buildApplicationReadinessReport(input());
  const serialized = JSON.stringify(report);
  assert.equal(report.decision, 'ready_for_exact_content_review');
  assert.equal(report.metrics.verified_fit_after, 100);
  assert.equal(report.exact_bundle.valid, true);
  assert.equal(report.safety.application_action, 'none');
  assert.equal(report.privacy.candidate_content_included, false);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes(KEY), false);
  assert.equal(serialized.includes('secret-gap-id'), false);
  assert.equal(serialized.includes(input().application_bundle.content_digest), false);
});

test('CLI accepts an explicit file or stdin and writes JSON to stdout only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-readiness-report-'));
  const file = join(dir, 'synthetic-input.json');
  const body = JSON.stringify(input());
  writeFileSync(file, body);
  const script = fileURLToPath(new URL('../enhanced/application-readiness-report.mjs', import.meta.url));

  const fromFile = JSON.parse(execFileSync(process.execPath, [script, file, '--compact'], { encoding: 'utf8' }));
  const fromStdin = JSON.parse(execFileSync(process.execPath, [script, '-', '--compact'], { input: body, encoding: 'utf8' }));
  assert.deepEqual(fromFile, fromStdin);
  assert.equal(JSON.stringify(fromFile).includes(SECRET), false);
  assert.equal(fromFile.safety.files_written, 0);
  assert.equal(fromFile.safety.network_requests, 0);
});

test('CLI failure is closed and never echoes malformed private input', () => {
  const script = fileURLToPath(new URL('../enhanced/application-readiness-report.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '-'], { input: `{${SECRET}`, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid_or_unreadable_input/);
  assert.equal(result.stderr.includes(SECRET), false);
});
