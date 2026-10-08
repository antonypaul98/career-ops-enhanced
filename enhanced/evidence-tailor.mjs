/** C05: deterministic, conservative tailoring over approved source bindings. */
import { validatePayload, KNOWN_ROOT_KEYS, ENTRY_FIELD_SPECS } from '../lib/cv-payload-schema.mjs';
import { extractStructuredRequirements } from './jd-requirements.mjs';
import { extractSkillMentions } from '../skill-extract.mjs';
import { digest, normalize } from './resume-authority.mjs';

const PRESENTATION = { '/lang': /^(?:en|[a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/, '/page_format': /^(?:letter|a4)$/,
  '/candidate/photo_style': /^(?:rounded|circle|square)$/ };
const CATEGORY = new Set(['skills', 'languages', 'tools', 'frameworks', 'technologies', 'competencies', 'core competencies', 'certifications']);
const SECTION_TITLES = new Set(['Professional Summary', 'Summary', 'Core Competencies', 'Work Experience', 'Experience',
  'Professional Experience', 'Projects', 'Education', 'Certifications', 'Awards & Honors', 'Interests', 'Skills']);
const refOf = binding => typeof binding === 'string' ? binding : binding?.ref;

function allowed(record, path) {
  if (record.kind === 'identity') return path === `/candidate/${record.field.replaceAll('.', '/')}`;
  const section = path.split('/')[1];
  if (record.scope === 'skill_only') return section === 'skills' || section === 'competencies';
  if (record.heading) return ['experience', 'projects', 'education'].includes(section)
    && { experiences: 'experience', projects: 'projects', education: 'education' }[record.kind] === section
    && !/\/(?:bullets|description|coursework)(?:\/|$)/.test(path);
  if (record.scope === 'contextual_claim') return ['summary', 'certifications', 'awards'].includes(section)
    || (['experience', 'projects', 'education'].includes(section) && !!record.parent_ref
      && /\/(?:bullets|description|context)(?:\/|$)/.test(path));
  if (section === 'skills' || section === 'competencies') return record.kind === 'skills';
  if (section === 'summary') return record.kind === 'summary';
  if (section === 'experience') return record.kind === 'experiences' && /\/bullets\/\d+$/.test(path);
  if (section === 'projects') return record.kind === 'projects' && /\/(?:bullets\/\d+|description|tech)$/.test(path);
  if (section === 'education') return record.kind === 'education' && /\/description$/.test(path);
  return section === record.kind;
}

function supportedValue(record, value, path) {
  if (normalize(record.text) === normalize(value)) return true;
  // Only a reviewed entity heading can be split into fields. Career assertions
  // are otherwise verbatim: paraphrases need a newly approved profile/vault fact.
  if (!record.heading || !/\/(?:company|role|location|dates|period|name|title|org|year)$/.test(path)) return false;
  return record.text.split(/\s+[—–|]\s+|\s+·\s+/).some(part => normalize(part) === normalize(value));
}

export function tailorBoundResume({ proposal, authority, jdText = '' }) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new Error('A structured tailoring proposal is required');
  if (proposal.persona_id !== authority.persona.id) throw new Error('Proposal persona does not match the selected persona');
  const original = proposal.payload;
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('proposal.payload must be a CV payload object');
  const records = new Map(authority.records.map(record => [record.ref, record]));
  const bindings = {}, excluded = [...authority.excluded];
  const omit = (path, reason) => { excluded.push({ path, reason }); return undefined; };
  const visit = (value, oldPath, newPath) => {
    if (Array.isArray(value)) {
      const result = [];
      for (let i = 0; i < value.length; i++) {
        const child = visit(value[i], `${oldPath}/${i}`, `${newPath}/${result.length}`);
        if (child !== undefined) result.push(child);
      }
      return result;
    }
    if (value && typeof value === 'object') {
      const result = {};
      const section = oldPath.split('/')[1];
      for (const [field, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(field)) return omit(oldPath, 'unsafe-key');
        if (/^\/(experience|projects|education|certifications|awards|skills)\/\d+$/.test(oldPath)
          && !ENTRY_FIELD_SPECS.html[section]?.known.includes(field)) { omit(`${oldPath}/${field}`, 'unknown-field'); continue; }
        const item = visit(child, `${oldPath}/${field}`, `${newPath}/${field}`);
        if (item !== undefined) result[field] = item;
      }
      if (/^\/(experience|projects|education|certifications|awards|skills)\/\d+$/.test(oldPath)) {
        const required = ENTRY_FIELD_SPECS.html[section].required;
        if (required.some(field => !result[field] || (Array.isArray(result[field]) && !result[field].length))) {
          for (const path of Object.keys(bindings)) if (path.startsWith(newPath + '/')) delete bindings[path];
          return omit(oldPath, 'unsupported-required-field');
        }
      }
      return result;
    }
    if (value === '' || value == null) return undefined;
    if (typeof value !== 'string') return omit(oldPath, 'non-text-claim');
    if (PRESENTATION[oldPath]?.test(value)) return value;
    if (/^\/sections\/[a-z]+$/.test(oldPath) && SECTION_TITLES.has(value)) return value;
    if (/^\/skills\/\d+\/category$/.test(oldPath) && CATEGORY.has(normalize(value).toLowerCase())) return value;
    const record = records.get(refOf(proposal.bindings?.[oldPath]));
    if (!record) return omit(oldPath, 'missing-or-unauthorized-evidence');
    if (!allowed(record, oldPath)) return omit(oldPath, 'evidence-scope-mismatch');
    if (!supportedValue(record, value, oldPath)) return omit(oldPath, 'unsupported-wording');
    bindings[newPath] = { ref: record.ref, ...structuredClone(record.binding),
      text_sha256: digest(value), ...(record.parent_ref ? { parent_ref: record.parent_ref } : {}) };
    return value;
  };
  const input = {};
  for (const [field, value] of Object.entries(original)) {
    if (!KNOWN_ROOT_KEYS.html.includes(field)) { omit(`/${field}`, 'unknown-field'); continue; }
    if (['__proto__', 'prototype', 'constructor'].includes(field)) throw new Error('Unsafe payload key');
    input[field] = value;
  }
  const payload = visit(input, '', '');
  // A profile fact remains tied to its employer/project/education entity.
  // Reordering never gives a fact permission to move to a different employer.
  for (const section of ['experience', 'projects', 'education']) {
    const kept = [], remapped = {};
    for (let i = 0; i < (payload[section] ?? []).length; i++) {
      const prefix = `/${section}/${i}/`;
      const entryBindings = Object.entries(bindings).filter(([path]) => path.startsWith(prefix));
      const headingRefs = new Set(entryBindings.filter(([, b]) => records.get(b.ref)?.heading).map(([, b]) => b.ref));
      const parents = new Set(entryBindings.map(([, b]) => b.parent_ref).filter(Boolean));
      if (headingRefs.size > 1 || parents.size > 1 || [...parents].some(ref => !headingRefs.has(ref))) {
        excluded.push({ path: `/${section}/${i}`, reason: 'experience-context-mismatch' });
      } else {
        const index = kept.length;
        kept.push(payload[section][i]);
        for (const [path, b] of entryBindings) remapped[path.replace(prefix, `/${section}/${index}/`)] = b;
      }
      for (const [path] of entryBindings) delete bindings[path];
    }
    if (section in payload) payload[section] = kept;
    Object.assign(bindings, remapped);
  }
  const shape = validatePayload(payload, 'html');
  if (shape.errors.length) throw new Error('Unusable tailored payload: ' + shape.errors.join('; '));
  const requirements = extractStructuredRequirements(jdText);
  const supportedSkills = new Set(Object.keys(bindings).flatMap(path => {
    const value = path.slice(1).split('/').reduce((item, part) => item?.[part], payload);
    return extractSkillMentions(String(value ?? '')).map(m => m.skill);
  }));
  const gaps = requirements.requirements.filter(req => req.requirement_type !== 'technology'
      || req.polarity !== 'positive' || !supportedSkills.has(req.canonical_requirement))
    .map(req => ({ requirement: req.canonical_requirement, requirement_id: req.id, kind: req.kind,
      candidate_evidence: false, reason: authority.contradictions.includes(req.canonical_requirement)
        ? 'contradictory-evidence' : req.requirement_type !== 'technology' || req.polarity !== 'positive' ? 'needs-review' : 'unsupported',
      source_span: req.source_span }));
  return { schema_version: 1, persona_id: authority.persona.id, payload, bindings, excluded, gaps,
    extraction_status: requirements.extraction_status, contradictions: [...authority.contradictions],
    snapshot: { ...authority.snapshot, payload_sha256: digest(payload), jd_sha256: digest(jdText) },
    safety: { candidate_facts_from_jd: 0, inferred_prerequisites: 0, paraphrase_policy: 'approved wording only' } };
}
