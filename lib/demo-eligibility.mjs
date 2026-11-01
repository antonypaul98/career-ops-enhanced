// Non-submitting research gate. Never a submission authorization or legal finding.
import { createHash } from 'node:crypto';
import { employmentVerdict, sponsorshipVerdict, clearanceVerdict } from './explore-qualifier.mjs';
import { usLocationVerdict } from '../web/src/lib/explore-qualifier.mjs';
export const postingDigest = offer => createHash('sha256').update(JSON.stringify([
  offer?.company, offer?.url, offer?.title, offer?.location, offer?.description, offer?.employmentType,
])).digest('hex');
const https = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const text = value => typeof value === 'string' && value.trim().length > 0;
function reviewed(e, offer) {
  return e?.review_status === 'source_verified' && e.posting_sha256 === postingDigest(offer)
    && https(e.source_url) && text(e.quote) && text(e.reviewed_at) && Number.isFinite(Date.parse(e.reviewed_at));
}
function historyValid(h, offer) {
  return reviewed(h, offer) && h.employer_match === 'verified' && h.posting_employer === offer.company
    && text(h.filing_employer) && text(h.employer_match_evidence)
    && ['DOL_LCA', 'USCIS_H1B'].includes(h.dataset) && Number.isInteger(h.fiscal_year)
    && h.fiscal_year >= 1990 && h.fiscal_year <= new Date().getUTCFullYear()
    && Number.isInteger(h.filing_count) && h.filing_count > 0 && https(h.government_source_url);
}
/** Evidence is reviewed research, not an instruction in the job description.
 * History requires employer resolution, source URLs, quotation and exact posting binding.
 * C2C requires a separately reviewed route and candidate-specific authorization/contract evidence.
 * All outputs require human confirmation before real submission, even when demo_allowed is true.
 */
export function evaluateDemoEligibility({offer, history, c2c, candidate_id} = {}) {
  const base = {schema_version:1, demo_allowed:false, submission_allowed:false,
    human_confirmation_required:true, application_action:'none', allowed_stages:[]};
  if (!offer || !text(offer.company) || !https(offer.url) || !text(offer.description))
    return {...base, status:'blocked', reasons:['invalid_posting']};
  const sponsorship = sponsorshipVerdict(offer);
  const checks = {location:usLocationVerdict(offer.location), employment:employmentVerdict(offer),
    clearance:clearanceVerdict(offer), sponsorship};
  const reasons = [];
  if (checks.location !== 'us') reasons.push('us_location_unverified');
  if (checks.clearance !== 'not_required') reasons.push('no_clearance_unverified');
  if (!['full_time','c2c'].includes(checks.employment)) reasons.push('employment_unverified');
  let status = sponsorship === 'offered' ? 'role_sponsorship_offered' : 'sponsorship_unknown';
  if (sponsorship === 'unknown' && historyValid(history, offer)) status = 'sponsorship_plausible_role_unconfirmed';
  if (sponsorship === 'not_offered') status = 'sponsorship_excluded';
  // Explicit sponsorship exclusion stays blocking for employment sponsorship.
  // Only separately evidenced C2C can establish another route; never assume work authorization.
  if (checks.employment === 'c2c') {
    const valid = reviewed(c2c, offer) && c2c.acceptance === 'explicit'
      && offer.description.includes(c2c.quote) && employmentVerdict({description:c2c.quote}) === 'c2c'
      && text(candidate_id) && c2c.candidate_id === candidate_id
      && c2c.work_authorized === true && c2c.contract_eligible === true
      && text(c2c.authorization_evidence) && text(c2c.contract_evidence);
    status = valid ? 'c2c_verified_demo_only' : 'c2c_needs_review';
    if (!valid) reasons.push('c2c_authorization_or_contract_unverified');
  } else if (!['role_sponsorship_offered','sponsorship_plausible_role_unconfirmed'].includes(status)) reasons.push(status);
  const demo_allowed = reasons.length === 0;
  return {...base, status, checks, reasons, posting_sha256:postingDigest(offer), demo_allowed,
    allowed_stages:demo_allowed ? ['candidate_matching','evidence_bound_tailoring','html_pdf','approval_preparation'] : []};
}

// Explicit read-only CLI: node lib/demo-eligibility.mjs reviewed-input.json
// Prints a decision only; never writes authority, artifacts, trackers or approvals.
import { readFileSync } from 'node:fs';
import { isMainModule } from './is-main-module.mjs';
if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node lib/demo-eligibility.mjs reviewed-input.json');
    console.log(JSON.stringify(evaluateDemoEligibility(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
