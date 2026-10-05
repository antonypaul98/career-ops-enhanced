#!/usr/bin/env node
/** Employer requirements only. Never a source of candidate career facts. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractJdRequirementLines, diagnoseExtraction } from '../jd-skill-gap.mjs';
import { extractSkillMentions } from '../skill-extract.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const PREFERRED = /\b(?:preferred|nice[- ]to[- ]have|bonus|optional|great if)\b|加分項目|加分條件/i;
const REQUIRED = /\b(?:required|requirements|must(?:[- ]have)?|mandatory)\b|必要條件|基本要求|條件要求|職位要求/i;
const NEGATED = /\b(?:no|not|without|neither|except|isn['’]t|aren['’]t|don['’]t)\b/i;
const ALTERNATIVES = /\b(?:or|either|one of)\b|\//i;
const hash = text => createHash('sha256').update(text).digest('hex');

function classify(line) {
  const reasons = [];
  const linePreferred = PREFERRED.test(line.text);
  const lineRequired = REQUIRED.test(line.text);
  const preferred = linePreferred || (!lineRequired && PREFERRED.test(line.section));
  const required = lineRequired || (!linePreferred && REQUIRED.test(line.section));
  let kind = preferred !== required ? (preferred ? 'preferred' : 'required') : 'unspecified';
  if (preferred && required) reasons.push('mixed-strength');
  if (kind === 'unspecified') reasons.push('strength-unspecified');
  const polarity = NEGATED.test(line.text) ? 'uncertain' : 'positive';
  if (polarity === 'uncertain') {
    kind = 'unspecified';
    reasons.push('negation-requires-review');
  }
  if (/\b(?:years?|degree|bachelor|master|phd|led|owned|managed)\b/i.test(line.text)) reasons.push('qualification-details-require-review');
  if (ALTERNATIVES.test(line.text)) reasons.push('alternatives-require-review');
  return { kind, polarity, reasons };
}

function span(line, start = 0, end = line.text.length) {
  return { line: line.line, column_start: line.column_start + start,
    column_end: line.column_start + end, offset_start: line.offset_start + start,
    offset_end: line.offset_start + end, text: line.text.slice(start, end) };
}

export function extractStructuredRequirements(jdText) {
  if (typeof jdText !== 'string') throw new TypeError('JD must be a string');
  const sourceHash = hash(jdText);
  const groups = new Map();
  for (const line of extractJdRequirementLines(jdText)) {
    const classification = classify(line);
    const mentions = extractSkillMentions(line.text);
    const items = mentions.length ? mentions.map(m => ({ name: m.skill, start: m.start, end: m.end, type: 'technology' }))
      : [{ name: line.text, start: 0, end: line.text.length, type: 'other' }];
    for (const item of items) {
      // Deduplicate aliases and repeated mentions without losing occurrences,
      // strength distinctions, or the original employer wording.
      const key = [item.type, item.name.toLowerCase().replace(/\s+/g, ' ').trim(),
        classification.kind, classification.polarity].join('\0');
      let entry = groups.get(key);
      if (!entry) {
        entry = { id: `jd-${hash(sourceHash + '\0' + key).slice(0, 20)}`,
          requirement: line.text.slice(item.start, item.end), canonical_requirement: item.name,
          requirement_type: item.type, kind: classification.kind, polarity: classification.polarity,
          provenance: 'job_description', candidate_evidence: false, occurrences: [], uncertainty_reasons: [] };
        groups.set(key, entry);
      }
      entry.occurrences.push({ source_span: span(line, item.start, item.end),
        requirement_span: span(line), section: line.section });
      for (const reason of classification.reasons) {
        if (!entry.uncertainty_reasons.includes(reason)) entry.uncertainty_reasons.push(reason);
      }
      if (item.type === 'other' && !entry.uncertainty_reasons.includes('unparsed-requirement')) {
        entry.uncertainty_reasons.push('unparsed-requirement');
      }
    }
  }
  const requirements = [...groups.values()].map(entry => ({ ...entry,
    source_span: entry.occurrences[0].source_span,
    uncertainty: entry.polarity === 'uncertain' ? 'high' : entry.uncertainty_reasons.length ? 'medium' : 'low' }));
  const diagnostic = diagnoseExtraction(jdText, requirements);
  return { schema_version: 1, source_type: 'job_description', source_sha256: sourceHash,
    span_units: 'UTF-16; lines/columns 1-based; end exclusive; offsets 0-based',
    candidate_evidence: false, extraction_status: diagnostic ? 'inconclusive' : 'ok', diagnostic,
    review_required: !!diagnostic || requirements.some(r => r.uncertainty !== 'low'), requirements };
}

function selfTest() {
  const result = extractStructuredRequirements('## Requirements\n- Python and k8s\n## Preferred\n- Terraform\n');
  if (result.requirements.length !== 3 || result.requirements[1].canonical_requirement !== 'Kubernetes'
      || result.requirements[2].kind !== 'preferred' || result.candidate_evidence !== false) {
    throw new Error('C03 structured requirement self-test failed');
  }
  console.log('PASS: C03 structured JD requirements');
}

if (isMainModule(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--self-test')) selfTest();
    else if (args.includes('--help')) console.log('Usage: node enhanced/jd-requirements.mjs <jd-file> | --self-test');
    else {
      if (args.length !== 1 || args[0].startsWith('--')) throw new Error('Usage: node enhanced/jd-requirements.mjs <jd-file> | --self-test');
      const result = extractStructuredRequirements(readFileSync(args[0], 'utf8'));
      console.log(JSON.stringify(result, null, 2));
      if (result.extraction_status !== 'ok') process.exitCode = 1;
    }
  } catch (error) { console.error('jd-requirements: ' + error.message); process.exitCode = 1; }
}
