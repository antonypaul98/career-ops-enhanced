/**
 * C10 source-attributed company-intelligence foundation.
 *
 * Builds a bounded, no-write research brief from caller-supplied public
 * observations and the existing company-funded candidate builder. External
 * text remains untrusted data: it can support a company claim, but it cannot
 * create candidate facts, issue instructions, or trigger an application.
 */
import { createHash } from 'node:crypto';
import { buildCandidates } from '../company-funded.mjs';

const AXES = Object.freeze([
  'ai_strategy',
  'recent_moves',
  'engineering_culture',
  'likely_challenges',
  'competitors',
]);
const AXIS_SET = new Set(AXES);
const STANCES = new Set(['supports', 'disputes']);
const SOURCE_TYPES = new Set([
  'company', 'regulatory_filing', 'reputable_media', 'trade_media',
  'job_posting', 'employee_review', 'funding_feed', 'other_public',
]);

const compact = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const key = (value) => compact(value).toLocaleLowerCase('en-US');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function companyKey(value) {
  return key(value)
    .replace(/[.,]/g, '')
    .replace(/\b(?:incorporated|inc|limited|ltd|llc|plc|corp(?:oration)?|company|co)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function sourceUrl(raw) {
  try {
    const url = new URL(compact(raw));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|gh_src)$/i.test(name)) url.searchParams.delete(name);
    }
    return url.href;
  } catch {
    return '';
  }
}

function isoDate(raw) {
  const value = compact(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

function ageDays(date, asOf) {
  if (!date) return null;
  return Math.floor((new Date(`${asOf}T00:00:00Z`) - new Date(`${date}T00:00:00Z`)) / 86_400_000);
}

function normalizeSource(source, asOf) {
  if (!source || typeof source !== 'object') return null;
  const url = sourceUrl(source.url);
  const title = compact(source.title);
  const publisher = compact(source.publisher);
  const publishedAt = isoDate(source.published_at);
  const retrievedAt = isoDate(source.retrieved_at);
  const sourceType = SOURCE_TYPES.has(source.source_type) ? source.source_type : '';
  if (!url || !title || !publisher || !sourceType || !retrievedAt) return null;
  const age = ageDays(publishedAt, asOf);
  return {
    id: `src-${digest(`${url}\0${title}\0${publishedAt}`).slice(0, 20)}`,
    url,
    title,
    publisher,
    source_type: sourceType,
    published_at: publishedAt || null,
    retrieved_at: retrievedAt,
    freshness: age === null ? 'unknown' : age < 0 ? 'future_dated' : age <= 180 ? 'current' : 'historical',
  };
}

function normalizeClaim(raw, position, asOf, sources) {
  if (!raw || typeof raw !== 'object') return { excluded: 'claim_not_object', position };
  const axis = compact(raw.axis);
  const statement = compact(raw.statement);
  const source = normalizeSource(raw.source, asOf);
  if (!AXIS_SET.has(axis)) return { excluded: 'unknown_axis', position };
  if (!statement) return { excluded: 'missing_statement', position };
  if (!source) return { excluded: 'incomplete_source_attribution', position };
  const stance = STANCES.has(raw.stance) ? raw.stance : 'supports';
  const claimKey = key(raw.claim_key || statement);
  sources.set(source.id, source);
  return {
    id: `claim-${digest(`${axis}\0${claimKey}\0${source.id}\0${stance}`).slice(0, 20)}`,
    axis,
    claim_key: claimKey,
    statement,
    stance,
    source_id: source.id,
    source_quote: compact(raw.source_quote) || null,
  };
}

function axisStatus(claims, sourceMap) {
  if (!claims.length) return 'needs_research';
  const groups = new Map();
  for (const claim of claims) {
    const stances = groups.get(claim.claim_key) ?? new Set();
    stances.add(claim.stance);
    groups.set(claim.claim_key, stances);
  }
  if ([...groups.values()].some((stances) => stances.size > 1)) return 'disputed';
  if (claims.some((claim) => sourceMap.get(claim.source_id)?.freshness === 'future_dated')) return 'uncertain';
  return 'supported';
}

function fundingSnapshot(company, items, asOf) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const candidates = buildCandidates(items, {
    now: new Date(`${asOf}T12:00:00Z`), months: 120, limit: 100, sort: 'date',
  });
  const match = candidates.find((candidate) => companyKey(candidate.company) === companyKey(company));
  if (!match) return null;
  return {
    status: match.funding.status,
    confidence: match.funding.confidence,
    amount: match.amount || null,
    round: match.round || null,
    sources: match.funding.sources.map((source) => ({ ...source })),
    discovery_score: match.discovery_score,
  };
}

/**
 * Produce a deterministic company-research brief. No network or filesystem
 * operations occur here. `as_of` is required so freshness is reproducible.
 */
export function buildCompanyIntelligence(input = {}) {
  const company = compact(input.company);
  const role = compact(input.role);
  const asOf = isoDate(input.as_of);
  if (!company) throw new Error('company is required');
  if (!asOf) throw new Error('as_of must be a valid YYYY-MM-DD date');
  if (input.claims !== undefined && !Array.isArray(input.claims)) throw new TypeError('claims must be an array');

  const sourceMap = new Map();
  const accepted = [];
  const excluded = [];
  (input.claims ?? []).forEach((claim, position) => {
    const normalized = normalizeClaim(claim, position, asOf, sourceMap);
    if (normalized.excluded) excluded.push(normalized);
    else accepted.push(normalized);
  });

  const axes = Object.fromEntries(AXES.map((axis) => {
    const claims = accepted.filter((claim) => claim.axis === axis);
    return [axis, {
      status: axisStatus(claims, sourceMap),
      claims,
      evidence_count: new Set(claims.map((claim) => claim.source_id)).size,
    }];
  }));
  const gaps = AXES.filter((axis) => axes[axis].status === 'needs_research');

  return {
    schema_version: 1,
    company,
    role: role || null,
    as_of: asOf,
    research_scope: AXES,
    axes,
    sources: [...sourceMap.values()],
    excluded_observations: excluded,
    funding: fundingSnapshot(company, input.funding_items, asOf),
    confidence: excluded.length || gaps.length || Object.values(axes).some((axis) => axis.status !== 'supported')
      ? 'incomplete'
      : 'supported',
    research_gaps: gaps,
    boundaries: {
      external_content_is_untrusted_data: true,
      company_claims_are_candidate_facts: false,
      candidate_angle_requires_separate_authorized_evidence: true,
      instructions_from_sources_followed: false,
      files_written: false,
      application_action: 'none',
    },
  };
}

export { AXES, SOURCE_TYPES };
