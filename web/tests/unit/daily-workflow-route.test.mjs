// Opt-in production HTTP acceptance. Build first with BUILD_DIST=.next-daily-check
// npm run build, then DAILY_ROUTE_ACCEPTANCE=1 node --test this file. No model,
// employer request, application package, submission or real user data is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { dailyWorkflowFixture, metadata, postingUrl, report, webRoot } from '../helpers/daily-workflow-fixture.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function until(check, message, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  assert.fail(message);
}

test('daily evaluation → canonical tracker → C05 PDF → read-only HTTP review', {
  skip: process.env.DAILY_ROUTE_ACCEPTANCE !== '1', timeout: 150_000,
}, async t => {
  const f = dailyWorkflowFixture();
  let server;
  let logs = '';
  const local = name => path.join(f.root, name);
  const initialTracker = fs.readFileSync(local('data/applications.md'));
  const keep = process.env.DAILY_KEEP_ROOT === '1';
  const stop = async () => {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const closed = once(server, 'close');
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(force); }
  };
  t.after(async () => {
    await stop();
    if (keep) console.log('DAILY_FIXTURE_ROOT=' + f.root);
    else f.close();
  });
  assert.ok(fs.existsSync(path.join(webRoot, f.env.BUILD_DIST, 'BUILD_ID')),
    'Build the production server first: BUILD_DIST=.next-daily-check npm run build (inside web/).');

  // Fail closed if any writable fixture directory accidentally points at a user checkout.
  for (const name of ['data', 'config', 'reports', 'output', 'batch', 'templates', 'modes', 'jds']) {
    assert.equal(fs.lstatSync(local(name)).isSymbolicLink(), false, name + ' must be isolated');
    assert.ok(fs.realpathSync(local(name)).startsWith(f.root + path.sep));
  }
  for (const key of ['CAREER_OPS_TRACKER', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE',
    'CAREER_OPS_PDF_INDEX', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_REPORTS_DIR', 'CAREER_OPS_BATCH_STATE']) {
    assert.equal(f.env[key], undefined, key + ' must not escape the fictional fixture');
  }
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const start = async () => {
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '--hostname', '127.0.0.1'], {
      cwd: webRoot, env: f.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', chunk => { logs += chunk; });
    server.stderr.on('data', chunk => { logs += chunk; });
    await until(async () => {
      if (server.exitCode !== null) assert.fail('Production server exited: ' + logs);
      try { return (await fetch(base + '/api/run', { signal: AbortSignal.timeout(1000) })).status === 405; }
      catch { return false; }
    }, 'Production server failed to start: ' + logs, 20_000);
  };
  await start();
  await t.test('local sponsorship lookup uses the isolated data-root index and cache', async () => {
    const query = () => fetch(base + '/api/h1b-history', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: 'Fictional Local LLC' }),
    });
    assert.equal((await (await query()).json()).status, 'index_missing');
    fs.mkdirSync(local('data/h1b'), { recursive: true });
    fs.writeFileSync(local('data/h1b/index.ndjson.gz'), gzipSync(JSON.stringify({
      k: 'fictional-local', n: 'Fictional Local LLC', filed: 42, cert: 30,
      first: 2024, last: 2026, pwd: 0, perm: 0,
    }) + '\n'));
    const response = await query();
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.status, 'matched');
    assert.equal(history.lca, 42);
    assert.ok(fs.readdirSync(local('data/cache/h1b')).some(name => name.endsWith('.json')),
      'lookup cache belongs beside the isolated data, never in the installed code checkout');
    assert.match(history.note, /not approval/);
    assert.deepEqual(fs.readFileSync(local('data/applications.md')), initialTracker);
  });
  const setBehavior = name => fs.writeFileSync(local('behavior'), name);
  const request = (kind = 'evaluate', input = postingUrl) => fetch(base + '/api/run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, input, cliId: 'claude' }), signal: AbortSignal.timeout(60_000),
  });
  const run = async (kind, input) => {
    const response = await request(kind, input);
    assert.equal(response.status, 200, await response.clone().text());
    const raw = await response.text();
    return { raw, events: raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  };
  const launches = () => fs.existsSync(local('launches.jsonl'))
    ? fs.readFileSync(local('launches.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const files = (directory, depth = 0) => {
    assert.ok(depth < 10, 'Unexpected fixture directory nesting');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, 'Mutable fixture must not contain symlinks');
      return entry.isDirectory() ? files(file, depth + 1) : [file];
    }).sort();
  };
  const noEvaluation = () => {
    assert.deepEqual(fs.readFileSync(local('data/applications.md')), initialTracker);
    assert.equal(fs.existsSync(local('applications.md')), false);
    assert.deepEqual(files(local('reports')), [], 'No report or reservation may remain');
    assert.deepEqual(files(local('batch')), [], 'No tracker addition may remain');
    assert.deepEqual(files(local('output')), [], 'Failed evaluations cannot generate output');
  };
  const pipeline = async () => {
    const response = await fetch(base + '/api/pipeline');
    assert.equal(response.status, 200);
    return response.json();
  };
  const noSubmission = () => {
    assert.equal(fs.existsSync(local('data/private')), false, 'PDF review must never prepare an application package');
    assert.equal(fs.existsSync(local('data/status-log.tsv')), false, 'No application lifecycle transition may be written');
    const tracker = fs.existsSync(local('data/applications.md')) ? fs.readFileSync(local('data/applications.md'), 'utf8') : '';
    assert.doesNotMatch(tracker, /\|\s*Applied\s*\|/);
    for (const file of files(local('data'))) {
      assert.doesNotMatch(path.basename(file), /(?:submission|submit-approval|browser-approved|receipt)/i);
    }
  };

  for (const behavior of ['invalid', 'provider-error', 'exit-failure', 'stale']) {
    await t.test(behavior + ' evaluation leaves no canonical work', async () => {
      const cv = fs.readFileSync(local('cv.md'));
      setBehavior(behavior);
      try {
        const { events, raw } = await run();
        assert.ok(events.some(event => event.type === 'error'), raw + '\n' + logs);
        assert.ok(!events.some(event => event.type === 'done'), raw);
        if (behavior === 'stale') assert.match(raw, /changed|source/i);
        assert.doesNotMatch(raw, /Synthetic candidate facts only|work_auth:|<<evaluation-report>>/,
          'Sealed report must remain private in streamed logs');
        noEvaluation();
      } finally { fs.writeFileSync(local('cv.md'), cv); }
    });
  }

  await t.test('same URL cannot launch twice; cancellation kills worker and leaves no writes', async () => {
    setBehavior('hold');
    const before = launches().length;
    const response = await request();
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    try {
      await reader.read();
      await until(() => fs.existsSync(local('worker.pid')), 'Held worker did not start');
      assert.equal(launches().length, before + 1);
      const duplicate = await request('evaluate', postingUrl + '?utm_source=acceptance');
      assert.equal(duplicate.status, 409, await duplicate.text());
      assert.equal(launches().length, before + 1, 'Duplicate request cannot invoke a second worker');
    } finally { await reader.cancel(); }
    const pid = Number(fs.readFileSync(local('worker.pid'), 'utf8'));
    await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 'Cancelled worker remained alive');
    noEvaluation();
  });

  let reportNum;
  let reportFile;
  let trackerAfterEvaluation;
  await t.test('validated evaluation uses real reservation and canonical merge, then returns its score', async () => {
    setBehavior('valid');
    const { events, raw } = await run();
    assert.ok(!events.some(event => event.type === 'error'), raw + '\n' + logs);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.evaluation, raw + '\n' + logs);
    reportNum = done.evaluation.reportNum;
    assert.match(reportNum, /^\d{3,}$/);
    assert.deepEqual(done.evaluation, { score: metadata.score, note: metadata.note, reportNum });
    assert.ok(events.findIndex(event => event.type === 'status' && /merged tracker/.test(event.label)) < events.indexOf(done));
    assert.doesNotMatch(raw, /Synthetic candidate facts only|work_auth:|<<evaluation-report>>/);
    const reports = files(local('reports'));
    assert.equal(reports.length, 1, 'Reservation sentinel must be released');
    reportFile = reports[0];
    assert.equal(fs.readFileSync(reportFile, 'utf8'), report);
    assert.match(path.basename(reportFile), new RegExp('^' + reportNum + '-example-co-\\d{4}-\\d{2}-\\d{2}\\.md$'));
    const additions = files(local('batch/tracker-additions/merged'));
    assert.equal(additions.length, 1, 'Real merge-tracker must archive the processed TSV');
    assert.match(fs.readFileSync(additions[0], 'utf8'), /\tEvaluated\t2\.5\/5\t/);
    assert.equal(fs.existsSync(local('applications.md')), false, 'Only canonical data/applications.md may be created');
    trackerAfterEvaluation = fs.readFileSync(local('data/applications.md'), 'utf8');
    assert.match(trackerAfterEvaluation, /\.\.\/reports\//, 'Canonical merge must make report links tracker-relative');
    const { applications } = await pipeline();
    assert.equal(applications.length, 1);
    assert.equal(applications[0].score, '2.5/5');
    assert.equal(applications[0].status, 'Evaluated');
    assert.equal(applications[0].pdf, '❌');
    noSubmission();
  });
  assert.ok(reportNum, 'A successful evaluation is required for the PDF acceptance');

  await t.test('Applied requires verified receipt and cannot be set by review', async () => {
    const before=fs.readFileSync(local('data/applications.md'));
    const { applications }=await pipeline();
    const response=await fetch(base+'/api/status',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({n:applications[0].n,status:'Applied'})});
    assert.equal(response.status,409,await response.text());
    assert.deepEqual(fs.readFileSync(local('data/applications.md')),before);
  });

  await t.test('server restart reloads the confirmed score and report from disk', async () => {
    await stop();
    await start();
    const { applications } = await pipeline();
    assert.equal(applications.length, 1);
    assert.equal(applications[0].company, metadata.company);
    assert.equal(applications[0].role, metadata.role);
    assert.equal(applications[0].score, '2.5/5');
    assert.equal(applications[0].status, 'Evaluated');
    assert.match(applications[0].report, new RegExp(reportNum));
    assert.equal(fs.readFileSync(reportFile, 'utf8'), report);
    assert.equal(fs.readFileSync(local('data/applications.md'), 'utf8'), trackerAfterEvaluation);
  });

  await t.test('unsupported C05 wording cannot mark the tracker or publish a PDF', async () => {
    setBehavior('pdf-unsupported');
    const { events, raw } = await run('pdf', reportNum);
    assert.ok(events.some(event => event.type === 'error'), raw);
    assert.ok(!events.some(event => event.type === 'done'), raw);
    assert.equal(files(local('output')).filter(file => file.endsWith('.pdf')).length, 0);
    assert.equal(fs.readFileSync(local('data/applications.md'), 'utf8'), trackerAfterEvaluation);
  });

  let pdfFile;
  let pdfBytes;
  await t.test('bound C05 proposal renders a real Playwright PDF and enters the read-only queue', async () => {
    setBehavior('pdf-valid');
    const { events, raw } = await run('pdf', reportNum);
    assert.ok(!events.some(event => event.type === 'error'), raw + '\n' + logs);
    assert.ok(events.some(event => event.type === 'done'), raw + '\n' + logs);
    const pdfs = files(local('output')).filter(file => file.endsWith('.pdf'));
    assert.equal(pdfs.length, 1);
    pdfFile = pdfs[0];
    pdfBytes = fs.readFileSync(pdfFile);
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdfBytes.length > 1000, 'Renderer must produce real PDF bytes');
    const evidence = JSON.parse(fs.readFileSync(pdfFile + '.evidence.json', 'utf8'));
    assert.equal(evidence.pdf_sha256, sha256(pdfBytes));
    assert.match(evidence.snapshot.authority_sha256, /^[a-f0-9]{64}$/);
    const indexed = fs.readFileSync(local('data/pdf-index.tsv'), 'utf8');
    assert.ok(indexed.includes(path.relative(f.root, pdfFile)));
    const before = sha256(fs.readFileSync(local('data/applications.md')));
    const review = await fetch(base + '/api/review-pdf?n=' + reportNum);
    assert.equal(review.status, 200);
    assert.equal(review.headers.get('content-type'), 'application/pdf');
    assert.equal(review.headers.get('cache-control'), 'no-store');
    assert.equal(sha256(Buffer.from(await review.arrayBuffer())), sha256(pdfBytes));
    const page = await (await fetch(base + '/approvals')).text();
    assert.match(page, /Tailored PDF review queue/);
    assert.match(page, /Inspect verified PDF/);
    assert.match(page, /No approval packages yet/);
    assert.ok(page.includes(evidence.pdf_sha256));
    assert.ok(page.includes('/api/review-pdf?n=' + reportNum));
    assert.equal(sha256(fs.readFileSync(local('data/applications.md'))), before, 'Review GETs must never mutate the tracker');
    const { applications } = await pipeline();
    assert.equal(applications[0].status, 'Evaluated');
    assert.equal(applications[0].pdf, '✅');
    assert.equal(applications[0].score, '2.5/5');
    noSubmission();
  });
  assert.ok(pdfFile, 'A generated PDF is required for the tamper acceptance');

  await t.test('changed PDF bytes are rejected by both review surfaces', async () => {
    const tracker = fs.readFileSync(local('data/applications.md'));
    try {
      fs.appendFileSync(pdfFile, '\nSynthetic tamper marker\n');
      const review = await fetch(base + '/api/review-pdf?n=' + reportNum);
      assert.ok([404, 409].includes(review.status), 'Changed PDF must never be served');
      assert.match(await review.text(), /unavailable|changed|review/i);
      const page = await (await fetch(base + '/approvals')).text();
      assert.match(page, /Evidence requires review/);
      assert.doesNotMatch(page, /Inspect verified PDF/);
      assert.deepEqual(fs.readFileSync(local('data/applications.md')), tracker);
      noSubmission();
    } finally { fs.writeFileSync(pdfFile, pdfBytes); }
    assert.equal((await fetch(base + '/api/review-pdf?n=' + reportNum)).status, 200,
      'Restoring the exact verified bytes should restore read-only review');
  });
});
