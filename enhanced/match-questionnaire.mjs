/**
 * Evidence-bound match questionnaire and application-readiness policy.
 *
 * This module is deliberately pure. It proposes short questions and Evidence
 * Vault entries, but never writes candidate facts, changes a score, submits an
 * application, or treats a JD requirement as candidate evidence by itself.
 */
import { createHash } from 'node:crypto';

const MATERIAL_TYPES = new Set(['technology', 'domain', 'professional_experience', 'project_experience']);
const EXPERIENCE_LEVELS = new Set(['hands_on', 'familiarity', 'none']);
const REVIEW_STATUSES = new Set(['confirmed', 'rejected', 'needs_review']);

const clean = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const key = (value) => clean(value).toLocaleLowerCase('en-US');
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function stableQuestionKey(requirement) {
  return 'mq-' + createHash('sha256')
    .update([key(requirement.id), key(requirement.requirement), key(requirement.type)].join('\0'))
    .digest('hex').slice(0, 14);
}

function validatePercent(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a finite percentage from 0 to 100`);
  }
}

function normalizeRequirement(input, index) {
  if (!input || typeof input !== 'object') throw new Error(`requirements[${index}] must be an object`);
  const requirement = clean(input.requirement);
  const type = key(input.type);
  if (!requirement) throw new Error(`requirements[${index}].requirement is required`);
  if (!MATERIAL_TYPES.has(type)) throw new Error(`requirements[${index}].type is not questionnaire-eligible`);
  const weight = input.weight ?? 1;
  if (!Number.isFinite(weight) || weight <= 0) throw new Error(`requirements[${index}].weight must be positive`);
  return {
    id: clean(input.id) || `requirement-${index + 1}`,
    requirement,
    type,
    weight,
    mandatory: input.mandatory === true,
    material: input.material !== false,
    minimum_level: input.minimum_level === 'familiarity' ? 'familiarity' : 'hands_on',
    evidence_status: input.evidence_status === 'verified' ? 'verified' : 'missing',
    provenance: input.provenance && typeof input.provenance === 'object' ? { ...input.provenance } : null,
  };
}

function shortQuestion(requirement) {
  const subject = requirement.requirement;
  if (requirement.type === 'technology') {
    return `Have you used ${subject} hands-on in professional or project work, or are you only familiar with it?`;
  }
  if (requirement.type === 'domain') {
    return `What hands-on experience do you have in ${subject}, if any?`;
  }
  if (requirement.type === 'project_experience') {
    return `Have you delivered a project involving ${subject}? If yes, what did you personally do?`;
  }
  return `What professional experience do you have with ${subject}, if any?`;
}

function normalizeResponse(response, questionKey) {
  if (!response || typeof response !== 'object') return null;
  if (clean(response.question_key) !== questionKey) return null;
  const reviewStatus = key(response.review_status);
  const level = key(response.experience_level);
  if (!REVIEW_STATUSES.has(reviewStatus) || !EXPERIENCE_LEVELS.has(level)) return null;
  const provenance = response.provenance;
  const validProvenance = provenance && typeof provenance === 'object'
    && clean(provenance.source) && clean(provenance.quote)
    && /^\d{4}-\d{2}-\d{2}$/.test(clean(provenance.confirmed_at));
  return {
    review_status: reviewStatus,
    experience_level: level,
    context: clean(response.context),
    provenance: validProvenance ? {
      source: clean(provenance.source),
      quote: clean(provenance.quote),
      confirmed_at: clean(provenance.confirmed_at),
    } : null,
  };
}

function responseSatisfies(requirement, response) {
  if (!response || response.review_status !== 'confirmed' || !response.provenance) return false;
  if (response.experience_level === 'none') return false;
  if (requirement.minimum_level === 'hands_on') return response.experience_level === 'hands_on';
  return response.experience_level === 'hands_on' || response.experience_level === 'familiarity';
}

function vaultProposal(requirement, response) {
  if (!responseSatisfies(requirement, response) || response.experience_level !== 'hands_on') return null;
  const isTechnology = requirement.type === 'technology';
  return {
    kind: isTechnology ? 'skill' : requirement.type === 'project_experience' ? 'project' : 'experience',
    claim: requirement.requirement,
    context: response.context,
    resumeScope: response.context ? 'contextual_claim' : 'skill_only',
    source: response.provenance.source,
    quote: response.provenance.quote,
    status: 'user_confirmed',
    confirmedAt: response.provenance.confirmed_at,
    requires_explicit_vault_write_confirmation: true,
  };
}

/**
 * Build a targeted questionnaire and truthfully recalculate verified fit.
 * Detailed questions are proposed only when the supplied initial score is
 * strictly greater than 75. A score at or below 75 remains review-only.
 */
export function evaluateMatchQuestionnaire(input = {}) {
  validatePercent(input.initial_verified_fit, 'initial_verified_fit');
  const requirements = (input.requirements ?? []).map(normalizeRequirement);
  if (!requirements.length) throw new Error('requirements must contain at least one material requirement');
  const requirementKeys = requirements.map(stableQuestionKey);
  if (new Set(requirementKeys).size !== requirementKeys.length) throw new Error('duplicate questionnaire requirement');
  const totalWeight = requirements.reduce((sum, item) => sum + item.weight, 0);
  const initialSupportedWeight = requirements
    .filter((item) => item.evidence_status === 'verified')
    .reduce((sum, item) => sum + item.weight, 0);
  const calculatedInitialFit = round((initialSupportedWeight / totalWeight) * 100);
  if (Math.abs(calculatedInitialFit - input.initial_verified_fit) > 0.01) {
    throw new Error(`initial_verified_fit does not match verified requirement evidence (${calculatedInitialFit})`);
  }
  const answeredKeys = new Set((input.asked_question_keys ?? []).map(clean).filter(Boolean));
  const responses = Array.isArray(input.responses) ? input.responses : [];
  const responseKeys = responses.map((item) => clean(item?.question_key)).filter(Boolean);
  if (new Set(responseKeys).size !== responseKeys.length) throw new Error('duplicate response question_key');
  const questionnaireEligible = calculatedInitialFit > 75;

  const evaluated = requirements.map((requirement) => {
    const questionKey = stableQuestionKey(requirement);
    const response = normalizeResponse(responses.find((item) => clean(item?.question_key) === questionKey), questionKey);
    const supported = requirement.evidence_status === 'verified' || responseSatisfies(requirement, response);
    return { ...requirement, question_key: questionKey, response, supported };
  });

  const questions = questionnaireEligible ? evaluated
    .filter((item) => item.material && !item.supported && !answeredKeys.has(item.question_key))
    .map((item) => ({
      question_key: item.question_key,
      requirement_id: item.id,
      requirement: item.requirement,
      type: item.type,
      mandatory: item.mandatory,
      question: shortQuestion(item),
      accepted_levels: item.minimum_level === 'hands_on' ? ['hands_on', 'none'] : ['hands_on', 'familiarity', 'none'],
      provenance_required: true,
    })) : [];

  const supportedWeight = evaluated.filter((item) => item.supported).reduce((sum, item) => sum + item.weight, 0);
  const finalVerifiedFit = round((supportedWeight / totalWeight) * 100);
  const unresolved = evaluated.filter((item) => !item.supported).map((item) => ({
    requirement_id: item.id,
    requirement: item.requirement,
    mandatory: item.mandatory,
    reason: item.response?.experience_level === 'familiarity' && item.minimum_level === 'hands_on'
      ? 'familiarity_does_not_satisfy_hands_on_requirement'
      : item.response?.review_status === 'confirmed' && !item.response.provenance
        ? 'confirmed_answer_missing_provenance'
        : 'verified_candidate_evidence_missing',
  }));
  const mandatorySatisfied = !evaluated.some((item) => item.mandatory && !item.supported);
  const eligibilityMet = input.eligibility?.verdict === 'eligible';
  const priorityReady = finalVerifiedFit >= 99 && mandatorySatisfied && eligibilityMet;
  const proposals = evaluated.map((item) => vaultProposal(item, item.response)).filter(Boolean);

  return {
    schema_version: 1,
    threshold_policy: { questionnaire_when: 'initial_verified_fit > 75', priority_when: 'final_verified_fit >= 99' },
    before: { verified_fit: calculatedInitialFit, recalculated_from_requirement_weights: true },
    questionnaire: {
      eligible: questionnaireEligible,
      reason: questionnaireEligible ? 'strictly_above_75' : 'at_or_below_75',
      questions,
      repeat_questions_suppressed: questionnaireEligible
        ? evaluated.filter((item) => !item.supported && answeredKeys.has(item.question_key)).map((item) => item.question_key)
        : [],
    },
    after: { verified_fit: finalVerifiedFit, recalculated_from_requirement_weights: true },
    unresolved_gaps: unresolved,
    mandatory_eligibility: { requirements_satisfied: mandatorySatisfied, eligibility_verdict: input.eligibility?.verdict ?? 'unknown' },
    application_readiness: priorityReady ? 'priority_application_ready' : 'review_queue',
    evidence_vault_proposals: proposals,
    safety: {
      jd_requirements_are_candidate_evidence: false,
      unconfirmed_answers_used: false,
      familiarity_promoted_to_hands_on: false,
      automatic_vault_write: false,
      automatic_submission: false,
      ats_or_hiring_probability_claimed: false,
    },
  };
}

