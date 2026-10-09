import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { loadResumeAuthority, digest } from '../enhanced/resume-authority.mjs';
import { tailorBoundResume } from '../enhanced/evidence-tailor.mjs';
import { renderBoundResume } from '../enhanced/tailor-resume.mjs';
import { verifyBoundPayload, verifyResumeArtifact, saveVerification } from '../enhanced/verify-resume.mjs';

const CODE = dirname(dirname(fileURLToPath(import.meta.url)));
const JD = '## Requirements\n- Python\n- Kubernetes\n';
const persona = { id: 'data-engineer' };
function fixture(name = 'Synthetic Candidate') {
  const root = mkdtempSync(join(tmpdir(), 'career-c06-'));
  for (const dir of ['data', 'config', 'output', 'jds']) mkdirSync(join(root, dir));
  const cv = '# Candidate\n## Experience\n### Verified Employer — Engineer — 2021–2024\n- Built Python pipelines.\n## Skills\n- Python\n';
  writeFileSync(join(root, 'cv.md'), cv); writeFileSync(join(root, 'jds/job.md'), JD);
  const profile = { schema_version: 1, candidate: {}, summary: [], projects: [], education: [], certifications: [],
    skills: [{ id: 'python', text: 'Python', review_status: 'verified', evidence: { source: 'cv.md', line: 6, quote: '- Python' } }],
    experiences: [{ id: 'employer', label: 'Verified Employer — Engineer — 2021–2024', review_status: 'verified',
      evidence: { source: 'cv.md', line: 3, quote: '### Verified Employer — Engineer — 2021–2024' },
      facts: [{ id: 'pipelines', text: 'Built Python pipelines.', review_status: 'verified', evidence: { source: 'cv.md', line: 4, quote: '- Built Python pipelines.' } }] }] };
  const vault = { schema_version: 1, entries: [{ id: 'k8s', kind: 'skill', claim: 'Kubernetes', aliases: [], status: 'user_confirmed', resume_scope: 'skill_only',
    provenance: { type: 'user_confirmed', source: 'conversation', quote: 'Kubernetes; private note must not authorize experience.', confirmed_at: '2026-01-01' } }] };
  const save = () => { writeFileSync(join(root, 'data/career-profile.yml'), yaml.dump(profile)); writeFileSync(join(root, 'data/career-evidence.yml'), yaml.dump(vault)); };
  save(); writeFileSync(join(root, 'config/profile.yml'), yaml.dump({ name, email: 'synthetic@example.com' }));
  const proposal = { persona_id: persona.id, payload: { candidate: { name, email: 'synthetic@example.com' },
    experience: [{ company: 'Verified Employer', role: 'Engineer', dates: '2021–2024', bullets: ['Built Python pipelines.'] }],
    skills: [{ category: 'Technologies', items: ['Python', 'Kubernetes'] }] },
    bindings: { '/candidate/name': 'config:name', '/candidate/email': 'config:email', '/experience/0/company': 'master_profile:employer',
      '/experience/0/role': 'master_profile:employer', '/experience/0/dates': 'master_profile:employer', '/experience/0/bullets/0': 'master_profile:pipelines',
      '/skills/0/items/0': 'master_profile:python', '/skills/0/items/1': 'evidence_vault:k8s' } };
  const authority = () => loadResumeAuthority({ root, persona });
  const audit = () => tailorBoundResume({ proposal, authority: authority(), jdText: JD });
  return { root, proposal, profile, vault, save, authority, audit, close: () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
}
function withFixture(fn) { const f = fixture(); try { return fn(f); } finally { f.close(); } }
const check = (f, audit = f.audit(), jdText = JD) => verifyBoundPayload({ audit, authority: f.authority(), jdText });
const reasons = report => report.faithfulness.findings.map(f => f.reason);
function rehash(audit) { audit.snapshot.payload_sha256 = digest(audit.payload); for (const [path, b] of Object.entries(audit.bindings)) {
  const value = path.slice(1).split('/').reduce((v, k) => v?.[k], audit.payload);
  if (value !== undefined) b.text_sha256 = digest(value);
} }

test('fresh source bindings pass independently with a separate relevance verdict', () => withFixture(f => {
  const before = f.audit(), report = check(f, before);
  assert.equal(report.faithfulness.verdict, 'pass'); assert.equal(report.relevance.verdict, 'strong');
  assert.equal(report.relevance.coveragePct, 100); assert.equal(report.relevance.candidate_evidence_from_jd, false);
  assert.deepEqual(before, f.audit());
}));

test('high keyword relevance cannot excuse fabricated experience or recomputed hashes', () => withFixture(f => {
  const audit = f.audit(); audit.payload.experience[0].bullets[0] = 'Built Python and Kubernetes systems for 500 customers.';
  audit.safety = { candidate_facts_from_jd: 0, independently_verified: true }; rehash(audit);
  const report = check(f, audit); assert.equal(report.relevance.verdict, 'strong'); assert.equal(report.faithfulness.verdict, 'fail');
  assert.ok(reasons(report).includes('unsupported-source-wording-or-field'));
}));

test('faithful low-relevance content stays factually valid', () => withFixture(f => {
  const jd = '## Requirements\n- Rust\n'; const audit = f.audit(); audit.snapshot.jd_sha256 = digest(jd);
  const report = check(f, audit, jd); assert.equal(report.faithfulness.verdict, 'pass'); assert.equal(report.relevance.verdict, 'low');
}));

test('negation, qualification details and missing extraction produce review, not a fit pass', () => withFixture(f => {
  for (const jd of ['## Requirements\n- No Kubernetes experience required\n', '## Requirements\n- Five years of Python experience\n', 'A role with no requirement section']) {
    const audit = f.audit(); audit.snapshot.jd_sha256 = digest(jd);
    const report = check(f, audit, jd); assert.equal(report.faithfulness.verdict, 'pass'); assert.equal(report.relevance.verdict, 'needs_review');
  }
}));

test('changed audit provenance fails even when the words are true', () => withFixture(f => {
  const audit = f.audit(); audit.bindings['/experience/0/bullets/0'].evidence.line = 999;
  assert.ok(reasons(check(f, audit)).includes('altered-provenance'));
}));

test('unsupported, JD-derived, orphan and incorrectly scoped bindings each fail', () => withFixture(f => {
  for (const ref of [undefined, 'job_description:python', 'inference:docker', 'evidence_vault:k8s']) {
    const audit = f.audit(); if (ref) audit.bindings['/experience/0/bullets/0'].ref = ref; else delete audit.bindings['/experience/0/bullets/0'];
    assert.equal(check(f, audit).faithfulness.verdict, 'fail');
  }
  const audit = f.audit(); audit.bindings['/summary'] = audit.bindings['/skills/0/items/0'];
  assert.ok(reasons(check(f, audit)).includes('orphan-or-presentation-binding'));
}));

test('approved heading words cannot become a different employer or role', () => withFixture(f => {
  const audit = f.audit(); audit.payload.experience[0].company = 'Engineer'; rehash(audit);
  assert.ok(reasons(check(f, audit)).includes('unsupported-source-wording-or-field'));
}));

test('moving an approved bullet to another entity fails independent context inspection', () => withFixture(f => {
  f.profile.experiences.push({ ...structuredClone(f.profile.experiences[0]), id: 'other', facts: [] }); f.save();
  const audit = f.audit(), authority = f.authority(), other = authority.records.find(r => r.ref === 'master_profile:other');
  for (const field of ['company', 'role', 'dates']) audit.bindings['/experience/0/' + field] = { ref: other.ref, ...other.binding, text_sha256: digest(audit.payload.experience[0][field]) };
  assert.ok(reasons(verifyBoundPayload({ audit, authority, jdText: JD })).includes('wrong-experience-context'));
}));

test('current contradictions and revoked evidence invalidate an older audit', () => withFixture(f => {
  const audit = f.audit(); writeFileSync(join(f.root, 'cv.md'), readFileSync(join(f.root, 'cv.md'), 'utf8') + '\nNo Python experience.\n');
  assert.equal(check(f, audit).faithfulness.verdict, 'fail');
  f.vault.entries[0].status = 'rejected'; f.save();
  assert.ok(reasons(check(f, audit)).includes('missing-or-unauthorized-evidence'));
}));

test('persona mismatch and an invented headline fail independently', () => withFixture(f => {
  const audit = f.audit(); audit.persona_id = 'platform'; assert.ok(reasons(check(f, audit)).includes('persona-mismatch'));
  audit.persona_id = persona.id; audit.payload.candidate.title = 'Principal Architect'; rehash(audit);
  assert.equal(check(f, audit).faithfulness.verdict, 'fail');
}));

test('separate candidate roots and escaped symlink paths remain isolated', () => withFixture(f => {
  const other = fixture('Other Candidate');
  try {
    assert.equal(verifyBoundPayload({ audit: f.audit(), authority: other.authority(), jdText: JD }).faithfulness.verdict, 'fail');
    const saved = renderBoundResume({ root: other.root, result: other.audit(), format: 'text', output: 'output/cv' });
    assert.throws(() => verifyResumeArtifact({ root: f.root, evidence: saved.evidence, artifact: saved.artifact, jdText: JD, persona: persona.id }), /data root/);
    symlinkSync(other.root, join(f.root, 'escape'), 'junction');
    assert.throws(() => saveVerification({ root: f.root, report: {}, output: 'escape/report.json' }), /Symlink/);
  } finally { other.close(); }
}));

test('presentation cannot relabel skills as certifications; malformed schemas fail', () => withFixture(f => {
  for (const mutate of [a => a.payload.skills[0].category = 'Certifications', a => a.payload.sections = { skills: 'Certifications' },
    a => a.payload.experience[0].ownership = 'Built Python pipelines.', a => a.payload.skills = {}]) {
    const audit = f.audit(); mutate(audit); rehash(audit); assert.equal(check(f, audit).faithfulness.verdict, 'fail');
  }
}));

test('identity and employer keywords do not improve relevance, and empty claims need review', () => withFixture(f => {
  f.proposal.payload = { candidate: f.proposal.payload.candidate }; f.proposal.bindings = Object.fromEntries(Object.entries(f.proposal.bindings).filter(([p]) => p.startsWith('/candidate/')));
  const report = check(f); assert.equal(report.faithfulness.verdict, 'needs_review'); assert.equal(report.relevance.coveragePct, 0);
}));

test('HTML, text and LaTeX artifacts pass independent source and rendering checks', () => withFixture(f => {
  for (const format of ['html', 'text', 'latex']) {
    const saved = renderBoundResume({ root: f.root, result: f.audit(), format, output: 'output/cv-' + format });
    const report = verifyResumeArtifact({ root: f.root, evidence: saved.evidence, artifact: saved.artifact, jdText: JD, persona: persona.id });
    assert.equal(report.faithfulness.verdict, 'pass', JSON.stringify(report.faithfulness));
    assert.ok(report.diagnostics.legacy_facts); assert.ok(report.diagnostics.ats_payload); assert.ok(report.diagnostics.titles);
    if (format === 'html') assert.ok(report.diagnostics.ats);
    if (process.platform !== 'win32') assert.equal(statSync(saved.artifact).mode & 0o777, 0o600);
  }
}));

test('rendered fabricated prose fails even after an attacker recomputes its audit hash', () => withFixture(f => {
  const saved = renderBoundResume({ root: f.root, result: f.audit(), format: 'html', output: 'output/cv' });
  const changed = readFileSync(saved.artifact, 'utf8').replace('</body>', '<p>Led an invented Terraform department.</p></body>');
  writeFileSync(saved.artifact, changed); const audit = JSON.parse(readFileSync(saved.evidence, 'utf8')); audit.render.artifact_sha256 = digest(changed);
  const report = verifyResumeArtifact({ root: f.root, evidence: audit, artifact: saved.artifact, jdText: JD, persona: persona.id });
  assert.equal(report.faithfulness.verdict, 'fail'); assert.ok(reasons(report).includes('artifact-not-derived-from-bound-payload'));
}));

test('LaTeX relevance excludes truthful claims omitted by its upstream template', () => withFixture(f => {
  f.profile.summary.push({ id: 'summary', text: 'Built Python pipelines.', review_status: 'verified', evidence: { source: 'cv.md', line: 4, quote: '- Built Python pipelines.' } }); f.save();
  f.proposal.payload = { candidate: f.proposal.payload.candidate, summary: 'Built Python pipelines.' };
  f.proposal.bindings = { '/candidate/name': 'config:name', '/candidate/email': 'config:email', '/summary': 'master_profile:summary' };
  const audit = f.audit(), jd = '## Requirements\n- Python\n'; audit.snapshot.jd_sha256 = digest(jd);
  assert.equal(verifyBoundPayload({ audit, authority: f.authority(), jdText: jd, format: 'html' }).relevance.coveragePct, 100);
  assert.equal(verifyBoundPayload({ audit, authority: f.authority(), jdText: jd, format: 'latex' }).relevance.coveragePct, 0);
}));

test('unknown artifact formats cannot receive a factual pass', () => withFixture(f => {
  const saved = renderBoundResume({ root: f.root, result: f.audit(), format: 'text', output: 'output/cv' });
  const audit = JSON.parse(readFileSync(saved.evidence, 'utf8')); audit.render.format = 'pdf';
  assert.equal(verifyResumeArtifact({ root: f.root, evidence: audit, artifact: saved.artifact, jdText: JD, persona: persona.id }).faithfulness.verdict, 'fail');
}));

test('private verification CLI writes a report, preserves truth, and exits nonzero on tampering', () => withFixture(f => {
  const saved = renderBoundResume({ root: f.root, result: f.audit(), format: 'text', output: 'output/cv' });
  const before = readFileSync(join(f.root, 'data/career-profile.yml'), 'utf8');
  const run = () => spawnSync(process.execPath, [join(CODE, 'enhanced/verify-resume.mjs'), '--evidence', saved.evidence,
    '--artifact', saved.artifact, '--jd', 'jds/job.md', '--persona', persona.id], { cwd: CODE, env: { ...process.env, CAREER_OPS_ROOT: f.root }, encoding: 'utf8', timeout: 15000 });
  const good = run(); assert.equal(good.status, 0, good.stderr); const report = JSON.parse(good.stdout); assert.equal(report.faithfulness, 'pass');
  writeFileSync(saved.artifact, readFileSync(saved.artifact, 'utf8') + '\nInvented employment.\n');
  assert.equal(run().status, 1); assert.equal(readFileSync(join(f.root, 'data/career-profile.yml'), 'utf8'), before);
}));
