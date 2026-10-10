/**
 * C08 explainable opportunity-score foundation.
 *
 * The scorer combines the five existing Global Score dimensions with two
 * bounded, inspectable signals: ATS keyword coverage over authorized candidate
 * text, and an explicitly reviewed match to configured profile archetypes.
 * Eligibility, requirement importance and posting legitimacy remain separate
 * advisory surfaces and never enter the numeric score.
 */
import { analyzeCoverage } from '../keyword-match.mjs';

const DIMENSIONS = ['cv_match', 'north_star', 'compensation', 'culture', 'red_flags'];
const DEFAULT_WEIGHTS = Object.freeze({
  cv_match: 0.30,
  north_star: 0.25,
  compensation: 0.15,
  culture: 0.15,
  red_flags: 0.15,
});
const EVIDENCE = new Set(['supported', 'partial', 'unknown']);
const FIT_SCORE = Object.freeze({ primary: 5, secondary: 4, adjacent: 3 });

const norm = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-US');

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function assertScore(value, label) {
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new Error(`${label} score must be a finite number from 1 to 5`);
  }
}

function validateDimensions(dimensions = {}) {
  return Object.fromEntries(DIMENSIONS.map((name) => {
    const input = dimensions[name];
    if (!input || typeof input !== 'object') throw new Error(`dimensions.${name} is required`);
    assertScore(input.score, `dimensions.${name}`);
    if (!EVIDENCE.has(input.evidence)) {
      throw new Error(`dimensions.${name}.evidence must be supported, partial, or unknown`);
    }
    return [name, {
      score: round(input.score),
      evidence: input.evidence,
      explanation: String(input.explanation ?? '').trim(),
    }];
  }));
}

function normalizeWeights(weights = DEFAULT_WEIGHTS) {
  const selected = Object.fromEntries(DIMENSIONS.map((name) => {
    const value = weights[name];
    if (!Number.isFinite(value) || value < 0) throw new Error(`weights.${name} must be a non-negative number`);
    return [name, value];
  }));
  const total = Object.values(selected).reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error('weights must contain a positive total');
  return Object.fromEntries(DIMENSIONS.map((name) => [name, selected[name] / total]));
}

function keywordSignal({ jd_keywords = [], candidate_text = '', candidate_evidence = {} }) {
  const authorized = candidate_evidence.status === 'verified'
    && norm(candidate_evidence.source)
    && typeof candidate_text === 'string';
  if (!authorized) {
    return {
      status: 'unavailable',
      reason: 'Verified candidate text and its source are required; JD keywords are never candidate evidence.',
    };
  }
  const coverage = analyzeCoverage(jd_keywords, candidate_text);
  if (coverage.total === 0) {
    return { status: 'unavailable', reason: 'No reviewed JD keywords were supplied.', coverage };
  }
  return {
    status: 'scored',
    score: round(1 + (coverage.coveragePct / 100) * 4),
    source: String(candidate_evidence.source),
    coverage,
  };
}

function configuredArchetypes(profile = {}) {
  return (profile?.target_roles?.archetypes ?? [])
    .filter((entry) => entry && typeof entry === 'object' && norm(entry.name))
    .map((entry) => ({
      name: String(entry.name).trim(),
      key: norm(entry.name),
      fit: norm(entry.fit),
    }));
}

function archetypeSignal({ profile = {}, detected_archetype, archetype_review_status }) {
  if (archetype_review_status !== 'reviewed' || !norm(detected_archetype)) {
    return {
      status: 'unavailable',
      reason: 'A reviewed detected archetype is required before it can affect North Star alignment.',
    };
  }
  const archetypes = configuredArchetypes(profile);
  const match = archetypes.find((entry) => entry.key === norm(detected_archetype));
  if (!match) {
    return {
      status: 'scored',
      score: 1,
      detected: String(detected_archetype).trim(),
      configured_match: null,
      reason: 'The reviewed role archetype is outside the configured target archetypes.',
    };
  }
  return {
    status: 'scored',
    score: FIT_SCORE[match.fit] ?? 2,
    detected: String(detected_archetype).trim(),
    configured_match: { name: match.name, fit: match.fit || 'unspecified' },
  };
}

function evidenceConfidence(dimensions, gaps) {
  const values = Object.values(dimensions).map((item) => item.evidence);
  const unknown = values.filter((value) => value === 'unknown').length;
  const partial = values.filter((value) => value === 'partial').length;
  if (unknown >= 2 || gaps.length >= 2) return 'Low';
  if (unknown || partial || gaps.length) return 'Medium';
  return 'High';
}

/**
 * Compute a deterministic, explainable 1-5 opportunity score.
 *
 * Keyword coverage refines CV match and archetype fit refines North Star
 * alignment. Each refinement is a 60% existing-dimension / 40% bounded-signal
 * blend. Missing signals do not become neutral evidence; the original
 * dimension remains and the missing signal is reported as a confidence gap.
 */
export function scoreOpportunity(input = {}) {
  const dimensions = validateDimensions(input.dimensions);
  const weights = normalizeWeights(input.weights ?? DEFAULT_WEIGHTS);
  const keyword = keywordSignal(input);
  const archetype = archetypeSignal(input);
  const gaps = [];

  if (keyword.status === 'scored') {
    dimensions.cv_match = {
      ...dimensions.cv_match,
      score: round(dimensions.cv_match.score * 0.6 + keyword.score * 0.4),
      components: { evaluation_block: input.dimensions.cv_match.score, keyword_coverage: keyword.score },
    };
  } else {
    gaps.push(keyword.reason);
  }

  if (archetype.status === 'scored') {
    dimensions.north_star = {
      ...dimensions.north_star,
      score: round(dimensions.north_star.score * 0.6 + archetype.score * 0.4),
      components: { evaluation_block: input.dimensions.north_star.score, profile_archetype: archetype.score },
    };
  } else {
    gaps.push(archetype.reason);
  }

  const contributions = Object.fromEntries(DIMENSIONS.map((name) => [name, {
    weight: round(weights[name], 4),
    score: dimensions[name].score,
    weighted: round(dimensions[name].score * weights[name], 4),
  }]));
  const score = round(Object.values(contributions).reduce((sum, item) => sum + item.weighted, 0), 1);

  return {
    schema_version: 1,
    score,
    scale: '1-5',
    confidence: evidenceConfidence(dimensions, gaps),
    dimensions,
    signals: { keyword_coverage: keyword, profile_archetype: archetype },
    contributions,
    confidence_gaps: gaps,
    excluded_signals: ['eligibility', 'requirement_importance', 'posting_legitimacy', 'historical_outcomes'],
    safety: {
      jd_keywords_are_candidate_evidence: false,
      eligibility_changes_score: false,
      unsupported_candidate_claims_used: false,
      application_action: 'none',
    },
  };
}

export { DEFAULT_WEIGHTS };
