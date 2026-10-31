// Opt-in actual Next HTTP route acceptance. No external model is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fixture } from '../helpers/bound-cv-fixture.mjs';

test('actual dashboard C05 route', {skip:!process.env.C05_ROUTE_ACCEPTANCE}, async t=>{
 const f=fixture(); f.root=fs.realpathSync(f.root); const code=path.resolve('..'); fs.mkdirSync(path.join(f.root,'reports')); 
 for(const entry of fs.readdirSync(code,{withFileTypes:true})) {
   if(entry.name.startsWith('.')||entry.name==='web'||fs.existsSync(path.join(f.root,entry.name)))continue;
   if(entry.name==='templates'||entry.name==='cv-templates.mjs')fs.cpSync(path.join(code,entry.name),path.join(f.root,entry.name),{recursive:true});
   else fs.symlinkSync(path.join(code,entry.name),path.join(f.root,entry.name));
 }
 fs.mkdirSync(path.join(f.root,'reports'),{recursive:true});
 fs.writeFileSync(path.join(f.root,'reports/001-synthetic-2026-10-30.md'),'# Evaluation: Synthetic\n## Job Description\nPython data pipelines');
 fs.mkdirSync(path.join(f.root,'bin'));
 const bin=path.join(f.root,'bin','claude');
 fs.writeFileSync(bin,`#!${process.execPath}\nimport fs from 'node:fs';const mode=fs.readFileSync('behavior','utf8');if(process.argv.includes('--version')){console.log('synthetic');process.exit(0)};if(mode==='cancel'){fs.writeFileSync('worker.pid',String(process.pid));console.log(JSON.stringify({type:'system',subtype:'init'}));setInterval(()=>{},1000)}else {let proposal=JSON.parse(fs.readFileSync('proposal.json'));if(mode==='unsupported')proposal.payload.summary='Invented 900% growth';if(mode==='stale')fs.appendFileSync('cv.md','\\nchanged source');console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{text:'<<cv-proposal>>\\n'+JSON.stringify(proposal)+'\\n<</cv-proposal>>'}}}));if(mode==='provider-error')console.log(JSON.stringify({type:'result',is_error:true,error:'Synthetic provider failure'}));}`,{mode:0o700});
 fs.writeFileSync(path.join(f.root,'behavior'),'valid');
 const smoke=spawnSync(bin,['--version'],{cwd:f.root,encoding:'utf8'});assert.equal(smoke.status,0,smoke.stderr);
 f.proposal.payload.page_format='letter';fs.writeFileSync(path.join(f.root,'proposal.json'),JSON.stringify(f.proposal));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{env:{...process.env,CAREER_OPS_ROOT:f.root,BUILD_DIST:'.next-c05-check',PATH:path.join(f.root,'bin')+path.delimiter+process.env.PATH},stdio:['ignore','pipe','pipe']});
 let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 t.after(async()=>{server.kill();await new Promise(r=>server.once('close',r));f.close();});
 const url=`http://127.0.0.1:${port}/api/run`;
 for(let i=0;i<100;i++){try{await fetch(url);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const request=()=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'pdf',input:'001',cliId:'claude'})});
 const artifacts=()=>fs.readdirSync(path.join(f.root,'output'),{recursive:true}).filter(x=>x.endsWith('.pdf'));
 await t.test('missing authority returns 409 without artifacts',async()=>{
  const file=path.join(f.root,'data/career-profile.yml');const original=fs.readFileSync(file);fs.unlinkSync(file);
  const r=await request();assert.equal(r.status,409);fs.writeFileSync(file,original);assert.deepEqual(artifacts(),[]);
 });
 await t.test('unreviewed authority cannot generate output',async()=>{
  f.profile.summary[0].review_status='needs_review';f.save();fs.writeFileSync(path.join(f.root,'behavior'),'valid');
  const events=await (await request()).text();assert.match(events,/unsupported/);assert.deepEqual(artifacts(),[]);
  f.profile.summary[0].review_status='verified';f.save();
 });
 await t.test('conflicting authority fails preflight',async()=>{
  const cv=fs.readFileSync(path.join(f.root,'cv.md'));fs.appendFileSync(path.join(f.root,'cv.md'),'\nI have no Python experience.');
  const r=await request();assert.equal(r.status,409);assert.deepEqual(artifacts(),[]);fs.writeFileSync(path.join(f.root,'cv.md'),cv);
 });
 for(const mode of ['unsupported','provider-error','stale'])await t.test(mode+' cannot persist a PDF or tracker',async()=>{
  fs.writeFileSync(path.join(f.root,'behavior'),mode);const cv=fs.readFileSync(path.join(f.root,'cv.md'));
  const r=await request();const events=await r.text();fs.writeFileSync(path.join(f.root,'cv.md'),cv);
  assert.match(events,/"type":"error"/);assert.match(events,mode==='unsupported'?/unsupported/:mode==='stale'?/changed/:/Synthetic provider failure/);assert.doesNotMatch(events,/"type":"done"/);assert.deepEqual(artifacts(),[]);assert.equal(fs.existsSync(path.join(f.root,'data/applications.md')),false);
 });
 await t.test('disconnect cancels the worker without persistence',async()=>{
  fs.writeFileSync(path.join(f.root,'behavior'),'cancel');const r=await request();
  const reader=r.body.getReader();await reader.read();await reader.cancel();
  const pid=Number(fs.readFileSync(path.join(f.root,'worker.pid'),'utf8'));
  let alive=true;for(let i=0;i<40;i++){try{process.kill(pid,0);}catch{alive=false;break;}await new Promise(r=>setTimeout(r,50));}
  assert.equal(alive,false);assert.deepEqual(artifacts(),[]);assert.equal(fs.existsSync(path.join(f.root,'data/applications.md')),false);
 });
 await t.test('valid proposal renders a real PDF through HTTP route',async()=>{
  fs.writeFileSync(path.join(f.root,'behavior'),'valid');const r=await request();const events=await r.text();
  assert.match(events,/"type":"done"/,events+'\n'+logs);assert.equal(artifacts().length,1);
  const evidence=JSON.parse(fs.readFileSync(path.join(f.root,'output',artifacts()[0]+'.evidence.json'),'utf8'));assert.ok(evidence.snapshot.authority_sha256);assert.match(evidence.pdf_sha256,/^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(f.root,'output',artifacts()[0])).subarray(0,4).toString(),'%PDF');
 });
});
