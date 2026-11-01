// Test-only bridge: a dashboard-generated synthetic PDF through the real browser
// runner and canonical lifecycle writer. All HTTP requests are intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { fixture } from './submission-browser-fixture.mjs';
import { canonicalJson } from '../../enhanced/application-approval.mjs';
import { runBrowserSubmission, reserveSubmissionAttempt } from '../../submit-application-browser.mjs';
import { createExactSubmissionReview, createExactSubmissionApproval, SUBMIT_CONFIRMATION_STATEMENT,
  createAppliedLifecycleDraftFromReceipt } from '../../enhanced/approved-application-submission.mjs';
import { confirmLifecycleEvent, LIFECYCLE_CONFIRMATION_STATEMENT } from '../../enhanced/application-lifecycle.mjs';

export async function controlledSubmissionAcceptance({ pdfBytes, url }) {
  const root=fs.mkdtempSync(join(tmpdir(),'synthetic-full-workflow-'));
  const browser=await chromium.launch({headless:process.env.CAREER_OPS_HEADED_TEST!=='1'});
  try {
    const input=fixture({url,artifactBytes:pdfBytes});
    delete input.submit_approval;
    const expectedHash=input.bundle.artifacts[0].sha256;
    input.browser_contract={schema_version:1,application_key:input.bundle.application.key,target_url:url,
      fields:[{key:'first_name',label:'First name',selector:'#name',read:'value'}],
      artifacts:[{kind:'resume',sha256:expectedHash,selector:'#resume',display_name:'synthetic-resume.pdf'}],
      submit:{selector:'#submit',expected_text:'Submit application'},
      receipt:{selectors:[{selector:'#receipt',kind:'ats_success_page'}],success_url_prefixes:[new URL('/confirmation/',url).href]}};
    const context=await browser.newContext();
    await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:
      '<label>First name<input id="name" value="Synthetic"></label><input id="resume" type="file"><button id="submit">Submit application</button>'}));
    const page=await context.newPage();await page.goto(url);
    await page.locator('#resume').setInputFiles({name:'synthetic-resume.pdf',mimeType:'application/pdf',buffer:pdfBytes});
    let clicks=0;await page.exposeFunction('syntheticClicked',()=>clicks++);
    const options={launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}}),
      reserveSubmission:(digest,posting)=>reserveSubmissionAttempt(join(root,'claims'),digest,posting)};
    const inspected=await runBrowserSubmission(input,{...options,mode:'inspect'});
    assert.equal(inspected.decision,'exact_final_review_observed');
    assert.equal(inspected.observation.attached_artifacts[0].sha256,expectedHash);
    assert.equal(clicks,0);input.observation=inspected.observation;
    assert.equal((await runBrowserSubmission(input,{...options,mode:'submit'})).reason,'submit_approval_invalid_or_stale');
    const review=createExactSubmissionReview(input);
    input.submit_approval=createExactSubmissionApproval({...input,confirmation:{confirmed:true,
      statement:SUBMIT_CONFIRMATION_STATEMENT,challenge_digest:review.challenge_digest,approved_at:new Date().toISOString()}});
    await page.locator('#submit').evaluate(node=>node.onclick=()=>{
      window.syntheticClicked();history.replaceState({},'','/confirmation/SYNTHETIC-42');
      document.body.innerHTML='<main id="receipt">Application received. SYNTHETIC-42.</main>';
    });
    const result=await runBrowserSubmission(input,{...options,mode:'submit',receiptSource:'data/receipt.json'});
    assert.equal(result.verified?.decision,'verified_receipt');assert.equal(clicks,1);
    assert.equal(result.applied_written,false);
    fs.mkdirSync(join(root,'data'));fs.mkdirSync(join(root,'output'));
    fs.writeFileSync(join(root,'output/synthetic-resume.pdf'),pdfBytes);
    fs.writeFileSync(join(root,'data/receipt.json'),canonicalJson(result.receipt.evidence));
    const tracker=join(root,'data/applications.md');
    const original='# Synthetic tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n'+
      `| 42 | 2026-01-01 | Synthetic Acme | Data Engineer | 4/5 | Evaluated | — | — | — | ${url} |\n`;
    fs.writeFileSync(tracker,original);
    const draft=createAppliedLifecycleDraftFromReceipt({verified:result.verified,bundle:input.bundle,tracker_row:42});
    const record=event=>{
      fs.writeFileSync(join(root,'data/event.json'),JSON.stringify(event));
      return spawnSync(process.execPath,[fileURLToPath(new URL('../../set-status.mjs',import.meta.url)),
        '--row','42','Applied','--lifecycle-event','data/event.json','--json'],{encoding:'utf8',
        env:{...process.env,CAREER_OPS_ROOT:root,CAREER_OPS_TRACKER:tracker}});
    };
    assert.notEqual(record(draft).status,0);assert.equal(fs.readFileSync(tracker,'utf8'),original);
    const event=confirmLifecycleEvent(draft,{confirmed:true,event_digest:draft.event_digest,
      statement:LIFECYCLE_CONFIRMATION_STATEMENT,confirmed_at:new Date().toISOString()});
    const first=record(event);assert.equal(first.status,0,first.stdout+first.stderr);
    const saved=fs.readFileSync(tracker,'utf8');assert.match(saved,/Applied/);
    const again=record(event);assert.equal(again.status,0,again.stdout+again.stderr);
    assert.equal(JSON.parse(again.stdout).changed,false);assert.equal(fs.readFileSync(tracker,'utf8'),saved);
    return {pdf_sha256:expectedHash,inspect:'exact',synthetic_receipt:'verified',tracker:'idempotent',external_requests:0};
  } finally {await browser.close();fs.rmSync(root,{recursive:true,force:true});}
}
