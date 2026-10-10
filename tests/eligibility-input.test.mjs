import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReviewedEligibilityInput } from '../enhanced/eligibility-input.mjs';

test('missing review inputs fail closed without application action', () => {
  const result = prepareReviewedEligibilityInput({});
  assert.notEqual(result.status, 'ready');
  assert.equal(result.application_action, 'none');
});

test('cyclic untrusted review input fails closed', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const result = prepareReviewedEligibilityInput({ extraction: cyclic, review: cyclic, candidate: cyclic });
  assert.notEqual(result.status, 'ready');
  assert.equal(result.application_action, 'none');
});
