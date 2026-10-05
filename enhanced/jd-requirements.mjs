#!/usr/bin/env node
import { readFileSync } from 'fs';
import { extractJdSkills, diagnoseExtraction } from '../jd-skill-gap.mjs';
import { canonicalize } from '../skill-extract.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const PREFERRED = /preferred|nice[- ]to[- ]have|bonus|great if/i;
const REQUIRED = /required|requirements|qualifications|must[- ]have|what\s+we|who\s+you|you(?:'|’)ll\s+have|you\s+will\s+have/i;

function kindAt(lines, lineIndex) {
  for (let i = lineIndex; i >= 0; i--) {
    const text = lines[i].replace(/[*_#]/g, '').trim();
    if (!text) continue;
    if (PREFERRED.test(text)) return 'preferred';
    if (REQUIRED.test(text)) return 'required';
    if (/^#{1,6}\s/.test(lines[i]) && i !== lineIndex) break;
  }
  return 'unspecified';
}

function findOccurrences(lines, skill) {
  const needle = skill.toLowerCase();
  const out = [];
  lines.forEach((line, index) => {
    const haystack = line.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      const before = at ? haystack[at - 1] : '';
      const after = haystack[at + needle.length] || '';
      if (!/[a-z0-9_]/i.test(before) && !/[a-z0-9_]/i.test(after)) {
        out.push({ line: index + 1, column_start: at + 1, column_end: at + skill.length + 1, text: line.slice(at, at + skill.length) });
      }
      from = at + Math.max(needle.length, 1);
    }
  });
  return out;
}

function extractStructuredRequirements(jdText) {
  const skills = extractJdSkills(jdText);
  const diagnostic = diagnoseExtraction(jdText, skills);
  const lines = jdText.split('\n');
  const requirements = skills.map(skill => {
    const occurrences = findOccurrences(lines, skill);
    const source = occurrences[0] || null;
    return {
      requirement: skill,
      canonical_requirement: canonicalize(skill),
      kind: source ? kindAt(lines, source.line - 1) : 'unspecified',
      source_span: source,
      provenance: 'job_description',
      uncertainty: source ? (occurrences.length === 1 ? 'low' : 'medium') : 'high',
      candidate_evidence: false
    };
  });
  return {
    schema_version: 1,
    source_type: 'job_description',
    candidate_evidence: false,
    extraction_status: diagnostic ? 'inconclusive' : 'ok',
    diagnostic,
    requirements
  };
}

export { extractStructuredRequirements };

function selfTest() {
  const jd = '# Role\n\n## Requirements\n- Python and Kubernetes\n\n## Preferred\n- Terraform\n';
  const result = extractStructuredRequirements(jd);
  const byName = new Map(result.requirements.map(r => [r.requirement, r]));
  const ok = result.extraction_status === 'ok'
    && byName.get('Python')?.kind === 'required'
    && byName.get('Terraform')?.kind === 'preferred'
    && byName.get('Kubernetes')?.source_span?.line === 4
    && result.requirements.every(r => r.candidate_evidence === false);
  if (!ok) throw new Error('C03 structured requirement self-test failed');
  console.log('PASS: C03 structured JD requirements');
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const path = process.argv.slice(2).find(a => !a.startsWith('--'));
    if (!path) throw new Error('Usage: node enhanced/jd-requirements.mjs <jd-file> | --self-test');
    const result = extractStructuredRequirements(readFileSync(path, 'utf8'));
    console.log(JSON.stringify(result, null, 2));
    if (result.extraction_status !== 'ok') process.exitCode = 1;
  }
}
