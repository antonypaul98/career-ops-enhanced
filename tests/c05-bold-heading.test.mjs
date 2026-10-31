import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as yaml from 'js-yaml';
import {loadResumeAuthority} from '../enhanced/resume-authority.mjs';
import {renderBoundResume} from '../enhanced/tailor-resume.mjs';
import {tailorBoundResume} from '../enhanced/evidence-tailor.mjs';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'c05-bold-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'config'));
 const lines=['**Client: Example Client, Test City Jan 2021 – Feb 2023**','','**Data Engineer**','','- Built Python pipelines.'];
 const fact=(id,text,line)=>({id,text,review_status:'verified',evidence:{source:'cv.md',line,quote:lines[line-1]}});
 const h=fact('client',lines[0].slice(2,-2),1);h.label=h.text;delete h.text;h.facts=[fact('role','Data Engineer',3),fact('dates','Jan 2021 – Feb 2023',1),fact('work','Built Python pipelines.',5)];
 const profile={schema_version:1,candidate:{},summary:[],skills:[],education:[],certifications:[],projects:[],experiences:[h]};
 const save=()=>{fs.writeFileSync(path.join(root,'cv.md'),lines.join('\n'));fs.writeFileSync(path.join(root,'data/career-profile.yml'),yaml.dump(profile));};save();
 fs.writeFileSync(path.join(root,'config/profile.yml'),'name: Synthetic Candidate\nemail: synthetic@example.com\n');
 const proposal={persona_id:'general',payload:{candidate:{name:'Synthetic Candidate'},experience:[{company:'Client: Example Client, Test City',role:'Data Engineer',dates:'Jan 2021 – Feb 2023',bullets:['Built Python pipelines.']}]},bindings:{'/candidate/name':'config:name','/experience/0/company':'master_profile:client','/experience/0/role':'master_profile:role','/experience/0/dates':'master_profile:dates','/experience/0/bullets/0':'master_profile:work'}};
 const authority=()=>loadResumeAuthority({root,persona:{id:'general'}});
 const run=()=>tailorBoundResume({proposal,authority:authority()});return {profile,lines,save,proposal,authority,run,root};
}
test('reviewed bold client/date header and separate role retain exact client attribution',t=>{const f=fixture(t);const r=f.run();assert.equal(r.excluded.filter(e=>e.path).length,0);assert.equal(r.payload.experience[0].company,'Client: Example Client, Test City');assert.equal(r.bindings['/experience/0/role'].context_ref,'master_profile:client');});
for(const field of ['role','dates'])test('unreviewed '+field+' cannot be authorized by the header',t=>{const f=fixture(t);f.profile.experiences[0].facts.find(r=>r.id===field).review_status='needs_review';f.save();assert.ok(f.run().excluded.some(e=>e.path));});
test('client label cannot be silently stripped',t=>{const f=fixture(t);f.proposal.payload.experience[0].company='Example Client';assert.ok(f.run().excluded.some(e=>e.path));});
test('stale role source is rejected',t=>{const f=fixture(t);f.lines[2]='**Different Role**';f.save();assert.ok(f.run().excluded.some(e=>e.path));});
test('role words cannot become dates or achievement',t=>{const f=fixture(t);f.proposal.payload.experience[0].dates='Data Engineer';f.proposal.bindings['/experience/0/dates']='master_profile:role';assert.ok(f.run().excluded.some(e=>e.path));});
test('unreviewed parent yields no career authority',t=>{const f=fixture(t);f.profile.experiences[0].review_status='needs_review';f.save();assert.equal(f.authority().records.filter(r=>r.kind!=='identity').length,0);});
test('nested identity is not silently imported as candidate experience',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,'config/profile.yml'),'candidate:\n  full_name: Synthetic Nested Name\n  title: Aspirational Engineer\n');assert.equal(f.authority().records.filter(r=>r.kind==='identity').length,0);});

test('compatible reviewed heading renders through the existing C05 HTML renderer',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.root,'output'));
 const output=path.join(f.root,'output','synthetic');
 renderBoundResume({root:f.root,result:f.run(),output});
 const html=fs.readFileSync(output+'.html','utf8');
 assert.match(html,/Client: Example Client, Test City/);assert.match(html,/Data Engineer/);
 assert.ok(JSON.parse(fs.readFileSync(output+'.evidence.json')).snapshot.authority_sha256);
});
