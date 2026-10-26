/**
 * Concrete Playwright adapter for the approval-bound submission kernel.
 *
 * The adapter is intentionally contract-driven: selectors live in the private
 * per-application input, never in the public repository. It reads the final
 * form, reports pause conditions, re-reads it immediately before one click,
 * and captures only concrete post-submit evidence. It never handles passwords,
 * MFA, CAPTCHA, or unexpected fields.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from './application-approval.mjs';
import { validateApplicationLaunchUrl } from './application-launch.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/;

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function exactKeys(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`${name} has unsupported keys: ${unknown.join(', ')}`);
}

function validateContract(contract) {
  exactKeys(contract, ['schema_version', 'application_key', 'target_url', 'fields', 'artifacts', 'submit', 'receipt'], 'contract');
  if (contract.schema_version !== 1) throw new Error('contract.schema_version must be 1');
  requiredText(contract.application_key, 'contract.application_key');
  if (!validateApplicationLaunchUrl(contract.target_url).valid) throw new Error('contract.target_url must be a public HTTPS URL');
  if (!Array.isArray(contract.fields) || !Array.isArray(contract.artifacts)) throw new Error('contract fields and artifacts must be arrays');
  for (const [index, field] of contract.fields.entries()) {
    exactKeys(field, ['key', 'label', 'selector', 'read'], `contract.fields[${index}]`);
    requiredText(field.key, `contract.fields[${index}].key`);
    requiredText(field.label, `contract.fields[${index}].label`);
    requiredText(field.selector, `contract.fields[${index}].selector`);
    if (field.read != null && !['value', 'checked', 'text'].includes(field.read)) throw new Error(`contract.fields[${index}].read is invalid`);
  }
  for (const [index, artifact] of contract.artifacts.entries()) {
    exactKeys(artifact, ['kind', 'sha256', 'selector', 'display_name'], `contract.artifacts[${index}]`);
    requiredText(artifact.kind, `contract.artifacts[${index}].kind`);
    if (!SHA256.test(artifact.sha256 ?? '')) throw new Error(`contract.artifacts[${index}].sha256 is invalid`);
    requiredText(artifact.selector, `contract.artifacts[${index}].selector`);
    requiredText(artifact.display_name, `contract.artifacts[${index}].display_name`);
  }
  exactKeys(contract.submit, ['selector', 'expected_text'], 'contract.submit');
  requiredText(contract.submit.selector, 'contract.submit.selector');
  requiredText(contract.submit.expected_text, 'contract.submit.expected_text');
  exactKeys(contract.receipt, ['selectors', 'success_url_prefixes'], 'contract.receipt');
  if (!Array.isArray(contract.receipt.selectors) || !contract.receipt.selectors.length) throw new Error('contract.receipt.selectors is required');
  if (!Array.isArray(contract.receipt.success_url_prefixes) || !contract.receipt.success_url_prefixes.length) {
    throw new Error('contract.receipt.success_url_prefixes is required');
  }
  contract.receipt.selectors.forEach((entry, index) => {
    exactKeys(entry, ['selector', 'kind'], `contract.receipt.selectors[${index}]`);
    requiredText(entry.selector, `contract.receipt.selectors[${index}].selector`);
    if (!['ats_success_page', 'employer_acknowledgement'].includes(entry.kind)) throw new Error(`contract.receipt.selectors[${index}].kind is invalid`);
  });
  for (const prefix of contract.receipt.success_url_prefixes) {
    if (!validateApplicationLaunchUrl(prefix).valid) throw new Error('receipt success URL prefixes must be public HTTPS URLs');
  }
  return contract;
}

function matchesSuccessUrl(currentValue, prefixValue) {
  const current = new URL(currentValue);
  const prefix = new URL(prefixValue);
  if (current.origin !== prefix.origin) return false;
  const pathPrefix = prefix.pathname.endsWith('/') ? prefix.pathname : `${prefix.pathname}/`;
  if (current.pathname !== prefix.pathname && !current.pathname.startsWith(pathPrefix)) return false;
  return !prefix.search || current.search === prefix.search;
}

async function visible(locator) {
  try { return await locator.isVisible(); } catch { return false; }
}

async function readValue(locator, mode = 'value') {
  if (mode === 'checked') return String(await locator.isChecked());
  if (mode === 'text') return String(await locator.innerText()).trim();
  return String(await locator.inputValue());
}

async function challengeState(page) {
  const url = String(page.url());
  const body = String(await page.locator('body').innerText().catch(() => '')).slice(0, 100000);
  const passwordVisible = await visible(page.locator('input[type="password"]:visible').first());
  const loginRequired = passwordVisible || /\b(sign in|log in|login required)\b/i.test(body);
  const mfaRequired = /\b(multi[- ]factor|two[- ]factor|verification code|one[- ]time (?:code|password)|authenticator)\b/i.test(body);
  const captchaRequired = /\b(captcha|verify (?:that )?you are human|i am not a robot|challenge-platform)\b/i.test(body)
    || await visible(page.locator('iframe[src*="captcha" i], iframe[title*="captcha" i], [class*="captcha" i]').first());
  return { url, body, login_required: loginRequired, mfa_required: mfaRequired, captcha_required: captchaRequired };
}

/** Read the current final-review DOM into the exact observation used by the kernel. */
export async function observeFinalReview(page, rawContract, { observedAt = new Date().toISOString() } = {}) {
  const contract = validateContract(structuredClone(rawContract));
  const challenge = await challengeState(page);
  const knownSelectors = [...contract.fields.map(field => field.selector), ...contract.artifacts.map(item => item.selector)];
  const renderedFields = [];
  const unexpectedFields = [];
  for (const field of contract.fields) {
    const locator = page.locator(field.selector);
    if (await locator.count() !== 1 || !await visible(locator)) {
      unexpectedFields.push(field.key);
      continue;
    }
    renderedFields.push({ key: field.key, label: field.label, value: await readValue(locator, field.read) });
  }
  const attachedArtifacts = [];
  for (const artifact of contract.artifacts) {
    const locator = page.locator(artifact.selector);
    if (await locator.count() !== 1 || !await visible(locator)) {
      unexpectedFields.push(`artifact:${artifact.kind}`);
      continue;
    }
    const name = String(await locator.getAttribute('data-career-ops-file-name').catch(() => '')
      || await locator.inputValue().catch(() => '')).replace(/^.*[\\/]/, '');
    if (name !== artifact.display_name) {
      unexpectedFields.push(`artifact:${artifact.kind}:changed`);
      continue;
    }
    attachedArtifacts.push({ kind: artifact.kind, sha256: artifact.sha256 });
  }
  for (const [index, entry] of contract.receipt.selectors.entries()) {
    const locator = page.locator(entry.selector);
    if (await locator.count() === 1 && await visible(locator)) {
      const quote = String(await locator.innerText().catch(() => '')).trim();
      if (quote) unexpectedFields.push(`receipt:${index}:already_visible`);
    }
  }
  const controls = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
  const total = await controls.count();
  for (let index = 0; index < total; index += 1) {
    const control = controls.nth(index);
    if (!await visible(control)) continue;
    const matched = await control.evaluate((node, selectors) => selectors.some(selector => {
      try { return node.matches(selector); } catch { return false; }
    }), knownSelectors);
    if (!matched) unexpectedFields.push(`unmapped_control:${index}`);
  }
  const submit = page.locator(contract.submit.selector);
  const submitText = await submit.count() === 1 && await visible(submit)
    ? String(await submit.innerText().catch(() => '')).trim() : '';
  const finalReview = submitText === contract.submit.expected_text;
  return {
    application_key: contract.application_key,
    current_url: challenge.url,
    rendered_fields: renderedFields,
    attached_artifacts: attachedArtifacts,
    unexpected_fields: [...new Set(unexpectedFields)].sort(),
    observed_at: observedAt,
    browser_contract_digest: hash(contract),
    login_required: challenge.login_required,
    mfa_required: challenge.mfa_required,
    captcha_required: challenge.captcha_required,
    final_review: finalReview,
  };
}

/** Build the one-action executor. It re-observes immediately before clicking. */
export function createPlaywrightSubmitExecutor({ page, contract: rawContract, expected_observation: expectedObservation }) {
  const contract = validateContract(structuredClone(rawContract));
  const expected = structuredClone(expectedObservation);
  let invoked = false;
  return async request => {
    if (invoked) throw new Error('submit executor is single-use');
    invoked = true;
    const observed = await observeFinalReview(page, contract, { observedAt: expected.observed_at });
    if (canonicalJson(observed) !== canonicalJson(expected)) throw new Error('browser form changed after approval');
    const submit = page.locator(contract.submit.selector);
    if (await submit.count() !== 1 || !await visible(submit)) throw new Error('exact submit control unavailable');
    if (String(await submit.innerText()).trim() !== contract.submit.expected_text) throw new Error('submit control changed');
    const submittedAt = new Date().toISOString();
    await submit.click({ timeout: 15000 });
    return { action: request.action, execution_digest: request.execution_digest, submitted: true, submitted_at: submittedAt };
  };
}

/** Capture concrete post-submit evidence. This does not itself mark Applied. */
export async function capturePlaywrightReceipt(page, rawContract, execution,
  { observedAt = new Date().toISOString(), source = 'private-browser-receipt.json' } = {}) {
  const contract = validateContract(structuredClone(rawContract));
  if (execution?.decision !== 'submitted_awaiting_verified_receipt') throw new Error('completed submission execution is required');
  if (execution.browser_contract_digest !== hash(contract)) throw new Error('browser contract changed after approval');
  const currentUrl = String(page.url());
  const urlAllowed = contract.receipt.success_url_prefixes.some(prefix => matchesSuccessUrl(currentUrl, prefix));
  if (!urlAllowed) return null;
  for (const entry of contract.receipt.selectors) {
    const locator = page.locator(entry.selector);
    if (await locator.count() !== 1 || !await visible(locator)) continue;
    const quote = String(await locator.innerText()).trim().slice(0, 2000);
    if (!quote) continue;
    const reference = currentUrl;
    const evidence = { url: currentUrl, selector: entry.selector, quote, reference, observed_at: observedAt };
    return { kind: entry.kind, origin: 'observed_actual', application_key: execution.application_key,
      content_digest: execution.content_digest, execution_digest: execution.execution_digest,
      observed_at: observedAt, source: requiredText(source, 'receipt source'), sha256: hash(evidence),
      reference, quote, evidence };
  }
  return null;
}

export { validateContract as validatePlaywrightSubmissionContract };
