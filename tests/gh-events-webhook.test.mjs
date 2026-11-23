import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as yaml from 'js-yaml';

const workflowText = readFileSync(new URL('../.github/workflows/gh-events-feed.yml', import.meta.url), 'utf8');
const workflow = yaml.load(workflowText);
const step = workflow.jobs.post.steps.find(item => String(item.uses || '').startsWith('actions/github-script@'));
const script = step?.with?.script;

async function runWebhookScript(value, { ok = true, status = 200 } = {}) {
  assert.equal(typeof script, 'string', 'the actual workflow script must be present');
  const calls = [];
  const notices = [];
  const context = { payload: { pull_request: {
    number: 123, title: 'Safe example PR', author_association: 'CONTRIBUTOR',
    html_url: 'https://github.com/example/repo/pull/123', user: { login: 'sample-user' },
  } } };
  await runInNewContext('(async () => {\n' + script + '\n})()', {
    process: { env: value === undefined ? {} : { WEBHOOK: value } },
    context,
    core: { notice: message => notices.push(message) },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok, status }; },
  }, { timeout: 1000 });
  return { calls, notices };
}

test('missing or blank optional Discord webhook never issues a network request', async () => {
  for (const value of [undefined, '', '   ']) {
    const { calls, notices } = await runWebhookScript(value);
    assert.equal(calls.length, 0);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /not configured/);
    assert.doesNotMatch(notices[0], /https?:\/\//);
  }
});

test('configured webhook posts only approved public PR metadata once', async () => {
  const url = 'https://discord.example.test/webhook';
  const { calls, notices } = await runWebhookScript('  ' + url + '  ');
  assert.deepEqual(notices, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.embeds.length, 1);
  assert.equal(body.embeds[0].url, 'https://github.com/example/repo/pull/123');
  assert.match(body.embeds[0].description, /Safe example PR/);
});

test('configured webhook delivery failure is not silently ignored', async () => {
  await assert.rejects(
    runWebhookScript('https://discord.example.test/webhook', { ok: false, status: 403 }),
    /Discord webhook 403/,
  );
});
