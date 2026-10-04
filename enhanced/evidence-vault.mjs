#!/usr/bin/env node

/**
 * Career Evidence Vault
 *
 * Extends career-ops beyond cv.md without permitting fabrication.
 * Stores user-confirmed or source-verified facts that can be used for
 * tailoring even when they are absent from the master CV.
 *
 * User data lives at data/career-evidence.yml and is ignored by Git.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import * as yaml from 'js-yaml';
import { canonicalize } from '../skill-extract.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { withPipelineLock } from '../pipeline-lock.mjs';

export const VAULT_SCHEMA_VERSION = 1;
export const ENTRY_KINDS = new Set(['skill', 'experience', 'project', 'achievement', 'certification', 'education']);
export const ENTRY_STATUSES = new Set(['user_confirmed', 'source_verified', 'needs_review', 'rejected']);
export const RESUME_SCOPES = new Set(['skill_only', 'contextual_claim']);
export const PROVENANCE_TYPES = new Set(['user_confirmed', 'source_verified']);

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizedKey(value) {
  return normalize(value).toLocaleLowerCase('en-US');
}

function stableId(kind, claim, context = '') {
  const key = [kind, normalizedKey(claim), normalizedKey(context)].join('\0');
  return 'ev-' + createHash('sha256').update(key).digest('hex').slice(0, 14);
}

export function getEvidenceVaultPath(root = getCareerOpsRoot()) {
  return join(root, 'data', 'career-evidence.yml');
}

export function emptyEvidenceVault() {
  return { schema_version: VAULT_SCHEMA_VERSION, entries: [] };
}

export function validateEvidenceVault(vault) {
  const errors = [];
  if (!vault || typeof vault !== 'object') return ['vault must be a mapping'];
  if (vault.schema_version !== VAULT_SCHEMA_VERSION) errors.push('schema_version must be ' + VAULT_SCHEMA_VERSION);
  if (!Array.isArray(vault.entries)) {
    errors.push('entries must be a list');
    return errors;
  }

  const ids = new Set();
  vault.entries.forEach((entry, index) => {
    const path = 'entries[' + index + ']';
    if (!entry || typeof entry !== 'object') {
      errors.push(path + ' must be a mapping');
      return;
    }

    if (typeof entry.id !== 'string' || !entry.id.trim()) errors.push(path + '.id is required');
    else if (ids.has(entry.id)) errors.push('duplicate id: ' + entry.id);
    else ids.add(entry.id);

    if (!ENTRY_KINDS.has(entry.kind)) errors.push(path + '.kind must be one of: ' + [...ENTRY_KINDS].join(', '));
    if (typeof entry.claim !== 'string' || !entry.claim.trim()) errors.push(path + '.claim is required');
    if (!ENTRY_STATUSES.has(entry.status)) errors.push(path + '.status must be one of: ' + [...ENTRY_STATUSES].join(', '));
    if (!RESUME_SCOPES.has(entry.resume_scope)) errors.push(path + '.resume_scope must be one of: ' + [...RESUME_SCOPES].join(', '));

    if (entry.resume_scope === 'contextual_claim' && (typeof entry.context !== 'string' || !entry.context.trim())) {
      errors.push(path + '.context is required for contextual_claim');
    }

    if (entry.aliases != null && (!Array.isArray(entry.aliases) || entry.aliases.some((item) => typeof item !== 'string'))) {
      errors.push(path + '.aliases must be a list of strings');
    }

    const provenance = entry.provenance;
    if (!provenance || typeof provenance !== 'object') {
      errors.push(path + '.provenance is required');
    } else {
      if (!PROVENANCE_TYPES.has(provenance.type)) errors.push(path + '.provenance.type must be user_confirmed or source_verified');
      if (typeof provenance.source !== 'string' || !provenance.source.trim()) errors.push(path + '.provenance.source is required');
      if (typeof provenance.quote !== 'string' || !provenance.quote.trim()) errors.push(path + '.provenance.quote is required');
      if (provenance.confirmed_at != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(provenance.confirmed_at))) {
        errors.push(path + '.provenance.confirmed_at must be YYYY-MM-DD');
      }
    }
  });

  return errors;
}

export function loadEvidenceVault({ root = getCareerOpsRoot(), required = false } = {}) {
  const path = getEvidenceVaultPath(root);
  if (!existsSync(path)) {
    if (required) throw new Error('Career Evidence Vault not found: ' + path);
    return emptyEvidenceVault();
  }
  const parsed = yaml.load(readFileSync(path, 'utf8'));
  const errors = validateEvidenceVault(parsed);
  if (errors.length) throw new Error('Invalid Career Evidence Vault:\n- ' + errors.join('\n- '));
  return parsed;
}

export function usableEvidenceEntries(vault) {
  return (vault?.entries ?? []).filter((entry) =>
    entry.status === 'user_confirmed' || entry.status === 'source_verified'
  );
}

function boundaryMention(needle, haystack) {
  const value = normalize(needle);
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp('(?:^|[^\\p{L}\\p{N}+#./-])' + escaped + '(?=$|[^\\p{L}\\p{N}+#./-])', 'iu');
  return re.test(normalize(haystack));
}

function canonicalSkill(value) {
  const raw = normalize(value);
  const canonical = canonicalize(raw);
  return normalizedKey(canonical || raw);
}

export function evidenceEntrySupportsSkill(entry, skill) {
  if (!entry || !skill) return false;
  const target = canonicalSkill(skill);
  const labels = [entry.claim, ...(entry.aliases ?? [])].filter(Boolean);
  if (labels.some((value) => canonicalSkill(value) === target)) return true;

  if (entry.resume_scope === 'contextual_claim') {
    const text = [entry.claim, entry.context, entry.provenance?.quote].filter(Boolean).join(' ');
    if (boundaryMention(skill, text)) return true;
  }
  return false;
}

export function matchEvidenceForSkill(skill, vault) {
  return usableEvidenceEntries(vault).filter((entry) => evidenceEntrySupportsSkill(entry, skill));
}

export function addEvidenceEntry(vault, {
  kind,
  claim,
  context = '',
  resumeScope = 'skill_only',
  source = 'conversation',
  quote,
  status = 'user_confirmed',
  aliases = [],
  confirmedAt = new Date().toISOString().slice(0, 10),
}) {
  const entry = {
    id: stableId(kind, claim, context),
    kind,
    claim: normalize(claim),
    ...(normalize(context) ? { context: normalize(context) } : {}),
    resume_scope: resumeScope,
    status,
    aliases: [...new Set(aliases.map(normalize).filter(Boolean))],
    provenance: {
      type: status === 'source_verified' ? 'source_verified' : 'user_confirmed',
      source: normalize(source) || 'conversation',
      quote: normalize(quote || context || claim),
      confirmed_at: confirmedAt,
    },
  };

  const candidate = {
    schema_version: VAULT_SCHEMA_VERSION,
    entries: [...(vault?.entries ?? []).filter((item) => item.id !== entry.id), entry],
  };

  const errors = validateEvidenceVault(candidate);
  if (errors.length) throw new Error('Evidence entry rejected:\n- ' + errors.join('\n- '));
  return { vault: candidate, entry };
}

export function evidenceVaultSourceText(vault) {
  return usableEvidenceEntries(vault).map((entry) => {
    const lines = [
      'kind: ' + entry.kind,
      'claim: ' + entry.claim,
      entry.aliases?.length ? 'aliases: ' + entry.aliases.join(', ') : '',
      entry.resume_scope === 'contextual_claim' ? 'context: ' + entry.context : '',
      'evidence: ' + entry.provenance.quote,
    ];
    return lines.filter(Boolean).join('\n');
  }).join('\n\n');
}

async function saveVault(path, vault) {
  await withPipelineLock(path, () => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + '.tmp';
    try {
      writeFileSync(tmp, yaml.dump(vault, { noRefs: true, lineWidth: 120 }), 'utf8');
      renameSync(tmp, path);
    } catch (error) {
      try { rmSync(tmp, { force: true }); } catch { /* preserve original error */ }
      throw error;
    }
  });
}

const HELP = `Career Evidence Vault

Usage:
  node enhanced/evidence-vault.mjs validate
  node enhanced/evidence-vault.mjs list
  node enhanced/evidence-vault.mjs add --kind skill --claim "Apache Airflow" [options]

add options:
  --kind VALUE          skill|experience|project|achievement|certification|education
  --claim TEXT          concise fact or technology name
  --context TEXT        supporting experience context
  --scope VALUE         skill_only|contextual_claim (default: skill_only)
  --source TEXT         provenance label (default: conversation)
  --quote TEXT          exact user/source statement supporting the fact
  --alias TEXT          alternate name; repeatable
  --source-verified     mark as source_verified instead of user_confirmed
  --confirm             required to write; without it, prints a preview only

Safety:
  skill_only permits the named technology/skill to be used as a skill.
  contextual_claim permits wording supported by the recorded context.
  Neither mode authorizes invented metrics, employers, ownership, or outcomes.
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  const root = getCareerOpsRoot();
  const path = getEvidenceVaultPath(root);

  if (command === 'validate') {
    const vault = loadEvidenceVault({ root, required: true });
    const errors = validateEvidenceVault(vault);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Valid Career Evidence Vault: ' + path + ' (' + vault.entries.length + ' entries)');
    return;
  }

  if (command === 'list') {
    const vault = loadEvidenceVault({ root });
    if (!vault.entries.length) {
      console.log('Career Evidence Vault is empty.');
      return;
    }
    for (const entry of vault.entries) {
      console.log('- [' + entry.status + '] ' + entry.kind + ' | ' + entry.resume_scope + ' | ' + entry.claim);
      if (entry.context) console.log('  context: ' + entry.context);
      console.log('  source: ' + entry.provenance.source + ' - ' + entry.provenance.quote);
    }
    return;
  }

  if (command !== 'add') throw new Error('Unknown command: ' + command + '\n\n' + HELP);

  const aliases = [];
  const filtered = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--alias') {
      if (!rest[i + 1]) throw new Error('--alias requires a value');
      aliases.push(rest[++i]);
    } else {
      filtered.push(rest[i]);
    }
  }

  const { values } = parseArgs({
    args: filtered,
    options: {
      kind: { type: 'string' },
      claim: { type: 'string' },
      context: { type: 'string' },
      scope: { type: 'string', default: 'skill_only' },
      source: { type: 'string', default: 'conversation' },
      quote: { type: 'string' },
      'source-verified': { type: 'boolean', default: false },
      confirm: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (!values.kind || !values.claim) throw new Error('--kind and --claim are required');

  const status = values['source-verified'] ? 'source_verified' : 'user_confirmed';
  const current = loadEvidenceVault({ root });
  const { vault, entry } = addEvidenceEntry(current, {
    kind: values.kind,
    claim: values.claim,
    context: values.context ?? '',
    resumeScope: values.scope,
    source: values.source,
    quote: values.quote,
    status,
    aliases,
  });

  console.log(yaml.dump(entry, { noRefs: true, lineWidth: 120 }).trimEnd());
  if (!values.confirm) {
    console.log('\nPreview only. Re-run with --confirm to save this evidence.');
    return;
  }

  await saveVault(path, vault);
  console.log('Saved evidence to ' + path);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error('evidence-vault: ' + error.message);
    process.exitCode = 1;
  });
}
