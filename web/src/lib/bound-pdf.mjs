// C05 PDF publication: render privately, revalidate, then publish one complete bundle.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyPreparedBoundCv } from './bound-cv.mjs';
import { spawnGeneratePdf, markTrackerReady } from './pdf-render.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function renderBoundPdf({ spawnFn, execPath, root, pdfPaths, format, reportNum, signal, evidencePath, prepared }) {
  let stage;
  let published;
  let indexed = false;
  try {
    const load = name => import(/* turbopackIgnore: true */ pathToFileURL(path.join(root, name)).href);
    const api = await load('enhanced/resume-authority.mjs');
    const { updatePDFManifest } = await load('generate-pdf.mjs');
    if (!prepared) throw new Error('C05 source snapshot is required.');
    const verify = () => verifyPreparedBoundCv(api, root, prepared, signal);
    verify();
    const evidence = JSON.parse(fs.readFileSync(api.privatePath(root, evidencePath), 'utf8'));
    const html = fs.readFileSync(api.privatePath(root, pdfPaths.html));
    if (evidence.render?.artifact_sha256 !== hash(html)
        || Object.entries(prepared.authority.snapshot).some(([key, value]) => api.digest(evidence.snapshot?.[key]) !== api.digest(value))
        || evidence.snapshot?.jd_sha256 !== prepared.reportDigest)
      throw new Error('C05 render evidence does not match the reviewed sources and HTML.');
    // A run owns its input copy, staging directory and final bundle. Concurrent
    // runs cannot replace one another's PDF or pair an audit with another render.
    stage = fs.mkdtempSync(path.join(path.dirname(api.privatePath(root, pdfPaths.html)), '.pdf-stage-'));
    const input = path.join(stage, 'source.html');
    const pdf = path.join(/* turbopackIgnore: true */ stage, path.basename(pdfPaths.finalPdf));
    fs.writeFileSync(input, html, { mode: 0o600 });
    const render = await spawnGeneratePdf({ spawnFn, execPath, root, html: input, finalPdf: pdf, format, reportNum, signal, deferManifest: true });
    if (!render.ok) throw new Error(render.stderr || 'PDF rendering failed.');
    const bytes = fs.readFileSync(/* turbopackIgnore: true */ pdf);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Renderer did not produce a PDF.');
    fs.writeFileSync(pdf + '.evidence.json', JSON.stringify({ ...evidence, pdf_sha256: hash(bytes) }, null, 2) + '\n', { mode: 0o600 });
    const output = api.privatePath(root, path.dirname(pdfPaths.finalPdf));
    fs.mkdirSync(output, { recursive: true });
    const bundle = path.join(output, 'c05-' + randomUUID());
    // No await between the final source/cancellation check and publication.
    // A directory rename exposes PDF + sidecar + exact input together.
    verify();
    fs.renameSync(stage, bundle);
    stage = undefined;
    published = bundle;
    const finalPdf = path.join(bundle, path.basename(pdf));
    updatePDFManifest(reportNum, finalPdf, path.join(bundle, 'source.html'), format, 'cv', root);
    indexed = true;
    const mark = await markTrackerReady({ spawnFn, execPath, root, reportNum, signal });
    if (signal?.aborted) return { kind: 'render-failed', error: 'PDF run cancelled after publication; published evidence was retained.' };
    const warnings = render.stderr.split('\n').map(s => s.trim()).filter(Boolean);
    if (!mark.ok) warnings.push('PDF published, but tracker synchronization failed.');
    return { kind: 'rendered', warnings };
  } catch (error) {
    return { kind: 'render-failed', error: error.message || 'C05 PDF publication refused.' };
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
    if (published && !indexed) fs.rmSync(published, { recursive: true, force: true });
  }
}
