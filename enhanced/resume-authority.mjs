/** Private, per-run resume authority. Employer text is never read here. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import * as yaml from 'js-yaml';
import { validateProfile } from '../career-profile.mjs';
import { emptyEvidenceVault, validateEvidenceVault } from './evidence-vault.mjs';
import { selectPersona } from './persona-selector.mjs';
import { extractSkillMentions } from '../skill-extract.mjs';
import { parseCvExperience } from '../cv-title-check.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const key = value => normalize(value).toLowerCase();
const PRIMARY = /^(?:cv\.md|article-digest\.md|config\/profile\.yml|modes\/_profile\.md|writing-samples\/[^\0]+)$/;

export function privatePath(root, path) {
  const base = realpathSync(root);
  const lexicalBase = resolve(root);
  const target = resolve(lexicalBase, path);
  const inside = (value, boundary = base) => {
    const rel = relative(boundary, value);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  // Check every existing ancestor as well as the file; this fences symlinked
  // source directories and not-yet-created output paths equally.
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, '..');
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, target));
  if (!inside(canonical)) throw new Error(inside(target, lexicalBase)
    ? 'Symlink escapes the candidate data root' : 'Path must stay inside the candidate data root');
  // macOS spells the same temp directory as /var and /private/var. Existing
  // aliases are authorized only when their physical target stays in this root.
  return canonical;
}

function readPrivate(root, path, optional = false) {
  const file = privatePath(root, path);
  if (optional && !existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

function anchored(root, evidence) {
  const source = evidence?.source?.replaceAll('\\', '/');
  if (!source || !PRIMARY.test(source) || !Number.isInteger(evidence.line) || evidence.line < 1) return false;
  if (source.split('/').some(part => !part || part === '.' || part === '..')) return false;
  try {
    const canonical = relative(realpathSync(root), realpathSync(privatePath(root, source))).split(sep).join('/');
    if (!PRIMARY.test(canonical)) return false;
    const line = readPrivate(root, source).replace(/\r\n?/g, '\n').split('\n')[evidence.line - 1];
    return typeof line === 'string' && normalize(line) === normalize(evidence.quote);
  } catch { return false; }
}

// Deliberately bounded, conservative conflict detection. It never infers
// prerequisites and does not claim to settle every semantic contradiction.
export function skillPolarity(text) {
  const positive = new Set(), negative = new Set();
  for (const sentence of String(text).split(/[\n.!?](?:\s|$)/)) {
    const negated = /\b(?:no|not|never|without|lack(?:s|ing)?|haven['’]t|have not|don['’]t|do not)\b/i.test(sentence);
    for (const mention of extractSkillMentions(sentence)) (negated ? negative : positive).add(mention.skill);
  }
  return { positive, negative };
}

const CONTACT_FIELDS = ['name', 'title', 'phone', 'email', 'location', 'linkedin', 'github', 'portfolio'];

function bindCvExperienceMetadata(records, cvText) {
  const lines = cvText.replace(/\r\n?/g, '\n').split('\n');
  const parsed = parseCvExperience(cvText);
  const plain = value => normalize(value).replace(/^[-*+]\s+/, '').replace(/\*\*/g, '').replace(/:\s*$/, '').trim();
  for (const heading of records.filter(record => record.heading && record.kind === 'experiences'
    && record.binding.evidence.source === 'cv.md' && /^###\s+/.test(record.binding.evidence.quote))) {
    const start = heading.binding.evidence.line - 1;
    let end = start + 1;
    while (end < lines.length && !/^#{1,3}\s+/.test(lines[end].trim())) end++;
    const within = records.filter(record => record.kind === 'experiences' && record.binding.evidence?.source === 'cv.md'
      && record.binding.evidence.line > start && record.binding.evidence.line <= end);
    const company = heading.text.split(/\s+[-–—]{1,2}\s+/)[0];
    const blockLines = lines.slice(start, end).map(plain);
    const matches = parsed.filter(entry => normalize(entry.company) === normalize(company)
      && blockLines.includes(plain(entry.title)) && blockLines.includes(plain(entry.dates)));
    if (matches.length !== 1) continue;
    const entry = matches[0];
    const role = within.find(record => plain(record.text) === plain(entry.title)
      && plain(record.binding.evidence.quote) === plain(entry.title));
    const dates = within.find(record => plain(record.text) === plain(entry.dates)
      && plain(record.binding.evidence.quote) === plain(entry.dates));
    const parts = heading.text.split(/\s+[-–—]{1,2}\s+/);
    heading.field_values = { company: parts[0], ...(parts[1] ? { location: parts.slice(1).join(' — ') } : {}) };
    for (const record of within) record.context_ref = heading.ref;
    // Identifying the source block restricts header fields even when a title
    // remains unreviewed; a location cannot then masquerade as a job title.
    if (role) role.field_values = { role: entry.title };
    if (dates) dates.field_values = { dates: entry.dates, period: entry.dates };
  }
}

export function loadResumeAuthority({ root, persona }) {
  if (!root) throw new Error('An explicit candidate data root is required');
  const profileText = readPrivate(root, 'data/career-profile.yml');
  const profile = yaml.load(profileText);
  const errors = validateProfile(profile);
  if (errors.length) throw new Error('Invalid Master Career Profile: ' + errors.join('; '));
  const vaultText = readPrivate(root, 'data/career-evidence.yml', true);
  const vault = vaultText ? yaml.load(vaultText) : emptyEvidenceVault();
  const vaultErrors = validateEvidenceVault(vault);
  if (vaultErrors.length) throw new Error('Invalid Evidence Vault: ' + vaultErrors.join('; '));
  const configText = readPrivate(root, 'config/profile.yml', true);
  const config = configText ? yaml.load(configText) : {};
  if (configText && (!config || typeof config !== 'object' || Array.isArray(config))) throw new Error('Invalid candidate config');
  const selected = selectPersona({ profile, vault, persona });
  const records = [], excluded = [];
  const parents = new Map();
  for (const section of ['experiences', 'projects', 'education']) {
    for (const parent of profile[section]) {
      if (parent.review_status !== 'verified' || !anchored(root, parent.evidence)) {
        excluded.push({ source: 'master_profile', id: parent.id, reason: 'parent-unreviewed-or-stale' });
        continue;
      }
      const ref = `master_profile:${parent.id}`;
      parents.set(parent.id, ref);
      records.push({ ref, text: parent.label, kind: section, heading: true,
        binding: { source: 'master_profile', id: parent.id, evidence: { ...parent.evidence } } });
    }
  }
  for (const fact of selected.facts) {
    const binding = fact.binding;
    if (binding.source === 'master_profile' && (!anchored(root, binding.evidence)
        || (binding.parent_id && !parents.has(binding.parent_id)))) {
      excluded.push({ source: binding.source, id: binding.id, reason: 'unreviewed-or-stale-source' });
      continue;
    }
    // Quotes in the vault are audit-only. A contextual claim carries its saved
    // context in the output; skill_only can never acquire experience scope.
    const contextualParent = fact.resume_scope === 'contextual_claim'
      ? [...parents.entries()].find(([id]) => ['experiences', 'projects', 'education'].some(section =>
        profile[section].some(parent => parent.id === id && key(parent.label) === key(fact.context))))?.[1] : undefined;
    records.push({ ref: `${binding.source}:${binding.id}`, text: fact.resume_scope === 'contextual_claim'
      ? `${fact.text} — ${fact.context}` : fact.text, kind: fact.kind, scope: fact.resume_scope,
      ...(binding.parent_id ? { parent_ref: parents.get(binding.parent_id) } : contextualParent ? { parent_ref: contextualParent } : {}),
      binding: structuredClone(binding) });
  }
  for (const field of CONTACT_FIELDS) {
    const value = config?.[field];
    if (typeof value === 'string' && value.trim()) records.push({ ref: `config:${field}`, text: value,
      kind: 'identity', field, binding: { source: 'config/profile.yml', key: field, source_sha256: digest(configText) } });
    else if (value && typeof value === 'object') {
      for (const part of ['url', 'display']) if (typeof value[part] === 'string' && value[part].trim()) {
        records.push({ ref: `config:${field}.${part}`, text: value[part], kind: 'identity', field: `${field}.${part}`,
          binding: { source: 'config/profile.yml', key: `${field}.${part}`, source_sha256: digest(configText) } });
      }
    }
  }
  const refs = new Set();
  for (const record of records) {
    if (refs.has(record.ref)) throw new Error('Ambiguous authority reference: ' + record.ref);
    refs.add(record.ref);
  }
  // Reuse upstream's canonical CV title/date parser to join separately reviewed
  // metadata in a conventional CV block. Original profile ids/parent ids remain
  // intact in provenance; context_ref records the source-proven block relation.
  const cvText = readPrivate(root, 'cv.md', true);
  if (cvText) bindCvExperienceMetadata(records, cvText);
  for (const record of records) {
    if (record.parent_ref && !record.context_ref) record.context_ref = records.find(parent => parent.ref === record.parent_ref)?.context_ref;
  }
  const primarySources = new Map();
  for (const record of records) {
    const source = record.binding.evidence?.source;
    if (source && !primarySources.has(source)) primarySources.set(source, readPrivate(root, source));
  }
  const polarity = skillPolarity(records.filter(r => r.kind !== 'identity').map(r => r.text).join('\n'));
  // A later negative statement in a current primary source can contradict an
  // older reviewed fact even if that negative statement has not been imported.
  // Source text can withhold a claim; it can never add positive resume authority.
  for (const text of primarySources.values()) for (const skill of skillPolarity(text).negative) polarity.negative.add(skill);
  const contradictions = [...polarity.negative].filter(skill => polarity.positive.has(skill)).sort();
  const safe = records.filter(record => {
    const mentions = extractSkillMentions(record.text).map(m => m.skill);
    const conflict = record.kind !== 'identity' && mentions.some(skill => contradictions.includes(skill));
    // Negative experience is not material for positive career assertions.
    const negative = record.kind !== 'identity' && skillPolarity(record.text).negative.size > 0;
    if (conflict || negative) excluded.push({ ref: record.ref, reason: conflict ? 'contradictory-skill' : 'negative-skill-evidence' });
    return !conflict && !negative;
  });
  return { schema_version: 1, persona: selected.persona, records: safe, excluded, contradictions,
    snapshot: { profile_sha256: digest(profileText), vault_sha256: digest(vaultText), config_sha256: digest(configText),
      primary_sources_sha256: Object.fromEntries([...primarySources].map(([source, text]) => [source, digest(text)])),
      authority_sha256: digest(safe) } };
}

export function proposalAuthority(authority) {
  // Model context excludes audit quotes, source paths, and unused config fields.
  return { persona_id: authority.persona.id, records: authority.records.map(({ ref, text, kind, heading, scope, parent_ref, context_ref, field_values, field }) =>
    ({ ref, text, kind, ...(heading ? { heading } : {}), ...(scope ? { scope } : {}),
      ...(parent_ref ? { parent_ref } : {}), ...(context_ref ? { context_ref } : {}),
      ...(field_values ? { field_values } : {}), ...(field ? { field } : {}) })) };
}
