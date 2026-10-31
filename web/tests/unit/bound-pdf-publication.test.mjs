import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { fixture } from '../helpers/bound-cv-fixture.mjs';
import { prepareBoundCv, renderDashboardBoundCv } from '../../src/lib/bound-cv.mjs';
import { renderAndMarkPdf } from '../../src/lib/pdf-render.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function setup(t) {
 const f = fixture(); t.after(() => f.close());
 for (const name of ['enhanced','generate-pdf.mjs']) fs.symlinkSync(path.resolve('..',name),path.join(f.root,name));
 fs.mkdirSync(path.join(f.root,'scratch'));
 f.paths={html:path.join(f.root,'scratch/cv-web-001.html'),finalPdf:path.join(f.root,'output/cv-synthetic.pdf')};
 f.prepared=await prepareBoundCv(f.root,'jds/job.md');
 await renderDashboardBoundCv({root:f.root,prepared:f.prepared,proposal:f.proposal,html:f.paths.html});
 return f;
}
for (const mode of ['changed','deleted','replaced','unreviewed','report','cancel','bad-pdf','worker-error','audit-tamper','valid']) {
 test('PDF publication: '+mode,async t=>{
  const f=await setup(t);const ac=new AbortController();let marks=0;
  if(mode==='audit-tamper'){const audit=JSON.parse(fs.readFileSync(f.paths.html+'.evidence.json'));audit.render.artifact_sha256='0'.repeat(64);fs.writeFileSync(f.paths.html+'.evidence.json',JSON.stringify(audit));}
  const before=fs.readFileSync(path.join(f.root,'cv.md'));
  const spawnFn=(_exec,args)=>{
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>true;
   queueMicrotask(()=>{
    if(args[0].endsWith('generate-pdf.mjs')) {
     assert.ok(args.includes('--defer-manifest'));
     assert.equal(fs.existsSync(path.join(f.root,'data/pdf-index.tsv')),false);
     fs.writeFileSync(args[2],mode==='bad-pdf'?'not a PDF':'%PDF-1.7\nsynthetic renderer bytes');
     if(mode==='changed')fs.appendFileSync(path.join(f.root,'cv.md'),'\nchanged');
     if(mode==='deleted')fs.unlinkSync(path.join(f.root,'cv.md'));
     if(mode==='replaced'){fs.unlinkSync(path.join(f.root,'cv.md'));fs.writeFileSync(path.join(f.root,'cv.md'),'replacement');}
     if(mode==='unreviewed'){f.profile.summary[0].review_status='needs_review';f.save();}
     if(mode==='report')fs.appendFileSync(path.join(f.root,'jds/job.md'),'\nchanged');
     if(mode==='cancel')ac.abort();
    }else {
     marks++;
     const index=fs.readFileSync(path.join(f.root,'data/pdf-index.tsv'),'utf8');
     const row=index.split('\n').find(l=>l.startsWith('001\t'));assert.ok(row);
     const pdf=path.join(f.root,row.split('\t')[1]);const evidence=JSON.parse(fs.readFileSync(pdf+'.evidence.json'));
     assert.equal(evidence.pdf_sha256,hash(fs.readFileSync(pdf)));
     assert.equal(evidence.render.artifact_sha256,hash(fs.readFileSync(path.join(path.dirname(pdf),'source.html'))));
     child.stdout.emit('data','{"changed":true}');
    }
    child.emit('close',mode==='worker-error'?1:0);
   });return child;
  };
  const result=await renderAndMarkPdf({spawnFn,execPath:process.execPath,root:f.root,pdfPaths:f.paths,format:'letter',reportNum:'001',signal:ac.signal,evidencePath:f.paths.html+'.evidence.json',prepared:f.prepared});
  if(mode==='valid'){assert.equal(result.kind,'rendered',JSON.stringify(result));assert.equal(marks,1);assert.deepEqual(fs.readFileSync(path.join(f.root,'cv.md')),before);}
  else {assert.equal(result.kind,'render-failed',JSON.stringify(result));assert.equal(marks,0);assert.deepEqual(fs.readdirSync(path.join(f.root,'output')),[]);assert.equal(fs.existsSync(path.join(f.root,'data/pdf-index.tsv')),false);}
  assert.equal(fs.existsSync(path.join(f.root,'data/applications.md')),false);
  assert.equal(fs.readdirSync(path.join(f.root,'scratch')).some(x=>x.startsWith('.pdf-stage')),false);
 });
}
