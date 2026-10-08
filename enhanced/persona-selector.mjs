/**
 * C04 persona selection over verified career truth.
 *
 * Personas are presentation filters only: they may rank/select verified facts,
 * but never create facts or promote unreviewed evidence.
 */
import { usableEvidenceEntries } from './evidence-vault.mjs';

const norm = (v) => String(v ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

function tokens(values = []) {
  return [...new Set(values.flatMap((v) => norm(v).split(/[^\p{L}\p{N}+#./-]+/u)).filter((v) => v.length > 1))];
}

function scoreText(text, keywords) {
  const hay = norm(text);
  return keywords.reduce((n, k) => n + (hay.includes(k) ? 1 : 0), 0);
}

function sourceBinding(source, item, parent = null) {
  return {
    source,
    id: item.id,
    ...(parent ? { parent_id: parent.id } : {}),
    evidence: item.evidence ? { ...item.evidence } : undefined,
  };
}

export function verifiedProfileFacts(profile = {}) {
  const out = [];
  for (const section of ['summary', 'skills', 'certifications']) {
    for (const item of profile[section] ?? []) {
      if (item?.review_status !== 'verified') continue;
      out.push({ id: item.id, kind: section, text: item.text, binding: sourceBinding('master_profile', item) });
    }
  }
  for (const section of ['experiences', 'projects', 'education']) {
    for (const parent of profile[section] ?? []) {
      if (parent?.review_status === 'needs_review') continue;
      for (const fact of parent?.facts ?? []) {
        if (fact?.review_status !== 'verified') continue;
        out.push({
          id: fact.id,
          kind: section,
          text: fact.text,
          context: parent.label,
          binding: sourceBinding('master_profile', fact, parent),
        });
      }
    }
  }
  return out;
}

export function approvedVaultFacts(vault = {}) {
  return usableEvidenceEntries(vault).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    text: entry.claim,
    ...(entry.resume_scope === 'contextual_claim' ? { context: entry.context } : {}),
    resume_scope: entry.resume_scope,
    binding: {
      source: 'evidence_vault',
      id: entry.id,
      status: entry.status,
      resume_scope: entry.resume_scope,
      provenance: { ...entry.provenance },
    },
  }));
}

export function selectPersona({ profile = {}, vault = {}, persona }) {
  if (!persona || typeof persona !== 'object' || !norm(persona.id)) throw new Error('persona.id is required');
  const keywords = tokens([...(persona.keywords ?? []), persona.title ?? '', persona.id]);
  const facts = [...verifiedProfileFacts(profile), ...approvedVaultFacts(vault)];
  const ranked = facts.map((fact, index) => ({
    ...fact,
    relevance: scoreText([fact.text, fact.context].filter(Boolean).join(' '), keywords),
    _index: index,
  })).sort((a, b) => b.relevance - a.relevance || a._index - b._index)
    .map(({ _index, ...fact }) => fact);

  return {
    persona: { id: norm(persona.id), title: String(persona.title ?? persona.id), keywords },
    facts: ranked,
    safety: {
      truth_layer: 'verified_master_profile+approved_evidence_vault',
      generated_claims: 0,
      jd_keywords_are_evidence: false,
    },
  };
}
