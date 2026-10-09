#!/usr/bin/env node
/** C06: independent inspection, never a call back into the tailoring gate.
 * Shares the approved authority reader and representation adapters, not the
 * generator's verdicts. Relevance cannot authorize or excuse a career claim.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { isMainModule } from '../lib/is-main-module.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { validatePayload, KNOWN_ROOT_KEYS } from '../lib/cv-payload-schema.mjs';
import { analyzeCoverage } from '../keyword-match.mjs';
import { auditAts, isPass, DEFAULT_MIN_SCORE } from '../verify-ats.mjs';
import { verifyFacts } from '../verify-cv-facts.mjs';
import { lintPayload } from '../ats-payload.mjs';
import { parseCvExperience, parseTailoredExperience, checkTitles } from '../cv-title-check.mjs';
import { loadResumeAuthority, privatePath, digest, normalize } from './resume-authority.mjs';
import { extractStructuredRequirements } from './jd-requirements.mjs';
import { textPayload, latexPayload } from './tailor-resume.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TITLES = { summary: ['Professional Summary', 'Summary'], competencies: ['Core Competencies'],
  experience: ['Work Experience', 'Experience', 'Professional Experience'], projects: ['Projects'], education: ['Education'],
  certifications: ['Certifications'], awards: ['Awards & Honors'], interests: ['Interests'], skills: ['Skills'] };
const CATEGORIES = ['skills', 'languages', 'tools', 'frameworks', 'technologies', 'competencies', 'core competencies'];
const CLAIM_TEXT = /^\/(?:summary$|competencies\/\d+$|skills\/\d+\/items(?:\/\d+)?$|experience\/\d+\/(?:bullets\/\d+|context)$|projects\/\d+\/(?:description|tech|bullets\/\d+)$|education\/\d+\/description$)/;
const GROUP = { experiences: 'experience', projects: 'projects', education: 'education' };

function presentation(path, value) {
  if (path === '/lang') return /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(value);
  if (path === '/page_format') return ['a4', 'letter'].includes(value);
  if (path === '/candidate/photo_style') return ['rounded', 'circle', 'square'].includes(value);
  if (/^\/sections\/[a-z]+$/.test(path)) return TITLES[path.split('/')[2]]?.includes(value) === true;
  return /^\/skills\/\d+\/category$/.test(path) && CATEGORIES.includes(normalize(value).toLowerCase());
}

function inScope(record, path) {
  if (record.kind === 'identity') return path === '/candidate/' + record.field.replaceAll('.', '/');
  if (record.scope === 'skill_only' || record.kind === 'skills') return /^\/(?:skills\/\d+\/items(?:\/\d+)?|competencies\/\d+)$/.test(path);
  if (record.heading) return new RegExp('^/' + GROUP[record.kind] + '/\\d+/(?:company|role|location|dates|period|name|title|org|year)$').test(path);
  if (record.scope === 'contextual_claim') {
    if (path === '/summary') return true;
    const section = { experience: 'experience', project: 'projects', education: 'education', certification: 'certifications' }[record.kind];
    if (section === 'certifications') return /^\/certifications\/\d+\/title$/.test(path);
    return !!section && !!record.parent_ref && new RegExp('^/' + section + '/\\d+/(?:bullets/\\d+|description|context)$').test(path);
  }
  const rules = { summary: /^\/summary$/, experiences: /^\/experience\/\d+\/bullets\/\d+$/,
    projects: /^\/projects\/\d+\/(?:description|tech|bullets\/\d+)$/, education: /^\/education\/\d+\/description$/,
    certifications: /^\/certifications\/\d+\/title$/, awards: /^\/awards\/\d+\/(?:title|org|year)$/, interests: /^\/interests\/\d+$/ };
  return rules[record.kind]?.test(path) === true;
}

function leaves(value, path = '', result = []) {
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) result.push({ path: path + '/' + key, unsafe: true });
      else leaves(item, path + '/' + key, result);
    }
  } else result.push({ path, value });
  return result;
}

function relevance(jdText, claims, format = 'html', payload = {}) {
  const requirements = extractStructuredRequirements(jdText);
  const unresolved = requirements.requirements.filter(r => r.requirement_type !== 'technology' || r.polarity !== 'positive' || r.uncertainty !== 'low');
  const known = requirements.requirements.filter(r => r.requirement_type === 'technology' && r.polarity === 'positive' && r.uncertainty === 'low');
  const visible = claims.filter(c => {
    if (!CLAIM_TEXT.test(c.path)) return false;
    if (format !== 'latex') return true;
    if (/^\/(?:summary|competencies|certifications|interests)(?:\/|$)/.test(c.path)) return false;
    const education = c.path.match(/^\/education\/(\d+)\//);
    return !education || !!payload.education?.[Number(education[1])]?.org;
  });
  const coverage = analyzeCoverage(known.map(r => r.canonical_requirement), visible.map(c => String(c.value ?? '')).join('\n'));
  return { verdict: requirements.extraction_status !== 'ok' || !coverage.total || unresolved.length ? 'needs_review'
    : coverage.coveragePct >= 80 ? 'strong' : coverage.coveragePct ? 'partial' : 'low',
    method: 'advisory technical keyword coverage over represented claim fields; not an eligibility or expertise verdict',
    ...coverage, extraction_status: requirements.extraction_status,
    unresolved_requirements: unresolved.map(r => ({ id: r.id, requirement: r.canonical_requirement, reasons: r.uncertainty_reasons, source_span: r.source_span })),
    candidate_evidence_from_jd: false };
}

export function verifyBoundPayload({ audit, authority, jdText = '', format = 'html' }) {
  const findings = [], facts = [], visited = new Set();
  const fail = (path, reason) => findings.push({ path, reason });
  const payload = audit?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { schema_version: 1, scope: 'payload', faithfulness: { verdict: 'fail', findings: [{ path: '/payload', reason: 'invalid-payload' }], checked_claims: 0 }, relevance: relevance(jdText, []) };
  }
  if (audit.schema_version !== 1) fail('/schema_version', 'unsupported-audit-schema');
  if (audit.persona_id !== authority.persona.id) fail('/persona_id', 'persona-mismatch');
  for (const [field, value] of Object.entries(authority.snapshot)) if (!isDeepStrictEqual(audit.snapshot?.[field], value)) fail('/snapshot/' + field, 'stale-or-other-candidate-source');
  if (audit.snapshot?.payload_sha256 !== digest(payload)) fail('/snapshot/payload_sha256', 'modified-payload');
  if (audit.snapshot?.jd_sha256 !== digest(jdText)) fail('/snapshot/jd_sha256', 'different-job-description');
  const shape = validatePayload(payload, 'html');
  for (const message of [...shape.errors, ...shape.warnings]) fail('/payload', 'invalid-schema: ' + message);
  for (const field of Object.keys(payload)) if (!KNOWN_ROOT_KEYS.html.includes(field)) fail('/' + field, 'unknown-section');
  for (const field of ['experience', 'projects', 'education', 'certifications', 'awards', 'skills', 'competencies', 'interests']) {
    if (field in payload && !Array.isArray(payload[field])) fail('/' + field, 'invalid-list-shape');
  }
  const records = new Map(authority.records.map(r => [r.ref, r]));
  for (const item of leaves(payload)) {
    const { path, value } = item;
    if (item.unsafe || typeof value !== 'string' || !value.trim()) { fail(path, 'invalid-claim-shape'); continue; }
    if (presentation(path, value)) continue;
    facts.push(item); visited.add(path);
    const binding = audit.bindings?.[path];
    const record = records.get(binding?.ref);
    if (!record) { fail(path, 'missing-or-unauthorized-evidence'); continue; }
    if (!inScope(record, path)) fail(path, 'evidence-scope-mismatch');
    const field = path.split('/').at(-1);
    const expectedText = record.heading ? record.field_values?.[field] : record.text;
    if (expectedText === undefined || normalize(expectedText) !== normalize(value)) fail(path, 'unsupported-source-wording-or-field');
    const expected = { ref: record.ref, ...structuredClone(record.binding), text_sha256: digest(value),
      ...(record.parent_ref ? { parent_ref: record.parent_ref } : {}), ...(record.context_ref ? { context_ref: record.context_ref } : {}) };
    if (!isDeepStrictEqual(binding, expected)) fail(path, 'altered-provenance');
  }
  for (const path of Object.keys(audit.bindings ?? {})) if (!visited.has(path)) fail(path, 'orphan-or-presentation-binding');
  for (const section of ['experience', 'projects', 'education']) {
    if (!Array.isArray(payload[section])) continue;
    payload[section].forEach((_entry, index) => {
      const members = facts.filter(f => f.path.startsWith(`/${section}/${index}/`)).map(f => records.get(audit.bindings?.[f.path]?.ref)).filter(Boolean);
      const entities = new Set(members.filter(r => r.heading).map(r => r.context_ref || r.ref));
      const parents = new Set(members.filter(r => !r.heading).map(r => r.context_ref || r.parent_ref).filter(Boolean));
      if (entities.size !== 1 || parents.size > 1 || [...parents].some(ref => !entities.has(ref))) fail(`/${section}/${index}`, 'wrong-experience-context');
    });
  }
  const substantive = facts.filter(f => CLAIM_TEXT.test(f.path)).length;
  return { schema_version: 1, scope: 'payload', persona_id: authority.persona.id,
    faithfulness: { verdict: findings.length ? 'fail' : substantive ? 'pass' : 'needs_review', checked_claims: facts.length,
      findings, ...(substantive ? {} : { reason: 'no-substantive-candidate-claims' }) },
    relevance: relevance(jdText, facts, format, payload),
    input_digests: { payload_sha256: digest(payload), jd_sha256: digest(jdText), authority_sha256: authority.snapshot.authority_sha256 } };
}

export function verifyResumeArtifact({ root, evidence, artifact, jdText = '', persona = 'general' }) {
  const audit = typeof evidence === 'string' ? JSON.parse(readFileSync(privatePath(root, evidence), 'utf8')) : evidence;
  const artifactPath = privatePath(root, artifact);
  const artifactText = readFileSync(artifactPath, 'utf8');
  const authority = loadResumeAuthority({ root, persona: { id: persona } });
  const format = audit?.render?.format;
  const report = verifyBoundPayload({ audit, authority, jdText, format });
  report.scope = 'source artifact';
  const add = reason => { report.faithfulness.findings.push({ path: '/render', reason }); report.faithfulness.verdict = 'fail'; };
  if (!['html', 'text', 'latex'].includes(format)) { add('unsupported-artifact-format-requires-review'); return report; }
  if (audit.render.artifact_sha256 !== digest(artifactText)) add('modified-artifact');
  if (report.faithfulness.verdict === 'fail') return report;
  const outputDir = privatePath(root, 'output');
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(outputDir, '.verification-'));
  try {
    const renderPayload = format === 'latex' ? latexPayload(audit.payload) : audit.payload;
    if (audit.render.payload_sha256 !== digest(renderPayload)) add('modified-render-payload');
    const input = join(stage, 'payload.json'), expected = join(stage, 'expected.' + (format === 'latex' ? 'tex' : 'html'));
    writeFileSync(input, JSON.stringify(renderPayload), { mode: 0o600 });
    let expectedText;
    if (format === 'text') expectedText = textPayload(renderPayload);
    else {
      const args = [join(CODE_ROOT, format === 'html' ? 'build-cv-html.mjs' : 'build-cv-latex.mjs'), input, expected];
      if (format === 'html') args.push(join(CODE_ROOT, 'templates/cv-template.html'));
      else args.push('--template=standard');
      const ran = spawnSync(process.execPath, args, { cwd: CODE_ROOT, env: { ...process.env, CAREER_OPS_ROOT: root,
        CAREER_OPS_PROFILE: privatePath(root, 'config/profile.yml') }, encoding: 'utf8', timeout: 30000 });
      if (ran.status !== 0) { add('independent-render-failed'); return report; }
      expectedText = readFileSync(expected, 'utf8');
    }
    // Recomputing an attacker-supplied hash is insufficient: build an expected
    // artifact from freshly checked facts with the trusted system renderer.
    if (artifactText !== expectedText) add('artifact-not-derived-from-bound-payload');
    const approved = join(stage, 'approved.txt');
    writeFileSync(approved, authority.records.map(r => r.text).join('\n'), { mode: 0o600 });
    const factConfig = privatePath(root, 'config/cv-facts.yml');
    report.diagnostics = { legacy_facts: verifyFacts(textPayload(audit.payload), { sourcePaths: [approved], configPath: factConfig, cwd: root }),
      ats_payload: lintPayload(audit.payload) };
    if (report.diagnostics.legacy_facts.verdict === 'block') add('upstream-fact-check-blocked');
    if (format === 'html') {
      const ats = auditAts(artifactText); report.diagnostics.ats = { ...ats, verdict: isPass(ats, DEFAULT_MIN_SCORE) ? 'pass' : 'needs_review' };
    }
    try {
      const cv = privatePath(root, 'cv.md');
      report.diagnostics.titles = existsSync(cv) ? checkTitles(parseCvExperience(readFileSync(cv, 'utf8')), parseTailoredExperience(audit.payload))
        : { verdict: 'needs_review', reason: 'missing-canonical-cv' };
    } catch { report.diagnostics.titles = { verdict: 'needs_review', reason: 'incomplete-canonical-title-comparison' }; }
    report.artifact_sha256 = digest(artifactText);
    report.render_omissions = { sections: format === 'latex' ? ['summary', 'certifications', 'competencies', 'interests'].filter(s => audit.payload[s]?.length) : [],
      education: format === 'latex' ? (audit.payload.education ?? []).flatMap((e, i) => e.org ? [] : [i]) : [] };
    return report;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export function saveVerification({ root, report, output }) {
  const file = privatePath(root, output);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

async function main() {
  const { values } = parseArgs({ options: { evidence: { type: 'string' }, artifact: { type: 'string' }, jd: { type: 'string' },
    persona: { type: 'string', default: 'general' }, output: { type: 'string', default: 'output/resume-verification.json' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('node enhanced/verify-resume.mjs --evidence output/cv.evidence.json --artifact output/cv.html --jd jds/job.md --persona ID [--output output/verification.json]\nVerifies HTML, text, or LaTeX source artifacts. Compiled PDF requires separate final-artifact review.'); return; }
  if (!values.evidence || !values.artifact || !values.jd) throw new Error('--evidence, --artifact and --jd are required');
  const root = getCareerOpsRoot(), jdText = readFileSync(privatePath(root, values.jd), 'utf8');
  const report = verifyResumeArtifact({ root, evidence: values.evidence, artifact: values.artifact, jdText, persona: values.persona });
  const file = saveVerification({ root, report, output: values.output });
  console.log(JSON.stringify({ verification: file, faithfulness: report.faithfulness.verdict, relevance: report.relevance.verdict }));
  if (report.faithfulness.verdict !== 'pass') process.exitCode = 1;
}
if (isMainModule(import.meta.url)) main().catch(error => { console.error('verify-resume: ' + error.message); process.exitCode = 1; });
