import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as yaml from 'js-yaml';
const JD='## Job Description\nPython data pipelines';
const persona={id:'general'};
export function fixture() {
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
