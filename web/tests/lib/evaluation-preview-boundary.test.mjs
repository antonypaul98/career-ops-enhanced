import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EVALUATION_ONLY_MARKER,assertNotEvaluationOnly} from '../../src/lib/evaluation-only-boundary.mjs';
import {persistEvaluation} from '../../src/lib/evaluation-persist.mjs';
import {prepareBoundCv} from '../../src/lib/bound-cv.mjs';
import {readSubmissionApprovals} from '../../src/lib/submission-approvals.mjs';
import {prepareOpenCodeReadOnlyLaunch} from '../../src/lib/opencode-readonly.mjs';
import {prepareApprovedSubmission,executeApprovedSubmission} from '../../../enhanced/approved-application-submission.mjs';

function root(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'career-preview-boundary-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
test('copied preview text and renamed preview JSON cannot enter tracker or PDF flows',async t=>{
 const r=root(t);fs.mkdirSync(path.join(r,'reports'));fs.symlinkSync(fileURLToPath(new URL('../../../enhanced',import.meta.url)),path.join(r,'enhanced'),'junction');
 for(const text of [EVALUATION_ONLY_MARKER+'\n# Evaluation: Synthetic',JSON.stringify({status:'evaluation-only',reportMarkdown:'Synthetic'})]){
  const file=path.join(r,'reports','001-synthetic.md');fs.writeFileSync(file,text);
  await assert.rejects(prepareBoundCv(r,file),/Evaluation-only/);
  let reserved=false;
  await assert.rejects(persistEvaluation({root:r,payload:{reportMarkdown:text}}, {reserveFn:()=>{reserved=true;}}),/Evaluation-only/);
  assert.equal(reserved,false);assert.equal(fs.existsSync(path.join(r,'data/applications.md')),false);
 }
});
test('renaming preview as a browser approval cannot promote it, even with fabricated approval',async t=>{
 const r=root(t);fs.mkdirSync(path.join(r,'data/private'),{recursive:true});
 const result={type:'preview-report',status:'evaluation-only',submission_allowed:false,
  readiness_input:{application_bundle:{application:{company:'Synthetic'}}},submit_approval:{approved:true}};
 fs.writeFileSync(path.join(r,'data/private','test-browser-approved.json'),JSON.stringify(result));
 const views=readSubmissionApprovals(r);assert.equal(views.length,1);assert.match(views[0].error,/Evaluation-only/);
 assert.equal(prepareApprovedSubmission(result).reason,'demo_submission_disabled');let called=false;
 await executeApprovedSubmission(result,()=>{called=true;});assert.equal(called,false);
});
test('normal reports and existing non-submitting demo flags keep their original behavior',()=>{
 assert.doesNotThrow(()=>assertNotEvaluationOnly('# Evaluation: ordinary report'));
 assert.doesNotThrow(()=>assertNotEvaluationOnly({demo_only:true,submission_allowed:false}));
});
test('strict OpenCode launch strips secrets and verifies zero tools, exact model and isolated config',t=>{
 const r=root(t);let calls=0;
 const p=prepareOpenCodeReadOnlyLaunch('synthetic',{cwd:r,streaming:true,capabilities:{writes:false,network:false,tools:false},
  env:{CAREER_OPS_PREVIEW_TOKEN:'do-not-forward',OPENAI_API_KEY:'do-not-forward',OPENCODE_CONFIG_CONTENT:'untrusted'},
  spawnSyncFn:(bin,args,opts)=>{
   calls++;assert.equal(opts.env.CAREER_OPS_PREVIEW_TOKEN,undefined);assert.equal(opts.env.OPENAI_API_KEY,undefined);
   if(args[0]==='--version')return {status:0,stdout:'1.19.4'};
   assert.notEqual(opts.cwd,r);assert.ok(opts.env.XDG_CONFIG_HOME);assert.ok(opts.env.XDG_CACHE_HOME);
   const c=JSON.parse(fs.readFileSync(opts.env.OPENCODE_CONFIG,'utf8'));
   assert.equal(c.model,'opencode/glm-5.3-flash-free');assert.equal(c.share,'disabled');
   assert.ok(Object.values(c.permission).every(v=>v==='deny'));
   return {status:0,stdout:JSON.stringify(args[1]==='config'?c:{permission:c.permission,model:{providerID:'opencode',modelID:'glm-5.3-flash-free'}})};
  }});
 assert.equal(calls,3);const config=p.configPath;p.cleanup();assert.equal(fs.existsSync(config),false);
});
test('unexpected plugin/provider config prevents any strict worker launch',t=>{
 const r=root(t);
 assert.throws(()=>prepareOpenCodeReadOnlyLaunch('synthetic',{cwd:r,streaming:true,capabilities:{writes:false,network:false,tools:false},
  spawnSyncFn:(bin,args,opts)=>{
   if(args[0]==='--version')return {status:0,stdout:'1.19.4'};
   const c=JSON.parse(fs.readFileSync(opts.env.OPENCODE_CONFIG,'utf8'));
   return {status:0,stdout:JSON.stringify(args[1]==='config'?{...c,mcp:{unsafe:{}}}:{permission:c.permission,model:{providerID:'opencode',modelID:'glm-5.3-flash-free'}})};
  }}),/Unexpected provider/);
});
test('single-request hook rejects another inference and any paid model before dispatch',()=>{
 const observer=new URL('../../src/lib/opencode-quota-observer.mjs',import.meta.url).href;
 for(const paid of [false,true]) {
  const call={agent:'career-ops-readonly',model:{providerID:'opencode',id:paid?'paid-model':'glm-5.3-flash-free'}};
  const code=`const p=await (await import(${JSON.stringify(observer)})).default();await p['chat.params'](${JSON.stringify(call)});console.log('FIRST_DISPATCH');await p['chat.params'](${JSON.stringify(call)});console.log('SECOND_DISPATCH');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CAREER_OPS_SINGLE_REQUEST:'1'},encoding:'utf8',timeout:5000});
  assert.equal(result.status,78);assert.doesNotMatch(result.stdout,/SECOND_DISPATCH/);
  assert.equal(result.stdout.includes('FIRST_DISPATCH'),!paid);
 }
});
for(const reason of ['free_tier_limit','provider_error'])test('strict worker exits on first '+reason+' retry before a second attempt',()=>{
 const observer=new URL('../../src/lib/opencode-quota-observer.mjs',import.meta.url).href;
 const code=`const p=await (await import(${JSON.stringify(observer)})).default();await p.event({event:{type:'session.status',properties:{status:{type:'retry',message:'failure',action:{reason:${JSON.stringify(reason)}}}}}});console.log('SECOND_ATTEMPT');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CAREER_OPS_SINGLE_REQUEST:'1'},encoding:'utf8',timeout:5000});
 assert.equal(result.status,78);assert.doesNotMatch(result.stdout,/SECOND_ATTEMPT/);assert.equal(JSON.parse(result.stdout).type,'error');
});
