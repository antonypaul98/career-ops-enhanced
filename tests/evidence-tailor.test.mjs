import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { loadResumeAuthority, privatePath, proposalAuthority, digest } from '../enhanced/resume-authority.mjs';
import { tailorBoundResume } from '../enhanced/evidence-tailor.mjs';
import { renderBoundResume, latexPayload, textPayload } from '../enhanced/tailor-resume.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JD = '## Requirements\n- Python\n- Kubernetes\n## Preferred\n- Apache Airflow\n';
const persona = { id: 'data-engineer', keywords: ['Python', 'Apache Airflow'] };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'career-c05-'));
  mkdirSync(join(root, 'data')); mkdirSync(join(root, 'config')); mkdirSync(join(root, 'output')); mkdirSync(join(root, 'jds'));
  const lines = ['# Synthetic Candidate', '## Summary', 'Builds reliable data pipelines.', '## Experience',
    '### Synthetic Employer — Analyst — 2022–2024', '- Built Python ETL pipelines.', '## Skills', '- Python',
    '### Other Employer — Engineer — 2020–2022', '- Maintained SQL reporting.'];
  writeFileSync(join(root, 'cv.md'), lines.join('\n'));
  const evidence = line => ({ source: 'cv.md', line, quote: lines[line - 1] });
  const fact = (id, text, line) => ({ id, text, review_status: 'verified', evidence: evidence(line) });
  const profile = { schema_version: 1, candidate: {},
    summary: [fact('summary', lines[2], 3)], skills: [fact('python', 'Python', 8)], certifications: [], projects: [], education: [],
    experiences: [{ id: 'employer', label: lines[4].slice(4), review_status: 'verified', evidence: evidence(5),
      facts: [fact('etl', 'Built Python ETL pipelines.', 6)] },
    { id: 'other', label: lines[8].slice(4), review_status: 'verified', evidence: evidence(9),
      facts: [fact('sql', 'Maintained SQL reporting.', 10)] }] };
  const vault = { schema_version: 1, entries: [{ id: 'airflow', kind: 'skill', claim: 'Apache Airflow', aliases: [],
    resume_scope: 'skill_only', status: 'user_confirmed', provenance: { type: 'user_confirmed', source: 'conversation',
      quote: 'I use Airflow. Private audit: unrelated Kubernetes work and salary 123456.', confirmed_at: '2026-01-01' } }] };
  const save = () => {
    writeFileSync(join(root, 'data/career-profile.yml'), yaml.dump(profile));
    writeFileSync(join(root, 'data/career-evidence.yml'), yaml.dump(vault));
  };
  writeFileSync(join(root, 'config/profile.yml'), 'name: Synthetic Candidate\nemail: synthetic@example.com\nprivate_note: never transmit this\n');
  writeFileSync(join(root, 'jds/job.md'), JD);
  save();
  const proposal = { persona_id: persona.id, payload: { candidate: { name: 'Synthetic Candidate', email: 'synthetic@example.com' },
    summary: lines[2], experience: [{ company: 'Synthetic Employer', role: 'Analyst', dates: '2022–2024', bullets: ['Built Python ETL pipelines.'] }],
    skills: [{ category: 'Technologies', items: ['Python', 'Apache Airflow'] }] },
    bindings: { '/candidate/name': 'config:name', '/candidate/email': 'config:email', '/summary': 'master_profile:summary',
      '/experience/0/company': 'master_profile:employer', '/experience/0/role': 'master_profile:employer',
      '/experience/0/dates': 'master_profile:employer', '/experience/0/bullets/0': 'master_profile:etl',
      '/skills/0/items/0': 'master_profile:python', '/skills/0/items/1': 'evidence_vault:airflow' } };
  return { root, lines, profile, vault, proposal, save, close: () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
}

function withFixture(run) { const f = fixture(); try { return run(f); } finally { f.close(); } }
const build = f => tailorBoundResume({ proposal: f.proposal, authority: loadResumeAuthority({ root: f.root, persona }), jdText: JD });

test('tailoring preserves exact wording, provenance, source line and contextual parent', () => withFixture(f => {
  const result = build(f);
  assert.deepEqual(result.payload, f.proposal.payload);
  assert.deepEqual(result.bindings['/experience/0/bullets/0'].evidence, f.profile.experiences[0].facts[0].evidence);
  assert.equal(result.bindings['/experience/0/bullets/0'].parent_ref, 'master_profile:employer');
  assert.equal(result.bindings['/skills/0/items/1'].resume_scope, 'skill_only');
  assert.equal(result.gaps.find(gap => gap.requirement === 'Kubernetes').reason, 'unsupported');
  assert.equal(result.safety.candidate_facts_from_jd, 0);
}));

test('fabricated experience and metrics are excluded even with a valid source id', () => withFixture(f => {
  f.proposal.payload.experience[0].bullets.push('Built Kubernetes systems serving 500 customers.');
  f.proposal.bindings['/experience/0/bullets/1'] = 'master_profile:etl';
  const result = build(f);
  assert.deepEqual(result.payload.experience[0].bullets, ['Built Python ETL pipelines.']);
  assert.ok(result.excluded.some(item => item.reason === 'unsupported-wording'));
  assert.ok(!JSON.stringify(result.payload).includes('500'));
}));

test('unsupported employer/title removes the whole invented experience', () => withFixture(f => {
  f.proposal.payload.experience[0].company = 'Fabricated Employer';
  const result = build(f);
  assert.deepEqual(result.payload.experience, []);
  assert.ok(result.excluded.some(item => item.reason === 'unsupported-required-field'));
  assert.ok(!Object.keys(result.bindings).some(path => path.startsWith('/experience/')));
}));

test('approved heading parts cannot be swapped between employer, role and dates', () => withFixture(f => {
  for (const [field, value] of [['company', 'Analyst'], ['role', 'Synthetic Employer'], ['dates', 'Analyst']]) {
    const proposal = structuredClone(f.proposal);
    proposal.payload.experience[0][field] = value;
    const result = tailorBoundResume({ proposal, authority: loadResumeAuthority({ root: f.root, persona }), jdText: JD });
    assert.ok(result.excluded.some(item => item.path.endsWith('/' + field) && item.reason === 'unsupported-wording'));
    assert.notEqual(result.payload.experience?.[0]?.[field], value);
  }
}));

test('skill-only evidence cannot be promoted to experience, ownership or a summary claim', () => withFixture(f => {
  f.proposal.payload.experience[0].bullets.push('Apache Airflow');
  f.proposal.bindings['/experience/0/bullets/1'] = 'evidence_vault:airflow';
  f.proposal.payload.summary = 'Authored Apache Airflow';
  f.proposal.bindings['/summary'] = 'evidence_vault:airflow';
  f.proposal.payload.skills[0].category = 'Certifications';
  f.proposal.payload.sections = { skills: 'Certifications' };
  const result = build(f);
  assert.equal(result.payload.summary, undefined);
  assert.equal(result.payload.experience[0].bullets.length, 1);
  assert.equal(result.payload.skills[0].category, undefined);
  assert.equal(result.payload.sections.skills, undefined);
  assert.ok(result.excluded.some(item => item.reason === 'evidence-scope-mismatch'));
}));

test('JD keywords and inferred prerequisites have no candidate authority', () => withFixture(f => {
  f.proposal.payload.skills[0].items.push('Kubernetes', 'Docker');
  f.proposal.bindings['/skills/0/items/2'] = 'job_description:kubernetes';
  f.proposal.bindings['/skills/0/items/3'] = 'inference:docker';
  const result = build(f);
  assert.deepEqual(result.payload.skills[0].items, ['Python', 'Apache Airflow']);
  assert.ok(result.gaps.every(gap => gap.candidate_evidence === false));
}));

test('contradictory approved skills are withheld and reported for review', () => withFixture(f => {
  f.lines.push('- No Python experience.');
  writeFileSync(join(f.root, 'cv.md'), f.lines.join('\n'));
  f.profile.summary.push({ id: 'negative-python', text: 'No Python experience.', review_status: 'verified',
    evidence: { source: 'cv.md', line: 11, quote: '- No Python experience.' } });
  f.save();
  const result = build(f);
  assert.deepEqual(result.contradictions, ['Python']);
  assert.ok(!JSON.stringify(result.payload).includes('Python'));
  assert.equal(result.gaps.find(gap => gap.requirement === 'Python').reason, 'contradictory-evidence');
}));

test('a new contradiction in current primary evidence withholds an older reviewed skill', () => withFixture(f => {
  writeFileSync(join(f.root, 'cv.md'), f.lines.join('\n') + '\n- I have no Python experience.\n');
  const result = build(f);
  assert.deepEqual(result.contradictions, ['Python']);
  assert.ok(!JSON.stringify(result.payload).includes('Python'));
  assert.equal(result.snapshot.primary_sources_sha256['cv.md'], digest(readFileSync(join(f.root, 'cv.md'), 'utf8')));
}));

test('personas change selection order but never authorize a new claim or headline', () => withFixture(f => {
  const a = loadResumeAuthority({ root: f.root, persona });
  const b = loadResumeAuthority({ root: f.root, persona: { id: 'platform', title: 'Principal Engineer' } });
  assert.deepEqual(new Set(a.records.map(r => r.ref)), new Set(b.records.map(r => r.ref)));
  assert.throws(() => tailorBoundResume({ proposal: f.proposal, authority: b }), /persona/);
  f.proposal.payload.candidate.title = 'Principal Engineer';
  f.proposal.bindings['/candidate/title'] = 'persona:platform';
  assert.equal(build(f).payload.candidate.title, undefined);
}));

test('moving a true bullet to another employer is rejected', () => withFixture(f => {
  f.proposal.payload.experience[0] = { company: 'Other Employer', role: 'Engineer', bullets: ['Built Python ETL pipelines.'] };
  f.proposal.bindings['/experience/0/company'] = 'master_profile:other';
  f.proposal.bindings['/experience/0/role'] = 'master_profile:other';
  const result = build(f);
  assert.deepEqual(result.payload.experience, []);
  assert.ok(result.excluded.some(item => item.reason === 'experience-context-mismatch'));
}));

test('unreviewed, rejected and stale evidence never satisfies a claim', () => withFixture(f => {
  f.profile.experiences[0].facts[0].review_status = 'needs_review';
  f.vault.entries[0].status = 'rejected'; f.save();
  assert.deepEqual(build(f).payload.experience[0].bullets, []);
  assert.deepEqual(build(f).payload.skills[0].items, ['Python']);
  f.profile.experiences[0].facts[0].review_status = 'verified'; f.save();
  f.lines[5] = '- Different work.'; writeFileSync(join(f.root, 'cv.md'), f.lines.join('\n'));
  assert.ok(build(f).excluded.some(item => item.reason === 'unreviewed-or-stale-source'));
}));

test('contextual vault wording retains its context and cannot move into unrelated employment', () => withFixture(f => {
  f.vault.entries[0] = { ...f.vault.entries[0], kind: 'experience', claim: 'Orchestrated Airflow workflows',
    resume_scope: 'contextual_claim', context: 'Personal learning project' }; f.save();
  f.proposal.payload.summary = 'Orchestrated Airflow workflows — Personal learning project';
  f.proposal.bindings['/summary'] = 'evidence_vault:airflow';
  f.proposal.payload.experience[0].bullets.push(f.proposal.payload.summary);
  f.proposal.bindings['/experience/0/bullets/1'] = 'evidence_vault:airflow';
  const result = build(f);
  assert.equal(result.payload.summary, f.proposal.payload.summary);
  assert.equal(result.payload.experience[0].bullets.length, 1);
  f.proposal.payload.summary = 'Orchestrated Airflow workflows';
  assert.equal(build(f).payload.summary, undefined);
}));

test('a contextual experience cannot be relabeled as a certification', () => withFixture(f => {
  f.vault.entries[0] = { ...f.vault.entries[0], kind: 'experience', claim: 'Orchestrated Airflow workflows',
    resume_scope: 'contextual_claim', context: 'Personal learning project' }; f.save();
  f.proposal.payload.certifications = [{ title: 'Orchestrated Airflow workflows — Personal learning project' }];
  f.proposal.bindings['/certifications/0/title'] = 'evidence_vault:airflow';
  assert.deepEqual(build(f).payload.certifications, []);
}));

test('audit quotes and unused private config never enter model authority', () => withFixture(f => {
  const view = JSON.stringify(proposalAuthority(loadResumeAuthority({ root: f.root, persona })));
  assert.ok(!view.includes('123456')); assert.ok(!view.includes('never transmit')); assert.ok(!view.includes('Kubernetes'));
}));

test('separate candidate roots do not reuse facts, identities, or cached authority', () => withFixture(f => withFixture(other => {
  other.profile.experiences[0].facts[0].text = 'Maintained a private reporting pipeline.'; other.save();
  writeFileSync(join(other.root, 'config/profile.yml'), 'name: Other Candidate\nemail: other@example.com\n');
  const wrong = tailorBoundResume({ proposal: f.proposal, authority: loadResumeAuthority({ root: other.root, persona }) });
  assert.ok(!wrong.payload.candidate?.name);
  assert.deepEqual(wrong.payload.experience[0].bullets, []);
  assert.throws(() => privatePath(f.root, join(other.root, 'cv.md')), /data root/);
  assert.throws(() => privatePath(f.root, '../cv.md'), /data root/);
})));

test('symlinked input/output ancestors cannot escape the private root', () => withFixture(f => withFixture(other => {
  symlinkSync(other.root, join(f.root, 'escape'), 'junction');
  assert.throws(() => privatePath(f.root, 'escape/cv.md'), /Symlink/);
  assert.throws(() => privatePath(f.root, 'escape/new/file.md'), /Symlink/);
})));

test('absolute paths through another spelling of the same private root stay authorized', () => withFixture(f => withFixture(other => {
  const aliasRoot = join(other.root, 'candidate-alias');
  symlinkSync(f.root, aliasRoot, 'junction');
  assert.equal(privatePath(aliasRoot, join(f.root, 'cv.md')), realpathSync(join(f.root, 'cv.md')));
  assert.equal(privatePath(f.root, join(aliasRoot, 'cv.md')), realpathSync(join(f.root, 'cv.md')));
})));

test('non-primary JD source anchors cannot masquerade as reviewed profile evidence', () => withFixture(f => {
  f.profile.skills[0] = { ...f.profile.skills[0], text: 'Kubernetes', evidence: { source: 'jds/job.md', line: 3, quote: '- Kubernetes' } };
  f.proposal.payload.skills[0].items[0] = 'Kubernetes'; f.save();
  assert.deepEqual(build(f).payload.skills[0].items, ['Apache Airflow']);
}));

test('writing-sample traversal and symlink aliases cannot promote a JD into candidate authority', () => withFixture(f => {
  mkdirSync(join(f.root, 'writing-samples'));
  symlinkSync(join(f.root, 'jds'), join(f.root, 'writing-samples/jd-alias'), 'junction');
  for (const source of ['writing-samples/../jds/job.md', 'writing-samples/jd-alias/job.md']) {
    f.profile.skills[0] = { ...f.profile.skills[0], text: 'Kubernetes', evidence: { source, line: 3, quote: '- Kubernetes' } };
    f.proposal.payload.skills[0].items[0] = 'Kubernetes'; f.save();
    assert.deepEqual(build(f).payload.skills[0].items, ['Apache Airflow']);
  }
}));

test('unreviewed employment headings cannot authorize employer or role fields', () => withFixture(f => {
  delete f.profile.experiences[0].review_status; f.save();
  assert.deepEqual(build(f).payload.experience, []);
}));

test('identity and employer names cannot satisfy technical skill gaps', () => withFixture(f => {
  writeFileSync(join(f.root, 'config/profile.yml'), 'name: Kubernetes Person\nemail: synthetic@example.com\n');
  f.proposal.payload.candidate.name = 'Kubernetes Person';
  const result = build(f);
  assert.equal(result.payload.candidate.name, 'Kubernetes Person');
  assert.equal(result.gaps.find(gap => gap.requirement === 'Kubernetes').reason, 'unsupported');
}));

test('LaTeX adaptation never invents an institution from a degree title', () => {
  assert.deepEqual(latexPayload({ education: [{ title: 'Bachelor of Science' }] }).education, []);
});

test('malformed authority and ambiguous ids fail instead of silently approving', () => withFixture(f => {
  f.profile.skills.push({ ...f.profile.skills[0] }); f.save();
  assert.throws(() => build(f), /duplicate id/);
}));

test('filtered array bindings are remapped to the surviving claim', () => withFixture(f => {
  f.proposal.payload.skills[0].items.unshift('Fabricated skill');
  f.proposal.bindings['/skills/0/items/0'] = 'missing:fake';
  f.proposal.bindings['/skills/0/items/1'] = 'master_profile:python';
  f.proposal.bindings['/skills/0/items/2'] = 'evidence_vault:airflow';
  const result = build(f);
  assert.equal(result.bindings['/skills/0/items/0'].id, 'python');
  assert.equal(result.bindings['/skills/0/items/1'].id, 'airflow');
  assert.equal(result.bindings['/skills/0/items/2'], undefined);
}));

test('all output adapters preserve only authorized facts and rendering rejects post-gate mutation', () => withFixture(f => {
  const result = build(f);
  assert.match(textPayload(result.payload), /Built Python ETL pipelines\./);
  assert.equal(latexPayload(result.payload).experience[0].bullets[0], result.payload.experience[0].bullets[0]);
  for (const format of ['html', 'text', 'latex']) {
    const saved = renderBoundResume({ root: f.root, result, format, output: 'output/test-' + format });
    const artifact = readFileSync(saved.artifact, 'utf8'), audit = JSON.parse(readFileSync(saved.evidence, 'utf8'));
    assert.match(artifact, /Built Python ETL pipelines/);
    assert.equal(audit.render.artifact_sha256, digest(artifact));
    assert.equal(audit.bindings['/experience/0/bullets/0'].source, 'master_profile');
    assert.ok(!artifact.includes('Kubernetes')); assert.ok(!artifact.includes('123456'));
  }
  result.payload.experience[0].bullets[0] = 'Invented experience';
  assert.throws(() => renderBoundResume({ root: f.root, result }), /modified/);
}));

test('private CLI excludes unsupported claims and leaves source truth unchanged', () => withFixture(f => {
  f.proposal.payload.experience[0].bullets.push('Fabricated quantum experience');
  writeFileSync(join(f.root, 'output/proposal.json'), JSON.stringify(f.proposal));
  const before = readFileSync(join(f.root, 'data/career-profile.yml'), 'utf8');
  const ran = spawnSync(process.execPath, [join(CODE_ROOT, 'enhanced/tailor-resume.mjs'), '--persona', persona.id,
    '--proposal', 'output/proposal.json', '--jd', 'jds/job.md', '--format', 'text'],
  { cwd: CODE_ROOT, env: { ...process.env, CAREER_OPS_ROOT: f.root }, encoding: 'utf8', timeout: 15000 });
  assert.equal(ran.status, 0, ran.stderr);
  const saved = JSON.parse(ran.stdout);
  assert.ok(!readFileSync(saved.artifact, 'utf8').includes('quantum'));
  assert.equal(readFileSync(join(f.root, 'data/career-profile.yml'), 'utf8'), before);
}));

test('normal upstream CV import preserves employer, reviewed title, dates and bullet context through tailoring', () => withFixture(f => {
  rmSync(join(f.root, 'data/career-profile.yml'));
  writeFileSync(join(f.root, 'cv.md'), '# Synthetic Candidate\n\n## Experience\n### Normal Employer -- Remote\n\n**Data Engineer**\n2022-2024\n\n- Built Python pipelines.\n\n## Skills\n- Python\n');
  const imported = spawnSync(process.execPath, [join(CODE_ROOT, 'career-profile.mjs'), 'import', 'cv.md', '--review'],
    { cwd: CODE_ROOT, env: { ...process.env, CAREER_OPS_ROOT: f.root }, input: 'y\n'.repeat(12), encoding: 'utf8', timeout: 10000 });
  assert.equal(imported.status, 0, imported.stderr);
  const authority = loadResumeAuthority({ root: f.root, persona });
  const employer = authority.records.find(record => record.field_values?.company === 'Normal Employer');
  const role = authority.records.find(record => record.field_values?.role === 'Data Engineer');
  const dates = authority.records.find(record => record.field_values?.dates === '2022-2024');
  const bullet = authority.records.find(record => record.text === 'Built Python pipelines.');
  assert.ok(employer && role && dates && bullet, JSON.stringify(proposalAuthority(authority)));
  const proposal = { persona_id: persona.id, payload: { experience: [{ company: 'Normal Employer', role: 'Data Engineer',
    dates: '2022-2024', location: 'Remote', bullets: ['Built Python pipelines.'] }] }, bindings: {
      '/experience/0/company': employer.ref, '/experience/0/role': role.ref, '/experience/0/dates': dates.ref,
      '/experience/0/location': employer.ref, '/experience/0/bullets/0': bullet.ref,
    } };
  const result = tailorBoundResume({ proposal, authority, jdText: JD });
  assert.deepEqual(result.payload.experience, proposal.payload.experience);
  assert.equal(result.bindings['/experience/0/role'].evidence.quote, '**Data Engineer**');
  assert.equal(result.bindings['/experience/0/bullets/0'].context_ref, employer.ref);
  assert.equal(result.bindings['/experience/0/bullets/0'].parent_ref, dates.ref);
  const rendered = renderBoundResume({ root: f.root, result, output: 'output/normal-format' });
  assert.match(readFileSync(rendered.artifact, 'utf8'), /Normal Employer/);
  const reviewed = yaml.load(readFileSync(join(f.root, 'data/career-profile.yml'), 'utf8'));
  reviewed.experiences.find(entry => entry.id === role.binding.id).review_status = 'needs_review';
  writeFileSync(join(f.root, 'data/career-profile.yml'), yaml.dump(reviewed));
  proposal.payload.experience[0].role = 'Remote';
  proposal.bindings['/experience/0/role'] = employer.ref;
  assert.deepEqual(tailorBoundResume({ proposal, authority: loadResumeAuthority({ root: f.root, persona }), jdText: JD }).payload.experience, []);
}));

test('upstream OpenAI tailoring gates a provider proposal before rendering', () => withFixture(f => {
  const stub = join(f.root, 'provider-stub.mjs'), capture = join(f.root, 'request.json');
  writeFileSync(join(f.root, 'report.md'), '# Evaluation: Synthetic - Analyst\n');
  f.proposal.payload.experience[0].bullets.push('Invented metrics: 500% growth');
  f.proposal.bindings['/experience/0/bullets/1'] = 'master_profile:etl';
  writeFileSync(stub, `import { writeFileSync } from 'node:fs';\nglobalThis.fetch = async (_url, options) => {\nwriteFileSync(${JSON.stringify(capture)}, options.body);\nreturn { ok: true, json: async () => ({ choices: [{ message: { content: ${JSON.stringify(JSON.stringify(f.proposal))} } }] }) };\n};\n`);
  const ran = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, join(CODE_ROOT, 'openai-tailor.mjs'), '--persona', persona.id,
    '--jd', join(f.root, 'jds/job.md'), '--report', join(f.root, 'report.md'), '--url', 'http://localhost:1234/v1'],
  { cwd: CODE_ROOT, env: { ...process.env, CAREER_OPS_ROOT: f.root, OPENAI_API_KEY: '', NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 15000 });
  assert.equal(ran.status, 0, ran.stderr);
  const htmlPath = ran.stdout.match(/HTML saved: (.+)/)?.[1];
  assert.ok(htmlPath, ran.stdout);
  assert.ok(!readFileSync(htmlPath, 'utf8').includes('500%'));
  assert.ok(!readFileSync(capture, 'utf8').includes('123456'));
  assert.ok(!readFileSync(capture, 'utf8').includes('never transmit'));
}));
