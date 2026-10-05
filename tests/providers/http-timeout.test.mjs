// The abort deadline must cover BODY reads after headers have arrived.
// An in-memory Response exercises the same native readers without loopback
// provider destinations (which are deliberately forbidden) or outbound traffic.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — _http timeout');
const { fetchJson, fetchText } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

function hardTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: hard test timeout after ${ms}ms — regression suspected`)), ms);
  })]).finally(() => clearTimeout(timer));
}
const MAX_ABORT_MS = 1_500;
const originalFetch = globalThis.fetch;
let bodiesStarted = 0;
try {
  globalThis.fetch = async (url, { signal }) => {
    if (new URL(url).pathname !== '/stall') return new Response('{"ok":true}');
    return new Response(new ReadableStream({ start(controller) {
      bodiesStarted++;
      controller.enqueue(new TextEncoder().encode('{"jobs": ['));
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted body read', 'AbortError')), { once: true });
    } }), { headers: { 'content-type': 'application/json' } });
  };

  for (const [label, consume] of [['fetchJson', fetchJson], ['fetchText', fetchText]]) {
    const before = bodiesStarted;
    const start = Date.now();
    try {
      await hardTimeout(consume('https://public.example/stall', { timeoutMs: 300 }), 8_000, `${label} /stall`);
      fail(`${label} resolved on a stalled body`);
    } catch (error) {
      const elapsed = Date.now() - start;
      if (error.name === 'AbortError' && bodiesStarted === before + 1 && elapsed < MAX_ABORT_MS) {
        pass(`${label} aborted an actual stalled body read in ${elapsed}ms`);
      } else fail(`${label} failed without aborting its body within the deadline: ${error.name}, elapsed=${elapsed}ms, bodies=${bodiesStarted - before}`);
    }
  }
  const ok = await fetchJson('https://public.example/ok', { timeoutMs: 2_000 });
  if (ok?.ok === true) pass('fetchJson still parses a completed body');
  else fail(`fetchJson happy path broken: ${JSON.stringify(ok)}`);
} finally { globalThis.fetch = originalFetch; }
