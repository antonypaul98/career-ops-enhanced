import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { fixture, resumeBytes, resumeHash } from './helpers/submission-browser-fixture.mjs';
import { runBrowserSubmission } from '../submit-application-browser.mjs';

const browserTest = existsSync(chromium.executablePath()) ? test : test.skip;
const html = '<meta charset="utf-8"><label>First name<input id="first-name" value="Synthetic"></label><input type="file" id="resume"><button id="submit">Submit application</button>';
async function setup(t) {
  const input = fixture();
  delete input.submit_approval;
  input.browser_contract = { schema_version: 1, application_key: input.bundle.application.key,
    target_url: input.bundle.application.url,
    fields: [{ key: 'first_name', label: 'First name', selector: '#first-name', read: 'value' }],
    artifacts: [{ kind: 'resume', sha256: resumeHash, selector: '#resume', display_name: 'synthetic-resume.pdf' }],
    submit: { selector: '#submit', expected_text: 'Submit application' },
    receipt: { selectors: [{ selector: '#receipt', kind: 'ats_success_page' }],
      success_url_prefixes: ['https://jobs.synthetic-acme.example/confirmation/'] } };
  const browser = await chromium.launch({ headless: process.env.CAREER_OPS_HEADED_TEST !== '1' });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  await page.goto(input.bundle.application.url);
  await page.locator('#resume').setInputFiles({ name: 'synthetic-resume.pdf', mimeType: 'application/pdf', buffer: resumeBytes });
  let clicks = 0;
  await page.exposeFunction('clicked', () => clicks++);
  await page.locator('#submit').evaluate(node => node.onclick = () => window.clicked());
  // Keep this synthetic session alive across inspect calls; production owns/ closes its context.
  const run = (mode = 'inspect') => runBrowserSubmission(input, { mode,
    launchPersistentContext: async () => ({ pages: () => [page], close: async () => {} }) });
  return { input, page, context, run, clicks: () => clicks };
}

browserTest('inspect rejects a changed answer instead of declaring an exact review', async t => {
  const f = await setup(t);
  await f.page.locator('#first-name').fill('Changed');
  const result = await f.run();
  assert.equal(result.decision, 'blocked');
  assert.equal(result.reason, 'observed_fields_changed');
  assert.equal(result.applied_status_authorized, false);
  assert.equal(f.clicks(), 0);
});

browserTest('inspect rejects changed URL and mismatched contract identity', async t => {
  const f = await setup(t);
  // Navigation itself redirects on the synthetic page, so re-opening cannot mask the change.
  await f.context.route('**/*', route => route.fulfill({ contentType: 'text/html',
    body: html + `<script>const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(resumeBytes.toString())}], 'synthetic-resume.pdf')); document.querySelector('#resume').files = dt.files; history.replaceState({}, '', '?changed=1')</script>` }));
  await f.page.reload();
  const result = await f.run();
  assert.equal(result.decision, 'blocked');
  assert.equal(result.reason, 'observed_url_changed');
  const g = await setup(t);
  g.input.browser_contract.application_key = 'wrong-key';
  assert.notEqual((await g.run()).decision, 'exact_final_review_observed');
});

browserTest('inspect exact package, missing approval, expired authentication, and candidate-assisted resume', async t => {
  const f = await setup(t);
  const ready = await f.run();
  assert.equal(ready.decision, 'exact_final_review_observed');
  f.input.observation = ready.observation;
  assert.equal((await f.run('submit')).reason, 'submit_approval_invalid_or_stale');
  for (const [markup, reason] of [
    ['<input type="password">', 'login_required'],
    ['Verification code', 'mfa_required'], ['CAPTCHA', 'captcha_required'],
    ['<input id="salary">', 'new_or_changed_fields'],
  ]) {
    await f.page.locator('body').evaluate((node, markup) => {
      const div = document.createElement('div'); div.id = 'challenge'; div.innerHTML = markup; node.append(div);
    }, markup);
    const paused = await f.run();
    assert.equal(paused.decision, 'paused'); assert.equal(paused.reason, reason);
    assert.equal(paused.resume_token, ready.resume_token);
    assert.equal(paused.consequential_actions, 0);
    assert.equal(paused.applied_status_authorized, false);
    await f.page.locator('#challenge').evaluate(node => node.remove());
  }
  const resumed = await f.run();
  assert.equal(resumed.decision, 'exact_final_review_observed');
  assert.equal(resumed.resume_token, ready.resume_token);
  assert.equal(f.clicks(), 0);
});

 browserTest('expired session cookie pauses and reauthentication requires a fresh inspection', async t => {
  const f = await setup(t);
  const ready = await f.run();
  await f.context.addCookies([{ name: 'session', value: 'synthetic', url: f.input.bundle.application.url }]);
  await f.context.clearCookies();
  await f.context.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
    route.request().headers().cookie?.includes('session=synthetic') ? html : '<h1>Sign in</h1><input type="password">' }));
  await f.page.reload();
  const expired = await f.run();
  assert.equal(expired.reason, 'login_required');
  assert.equal(expired.resume_token, ready.resume_token);
  assert.equal(expired.applied_status_authorized, false);
  // Simulate the candidate finishing authentication; the runner never supplies credentials.
  await f.context.addCookies([{ name: 'session', value: 'synthetic', url: f.input.bundle.application.url }]);
  await f.page.reload();
  const missingUpload = await f.run();
  assert.equal(missingUpload.reason, 'new_or_changed_fields');
  await f.page.locator('#resume').setInputFiles({ name: 'synthetic-resume.pdf', mimeType: 'application/pdf', buffer: resumeBytes });
  const resumed = await f.run();
  assert.equal(resumed.decision, 'exact_final_review_observed');
  assert.equal(resumed.resume_token, ready.resume_token);
  assert.equal(f.clicks(), 0);
});

test('interrupted browser launch produces a serializable pause with a stable resume token', async () => {
  const input = fixture(); input.browser_contract = {};
  const options = { mode: 'inspect', launchPersistentContext: async () => { throw new Error('synthetic interruption'); } };
  const first = await runBrowserSubmission(input, options);
  const retry = await runBrowserSubmission(input, options);
  assert.equal(first.decision, 'paused');
  assert.equal(first.reason, 'browser_observation_unavailable');
  assert.match(first.resume_token, /^[a-f0-9]{64}$/);
  assert.equal(retry.resume_token, first.resume_token);
  assert.equal(first.consequential_actions, 0);
  assert.equal(first.tracker_mutation, false);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

browserTest('changed question labels cannot reuse the reviewed answer', async t => {
  const f = await setup(t);
  await f.page.locator('label').evaluate(node => { node.firstChild.textContent = 'Different question'; });
  const result = await f.run();
  assert.equal(result.reason, 'new_or_changed_fields');
  assert.ok(result.observation.unexpected_fields.includes('field:first_name:label_changed'));
  assert.equal(f.clicks(), 0);
});

browserTest('a consumed exact approval cannot submit twice across runner invocations', async t => {
  const f = await setup(t);
  const { createExactSubmissionReview, createExactSubmissionApproval, SUBMIT_CONFIRMATION_STATEMENT } =
    await import('../enhanced/approved-application-submission.mjs');
  const ready = await f.run();
  f.input.observation = ready.observation;
  const review = createExactSubmissionReview(f.input);
  f.input.submit_approval = createExactSubmissionApproval({ ...f.input, confirmation: {
    confirmed: true, statement: SUBMIT_CONFIRMATION_STATEMENT,
    challenge_digest: review.challenge_digest, approved_at: new Date().toISOString(),
  } });
  const used = new Set();
  const options = { mode: 'submit',
    launchPersistentContext: async () => ({ pages: () => [f.page], close: async () => {} }),
    reserveSubmission: async digest => { if (used.has(digest)) return false; used.add(digest); return true; },
  };
  await runBrowserSubmission(f.input, options);
  const retry = await runBrowserSubmission(f.input, options);
  assert.equal(f.clicks(), 1);
  assert.equal(retry.reason, 'submission_already_attempted');
  assert.equal(retry.applied_status_authorized, false);
});

test('durable approval claims survive separate processes and reject replay', t => {
  const root = mkdtempSync(join(tmpdir(), 'synthetic-submit-claims-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const moduleUrl = new URL('../submit-application-browser.mjs', import.meta.url).href;
  const code = `import {reserveSubmissionAttempt} from ${JSON.stringify(moduleUrl)};
    console.log(reserveSubmissionAttempt(${JSON.stringify(root)}, 'a'.repeat(64)));`;
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  const first = run(); const retry = run();
  assert.equal(first.status, 0); assert.equal(retry.status, 0);
  assert.equal(first.stdout.trim(), 'true'); assert.equal(retry.stdout.trim(), 'false');
});
