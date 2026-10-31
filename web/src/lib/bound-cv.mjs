// Dashboard C05 boundary: models propose data; only the core renderer authors HTML.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createProcessTreeStopper } from './process-tree.mjs';

export const BOUND_CV_INSTRUCTION = 'Return exactly one <<cv-proposal>> line, then a JSON object with persona_id, payload and bindings, then <</cv-proposal>> on its own line. Use the existing C05 CV payload schema. Bind every factual JSON-pointer field to a supplied authority ref; copy approved wording exactly. Never emit HTML, invent facts or approve evidence. Set payload.page_format to letter or a4. If reviewed facts are insufficient, explain the pause and emit no proposal.';

export function createBoundCvFilter() {
  let text = '', overflow = false;
  return {
    push(chunk) { if (text.length + chunk.length > 1_000_000) overflow = true; else text += chunk; return ''; },
    flush() { return ''; },
    result() {
      if (overflow) return { ok: false, error: 'C05 proposal exceeds the size limit.' };
      const s = text.replace(/\r\n/g, '\n');
      if ([...s.matchAll(/^<<cv-proposal>>\s*$/gm)].length !== 1 || [...s.matchAll(/^<<\/cv-proposal>>\s*$/gm)].length !== 1)
        return { ok: false, error: 'Exactly one complete C05 proposal is required; raw HTML is not accepted.' };
      const match = s.match(/^<<cv-proposal>>[ \t]*\n([\s\S]*?)\n<<\/cv-proposal>>[ \t]*$/m);
      try {
        const proposal = JSON.parse(match?.[1] ?? '');
        const format = proposal?.payload?.page_format;
        if (!['letter', 'a4'].includes(format)) throw new Error();
        return { ok: true, proposal, format, warnings: [] };
      } catch { return { ok: false, error: 'Invalid C05 proposal JSON or page format.' }; }
    },
  };
}

async function core(root) {
  const load = name => import(/* turbopackIgnore: true */ pathToFileURL(path.join(root, 'enhanced', name)).href);
  return { ...await load('resume-authority.mjs'), ...await load('evidence-tailor.mjs') };
}
const cancelled = signal => { if (signal?.aborted) throw new Error('C05 generation cancelled.'); };

export async function prepareBoundCv(root, reportFile) {
  const api = await core(root);
  const report = api.privatePath(root, reportFile);
  const jdText = fs.readFileSync(report, 'utf8');
  const authority = api.loadResumeAuthority({ root, persona: { id: 'general' } });
  if (authority.contradictions.length) throw new Error('Conflicting candidate evidence requires review.');
  if (!authority.records.some(r => r.kind !== 'identity')) throw new Error('Reviewed career facts are required before résumé generation.');
  return { authority, context: api.proposalAuthority(authority), report, jdText, snapshot: api.digest(authority.snapshot), reportDigest: api.digest(jdText) };
}

export async function renderDashboardBoundCv({ root, prepared, proposal, html, signal, template }, options = {}) {
  cancelled(signal);
  const api = await core(root);
  const verify = () => verifyPreparedBoundCv(api, root, prepared, signal);
  const result = api.tailorBoundResume({ proposal, authority: verify(), jdText: prepared.jdText });
  // C05 can omit unsupported fields for advisory use. Dashboard generation must
  // reject the entire run before any output when proposed facts were omitted.
  if (result.excluded.some(entry => entry.path)) throw new Error('C05 rejected unsupported or unreviewed proposal fields.');
  cancelled(signal);
  const target = api.privatePath(root, html);
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.bound-cv-'));
  const input = path.join(stage, 'bound.json');
  try {
    fs.writeFileSync(input, JSON.stringify(result), { mode: 0o600 });
    const script = `import fs from 'node:fs'; import {pathToFileURL} from 'node:url'; const [module,root,input,output,template]=process.argv.slice(1); process.argv[1]="dashboard-c05-worker"; const {renderBoundResume}=await import(pathToFileURL(module).href); renderBoundResume({root,result:JSON.parse(fs.readFileSync(input,'utf8')),output,template:template || undefined});`;
    const child = (options.spawnFn ?? spawn)(process.execPath, ['--input-type=module', '-e', script,
      path.join(root, 'enhanced/tailor-resume.mjs'), root, input, path.join(stage, 'cv'), template ? api.privatePath(root, template) : ''],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    const stopper = createProcessTreeStopper(child);
    const abort = () => stopper.stop();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort(); }, 30_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stderr?.resume(); // Never expose candidate content through renderer diagnostics.
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error('C05 renderer failed or was cancelled.')));
      });
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); stopper.settled(); }
    if (timedOut) throw new Error('C05 renderer timed out.');
    verify();
    // Publish only after rendering and revalidating the exact source snapshot.
    fs.renameSync(path.join(stage, 'cv.evidence.json'), target + '.evidence.json');
    fs.renameSync(path.join(stage, 'cv.html'), target);
    return result;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

export function verifyPreparedBoundCv(api, root, prepared, signal) {
  cancelled(signal);
  const current = api.loadResumeAuthority({ root, persona: { id: 'general' } });
  if (api.digest(current.snapshot) !== prepared.snapshot || api.digest(fs.readFileSync(prepared.report, 'utf8')) !== prepared.reportDigest)
    throw new Error('Candidate evidence or report changed; regenerate the reviewed proposal.');
  return current;
}
