import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const wd = 'https://acme.wd12.myworkdayjobs.com/careers/job/';
const config = { always_allow:['United States'], allow:['United States','US','Remote'] };
const guarded = buildLocationFilter({...config, require_us_evidence:true});

test('remote title cannot substitute for affirmative US location evidence',()=>{
  for (const location of ['Berlin, Germany','London, UK','Montréal, Quebec, Canada','Dublin, Ireland','India','Georgia','Washington']) {
    for (const title of ['Data Engineer - Remote','Platform Engineer (Remote)']) {
      assert.equal(buildLocationFilter({allow:['United States']})(location,'',title),true,'legacy remote rescue stays unchanged');
      assert.equal(guarded(location,'',title),false,`${location}: ${title}`);
    }
  }
});

test('country, contextual state and DC evidence pass while unknown abbreviations do not',()=>{
  const evidenceOnly = buildLocationFilter({require_us_evidence:true});
  for (const location of ['United States','Remote - USA','U.S.','US (Remote)','Austin, TX',
    'Dublin OH','Portland, OR','Boston, MA (Hybrid)','New Mexico','Washington State',
    'Washington, DC','District of Columbia','Atlanta, Georgia','New York']) {
    assert.equal(evidenceOnly(location),true,location);
  }
  for (const location of ['CA','IN','OR','ME','GA','DC','Georgia','Washington','New York, UK',
    'Remote, Belgium or France','United States or Canada','Anywhere in the US','Outside US','Non-US','Montréal']) {
    assert.equal(evidenceOnly(location,'','Engineer - Remote'),false,location);
  }
  for (const location of ['Canada, United States','United Kingdom, United States','Canada CA',
    'Paris, France, US','London, UK, New York','Remote - IN','Remote in DE','Hybrid - CA','Work from home, CA',
    'Fully remote, CA','100% remote - IN','Fully remote in DE','Partially hybrid, CA']) {
    assert.equal(evidenceOnly(location,'','Engineer - Remote'),false,location);
  }
  assert.equal(evidenceOnly('Albuquerque, New Mexico, United States'),true,'New Mexico is US evidence, not Mexico');
});

test('missing, malformed, remote-only and global locations fail closed even without allow tiers',()=>{
  const f=buildLocationFilter({require_us_evidence:true});
  for (const location of ['', '  ', null, undefined, 42, {}, 'Remote','Hybrid','N/A','5 Locations','Worldwide','Global']) {
    assert.equal(f(location,'','Engineer (Remote)'),false,JSON.stringify(location));
  }
});

test('only recognized HTTPS Workday location hints can fill unspecified location',()=>{
  const f=buildLocationFilter({require_us_evidence:true});
  for (const location of ['',null,'5 Locations','Remote']) {
    assert.equal(f(location,wd+'Dublin-OH/Engineer_R1'),true);
    assert.equal(f(location,wd+'New-Mexico/Engineer_R1'),true);
    assert.equal(f(location,wd+'Hyderabad-India/Engineer_R1','Engineer - Remote'),false);
  }
  for (const url of [wd+'US-Remote-Engineer_R1',wd+'Engineer_R1?location=United%20States',
    'https://usa.wd12.myworkdayjobs.com/careers/job/Engineer_R1',
    'https://example.com/job/United-States/Engineer_R1',
    'https://acme.myworkdayjobs.com.evil.example/job/United-States/Engineer_R1',
    wd.replace('https:','http:')+'Dublin-OH/Engineer_R1',
    wd.replace('https://','https://user@')+'Dublin-OH/Engineer_R1',
    wd+'Remote/US-Data-Engineer_R1','not a URL']) {
    assert.equal(f('',url,'US Engineer (Remote)'),false,url);
  }
  assert.equal(f('Berlin, Germany',wd+'New-York-NY/Engineer_R1','Engineer - Remote'),false);
  assert.equal(f('Canada',wd+'United-States/Engineer_R1','Engineer (Remote)'),false);
});

test('US evidence is an additional gate; existing block/allow priority remains',()=>{
  assert.equal(buildLocationFilter({require_us_evidence:true,always_allow:['Remote']})('Remote'),false);
  assert.equal(buildLocationFilter({require_us_evidence:true,always_allow:['United States'],block_hard:['Texas']})('Austin, Texas, United States'),false);
  assert.equal(buildLocationFilter({require_us_evidence:true,block:['Austin']})('Austin, TX'),false);
  assert.equal(buildLocationFilter({require_us_evidence:true,allow:['Boston']})('Austin, TX'),false);
  assert.equal(buildLocationFilter({require_us_evidence:true,always_allow:['United States'],block:['Dublin']})('Dublin, OH'),true);
});

test('omitted and false option preserve all legacy results; true only narrows them',()=>{
  for (const filters of [{}, {strict:true}, config, {allow:['US']}, {always_allow:['Remote'],block:['India']}, {block_hard:['Germany']}]) {
    const base=buildLocationFilter(filters), off=buildLocationFilter({...filters,require_us_evidence:false});
    const on=buildLocationFilter({...filters,require_us_evidence:true});
    for (const location of ['',null,'Remote','Berlin, Germany','United States','Austin, TX','Dublin OH']) {
      for (const title of ['Engineer','Engineer - Remote','Engineer (Remote)','Non-Remote Engineer']) {
        assert.equal(off(location,'',title),base(location,'',title));
        if(on(location,'',title)) assert.equal(base(location,'',title),true,'opt-in must never broaden the filter');
      }
    }
  }
});

test('portals validator accepts boolean option and rejects truthy strings/numbers',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'co-us-evidence-'));
  t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5}));
  const validate=(config)=>{
    const file=path.join(root,'portals.yml');writeFileSync(file,JSON.stringify(config));
    return spawnSync(process.execPath,['validate-portals.mjs','--file',file],{encoding:'utf8',timeout:30000});
  };
  const base={title_filter:{positive:['Engineer']},tracked_companies:[{name:'Fictional',careers_url:'https://jobs.lever.co/fictional'}]};
  for(const value of [true,false,undefined]) {
    const r=validate({...base,location_filter:{require_us_evidence:value}});
    assert.equal(r.status,0,r.stdout+r.stderr);
  }
  for(const value of ['true',1,null]) {
    const r=validate({...base,location_filter:{require_us_evidence:value}});
    assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/location_filter.require_us_evidence: must be a boolean/);
  }
});
