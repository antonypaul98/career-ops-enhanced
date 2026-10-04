#!/usr/bin/env node

/**
 * Evidence-aware JD skill-gap checker.
 *
 * Keeps upstream jd-skill-gap.mjs intact, then upgrades only true gaps when
 * Career Evidence Vault contains user-confirmed or source-verified proof.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { classifySkillGaps, diagnoseExtraction, extractJdSkills } from '../jd-skill-gap.mjs';
import { loadEvidenceVault, matchEvidenceForSkill } from './evidence-vault.mjs';

export function classifySkillGapsWithEvidence(jdSkills, cvText, vault) {
  const base = classifySkillGaps(jdSkills, cvText);
  const supportedByEvidence = [];
  const gap = [];
  const evidence = {};

  for (const skill of base.gap) {
    const matches = matchEvidenceForSkill(skill, vault);
    if (!matches.length) {
      gap.push(skill);
      continue;
    }

    supportedByEvidence.push(skill);
    evidence[skill] = matches.map((entry) => ({
      id: entry.id,
      claim: entry.claim,
      resume_scope: entry.resume_scope,
      status: entry.status,
      source: entry.provenance?.source,
    }));
  }

  return {
    existing: base.existing,
    supportedByResume: base.supportedByResume,
    supportedByEvidence,
    gap,
    evidence,
  };
}

function usage() {
  return `Usage: node enhanced/jd-evidence-gap.mjs <jd-file> [--summary|--json]

Classifies JD requirements into:
  existing             named in cv.md Skills
  supportedByResume    demonstrated elsewhere in cv.md
  supportedByEvidence  absent from cv.md but backed by Career Evidence Vault
  gap                  not supported by either source
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }

  const jdArg = args.find((arg) => !arg.startsWith('--'));
  const summary = args.includes('--summary');
  const root = getCareerOpsRoot();
  const cvPath = resolve(root, 'cv.md');

  if (!jdArg || !existsSync(jdArg)) throw new Error('JD file not found.\n' + usage());
  if (!existsSync(cvPath)) throw new Error('cv.md not found at ' + cvPath);

  const jdText = readFileSync(jdArg, 'utf8');
  const cvText = readFileSync(cvPath, 'utf8');
  const vault = loadEvidenceVault({ root });
  const skills = extractJdSkills(jdText);
  const result = classifySkillGapsWithEvidence(skills, cvText, vault);
  const lowConfidence = diagnoseExtraction(jdText, skills);

  if (!summary) {
    console.log(JSON.stringify({ ...result, lowConfidence }, null, 2));
    return;
  }

  console.log('\nJD Evidence-Aware Skill-Gap Check');
  console.log('-'.repeat(48));
  console.log('JD skills found: ' + skills.length);
  console.log('  Already in Skills section:      ' + (result.existing.join(', ') || '(none)'));
  console.log('  Mentioned in resume prose:      ' + (result.supportedByResume.join(', ') || '(none)'));
  console.log('  Confirmed outside master CV:    ' + (result.supportedByEvidence.join(', ') || '(none)'));
  console.log('  Unsupported gaps:               ' + (result.gap.join(', ') || '(none)'));

  if (result.supportedByEvidence.length) {
    console.log('');
    console.log('  Evidence scope:');
    for (const skill of result.supportedByEvidence) {
      for (const item of result.evidence[skill] ?? []) {
        console.log('    - ' + skill + ': ' + item.resume_scope + ' | ' + item.status + ' | ' + item.source);
      }
    }
  }

  if (lowConfidence) {
    console.log('');
    console.log('  LOW CONFIDENCE: this is not a clean result.');
    console.log('     ' + lowConfidence.message);
    console.log('     (reason: ' + lowConfidence.reason + ')');
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error('jd-evidence-gap: ' + error.message);
    process.exitCode = 1;
  });
}
