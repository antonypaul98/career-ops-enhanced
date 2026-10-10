import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDiscoveries } from '../enhanced/discovery-review.mjs';

const active = { result: 'active', code: 'apply_control_visible', reason: 'Apply control visible.' };

function posting(overrides = {}) {
  return {
    company: 'Acme',
    title: 'Data Engineer',
    url: 'https://jobs.acme.example/roles/JR-100?utm_source=test',
    location: 'New York, NY',
    requisition_id: 'JR-100',
    liveness: active,
    ...overrides,
  };
}

test('marks an active unseen posting new without side effects', () => {
  const input = posting();
  const [result] = reviewDiscoveries([input]);
  assert.equal(result.decision, 'new');
  assert.equal(result.application_action, 'none');
  assert.match(result.identity.url_key, /JR-100/);
  assert.equal(input.application_action, undefined);
});

test('collapses tracking-only URL variants through canonical URL identity', () => {
  const prior = posting({ url: 'http://jobs.acme.example/roles/JR-100/?utm_campaign=old' });
  const candidate = posting({ url: 'https://jobs.acme.example/roles/JR-100?utm_source=new' });
  const [result] = reviewDiscoveries([candidate], { prior_postings: [prior] });
  assert.equal(result.decision, 'duplicate');
  assert.equal(result.reason_code, 'duplicate_url');
});

test('deduplicates company aliases and normalized role titles', () => {
  const prior = posting({ company: 'International Business Machines', title: 'Senior Data Engineer (Remote)' });
  const candidate = posting({
    company: 'IBM',
    title: 'Senior Data Engineer [Remote]',
    url: 'https://careers.ibm.example/jobs/JR-100',
  });
  const [result] = reviewDiscoveries([candidate], {
    prior_postings: [prior],
    company_aliases: { 'International Business Machines': ['IBM'] },
  });
  assert.equal(result.decision, 'duplicate');
  assert.equal(result.reason_code, 'duplicate_company_role');
});

test('keeps explicitly distinct requisitions with the same company and title', () => {
  const prior = posting({ url: 'https://jobs.acme.example/roles/JR-100', requisition_id: 'JR-100' });
  const candidate = posting({
    url: 'https://jobs.acme.example/roles/JR-200',
    requisition_id: 'JR-200',
  });
  const [result] = reviewDiscoveries([candidate], { prior_postings: [prior] });
  assert.equal(result.decision, 'new');
  assert.deepEqual(result.identity.requisition_ids, ['JR-200']);
});

test('uses location-aware identity only when explicitly enabled', () => {
  const prior = posting({ location: 'New York, NY' });
  const candidate = posting({
    url: 'https://jobs.acme.example/roles/JR-100-LONDON',
    location: 'London, UK',
    requisition_id: '',
  });
  assert.equal(reviewDiscoveries([candidate], { prior_postings: [prior] })[0].decision, 'duplicate');
  assert.equal(reviewDiscoveries([candidate], {
    prior_postings: [prior],
    include_location: true,
  })[0].decision, 'new');
});

test('marks only authoritative expiry evidence stale', () => {
  const [result] = reviewDiscoveries([posting({
    liveness: undefined,
    liveness_observation: {
      status: 410,
      finalUrl: 'https://jobs.acme.example/roles/JR-100',
      bodyText: 'Gone',
      applyControls: [],
    },
  })]);
  assert.equal(result.decision, 'stale');
  assert.equal(result.reason_code, 'http_gone');
});

test('keeps access blocks and transient failures visible for review', () => {
  for (const status of [429, 502]) {
    const [result] = reviewDiscoveries([posting({
      liveness: undefined,
      liveness_observation: {
        status,
        finalUrl: 'https://jobs.acme.example/roles/JR-100',
        bodyText: `${status} temporary response`,
        applyControls: [],
      },
    })]);
    assert.equal(result.decision, 'needs_review');
    assert.equal(result.liveness.result, 'uncertain');
  }
});

test('missing liveness never becomes active, stale, or duplicate', () => {
  const [result] = reviewDiscoveries([posting({ liveness: undefined })], {
    prior_postings: [posting()],
  });
  assert.equal(result.decision, 'needs_review');
  assert.equal(result.reason_code, 'missing_liveness');
});

test('invalid and placeholder URLs fail closed without becoming shared keys', () => {
  const results = reviewDiscoveries([
    posting({ url: 'N/A' }),
    posting({ url: 'TBD', company: 'Other', title: 'Platform Engineer' }),
  ]);
  assert.deepEqual(results.map((item) => item.decision), ['invalid', 'invalid']);
  assert.deepEqual(results.map((item) => item.identity.url_key), ['', '']);
});

test('deduplicates active discoveries within the same batch deterministically', () => {
  const results = reviewDiscoveries([
    posting(),
    posting({ url: 'https://jobs.acme.example/roles/JR-100?utm_medium=repeat' }),
  ]);
  assert.deepEqual(results.map((item) => item.decision), ['new', 'duplicate']);
  assert.equal(results[1].duplicate_of, 'batch:0');
});
