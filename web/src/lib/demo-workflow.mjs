// Explicit isolated demo orchestration: no model, tracker, live authority or submit runner.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { prepareBoundCv, renderDashboardBoundCv, verifyPreparedBoundCv } from './bound-cv.mjs';
import { renderBoundPdf } from './bound-pdf.mjs';
import { sealDemoPackage, verifyDemoPackage } from './demo-package.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
export async function runDemoWorkflow(root, signal) {
  root = fs.realpathSync(root);
  const read = file => {
    const target = path.join(root, file);
    if (fs.lstatSync(target).isSymbolicLink()) throw Error('Demo inputs must be isolated regular files.');
    return fs.readFileSync(target, 'utf8');
  };
  if (read('.career-ops-demo') !== 'isolated-no-submit\n') throw Error('Isolated demo marker required.');
  for (const file of ['data/applications.md', 'applications.md']) if (fs.existsSync(path.join(root,file))) throw Error('Demo root must have no tracker.');
  if (fs.realpathSync(path.join(root,'data')) !== path.join(root,'data')) throw Error('Demo data must not be a symlink.');
  const inputText = read('demo-input.json');
  const input = JSON.parse(inputText);
  const load = name => import(/* turbopackIgnore: true */ pathToFileURL(path.join(root,name)).href);
  // Reuse the existing ATS provider for live discovery; archived text alone cannot qualify.
  const target = new URL(input.offer.url);
  if (target.hostname !== 'jobs.ashbyhq.com' || target.protocol !== 'https:') throw Error('Demo currently requires an Ashby posting.');
  const board = target.pathname.split('/')[1];
  if (!/^[a-zA-Z0-9_-]+$/.test(board)) throw Error('Invalid ATS board.');
  const {default:provider} = await load('providers/ashby.mjs');
  const {fetchJson} = await load('providers/_http.mjs');
  let rawJob;
  const jobs = await provider.fetch({name:input.offer.company,careers_url:`https://jobs.ashbyhq.com/${board}`}, {
    fetchJson: async (url, options) => {
      if (signal?.aborted) throw Error('Demo cancelled.');
      const data = await fetchJson(url,options);
      rawJob = data.jobs?.find(job => job.jobUrl === input.offer.url);
      return data;
    },
  });
  if (signal?.aborted) throw Error('Demo cancelled.');
  if (!jobs.some(job => job.url === input.offer.url) || rawJob?.isListed !== true
      || rawJob.title !== input.offer.title || rawJob.descriptionPlain !== input.offer.description
      || rawJob.location !== input.offer.location || rawJob.employmentType !== input.offer.employmentType
      || rawJob.secondaryLocations?.length) throw Error('Live posting changed or unavailable; review eligibility again.');
  const discovery = {source:'ashby',checked_at:new Date().toISOString(),posting_sha256:hash(JSON.stringify(rawJob))};
  const {evaluateDemoEligibility} = await load('lib/demo-eligibility.mjs');
  const decision = evaluateDemoEligibility(input);
  if (!decision.demo_allowed || decision.submission_allowed !== false) throw Error('Demo eligibility blocked: '+decision.reasons.join(', '));
  const {normalizeUrl} = await load('url-key.mjs');
  const key = hash(normalizeUrl(input.offer.url));
  const privateDir = path.join(root,'data/private');
  fs.mkdirSync(privateDir,{recursive:true});
  if (fs.realpathSync(privateDir) !== privateDir) throw Error('Demo output must not be a symlink.');
  const packagePath = path.join(privateDir,key+'-demo-package.json');
  if (fs.existsSync(packagePath)) throw Error('Duplicate demo package; review the existing package.');
  const lock = path.join(privateDir,key+'.lock');
  const fd = fs.openSync(lock,'wx',0o600);
  let stage;
  try {
    if (signal?.aborted) throw Error('Demo cancelled.');
    stage = fs.mkdtempSync(path.join(root,'.demo-run-'));
    const report = path.join(stage,'job.md');
    fs.writeFileSync(report,input.offer.description,{mode:0o600});
    const prepared = await prepareBoundCv(root,report);
    const api = await load('enhanced/resume-authority.mjs');
    const html = path.join(stage,'resume.html');
    const bound = await renderDashboardBoundCv({root,prepared,proposal:input.proposal,html,signal});
    const pdf = await renderBoundPdf({spawnFn:spawn,execPath:process.execPath,root,pdfPaths:{html,finalPdf:path.join(stage,'resume.pdf')},format:input.proposal.payload.page_format,reportNum:'0',signal,evidencePath:html+'.evidence.json',prepared,demoOnly:true});
    if (pdf.kind !== 'rendered') throw Error(pdf.error);
    const bytes = fs.readFileSync(pdf.finalPdf);
    const evidence = JSON.parse(fs.readFileSync(pdf.finalPdf+'.evidence.json'));
    if (evidence.pdf_sha256 !== hash(bytes)) throw Error('Demo PDF evidence mismatch.');
    verifyPreparedBoundCv(api,root,prepared,signal);
    if (read('demo-input.json') !== inputText) throw Error('Demo input changed.');
    // Different schema/suffix from executable browser approvals. No readiness_input,
    // submit_approval or application_bundle can be passed to the submission runner.
    const result = sealDemoPackage({demo_only:true,submission_allowed:false,application_action:'none',
      application:{key,company:input.offer.company,role:input.offer.title,url:input.offer.url},
      discovery, eligibility:decision, candidate_match:{method:'reviewed-proposal-selection',limitations:input.match_limitations ?? [],bound_claims:Object.keys(bound.bindings).length,gaps:bound.gaps},
      artifacts:[{kind:'resume',path:pdf.finalPdf,sha256:hash(bytes)}],source_snapshot:evidence.snapshot,
      content_digest:hash(JSON.stringify({decision,pdf:hash(bytes),snapshot:evidence.snapshot})),
      warning:'DEMO ONLY — role sponsorship unconfirmed; human eligibility confirmation required; submission disabled'});
    verifyDemoPackage(root,result);
    const pending = path.join(stage,'package.json');
    fs.writeFileSync(pending,JSON.stringify(result,null,2),{mode:0o600});
    verifyPreparedBoundCv(api,root,prepared,signal);
    fs.renameSync(pending,packagePath);
    stage = undefined; // Retain artifact bundle referenced by the package.
    return result;
  } finally {
    if (stage) fs.rmSync(stage,{recursive:true,force:true});
    fs.closeSync(fd);fs.unlinkSync(lock);
  }
}
