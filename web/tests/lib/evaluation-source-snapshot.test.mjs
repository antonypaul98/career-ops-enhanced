import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureEvaluationSources, assertEvaluationSourcesCurrent } from '../../src/lib/evaluation-source-snapshot.mjs';
import { persistEvaluation } from '../../src/lib/evaluation-persist.mjs';

const payload = { company:'Fictional Co', role:'Engineer', score:2.5,
  note:'Synthetic only', postingUrl:'https://example.com/jobs/1', reportMarkdown:'# Synthetic report\n' };
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'evaluation-sources-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'modes'));
  fs.writeFileSync(path.join(root,'cv.md'),'Fictional Python engineer.\n');
  fs.writeFileSync(path.join(root,'modes/oferta.md'),'Fictional evaluation rules.\n');
  return {root, cv:path.join(root,'cv.md'), snapshot:captureEvaluationSources(root)};
}
function artifacts(root) {
  const walk=dir=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>
    e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]):[];
  return ['reports','batch'].flatMap(dir=>walk(path.join(root,dir)));
}
test('unchanged legacy CV is valid without requiring new authority files',t=>{
  const f=fixture(t);assert.doesNotThrow(()=>assertEvaluationSourcesCurrent(f.snapshot));
});

test('nested writing samples are captured and invalidate after changes', t => {
  const f = fixture(t);
  const nested = path.join(f.root, 'writing-samples', 'portfolio');
  fs.mkdirSync(nested, { recursive: true });
  const sample = path.join(nested, 'sample.md');
  fs.writeFileSync(sample, 'Synthetic writing sample.\n');
  const snapshot = captureEvaluationSources(f.root);
  assert.doesNotThrow(() => assertEvaluationSourcesCurrent(snapshot));
  fs.appendFileSync(sample, 'Changed synthetic sample.\n');
  assert.throws(() => assertEvaluationSourcesCurrent(snapshot), { code: 'EVALUATION_SOURCES_CHANGED' });
});
test('nested Git checkout in explicit writing samples stays source-tracked', t => {
  const f = fixture(t);
  const checkout = path.join(f.root, 'writing-samples', 'external');
  fs.mkdirSync(checkout, { recursive: true });
  fs.writeFileSync(path.join(checkout, '.git'), 'gitdir: /unrelated/worktree\n');
  const sample = path.join(checkout, 'sample.md');
  fs.writeFileSync(sample, 'PRIVATE_SYNTHETIC_MARKER');
  const snapshot = captureEvaluationSources(f.root);
  assert.doesNotThrow(() => assertEvaluationSourcesCurrent(snapshot));
  fs.appendFileSync(sample, 'Changed synthetic evidence.\n');
  assert.throws(() => assertEvaluationSourcesCurrent(snapshot), { code: 'EVALUATION_SOURCES_CHANGED' });
});

for(const change of ['content','deletion','replacement','optional-addition'])test(change+' invalidates sources without exposing facts',t=>{
  const f=fixture(t);
  if(change==='content')fs.appendFileSync(f.cv,'PRIVATE_SYNTHETIC_MARKER');
  if(change==='deletion')fs.unlinkSync(f.cv);
  if(change==='replacement'){const bytes=fs.readFileSync(f.cv);fs.renameSync(f.cv,f.cv+'.old');fs.writeFileSync(f.cv,bytes);}
  if(change==='optional-addition')fs.writeFileSync(path.join(f.root,'article-digest.md'),'PRIVATE_SYNTHETIC_MARKER');
  assert.throws(()=>assertEvaluationSourcesCurrent(f.snapshot),e=>e.code==='EVALUATION_SOURCES_CHANGED'&&!e.message.includes('PRIVATE_SYNTHETIC_MARKER'));
});
for(const stage of ['before-reservation','during-reservation','report-sync','addition-sync','before-merge'])test('stale sources at '+stage+' cannot queue a tracker addition',async t=>{
  const f=fixture(t);let reserved=0,released=0,merged=0,writes=0;
  const mutate=()=>fs.appendFileSync(f.cv,'Changed synthetic source.\n');
  if(stage==='before-reservation')mutate();
  await assert.rejects(persistEvaluation({root:f.root,payload,today:'2026-11-21',sourceSnapshot:f.snapshot},{
    reserveFn:async()=>{reserved++;if(stage==='during-reservation')mutate();return {num:'001',release:async()=>{released++;}};},
    fsOps:{open:async(...args)=>{const handle=await open(...args);const number=++writes;return {
      writeFile:(...params)=>handle.writeFile(...params),
      sync:async()=>{await handle.sync();if(stage===(number===1?'report-sync':'addition-sync'))mutate();},
      close:()=>handle.close(),
    };}},
    beforeMergeFn:async()=>{if(stage==='before-merge')mutate();},
    mergeFn:async()=>{merged++;},
  }),{code:'EVALUATION_SOURCES_CHANGED'});
  assert.equal(merged,0);assert.equal(released,reserved);assert.deepEqual(artifacts(f.root),[]);
});
test('cancellation during report sync cannot publish artifacts',async t=>{
  const f=fixture(t), controller=new AbortController();let merged=0,released=0;
  await assert.rejects(persistEvaluation({root:f.root,payload,today:'2026-11-21',sourceSnapshot:f.snapshot,signal:controller.signal},{
    reserveFn:async()=>({num:'002',release:async()=>{released++;}}),
    fsOps:{open:async(...args)=>{const h=await open(...args);return {writeFile:(...p)=>h.writeFile(...p),sync:async()=>{await h.sync();controller.abort();},close:()=>h.close()};}},
    mergeFn:async()=>{merged++;},
  }),{code:'ABORT_ERR'});
  assert.equal(merged,0);assert.equal(released,1);assert.deepEqual(artifacts(f.root),[]);
});
test('valid snapshot preserves real persistence and recoverable merge-failure semantics',async t=>{
  const f=fixture(t);let merged=0;
  const saved=await persistEvaluation({root:f.root,payload,today:'2026-11-21',sourceSnapshot:f.snapshot},{
    reserveFn:async()=>({num:'003',release:async()=>{}}),mergeFn:async()=>{merged++;},
  });
  assert.equal(merged,1);assert.equal(fs.readFileSync(path.join(f.root,saved.reportRelative),'utf8'),payload.reportMarkdown);
  await assert.rejects(persistEvaluation({root:f.root,payload,today:'2026-11-21',sourceSnapshot:f.snapshot},{
    reserveFn:async()=>({num:'004',release:async()=>{}}),mergeFn:async()=>{throw Error('Synthetic merge unavailable');},
  }),/Synthetic merge unavailable/);
  assert.equal(artifacts(f.root).length,4,'Both recoverable pairs stay intact');
});
