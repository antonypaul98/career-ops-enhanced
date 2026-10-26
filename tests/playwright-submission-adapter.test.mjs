import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { observeFinalReview, createPlaywrightSubmitExecutor, capturePlaywrightReceipt,
  validatePlaywrightSubmissionContract } from '../enhanced/playwright-submission-adapter.mjs';

const URL = 'https://jobs.synthetic-acme.example/apply/42';
const WHEN = '2026-10-21T00:00:00.000Z';
const browserTest = existsSync(chromium.executablePath()) ? test : test.skip;
const contract = {
  schema_version: 1,
  application_key: 'synthetic-042',
  target_url: URL,
  fields: [{ key: 'first_name', label: 'First name', selector: '#first-name', read: 'value' }],
  artifacts: [{ kind: 'resume', sha256: 'a'.repeat(64), selector: '#resume', display_name: 'synthetic-resume.pdf' }],
  submit: { selector: '#submit', expected_text: 'Submit application' },
  receipt: {
    selectors: [{ selector: '#receipt', kind: 'ats_success_page' }],
    success_url_prefixes: ['https://jobs.synthetic-acme.example/confirmation/'],
  },
};

const reviewHtml = `<!doctype html><html><body>
  <label>First name <input id="first-name" value="Synthetic"></label>
  <input id="resume" type="file" data-career-ops-file-name="synthetic-resume.pdf">
  <button id="submit">Submit application</button>
</body></html>`;

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://jobs.synthetic-acme.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: reviewHtml }));
    await page.goto(URL);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

browserTest('reads one exact synthetic final-review form and attached artifact', () => withPage(async page => {
  const observed = await observeFinalReview(page, contract, { observedAt: WHEN });
  assert.deepEqual(observed.rendered_fields, [{ key: 'first_name', label: 'First name', value: 'Synthetic' }]);
  assert.deepEqual(observed.attached_artifacts, [{ kind: 'resume', sha256: 'a'.repeat(64) }]);
  assert.deepEqual(observed.unexpected_fields, []);
  assert.equal(observed.current_url, URL);
  assert.match(observed.browser_contract_digest, /^[a-f0-9]{64}$/);
  assert.equal(observed.final_review, true);
  assert.equal(observed.login_required, false);
  assert.equal(observed.mfa_required, false);
  assert.equal(observed.captcha_required, false);
}));

browserTest('unexpected controls and login/MFA/CAPTCHA pause signals are surfaced', () => withPage(async page => {
  await page.locator('body').evaluate(node => {
    node.insertAdjacentHTML('beforeend', '<input id="salary"><input type="password"><div>Verification code</div><div>Verify you are human CAPTCHA</div>');
  });
  const observed = await observeFinalReview(page, contract, { observedAt: WHEN });
  assert.ok(observed.unexpected_fields.some(value => value.startsWith('unmapped_control:')));
  assert.equal(observed.login_required, true);
  assert.equal(observed.mfa_required, true);
  assert.equal(observed.captcha_required, true);
}));

browserTest('pre-existing success markers block final review before any submit action', () => withPage(async page => {
  await page.locator('body').evaluate(node => node.insertAdjacentHTML(
    'beforeend', '<main id="receipt">Unrelated pre-existing success text.</main>'));
  const observed = await observeFinalReview(page, contract, { observedAt: WHEN });
  assert.deepEqual(observed.unexpected_fields, ['receipt:0:already_visible']);
}));

browserTest('executor re-reads exact DOM, clicks once, and is single-use', () => withPage(async page => {
  const observed = await observeFinalReview(page, contract, { observedAt: WHEN });
  let clicks = 0;
  await page.locator('#submit').evaluate(node => node.addEventListener('click', event => { event.preventDefault(); window.__clicks = (window.__clicks || 0) + 1; }));
  const executor = createPlaywrightSubmitExecutor({ page, contract, expected_observation: observed });
  const request = { action: 'submit_exact_approved_form', execution_digest: 'b'.repeat(64) };
  const result = await executor(request);
  clicks = await page.evaluate(() => window.__clicks || 0);
  assert.equal(clicks, 1);
  assert.equal(result.submitted, true);
  assert.equal(result.execution_digest, request.execution_digest);
  await assert.rejects(() => executor(request), /single-use/);
}));

browserTest('executor fails closed if the form changes after approval', () => withPage(async page => {
  const observed = await observeFinalReview(page, contract, { observedAt: WHEN });
  const executor = createPlaywrightSubmitExecutor({ page, contract, expected_observation: observed });
  await page.locator('#first-name').fill('Changed');
  await assert.rejects(() => executor({ action: 'submit_exact_approved_form', execution_digest: 'b'.repeat(64) }), /changed/);
}));

browserTest('receipt requires the sealed contract, an allowed success URL, and visible post-submit evidence', () => withPage(async page => {
  const observed = await observeFinalReview(page, contract, { observedAt: WHEN });
  const execution = { decision: 'submitted_awaiting_verified_receipt', application_key: 'synthetic-042',
    content_digest: 'c'.repeat(64), execution_digest: 'd'.repeat(64),
    browser_contract_digest: observed.browser_contract_digest };
  assert.equal(await capturePlaywrightReceipt(page, contract, execution, { observedAt: WHEN }), null);
  await page.locator('body').evaluate(node => node.insertAdjacentHTML(
    'beforeend', '<main id="receipt">Application received. Reference SYN-42.</main>'));
  assert.equal(await capturePlaywrightReceipt(page, contract, execution, { observedAt: WHEN }), null);
  await page.goto('https://jobs.synthetic-acme.example/confirmation/SYN-42');
  await page.locator('body').evaluate(node => node.insertAdjacentHTML(
    'beforeend', '<main id="receipt">Application received. Reference SYN-42.</main>'));
  const receipt = await capturePlaywrightReceipt(page, contract, execution, { observedAt: WHEN });
  assert.equal(receipt.kind, 'ats_success_page');
  assert.equal(receipt.origin, 'observed_actual');
  assert.equal(receipt.reference, 'https://jobs.synthetic-acme.example/confirmation/SYN-42');
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.tracker_mutation, undefined);
  assert.equal(receipt.applied_status_authorized, undefined);

  const changed = structuredClone(contract);
  changed.receipt.selectors[0].selector = 'body';
  await assert.rejects(() => capturePlaywrightReceipt(page, changed, execution, { observedAt: WHEN }),
    /browser contract changed after approval/);
}));

test('contract rejects unknown capabilities and fixtures contain no private candidate data', () => {
  const unsafe = structuredClone(contract);
  unsafe.submit.javascript = 'document.forms[0].submit()';
  assert.throws(() => validatePlaywrightSubmissionContract(unsafe), /unsupported keys/);
  const noSuccessUrl = structuredClone(contract);
  noSuccessUrl.receipt.success_url_prefixes = [];
  assert.throws(() => validatePlaywrightSubmissionContract(noSuccessUrl), /success_url_prefixes is required/);
  assert.doesNotMatch(JSON.stringify({ contract, reviewHtml }), /antony|gmail|@/i);
});
