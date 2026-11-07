import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import * as yaml from 'js-yaml';
import { createBoundCvFilter, prepareBoundCv, renderDashboardBoundCv } from '../../src/lib/bound-cv.mjs';
const JD = '## Job Description\nPython data pipelines';
import {fixture} from '../helpers/bound-cv-fixture.mjs';

async function setup(t) {
 const f=fixture(); t.after(()=>f.close());
 symlinkSync(resolve('../enhanced'),join(f.root,'enhanced'));
 mkdirSync(join(f.root,'scratch'));
 f.html=join(f.root,'scratch','cv.html');
 f.prepared=await prepareBoundCv(f.root,'jds/job.md');
 return f;
}
const run=f=>renderDashboardBoundCv({root:f.root,prepared:f.prepared,proposal:f.proposal,html:f.html});
test('route boundary: unsupported achievement fails before artifacts',async t=>{
 const f=await setup(t);f.proposal.payload.summary='Invented 900% revenue growth';
 await assert.rejects(run(f),/unsupported/);assert.equal(existsSync(f.html),false);
 assert.equal(existsSync(join(f.root,'data/applications.md')),false);
});
test('route boundary: missing authority fails before worker/output',async t=>{
 const f=await setup(t);rmSync(join(f.root,'data/career-profile.yml'));
 await assert.rejects(prepareBoundCv(f.root,'jds/job.md'));assert.equal(existsSync(f.html),false);
});
test('route boundary: unreviewed facts cannot produce HTML',async t=>{
 const f=await setup(t);f.profile.summary[0].review_status='needs_review';f.save();
 f.prepared=await prepareBoundCv(f.root,'jds/job.md');
 await assert.rejects(run(f),/unsupported/);assert.equal(existsSync(f.html),false);
});
test('route boundary: source drift rejects the proposal',async t=>{
 const f=await setup(t);writeFileSync(join(f.root,'cv.md'),'changed');
 await assert.rejects(run(f),/changed/);assert.equal(existsSync(f.html),false);
});
test('route boundary: pre-cancelled run writes nothing',async t=>{
 const f=await setup(t);const ac=new AbortController();ac.abort();
 await assert.rejects(renderDashboardBoundCv({root:f.root,prepared:f.prepared,proposal:f.proposal,html:f.html,signal:ac.signal}),/cancelled/);
 assert.equal(existsSync(f.html),false);
});
test('route boundary: cancellation stops an active renderer and publishes nothing',async t=>{
 const f=await setup(t);const ac=new AbortController();let child;
 await assert.rejects(renderDashboardBoundCv({root:f.root,prepared:f.prepared,proposal:f.proposal,html:f.html,signal:ac.signal},{spawnFn:()=>{
  child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:process.platform!=='win32',stdio:['ignore','ignore','pipe']});setTimeout(()=>ac.abort(),30);return child;
 }}),/cancelled/);
 assert.ok(child.exitCode!==null||child.signalCode);assert.equal(existsSync(f.html),false);
});
test('route boundary: valid proposal uses real C05 renderer and preserves evidence',async t=>{
 const f=await setup(t);await run(f);
 assert.match(readFileSync(f.html,'utf8'),/Built Python ETL pipelines/);
 const audit=JSON.parse(readFileSync(f.html+'.evidence.json','utf8'));
 assert.equal(audit.snapshot.authority_sha256,f.prepared.authority.snapshot.authority_sha256);
 assert.equal(existsSync(join(f.root,'data/applications.md')),false);
});
test('route wiring cannot accept raw HTML and tracks cancellable C05 before PDF',()=>{
 const source=readFileSync(new URL('../../src/app/api/run/route.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/writeCvHtml|saveCv\(/);
 assert.match(source,/pdfRenderPromise = \(async/);
 assert.ok(source.indexOf('await renderDashboardBoundCv')<source.indexOf('await renderPdf(paths'));
 const filter=createBoundCvFilter();filter.push('<<cv-html>>\n<html>fabricated</html>\n<</cv-html>>');assert.equal(filter.result().ok,false);
});
test('proposal parser rejects duplicates and accepts only structured C05 output',()=>{
 const text='<<cv-proposal>>\n'+JSON.stringify({persona_id:'general',payload:{page_format:'letter'},bindings:{}})+'\n<</cv-proposal>>';
 const f=createBoundCvFilter();f.push(text);assert.equal(f.result().ok,true);
 f.push('\n'+text);assert.equal(f.result().ok,false);
});

test('route boundary: source changed while rendering never publishes HTML',async t=>{
 const f=await setup(t);
 await assert.rejects(renderDashboardBoundCv({root:f.root,prepared:f.prepared,proposal:f.proposal,html:f.html},{spawnFn:(...args)=>{
  const child=spawn(...args);child.once('spawn',()=>writeFileSync(join(f.root,'cv.md'),'changed during render'));return child;
 }}),/changed/);
 assert.equal(existsSync(f.html),false);assert.equal(existsSync(f.html+'.evidence.json'),false);
});
