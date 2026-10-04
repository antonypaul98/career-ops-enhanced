import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEvidenceEntry,
  emptyEvidenceVault,
  evidenceEntrySupportsSkill,
  evidenceVaultSourceText,
  matchEvidenceForSkill,
  validateEvidenceVault,
} from '../enhanced/evidence-vault.mjs';

test('user-confirmed skill absent from master CV is valid reusable evidence', () => {
  const { vault, entry } = addEvidenceEntry(emptyEvidenceVault(), {
    kind: 'skill',
    claim: 'Apache Airflow',
    resumeScope: 'skill_only',
    source: 'conversation',
    quote: 'I have used Apache Airflow.',
  });

  assert.deepEqual(validateEvidenceVault(vault), []);
  assert.equal(entry.status, 'user_confirmed');
  assert.equal(evidenceEntrySupportsSkill(entry, 'Apache Airflow'), true);
  assert.equal(matchEvidenceForSkill('Apache Airflow', vault).length, 1);
  assert.match(evidenceVaultSourceText(vault), /Apache Airflow/);
});

test('skill-only evidence does not treat unrelated context as authority', () => {
  const { entry } = addEvidenceEntry(emptyEvidenceVault(), {
    kind: 'skill',
    claim: 'Snowflake',
    context: 'Also curious about Apache Airflow.',
    resumeScope: 'skill_only',
    quote: 'I know Snowflake.',
  });

  assert.equal(evidenceEntrySupportsSkill(entry, 'Snowflake'), true);
  assert.equal(evidenceEntrySupportsSkill(entry, 'Apache Airflow'), false);
});

test('contextual claim can support technology explicitly present in confirmed context', () => {
  const { vault } = addEvidenceEntry(emptyEvidenceVault(), {
    kind: 'experience',
    claim: 'Orchestrated batch pipelines',
    context: 'Built and maintained Apache Airflow DAGs for scheduled ETL workflows.',
    resumeScope: 'contextual_claim',
    quote: 'Built and maintained Apache Airflow DAGs for scheduled ETL workflows.',
  });

  assert.equal(matchEvidenceForSkill('Apache Airflow', vault).length, 1);
});

test('unreviewed or rejected evidence never authorizes resume claims', () => {
  const base = emptyEvidenceVault();
  base.entries.push({
    id: 'ev-review',
    kind: 'skill',
    claim: 'Kubernetes',
    resume_scope: 'skill_only',
    status: 'needs_review',
    aliases: [],
    provenance: {
      type: 'user_confirmed',
      source: 'conversation',
      quote: 'Maybe Kubernetes',
      confirmed_at: '2026-10-04',
    },
  });

  assert.equal(matchEvidenceForSkill('Kubernetes', base).length, 0);
});

test('contextual_claim requires context', () => {
  const invalid = {
    schema_version: 1,
    entries: [{
      id: 'ev-invalid',
      kind: 'experience',
      claim: 'Built pipelines',
      resume_scope: 'contextual_claim',
      status: 'user_confirmed',
      aliases: [],
      provenance: {
        type: 'user_confirmed',
        source: 'conversation',
        quote: 'Built pipelines',
        confirmed_at: '2026-10-04',
      },
    }],
  };

  assert.ok(validateEvidenceVault(invalid).some((error) => /context is required/.test(error)));
});
