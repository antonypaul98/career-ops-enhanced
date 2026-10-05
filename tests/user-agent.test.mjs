// tests/user-agent.test.mjs — the shared User-Agent constants must be stable
// (no package-version churn: a UA that moves on every release is an
// unintended fingerprint variable introduced into every scan without anyone
// deciding it should be there — see PR #2536 review) and must actually be
// the header value handed to the fetch transport.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nShared User-Agent constants');

const {
  DEFAULT_USER_AGENT,
  BROWSER_LIKE_USER_AGENT,
  MACOS_BROWSER_LIKE_USER_AGENT,
} = await import(pathToFileURL(join(ROOT, 'user-agent.mjs')).href);
const { fetchJson } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

// 1. Pinned to a literal, not derived from package.json — the exact
// regression this test guards. The trailing /1.0 is a UA-format version
// (Googlebot/2.1-style), bumped by hand only if this identifier's shape
// changes — it must never track the release version.
const EXPECTED_UA = 'Mozilla/5.0 (compatible; career-ops/1.0; +https://github.com/career-ops-hq/career-ops)';
if (DEFAULT_USER_AGENT === EXPECTED_UA) pass('DEFAULT_USER_AGENT matches the pinned literal');
else fail(`DEFAULT_USER_AGENT drifted from the pinned literal: got ${DEFAULT_USER_AGENT}`);

const EXPECTED_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
if (BROWSER_LIKE_USER_AGENT === EXPECTED_BROWSER_UA) pass('BROWSER_LIKE_USER_AGENT matches the pinned literal');
else fail(`BROWSER_LIKE_USER_AGENT drifted from the pinned literal: got ${BROWSER_LIKE_USER_AGENT}`);

const EXPECTED_MACOS_BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
if (MACOS_BROWSER_LIKE_USER_AGENT === EXPECTED_MACOS_BROWSER_UA) pass('MACOS_BROWSER_LIKE_USER_AGENT matches the pinned literal');
else fail(`MACOS_BROWSER_LIKE_USER_AGENT drifted from the pinned literal: got ${MACOS_BROWSER_LIKE_USER_AGENT}`);

// 2. Drive the public entry point and inspect its actual transport headers.
// The synthetic public URL keeps this independent of process-wide proxy setup
// and the production prohibition on private provider destinations.
{
  let receivedUA = null;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      receivedUA = new Headers(options.headers).get('user-agent');
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    };
    await fetchJson('https://public.example/user-agent-fixture', { timeoutMs: 2_000 });
  } finally { globalThis.fetch = originalFetch; }

  if (receivedUA === DEFAULT_USER_AGENT) pass('fetchJson sends DEFAULT_USER_AGENT verbatim as the User-Agent header');
  else fail(`fetchJson sent an unexpected User-Agent: ${receivedUA}`);
}
