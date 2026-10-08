#!/usr/bin/env node
/** C05 private output adapter. Reuses upstream HTML/LaTeX renderers. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { loadResumeAuthority, privatePath, proposalAuthority, digest } from './resume-authority.mjs';
import { tailorBoundResume } from './evidence-tailor.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function textPayload(payload) {
  const lines = [];
  if (payload.candidate?.name) lines.push(`# ${payload.candidate.name}`);
  if (payload.candidate?.title) lines.push(payload.candidate.title);
  const contacts = ['location', 'email', 'phone'].map(field => payload.candidate?.[field]).filter(Boolean);
  if (contacts.length) lines.push(contacts.join(' | '));
  if (payload.summary) lines.push('## Professional Summary', payload.summary);
  if (payload.competencies?.length) lines.push('## Core Competencies', payload.competencies.join(', '));
  for (const [section, heading] of [['experience', 'Work Experience'], ['projects', 'Projects'], ['education', 'Education'],
    ['certifications', 'Certifications'], ['awards', 'Awards & Honors']]) {
    if (!payload[section]?.length) continue;
    lines.push(`## ${heading}`);
    for (const entry of payload[section]) {
      lines.push(`### ${[entry.company, entry.role, entry.name, entry.title, entry.org].filter(Boolean).join(' — ')}`);
      for (const field of ['location', 'dates', 'period', 'year', 'context', 'tech', 'description', 'badge', 'url']) {
        if (entry[field]) lines.push(entry[field]);
      }
      for (const bullet of entry.bullets ?? []) lines.push(`- ${bullet}`);
    }
  }
  if (payload.skills?.length) {
    lines.push('## Skills');
    for (const skill of payload.skills) lines.push(`${skill.category ? skill.category + ': ' : ''}${Array.isArray(skill.items) ? skill.items.join(', ') : skill.items}`);
  }
  if (payload.interests?.length) lines.push('## Interests', payload.interests.join(', '));
  return lines.join('\n\n') + '\n';
}

export function latexPayload(payload) {
  // The upstream HTML and LaTeX education schemas differ. This adapter only
  // moves already bound values; it does not author any new content.
  const candidate = payload.candidate ?? {};
  const result = { name: candidate.name ?? '', contact_line: [candidate.location, candidate.phone].filter(Boolean).join(' | '),
    ...(candidate.email ? { email: { url: candidate.email, display: candidate.email } } : {}),
    ...(candidate.linkedin ? { linkedin: typeof candidate.linkedin === 'string'
      ? { url: candidate.linkedin, display: candidate.linkedin } : candidate.linkedin } : {}),
    ...(candidate.github ? { github: typeof candidate.github === 'string'
      ? { url: candidate.github, display: candidate.github } : candidate.github } : {}),
    experience: (payload.experience ?? []).map(({ company, role, location, dates, period, context, bullets }) =>
      ({ company, role, ...(location ? { location } : {}), ...(dates || period ? { dates: dates || period } : {}),
        bullets: [...(context ? [context] : []), ...(bullets ?? [])] })),
    projects: (payload.projects ?? []).map(({ name, tech, description, bullets, url, badge }) =>
      ({ name, ...(tech ? { context: tech } : {}), ...(url ? { url } : {}),
        bullets: [...(description ? [description] : []), ...(badge ? [badge] : []), ...(bullets ?? [])] })),
    education: (payload.education ?? []).map(({ title, org, location, year, description }) =>
      ({ institution: org ?? title, degree: title, ...(location ? { location } : {}), ...(year ? { dates: year } : {}),
        ...(description ? { coursework: [description] } : {}) })),
    awards: payload.awards ?? [], skills: payload.skills ?? [] };
  return result;
}

export function renderBoundResume({ root, result, format = 'html', output = `output/tailored-${result.persona_id}` }) {
  if (!['html', 'text', 'latex'].includes(format)) throw new Error('Format must be html, text, or latex');
  if (digest(result.payload) !== result.snapshot.payload_sha256) throw new Error('Bound payload was modified before rendering');
  const extension = { html: '.html', text: '.md', latex: '.tex' }[format];
  const stem = privatePath(root, output);
  mkdirSync(dirname(stem), { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(dirname(stem), '.tailoring-'));
  try {
    let renderPayload = result.payload;
    if (format === 'latex') renderPayload = latexPayload(result.payload);
    const input = join(staging, 'cv.json'), artifact = join(staging, 'cv' + extension);
    writeFileSync(input, JSON.stringify(renderPayload, null, 2), { mode: 0o600 });
    if (format === 'text') writeFileSync(artifact, textPayload(renderPayload), { mode: 0o600 });
    else {
      const builder = join(CODE_ROOT, format === 'html' ? 'build-cv-html.mjs' : 'build-cv-latex.mjs');
      const rendered = spawnSync(process.execPath, [builder, input, artifact], {
        cwd: CODE_ROOT, env: { ...process.env, CAREER_OPS_ROOT: root }, encoding: 'utf8', timeout: 30000,
      });
      if (rendered.status !== 0) throw new Error('Upstream CV renderer failed: ' + (rendered.stderr || rendered.error?.message || rendered.stdout));
    }
    const artifactText = readFileSync(artifact, 'utf8');
    const audit = { ...result, render: { format, payload_sha256: digest(renderPayload), artifact_sha256: digest(artifactText),
      omitted_sections: format === 'latex' ? ['summary', 'certifications', 'competencies', 'interests'].filter(section =>
        result.payload[section]?.length) : [] } };
    const auditPath = stem + '.evidence.json';
    privatePath(root, auditPath);
    privatePath(root, stem + extension);
    writeFileSync(join(staging, 'audit.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
    renameSync(join(staging, 'audit.json'), auditPath);
    renameSync(artifact, stem + extension);
    return { artifact: stem + extension, evidence: auditPath, excluded: result.excluded.length, gaps: result.gaps };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

async function main() {
  const { values } = parseArgs({ options: {
    proposal: { type: 'string' }, jd: { type: 'string' }, persona: { type: 'string', default: 'general' },
    format: { type: 'string', default: 'html' }, output: { type: 'string' }, prepare: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node enhanced/tailor-resume.mjs --persona ID --prepare\n'
      + 'node enhanced/tailor-resume.mjs --persona ID --proposal output/proposal.json --jd jds/job.md [--format html|text|latex] [--output output/stem]\n'
      + 'Requires reviewed data/career-profile.yml. All output remains in the private candidate data root.');
    return;
  }
  const root = getCareerOpsRoot();
  const authority = loadResumeAuthority({ root, persona: { id: values.persona } });
  if (values.prepare) { console.log(JSON.stringify(proposalAuthority(authority), null, 2)); return; }
  if (!values.proposal || !values.jd) throw new Error('--proposal and --jd are required');
  const proposal = JSON.parse(readFileSync(privatePath(root, values.proposal), 'utf8'));
  const jdText = readFileSync(privatePath(root, values.jd), 'utf8');
  const result = tailorBoundResume({ proposal, authority, jdText });
  if (!Object.keys(result.bindings).length) throw new Error('No authorized candidate facts survived tailoring');
  console.log(JSON.stringify(renderBoundResume({ root, result, format: values.format, output: values.output }), null, 2));
}

if (isMainModule(import.meta.url)) main().catch(error => { console.error('tailor-resume: ' + error.message); process.exitCode = 1; });
