#!/usr/bin/env node
/** Opt-in native Safari synthetic observation validation. No Submit capability.
 * Start /usr/bin/safaridriver -p 48157, then:
 * node scripts/native-safari-acceptance.mjs --synthetic --output <local.json>
 * This is not Playwright WebKit or production Safari-profile support.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { observeFinalReview } from '../enhanced/playwright-submission-adapter.mjs';
import { inspectApplicationObservation } from '../enhanced/approved-application-submission.mjs';
import { fixture, resumeBytes, resumeHash } from '../tests/helpers/submission-browser-fixture.mjs';

if (!process.argv.includes('--synthetic')) throw new Error('--synthetic is required');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? null : process.argv[outputIndex + 1];
const base = 'http://127.0.0.1:48157';
let session;
const evidence = { browser: 'native Safari via safaridriver', synthetic_only: true, submit_actions: 0, results: [] };
async function request(path, body, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (result.value?.error) throw new Error(result.value.message);
  return result.value;
}
const execute = (script, args = []) => request(`/session/${session}/execute/sync`, { script, args });
const executeAsync = (script, args = []) => request(`/session/${session}/execute/async`, { script, args });
// Read-only locator surface for the production observer. No click/fill method.
class Locator {
  constructor(selector, index = null) { this.selector = selector; this.index = index; }
  first() { return new Locator(this.selector, 0); }
  nth(index) { return new Locator(this.selector, index); }
  async evaluate(fn, arg) {
    const script = `const [selector,index,arg] = arguments;
      let nodes = [...document.querySelectorAll(selector.replaceAll(':visible',''))];
      if (selector.includes(':visible')) nodes = nodes.filter(n => !!(n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden'));
      const node = nodes[index ?? 0];
      if (!node) throw new Error('missing node');
      Promise.resolve((${fn.toString()})(node,arg)).then(v=>arguments[3]({value:v}),e=>arguments[3]({error:String(e)}));`;
    const result = await executeAsync(script, [this.selector, this.index, arg ?? null]);
    if (result.error) throw new Error(result.error);
    return result.value;
  }
  async count() {
    return execute(`let nodes=[...document.querySelectorAll(arguments[0].replaceAll(':visible',''))];
      if(arguments[0].includes(':visible')) nodes=nodes.filter(n=>!!(n.getClientRects().length && getComputedStyle(n).visibility!=='hidden'));
      return arguments[1]===null ? nodes.length : Number(nodes.length>arguments[1]);`, [this.selector, this.index]);
  }
  isVisible() { return this.evaluate(n => !!(n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden')); }
  innerText() { return this.evaluate(n => n.innerText); }
  inputValue() { return this.evaluate(n => n.value); }
  isChecked() { return this.evaluate(n => n.checked); }
}
try {
  const created = await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  session = created.sessionId;
  evidence.capabilities = created.capabilities;
  await request(`/session/${session}/url`, { url: 'https://example.com/' });
  const input = fixture({ url: 'https://example.com/' });
  const contract = { schema_version: 1, application_key: input.bundle.application.key, target_url: input.bundle.application.url,
    fields: [{ key: 'first_name', label: 'First name', selector: '#name', read: 'value' }],
    artifacts: [{ kind: 'resume', sha256: resumeHash, display_name: 'synthetic-resume.pdf', selector: '#resume' }],
    submit: { selector: '#submit', expected_text: 'Submit application' },
    receipt: { selectors: [{ selector: '#receipt', kind: 'ats_success_page' }], success_url_prefixes: ['https://example.com/confirmation/'] } };
  let resumeToken;
  for (const scenario of ['baseline', 'wrong_bytes', 'missing_bytes', 'changed_answer', 'changed_url', 'new_field', 'login', 'mfa', 'captcha', 'resumed']) {
    // Only synthetic in-memory File objects. Never read or transmit candidate files.
    await execute(`document.body.innerHTML='<h1>Career Ops synthetic Safari test</h1><label>First name<input id="name" value="Synthetic"></label><input id="resume" type="file"><button id="submit">Submit application</button>';
      history.replaceState({},'', '/');
      window.syntheticClicks=0; document.querySelector('#submit').onclick=()=>window.syntheticClicks++;
      const dt=new DataTransfer();dt.items.add(new File([arguments[0]],'synthetic-resume.pdf',{type:'application/pdf'}));document.querySelector('#resume').files=dt.files;`, [resumeBytes.toString()]);
    const mutations = {
      wrong_bytes: "const dt=new DataTransfer();dt.items.add(new File(['wrong bytes'],'synthetic-resume.pdf'));document.querySelector('#resume').files=dt.files;",
      missing_bytes: "document.querySelector('#resume').value='';document.querySelector('#resume').dataset.careerOpsFileName='synthetic-resume.pdf';",
      changed_answer: "document.querySelector('#name').value='Changed';",
      changed_url: "history.replaceState({},'', '/?changed=1');",
      new_field: "document.body.insertAdjacentHTML('beforeend','<input id=salary>');",
      login: "document.body.insertAdjacentHTML('beforeend','<input type=password>');",
      mfa: "document.body.insertAdjacentHTML('beforeend','<div>Verification code</div>');",
      captcha: "document.body.insertAdjacentHTML('beforeend','<div>CAPTCHA</div>');",
    };
    if (mutations[scenario]) await execute(mutations[scenario]);
    const url = await request(`/session/${session}/url`, null, 'GET');
    const page = { url: () => url, locator: selector => new Locator(selector) };
    const observation = await observeFinalReview(page, contract);
    const result = inspectApplicationObservation({ ...input, observation });
    resumeToken ??= result.resume_token;
    assert.equal(result.resume_token, resumeToken);
    assert.equal(result.applied_status_authorized, false);
    assert.equal(result.consequential_actions, 0);
    assert.equal(await execute('return window.syntheticClicks'), 0);
    if (['baseline', 'resumed'].includes(scenario)) assert.equal(result.decision, 'exact_final_review_observed');
    else assert.notEqual(result.decision, 'exact_final_review_observed');
    evidence.results.push({ scenario, result, observation });
  }
  evidence.status = 'PASS';
  evidence.limitations = ['Synthetic FileList injection; native file-picker and real ATS upload not tested',
    'Read-only Safari observer validation; packaged Chromium runner and existing Safari user profiles are not supported'];
} catch (error) {
  evidence.status = session ? 'FAIL' : 'BLOCKED';
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  if (session) await request(`/session/${session}`, {}, 'DELETE').catch(() => {});
  const json = JSON.stringify(evidence, null, 2);
  if (output) writeFileSync(output, json + '\n', { mode: 0o600 });
  console.log(json);
}
