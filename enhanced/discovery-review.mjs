/**
 * C09 bounded discovery review.
 *
 * Classifies provider discoveries without writing the pipeline, tracker, or
 * scan history. The review deliberately reuses the scanner's canonical URL,
 * company/role, location and requisition identities plus the shared liveness
 * classifier. Only an explicitly active posting can be marked new or duplicate;
 * uncertain observations remain visible for review and only authoritative
 * expiry evidence can mark a posting stale.
 */
import { classifyLiveness } from '../liveness-core.mjs';
import { normalizeUrl } from '../url-key.mjs';
import {
  ANY_REQUISITION,
  buildCompanyCanonicalizer,
  companyRoleDedupKey,
  matchesSeenCompanyRole,
  normalizeUrlForDedup,
  requisitionIdsForDedup,
} from '../scan.mjs';

const DECISIONS = Object.freeze({
  NEW: 'new',
  DUPLICATE: 'duplicate',
  STALE: 'stale',
  NEEDS_REVIEW: 'needs_review',
  INVALID: 'invalid',
});

function postingText(posting = {}) {
  return [posting.title, posting.description, posting.requisition_id]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n');
}

function normalizedIdentity(posting, canonicalizeCompany, includeLocation) {
  const urlKey = normalizeUrl(posting.url);
  const scanUrlKey = normalizeUrlForDedup(posting.url);
  const baseKey = companyRoleDedupKey(posting.company, posting.title, canonicalizeCompany);
  const roleKey = companyRoleDedupKey(
    posting.company,
    posting.title,
    canonicalizeCompany,
    includeLocation ? posting.location : undefined,
  );
  return {
    url_key: urlKey,
    scan_url_key: typeof scanUrlKey === 'string' ? scanUrlKey : '',
    company_role_key: roleKey,
    company_role_base_key: baseKey,
    requisition_ids: requisitionIdsForDedup({ url: posting.url, text: postingText(posting) }),
  };
}

function addForms(map, key, forms) {
  let values = map.get(key);
  if (!values) map.set(key, (values = new Set()));
  if (forms.length === 0) values.add(ANY_REQUISITION);
  for (const form of forms) values.add(form);
}

function createIndex(canonicalizeCompany, includeLocation) {
  return {
    canonicalizeCompany,
    includeLocation,
    urls: new Map(),
    scanUrls: new Map(),
    roles: new Set(),
    requisitions: new Map(),
    locatedRequisitions: new Map(),
  };
}

function seedPosting(index, posting, source) {
  const identity = normalizedIdentity(posting, index.canonicalizeCompany, index.includeLocation);
  if (identity.url_key) index.urls.set(identity.url_key, source);
  if (identity.scan_url_key) index.scanUrls.set(identity.scan_url_key, source);
  if (!identity.company_role_base_key.endsWith('::')) {
    index.roles.add(identity.company_role_key);
    addForms(index.requisitions, identity.company_role_key, identity.requisition_ids);
    if (identity.company_role_key !== identity.company_role_base_key) {
      addForms(index.locatedRequisitions, identity.company_role_base_key, identity.requisition_ids);
    }
  }
  return identity;
}

function livenessVerdict(posting) {
  if (posting?.liveness && typeof posting.liveness === 'object') {
    const { result, code, reason } = posting.liveness;
    if (['active', 'expired', 'uncertain'].includes(result) && typeof code === 'string') {
      return { result, code, reason: String(reason ?? '') };
    }
  }
  if (posting?.liveness_observation && typeof posting.liveness_observation === 'object') {
    return classifyLiveness({ requestedUrl: posting.url, ...posting.liveness_observation });
  }
  return {
    result: 'uncertain',
    code: 'missing_liveness',
    reason: 'No current liveness observation was supplied.',
  };
}

function invalidReason(posting, identity) {
  if (!posting || typeof posting !== 'object') return 'Posting must be an object.';
  if (typeof posting.company !== 'string' || !posting.company.trim()) return 'Company is required.';
  if (typeof posting.title !== 'string' || !posting.title.trim()) return 'Title is required.';
  if (!identity.url_key) return 'A valid HTTP(S) posting URL is required.';
  return null;
}

/**
 * Review a batch of discoveries against prior known postings and earlier rows
 * in the same batch. Inputs and results are plain objects; no files are read or
 * written and no application action is possible.
 */
export function reviewDiscoveries(postings = [], options = {}) {
  if (!Array.isArray(postings)) throw new TypeError('postings must be an array');
  const prior = Array.isArray(options.prior_postings) ? options.prior_postings : [];
  const canonicalizeCompany = buildCompanyCanonicalizer(options.company_aliases);
  const includeLocation = options.include_location === true;
  const index = createIndex(canonicalizeCompany, includeLocation);

  prior.forEach((posting, position) => {
    if (posting && typeof posting === 'object') seedPosting(index, posting, `prior:${position}`);
  });

  return postings.map((posting, position) => {
    const identity = normalizedIdentity(posting ?? {}, canonicalizeCompany, includeLocation);
    const invalid = invalidReason(posting, identity);
    const liveness = livenessVerdict(posting);
    const base = {
      position,
      decision: DECISIONS.NEEDS_REVIEW,
      reason_code: liveness.code,
      reason: liveness.reason,
      identity,
      liveness,
      application_action: 'none',
    };

    if (invalid) {
      return { ...base, decision: DECISIONS.INVALID, reason_code: 'invalid_posting', reason: invalid };
    }
    if (liveness.result === 'expired') {
      return { ...base, decision: DECISIONS.STALE };
    }
    if (liveness.result !== 'active') {
      return { ...base, decision: DECISIONS.NEEDS_REVIEW };
    }

    const urlSource = index.urls.get(identity.url_key)
      ?? index.scanUrls.get(identity.scan_url_key);
    if (urlSource) {
      return {
        ...base,
        decision: DECISIONS.DUPLICATE,
        reason_code: 'duplicate_url',
        reason: `Canonical posting URL already seen at ${urlSource}.`,
        duplicate_of: urlSource,
      };
    }

    const roleDuplicate = matchesSeenCompanyRole({
      key: identity.company_role_key,
      baseKey: identity.company_role_base_key,
      seen: index.roles,
      requisitions: index.requisitions,
      locatedRequisitions: index.locatedRequisitions,
    }, identity.requisition_ids);
    if (roleDuplicate) {
      return {
        ...base,
        decision: DECISIONS.DUPLICATE,
        reason_code: 'duplicate_company_role',
        reason: 'Canonical company and role match a known posting without evidence of a distinct requisition.',
      };
    }

    seedPosting(index, posting, `batch:${position}`);
    return {
      ...base,
      decision: DECISIONS.NEW,
      reason_code: 'active_unseen',
      reason: 'Posting is active and no canonical duplicate was found.',
    };
  });
}

export { DECISIONS };
