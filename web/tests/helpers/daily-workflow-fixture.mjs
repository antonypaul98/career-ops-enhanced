// Fictional, self-contained user layer with the real core scripts. Only dependency
// directories are linked; reports, tracker, batch, templates and sources are copies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture } from './bound-cv-fixture.mjs';

export const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const codeRoot = path.resolve(webRoot, '..');
export const postingUrl = 'https://example.com/jobs/synthetic-engineer';
export const metadata = {
  company: 'Example Co', role: 'Synthetic Engineer', score: 2.5,
  note: 'Synthetic fixture: experience and work authorization require review',
  postingUrl,
};
const fence = '`'.repeat(3);
export const report = [
  '# Evaluation: Example Co — Synthetic Engineer', '',
  '**URL:** ' + postingUrl, '**Legitimacy:** synthetic fixture', '',
  '## Machine Summary', '', fence + 'yaml',
  'company: Example Co', 'role: Synthetic Engineer', 'score: 2.5',
  'final_decision: HOLD', 'confidence: medium', 'work_auth: not verified',
  'risk_summary: experience and work authorization unresolved',
  'score_evidence: synthetic Python pipeline experience, incomplete eligibility', fence, '',
  '## A — Fit', 'Partial.',
  '## B — Requirements', 'Python data pipelines and eligibility confirmation.',
  '## C — Evidence', 'Synthetic candidate facts only.',
  '## D — Gaps', 'Experience requirement unresolved.',
  '## E — Eligibility', 'Unconfirmed.',
  '## F — Recommendation', 'Hold pending review.',
  '## G — Posting Legitimacy', 'Fictional example.com posting, used only for local testing.',
  '## H — Application Strategy', 'No application is authorized.',
  '## Risk Summary', 'Experience and work-authorization checks pending.',
  '## Score Evidence', 'Not a full match.',
  '## Keywords extracted', 'Python; SQL; data pipelines.',
  '## Keyword Coverage', 'Partial.',
  '## Job Description (archived verbatim)',
  'Synthetic Engineer: build Python data pipelines. Eligibility needs confirmation.', '',
].join('\n');

const worker = String.raw`import fs from 'node:fs';
if (process.argv.includes('--version')) { console.log('synthetic-daily-fixture'); process.exit(0); }
const behavior = fs.readFileSync('behavior', 'utf8').trim();
fs.appendFileSync('launches.jsonl', JSON.stringify({pid: process.pid, behavior}) + '\n');
const emit = text => console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{text}}}));
console.log(JSON.stringify({type:'system',subtype:'init'}));
if (behavior === 'hold') {
  fs.writeFileSync('worker.pid', String(process.pid));
  setInterval(() => {}, 1000);
} else if (behavior.startsWith('pdf')) {
  const proposal = JSON.parse(fs.readFileSync('proposal.json', 'utf8'));
  if (behavior === 'pdf-unsupported') proposal.payload.summary = 'Invented 900% growth';
  emit('<<cv-proposal>>\n' + JSON.stringify(proposal) + '\n<</cv-proposal>>\n');
} else {
  let envelope = fs.readFileSync('evaluation.txt', 'utf8');
  if (behavior === 'invalid') envelope = envelope.replace('## G — Posting Legitimacy', '## Missing section');
  if (behavior === 'stale') fs.appendFileSync('cv.md', '\nSynthetic source changed during evaluation.\n');
  // Fragment the sealed report across structured stream events, as real CLIs do.
  for (let i = 0; i < envelope.length; i += 31) emit(envelope.slice(i, i + 31));
  if (behavior === 'provider-error') console.log(JSON.stringify({type:'result',is_error:true,error:'Synthetic provider failure'}));
  if (behavior === 'exit-failure') process.exitCode = 9;
}
`;

export function dailyWorkflowFixture() {
  const f = fixture();
  f.root = fs.realpathSync(f.root);
  try {
    // An explicit system-only allowlist avoids copying any actual user layer.
    const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: codeRoot, encoding: 'utf8' });
    if (tracked.status !== 0) throw Error('Unable to list the system fixture files.');
    for (const name of tracked.stdout.split('\0').filter(Boolean)) {
      const topLevelCode = !name.includes('/') && /\.(mjs|json)$/.test(name) && name !== 'opencode.json';
      const supportingCode = /^(lib|enhanced)\//.test(name) && /\.(mjs|json)$/.test(name);
      const shippedTemplate = /^templates\//.test(name);
      const mode = ['modes/oferta.md', 'modes/_shared.md'].includes(name);
      // The core's evaluation-only bridge imports this shared, stateless guard.
      const sharedGuard = name === 'web/src/lib/evaluation-only-boundary.mjs';
      if (!topLevelCode && !supportingCode && !shippedTemplate && !mode && !sharedGuard) continue;
      const target = path.join(f.root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(codeRoot, name), target);
    }
    fs.symlinkSync(fs.realpathSync(path.join(codeRoot, 'node_modules')), path.join(f.root, 'node_modules'));
    for (const name of ['reports', 'batch', 'documents', 'interview-prep', 'writing-samples', 'bin', 'home']) {
      fs.mkdirSync(path.join(f.root, name), { recursive: true });
    }
    fs.writeFileSync(path.join(f.root, 'modes/_profile.md'), '# Fictional test profile\nTarget: synthetic Python data roles.\n');
    fs.writeFileSync(path.join(f.root, 'modes/_custom.md'), '# Fictional test rules\nNever submit an application.\n');
    fs.writeFileSync(path.join(f.root, 'portals.yml'), 'portals: []\n');
    fs.writeFileSync(path.join(f.root, 'data/applications.md'),
      '| # | Date | Company | Role | Status | Score | PDF | Report | Notes | URL |\n' +
      '|---|---|---|---|---|---|---|---|---|---|\n');
    const cvFile = path.join(f.root, 'cv.md');
    const cvText = fs.readFileSync(cvFile, 'utf8').replace('# Synthetic Candidate', '**Synthetic Candidate**');
    const emailLine = cvText.split('\n').length + 1;
    fs.writeFileSync(cvFile, cvText + '\n**Email: synthetic@example.com**');
    f.profile.candidate.identity = [
      { id: 'http-name', field: 'name', text: 'Synthetic Candidate', review_status: 'verified', evidence: { source: 'cv.md', line: 1, quote: '**Synthetic Candidate**' } },
      { id: 'http-email', field: 'email', text: 'synthetic@example.com', review_status: 'verified', evidence: { source: 'cv.md', line: emailLine, quote: '**Email: synthetic@example.com**' } },
    ];
    f.save();
    f.proposal.bindings['/candidate/name'] = 'master_profile:http-name';
    f.proposal.bindings['/candidate/email'] = 'master_profile:http-email';
    f.proposal.payload.page_format = 'letter';
    fs.writeFileSync(path.join(f.root, 'proposal.json'), JSON.stringify(f.proposal));
    fs.writeFileSync(path.join(f.root, 'evaluation.txt'), [
      '<<evaluation-json>>', JSON.stringify(metadata), '<<evaluation-report>>',
      report.trimEnd(), '<</evaluation-report>>', '<</evaluation-json>>', '',
    ].join('\n'));
    fs.writeFileSync(path.join(f.root, 'behavior'), 'valid');
    fs.writeFileSync(path.join(f.root, 'bin/claude'), '#!' + process.execPath + '\n' + worker, { mode: 0o700 });

    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(CAREER_OPS_|ANTHROPIC_|OPENAI_|CLAUDE|CODEX_|GEMINI_|GOOGLE_API|NODE_OPTIONS$|NODE_PATH$)/.test(key)));
    const browserCache = process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Caches/ms-playwright')
      : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ms-playwright');
    Object.assign(env, {
      HOME: path.join(f.root, 'home'), CAREER_OPS_ROOT: f.root,
      BUILD_DIST: process.env.BUILD_DIST || '.next-daily-check',
      PATH: [path.join(f.root, 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || browserCache,
      NEXT_TELEMETRY_DISABLED: '1',
    });
    const smoke = spawnSync(path.join(f.root, 'bin/claude'), ['--version'], { cwd: f.root, env, encoding: 'utf8' });
    if (smoke.status !== 0) throw Error('Synthetic CLI failed: ' + smoke.stderr);
    return { ...f, env };
  } catch (error) { f.close(); throw error; }
}
