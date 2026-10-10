// C07 integration/adversarial regressions. Every declaration and JD is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { extractStructuredRequirements } from '../enhanced/jd-requirements.mjs';
import { evaluateEligibility } from '../enhanced/eligibility.mjs';
import { fingerprintRequirements, prepareReviewedEligibilityInput } from '../enhanced/eligibility-input.mjs';

const REGION = 'SYNTHETIC_REGION';
const CANDIDATE = 'synthetic-candidate';
const JD = `## Requirements\n- Work authorization required for ${REGION}.\n- Python required.\n`;

function fixture(jdText = JD) {
  const extraction = extractStructuredRequirements(jdText);
  assert.equal(extraction.extraction_status, 'ok');
  const decisions = extraction.requirements.map(item => ({
    requirement_id: item.id, review_status: 'explicit',
    relevant: item.requirement_type === 'other',
    ...(item.requirement_type === 'other' ? { field: 'work_authorized', required_value: true,
      mandatory: item.kind === 'required', jurisdiction: REGION, period: 'current' } : {}),
  }));
  return { jdText, extraction, review: { complete: true, source_sha256: extraction.source_sha256,
    requirements_sha256: fingerprintRequirements(extraction.requirements), decisions },
  candidate: { candidate_id: CANDIDATE, facts: [{ id: 'synthetic-declaration', candidate_id: CANDIDATE,
    field: 'work_authorized', value: true, jurisdiction: REGION, period: 'current',
    status: 'user_confirmed', provenance: { source_type: 'candidate_statement', source_id: 'synthetic-source' } }] } };
}

const eligibilityDecision = args => args.review.decisions.find(item => item.relevant);
const refreshFingerprint = args => {
  args.review.requirements_sha256 = fingerprintRequirements(args.extraction.requirements);
};

function expectReview(args, reason) {
  const result = prepareReviewedEligibilityInput(args);
  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.reason_codes, [reason]);
  assert.equal(result.input, null);
  assert.equal(result.advisory_only, true);
  assert.equal(result.application_action, 'none');
  return result;
}

function assess(args) {
  const prepared = prepareReviewedEligibilityInput(args);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  assert.equal(prepared.advisory_only, true);
  assert.equal(prepared.application_action, 'none');
  assert.ok(prepared.input.requirements.every(item => item.candidate_evidence === false));
  return { prepared, result: evaluateEligibility(prepared.input) };
}

test('real C03 extraction feeds the evaluator without promoting a JD skill to candidate evidence', () => {
  const { prepared, result } = assess(fixture());
  assert.equal(result.status, 'eligible');
  assert.equal(prepared.input.requirements.length, 1);
  assert.equal(prepared.input.candidate.facts.length, 1);
  assert.equal(prepared.input.candidate.facts[0].field, 'work_authorized');
  assert.equal(result.application_action, 'none');
});

test('source-verified candidate documents remain a separate accepted declaration source', () => {
  const args = fixture();
  args.candidate.facts[0].status = 'source_verified';
  args.candidate.facts[0].provenance.source_type = 'candidate_document';
  const { prepared, result } = assess(args);
  assert.equal(result.status, 'eligible');
  assert.equal(prepared.input.candidate.facts[0].provenance.source_type, 'candidate_document');
  assert.equal(prepared.input.requirements[0].provenance.source_type, 'job_description');
});

test('mandatory explicit conflict is advisory ineligibility with a traceable reason', () => {
  const args = fixture();
  args.candidate.facts[0].value = false;
  const { result } = assess(args);
  assert.equal(result.status, 'ineligible');
  assert.ok(result.reason_codes.includes('mandatory_explicit_conflict'));
  assert.equal(result.application_action, 'none');
});

test('a preferred condition cannot become a mandatory exclusion', () => {
  const args = fixture(`## Preferred\n- Work authorization for ${REGION}.\n`);
  eligibilityDecision(args).mandatory = true;
  expectReview(args, 'mandatory_strength_unverified');
});

test('preferred conflicts and nonmandatory required conflicts remain review work', () => {
  for (const jd of [JD, `## Preferred\n- Work authorization for ${REGION}.\n`]) {
    const args = fixture(jd);
    eligibilityDecision(args).mandatory = false;
    args.candidate.facts[0].value = false;
    const { result } = assess(args);
    assert.equal(result.status, 'needs_review');
    assert.ok(result.reason_codes.includes('non_mandatory_conflict'));
  }
});

test('empty declarations, nationality, location, legacy defaults and CV words do not prove authorization', () => {
  const args = fixture();
  args.candidate.facts = [];
  Object.assign(args.candidate, { nationality: REGION, location: REGION,
    education: `${REGION} university`, resume: 'Authorized citizen, no sponsorship',
    profile: { authorized_in: [REGION], needs_sponsorship: false } });
  const { prepared, result } = assess(args);
  assert.deepEqual(prepared.input.candidate.facts, []);
  assert.equal(result.status, 'needs_review');
  assert.ok(result.reason_codes.includes('missing_candidate_fact'));
});

test('missing declaration envelopes never fall back to a profile or source text', () => {
  for (const candidate of [undefined, {}, { candidate_id: CANDIDATE, profile: { authorized_in: [REGION] } }]) {
    const args = fixture();
    args.candidate = candidate;
    expectReview(args, 'candidate_declarations_missing');
  }
});

test('authorization declarations do not imply future sponsorship or another jurisdiction', () => {
  for (const changes of [{ period: 'future' }, { jurisdiction: 'OTHER_SYNTHETIC_REGION' },
    { field: 'needs_sponsorship', required_value: false }]) {
    const args = fixture();
    Object.assign(eligibilityDecision(args), changes);
    const { result } = assess(args);
    assert.equal(result.status, 'needs_review');
    assert.ok(result.reason_codes.includes('missing_candidate_fact'));
  }
});

test('current authorization and future sponsorship are assessed separately', () => {
  const args = fixture(`## Requirements\n- Work authorization required for ${REGION}.\n- Sponsorship policy required for ${REGION}.\n`);
  const sponsorship = args.review.decisions[1];
  Object.assign(sponsorship, { field: 'needs_sponsorship', required_value: false, period: 'future' });
  args.candidate.facts.push({ ...structuredClone(args.candidate.facts[0]), id: 'synthetic-future',
    field: 'needs_sponsorship', value: false, period: 'future' });
  assert.equal(assess(args).result.status, 'eligible');
  args.candidate.facts[1].value = true;
  assert.equal(assess(args).result.status, 'ineligible');
});

test('contradictory approved candidate facts require review rather than selecting the favorable fact', () => {
  const args = fixture();
  args.candidate.facts.push({ ...structuredClone(args.candidate.facts[0]), id: 'synthetic-conflict', value: false });
  const { result } = assess(args);
  assert.equal(result.status, 'needs_review');
  assert.ok(result.reason_codes.includes('conflicting_candidate_evidence'));
});

test('duplicate candidate fact ids are rejected even when values agree', () => {
  const args = fixture();
  args.candidate.facts.push(structuredClone(args.candidate.facts[0]));
  expectReview(args, 'candidate_declaration_duplicate');
});

for (const [name, change] of [
  ['another candidate', { candidate_id: 'other-synthetic-candidate' }],
  ['unreviewed fact', { status: 'needs_review' }],
  ['rejected fact', { status: 'rejected' }],
  ['string Boolean', { value: 'true' }],
  ['numeric Boolean', { value: 1 }],
  ['unsupported field', { field: 'nationality' }],
  ['unknown period', { period: 'indefinite' }],
  ['empty jurisdiction', { jurisdiction: ' ' }],
  ['missing fact id', { id: '' }],
  ['JD provenance', { provenance: { source_type: 'job_description', source_id: 'synthetic-jd' } }],
  ['missing source ref', { provenance: { source_type: 'candidate_statement', source_id: '' } }],
]) {
  test(`candidate declaration rejects ${name}`, () => {
    const args = fixture();
    Object.assign(args.candidate.facts[0], change);
    expectReview(args, 'candidate_declaration_unverified');
  });
}

test('every C03 record needs an explicit review decision, including unrelated technologies', () => {
  const args = fixture();
  args.review.decisions = args.review.decisions.filter(item => item.relevant);
  expectReview(args, 'eligibility_review_incomplete');
});

test('incomplete, duplicate, unknown and unreviewed decisions fail closed', () => {
  for (const mutate of [
    args => { args.review.complete = false; },
    args => { args.review.decisions.push(structuredClone(args.review.decisions[0])); },
    args => { args.review.decisions[0].requirement_id = 'unknown-synthetic-record'; },
    args => { args.review.decisions[0].review_status = 'needs_review'; },
    args => { args.review.decisions[0].relevant = 'yes'; },
    args => { eligibilityDecision(args).mandatory = 'true'; },
    args => { eligibilityDecision(args).required_value = 1; },
    args => { eligibilityDecision(args).field = 'visa_label'; },
    args => { eligibilityDecision(args).jurisdiction = ''; },
    args => { eligibilityDecision(args).period = 'unknown'; },
  ]) {
    const args = fixture();
    mutate(args);
    expectReview(args, 'eligibility_review_incomplete');
  }
});

test('a review of no eligibility conditions never yields a vacuous eligibility pass', () => {
  const args = fixture();
  for (const decision of args.review.decisions) decision.relevant = false;
  expectReview(args, 'no_reviewed_eligibility_requirement');
});

test('changed JD bytes or stale review source digests invalidate the review', () => {
  const args = fixture();
  args.jdText += ' ';
  expectReview(args, 'jd_snapshot_unverified');
  const stale = fixture();
  stale.review.source_sha256 = '0'.repeat(64);
  expectReview(stale, 'eligibility_review_incomplete');
});

test('changed extraction records and missing fingerprints invalidate prior review', () => {
  for (const mutate of [
    args => { args.extraction.requirements[0].kind = 'preferred'; },
    args => { args.extraction.requirements[0].occurrences[0].section = 'Changed'; },
    args => { delete args.review.requirements_sha256; },
  ]) {
    const args = fixture();
    mutate(args);
    expectReview(args, 'eligibility_review_snapshot_mismatch');
  }
});

test('forged C03 envelopes cannot be treated as reviewed employer snapshots', () => {
  for (const change of [{ schema_version: 2 }, { span_units: 'bytes' }, { source_type: 'candidate_document' },
    { candidate_evidence: true }, { extraction_status: 'inconclusive' }, { source_sha256: '0'.repeat(64) },
    { requirements: null }]) {
    const args = fixture();
    Object.assign(args.extraction, change);
    expectReview(args, 'jd_snapshot_unverified');
  }
});

test('record provenance, duplicate ids and missing occurrences fail even after a new fingerprint', () => {
  for (const mutate of [
    args => { args.extraction.requirements[0].provenance = 'candidate_statement'; },
    args => { args.extraction.requirements[0].candidate_evidence = true; },
    args => { args.extraction.requirements[0].occurrences = []; },
    args => { args.extraction.requirements[1].id = args.extraction.requirements[0].id; },
  ]) {
    const args = fixture();
    mutate(args);
    refreshFingerprint(args);
    expectReview(args, 'jd_record_unverified');
  }
});

test('incorrect line, UTF-16 column, offsets and occurrence identity fail source validation', () => {
  for (const change of [{ line: 99 }, { column_start: 99 }, { column_end: 99 },
    { offset_start: -1 }, { offset_end: Number.MAX_SAFE_INTEGER }, { text: 'fabricated synthetic condition' }]) {
    const args = fixture();
    Object.assign(args.extraction.requirements[0].source_span, change);
    refreshFingerprint(args);
    expectReview(args, 'jd_record_unverified');
  }
  const args = fixture();
  args.extraction.requirements[0].source_span = args.extraction.requirements[1].source_span;
  refreshFingerprint(args);
  expectReview(args, 'jd_record_unverified');
});

test('negated or unspecified C03 meaning cannot justify a positive eligibility condition', () => {
  for (const jd of [`## Requirements\n- Work authorization is not required for ${REGION}.\n`,
    `## Qualifications\n- Work authorization for ${REGION}.\n`]) {
    const args = fixture(jd);
    expectReview(args, 'requirement_meaning_unverified');
  }
});

test('conflicting reviewed employer declarations in one scope require a new review', () => {
  const args = fixture(`## Requirements\n- Work authorization required for ${REGION}.\n- Separate authorization condition required for ${REGION}.\n`);
  args.review.decisions[1].required_value = false;
  expectReview(args, 'conflicting_employer_requirements');
});

test('real C03 inline headings, CRLF, Unicode offsets and repeated occurrences remain usable', () => {
  for (const jd of [`Requirements: Work authorization required for ${REGION}.\n`,
    `## Requirements\r\n1. Work authorization required for ${REGION}.\r\n`,
    `Synthetic 😀 introduction\n## Requirements\n- Work authorization required for ${REGION}.\n`,
    `## Requirements\n- Work authorization required for ${REGION}.\n- Work authorization required for ${REGION}.\n`]) {
    assert.equal(assess(fixture(jd)).result.status, 'eligible');
  }
});

test('normalized facts drop extra private fields and advisory results hash synthetic source identifiers', () => {
  const args = fixture();
  const marker = 'SYNTHETIC_PRIVATE_MARKER';
  Object.assign(args.candidate.facts[0], { quote: marker, path: `/synthetic/${marker}`, salary: marker });
  args.candidate.facts[0].provenance.source_id = marker;
  args.candidate.facts[0].provenance.quote = marker;
  const { prepared, result } = assess(args);
  assert.equal('quote' in prepared.input.candidate.facts[0], false);
  assert.equal('path' in prepared.input.candidate.facts[0], false);
  assert.deepEqual(Object.keys(prepared.input.candidate.facts[0].provenance).sort(), ['source_id', 'source_type']);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes(CANDIDATE), false);
  assert.equal(JSON.stringify(result).includes(REGION), false);
  assert.match(result.checks[0].provenance.candidate[0].source_ref, /^[a-f0-9]{64}$/);
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

test('review preparation is deterministic and does not mutate caller snapshots or declarations', () => {
  const args = fixture();
  const before = structuredClone(args);
  const first = prepareReviewedEligibilityInput(freeze(args));
  assert.equal(first.status, 'ready');
  assert.deepEqual(prepareReviewedEligibilityInput(args), first);
  assert.deepEqual(args, before);
  first.input.candidate.facts[0].value = false;
  assert.equal(args.candidate.facts[0].value, true);
});

test('malformed, cyclic and throwing untrusted inputs return generic review diagnostics', () => {
  expectReview(null, 'malformed_review_input');
  for (const value of [0, 'synthetic', [], undefined]) expectReview(value, 'jd_snapshot_unverified');
  const cyclic = fixture();
  cyclic.extraction.requirements[0].cycle = cyclic.extraction.requirements;
  expectReview(cyclic, 'malformed_review_input');
  const throwing = fixture();
  Object.defineProperty(throwing.candidate.facts[0], 'value', {
    get() { throw new Error('SYNTHETIC_PRIVATE_MARKER'); },
  });
  const result = expectReview(throwing, 'malformed_review_input');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_MARKER'), false);
});

test('the adapter makes no filesystem or network calls while preparing reviewed runtime input', () => {
  const adapter = new URL('../enhanced/eligibility-input.mjs', import.meta.url).href;
  const code = `
    import fs from 'node:fs';
    import http from 'node:http';
    import https from 'node:https';
    const { prepareReviewedEligibilityInput } = await import(${JSON.stringify(adapter)});
    const args = ${JSON.stringify(fixture())};
    let calls = 0;
    const deny = () => { calls++; throw new Error('unexpected I/O'); };
    for (const name of ['readFileSync', 'writeFileSync', 'openSync', 'readdirSync', 'statSync']) fs[name] = deny;
    for (const name of ['readFile', 'writeFile', 'open', 'readdir', 'stat']) fs.promises[name] = deny;
    http.request = https.request = http.get = https.get = globalThis.fetch = deny;
    const result = prepareReviewedEligibilityInput(args);
    if (calls || result.status !== 'ready') throw new Error('unexpected I/O or review status');
    console.log(JSON.stringify({ status: result.status, calls, application_action: result.application_action }));
  `;
  const output = JSON.parse(execFileSync(process.execPath,
    ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(output, { status: 'ready', calls: 0, application_action: 'none' });
});
