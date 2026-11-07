import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function sealDemoPackage(input) {
  const {content_digest, ...body} = input;
  return {...body,content_digest:hash(body)};
}
export function verifyDemoPackage(root,input) {
  if (input?.demo_only !== true || input.submission_allowed !== false || input.application_action !== 'none'
      || input.eligibility?.submission_allowed !== false || input.eligibility?.demo_allowed !== true
      || input.readiness_input || input.submit_approval) throw Error('Invalid demo safety boundary');
  if (input.content_digest !== sealDemoPackage(input).content_digest) throw Error('Demo package digest mismatch');
  const base=fs.realpathSync(root);
  const read = (name, optional=false) => {
    const p=path.resolve(base,name);
    let ancestor=p;
    while(!fs.existsSync(ancestor)) ancestor=path.dirname(ancestor);
    const canonical=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,p));
    const rel=path.relative(base,canonical);
    if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Demo evidence escapes root');
    if(optional&&!fs.existsSync(canonical))return '';
    return fs.readFileSync(canonical);
  };
  const snapshot=input.source_snapshot;
  if (!snapshot || !Array.isArray(input.artifacts) || input.artifacts.length!==1)throw Error('Demo evidence missing');
  for (const [key,file] of [['profile_sha256','data/career-profile.yml'],['config_sha256','config/profile.yml'],['vault_sha256','data/career-evidence.yml']])
    if(hash(read(file,key!=='profile_sha256'))!==snapshot[key])throw Error('Demo authority changed');
  for(const [file,digest] of Object.entries(snapshot.primary_sources_sha256??{}))
    if(hash(read(file))!==digest)throw Error('Demo source changed');
  const artifact=input.artifacts[0];const bytes=read(artifact.path);
  if(bytes.subarray(0,5).toString()!=='%PDF-'||hash(bytes)!==artifact.sha256)throw Error('Demo PDF changed');
  const sidecar=JSON.parse(read(artifact.path+'.evidence.json'));
  if(sidecar.pdf_sha256!==artifact.sha256||hash(sidecar.snapshot)!==hash(snapshot))throw Error('Demo PDF sidecar changed');
  return true;
}
