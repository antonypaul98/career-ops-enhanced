import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as yaml from 'js-yaml';
import { verifyFacts } from '../verify-cv-facts.mjs';

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'career-evidence-fact-gate-'));
  const cv = join(root, 'cv.md');
  const evidence = join(root, 'career-evidence.yml');
  const config = join(root, 'cv-facts.json');
  writeFileSync(cv, '# Skills\nPython\n');
  writeFileSync(config, JSON.stringify({
    allow_metrics: [],
    allow_facts: [],
    forbidden_phrases: [],
    warn_phrases: [],
  }));
  try {
    run({ root, cv, evidence, config });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeVault(path, entry) {
  writeFileSync(path, yaml.dump({ schema_version: 1, entries: [entry] }, { noRefs: true }));
}

function skillEntry(status = 'user_confirmed') {
  return {
    id: 'ev-airflow',
    kind: 'skill',
    claim: 'Apache Airflow',
    resume_scope: 'skill_only',
    status,
    aliases: ['Airflow'],
    provenance: {
      type: 'user_confirmed',
      source: 'conversation',
      quote: 'I used Apache Airflow at Acme as a Principal Engineer and improved throughput 50%.',
      confirmed_at: '2026-10-04',
    },
  };
}

test('approved off-CV skill evidence satisfies the fact gate', () => {
  withFixture(({ cv, evidence, config }) => {
    writeVault(evidence, skillEntry());
    const result = verifyFacts('Technologies: Apache Airflow', {
      sourcePaths: [cv, evidence],
      configPath: config,
    });
    assert.notEqual(result.verdict, 'block', JSON.stringify(result));
    assert.equal(result.unsupportedFacts.some((claim) => claim.value === 'apache airflow'), false);
  });
});

test('needs_review evidence cannot authorize a missing JD technology', () => {
  withFixture(({ cv, evidence, config }) => {
    writeVault(evidence, skillEntry('needs_review'));
    const result = verifyFacts('Technologies: Apache Airflow', {
      sourcePaths: [cv, evidence],
      configPath: config,
    });
    assert.equal(result.verdict, 'block', JSON.stringify(result));
    assert.ok(result.unsupportedFacts.some((claim) => claim.value === 'apache airflow'));
  });
});

test('skill_only provenance cannot leak metrics or titles into resume authority', () => {
  withFixture(({ cv, evidence, config }) => {
    writeVault(evidence, skillEntry());
    const result = verifyFacts(
      'Title: Principal Engineer. Improved throughput 50% using Apache Airflow.',
      { sourcePaths: [cv, evidence], configPath: config },
    );
    assert.equal(result.verdict, 'block', JSON.stringify(result));
    assert.ok(result.invented.includes('50%'));
    assert.ok(result.unsupportedFacts.some((claim) => claim.value === 'principal engineer'));
    assert.equal(result.unsupportedFacts.some((claim) => claim.value === 'apache airflow'), false);
  });
});

test('contextual_claim authorizes only the explicitly approved context', () => {
  withFixture(({ cv, evidence, config }) => {
    writeVault(evidence, {
      id: 'ev-airflow-context',
      kind: 'experience',
      claim: 'Orchestrated scheduled ETL workflows',
      context: 'Improved pipeline throughput 50% using Apache Airflow.',
      resume_scope: 'contextual_claim',
      status: 'user_confirmed',
      aliases: [],
      provenance: {
        type: 'user_confirmed',
        source: 'conversation',
        quote: 'I also had unrelated details in the original statement.',
        confirmed_at: '2026-10-04',
      },
    });

    const allowed = verifyFacts('Improved pipeline throughput 50% using Apache Airflow.', {
      sourcePaths: [cv, evidence],
      configPath: config,
    });
    assert.notEqual(allowed.verdict, 'block', JSON.stringify(allowed));

    const expanded = verifyFacts('Improved pipeline throughput 75% using Apache Airflow.', {
      sourcePaths: [cv, evidence],
      configPath: config,
    });
    assert.equal(expanded.verdict, 'block', JSON.stringify(expanded));
    assert.ok(expanded.invented.includes('75%'));
  });
});
