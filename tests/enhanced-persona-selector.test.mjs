import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPersona } from '../enhanced/persona-selector.mjs';

const evidence = (line, quote) => ({ source: 'cv.md', line, quote });
const profile = {
  summary: [
    { id: 's1', text: 'Builds reliable data platforms', review_status: 'verified', evidence: evidence(2, 'Builds reliable data platforms') },
    { id: 's2', text: 'Unverified quantum expert', review_status: 'needs_review', evidence: evidence(3, 'Unverified quantum expert') },
  ],
  skills: [
    { id: 'k1', text: 'Python', review_status: 'verified', evidence: evidence(8, 'Python') },
    { id: 'k2', text: 'Rust', review_status: 'needs_review', evidence: evidence(8, 'Rust') },
  ],
  certifications: [],
  experiences: [{
    id: 'e1', label: 'Synthetic Employer', review_status: 'verified', evidence: evidence(12, 'Synthetic Employer'),
    facts: [
      { id: 'ef1', text: 'Built Python ETL pipelines', review_status: 'verified', evidence: evidence(13, 'Built Python ETL pipelines') },
      { id: 'ef2', text: 'Claim awaiting review', review_status: 'needs_review', evidence: evidence(14, 'Claim awaiting review') },
    ],
  }],
  projects: [], education: [],
};
const vault = { schema_version: 1, entries: [
  { id: 'ev1', kind: 'skill', claim: 'Apache Airflow', resume_scope: 'skill_only', status: 'user_confirmed', aliases: [], provenance: { type: 'user_confirmed', source: 'conversation', quote: 'I use Airflow', confirmed_at: '2026-01-01' } },
  { id: 'ev2', kind: 'skill', claim: 'Kubernetes', resume_scope: 'skill_only', status: 'needs_review', aliases: [], provenance: { type: 'user_confirmed', source: 'conversation', quote: 'maybe', confirmed_at: '2026-01-01' } },
]};

test('persona selection is deterministic and ranks relevant verified facts', () => {
  const persona = { id: 'data-engineer', title: 'Data Engineer', keywords: ['python', 'etl', 'airflow'] };
  const a = selectPersona({ profile, vault, persona });
  const b = selectPersona({ profile, vault, persona });
  assert.deepEqual(a, b);
  assert.equal(a.facts[0].id, 'ef1');
  assert.ok(a.facts.some((f) => f.id === 'ev1'));
});

test('unverified profile and vault facts never cross the truth boundary', () => {
  const result = selectPersona({ profile, vault, persona: { id: 'platform', keywords: ['rust', 'kubernetes'] } });
  assert.ok(!result.facts.some((f) => ['s2', 'k2', 'ef2', 'ev2'].includes(f.id)));
  assert.equal(result.safety.generated_claims, 0);
  assert.equal(result.safety.jd_keywords_are_evidence, false);
});

test('selection preserves provenance and scope', () => {
  const result = selectPersona({ profile, vault, persona: { id: 'data', keywords: ['airflow'] } });
  const profileFact = result.facts.find((f) => f.id === 'ef1');
  const vaultFact = result.facts.find((f) => f.id === 'ev1');
  assert.equal(profileFact.binding.source, 'master_profile');
  assert.equal(profileFact.binding.evidence.source, 'cv.md');
  assert.equal(vaultFact.binding.source, 'evidence_vault');
  assert.equal(vaultFact.binding.resume_scope, 'skill_only');
  assert.equal(vaultFact.binding.provenance.source, 'conversation');
});

test('persona changes ranking, not the authorized fact set', () => {
  const data = selectPersona({ profile, vault, persona: { id: 'data', keywords: ['etl', 'airflow'] } });
  const general = selectPersona({ profile, vault, persona: { id: 'general', keywords: ['reliable'] } });
  assert.deepEqual(new Set(data.facts.map((f) => f.id)), new Set(general.facts.map((f) => f.id)));
});
