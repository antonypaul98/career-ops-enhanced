import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEvidenceEntry, emptyEvidenceVault } from '../enhanced/evidence-vault.mjs';
import { classifySkillGapsWithEvidence } from '../enhanced/jd-evidence-gap.mjs';

test('JD technology missing from cv.md is promoted only when confirmed evidence exists', () => {
  const cv = '# Skills\nPython, SQL\n\n# Experience\nBuilt ETL pipelines.\n';
  let vault = emptyEvidenceVault();
  ({ vault } = addEvidenceEntry(vault, {
    kind: 'skill',
    claim: 'Apache Airflow',
    resumeScope: 'skill_only',
    quote: 'I have used Apache Airflow.',
  }));

  const result = classifySkillGapsWithEvidence(['Python', 'Apache Airflow', 'Rust'], cv, vault);

  assert.deepEqual(result.existing, ['Python']);
  assert.deepEqual(result.supportedByEvidence, ['Apache Airflow']);
  assert.deepEqual(result.gap, ['Rust']);
  assert.equal(result.evidence['Apache Airflow'][0].resume_scope, 'skill_only');
});

test('resume prose remains higher-priority than external evidence', () => {
  const cv = '# Skills\nPython\n\n# Experience\nDeployed services to Kubernetes clusters.\n';
  let vault = emptyEvidenceVault();
  ({ vault } = addEvidenceEntry(vault, {
    kind: 'skill',
    claim: 'Kubernetes',
    resumeScope: 'skill_only',
    quote: 'I use Kubernetes.',
  }));

  const result = classifySkillGapsWithEvidence(['Kubernetes'], cv, vault);

  assert.deepEqual(result.supportedByResume, ['Kubernetes']);
  assert.deepEqual(result.supportedByEvidence, []);
  assert.deepEqual(result.gap, []);
});
