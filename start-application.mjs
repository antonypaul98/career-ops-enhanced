#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { prepareCandidateApplicationStart, requestCandidateBrowserOpen } from './enhanced/application-launch.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const KNOWN_FLAGS = new Set(['--input', '--open', '--help', '-h']);

export function systemBrowserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}

export function openInSystemBrowser(url, platform = process.platform) {
  const { command, args } = systemBrowserCommand(url, platform);
  try {
    execFileSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function usage() {
  return [
    'Usage: node start-application.mjs --input <private-start-package.json> [--open]',
    '',
    'Without --open, validates and prints the candidate launch plan.',
    'With --open, opens only the exact confirmed HTTPS application URL in the ordinary system browser.',
    'This command never fills, advances, submits, or marks an application Applied.',
  ].join('\n');
}

function parseArgs(argv) {
  for (const arg of argv) {
    if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg)) throw new Error(`unknown flag: ${arg}`);
  }
  const index = argv.indexOf('--input');
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    open: argv.includes('--open'),
    input: index >= 0 ? argv[index + 1] : null,
  };
}

function privateInputPath(value) {
  if (!value || value.startsWith('-')) throw new Error('--input is required');
  const root = realpathSync(getCareerOpsRoot());
  const candidate = resolve(root, value);
  if (!existsSync(candidate) || !lstatSync(candidate).isFile()) throw new Error('input package must be an existing file');
  const canonical = realpathSync(candidate);
  const rel = relative(root, canonical);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('input package must stay inside the private data root');
  return canonical;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
  if (args.help) {
    console.log(usage());
    return 0;
  }
  let input;
  try {
    input = JSON.parse(readFileSync(privateInputPath(args.input), 'utf8'));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
  const plan = prepareCandidateApplicationStart(input);
  if (!args.open || plan.decision !== 'ready_to_open') {
    console.log(JSON.stringify(plan, null, 2));
    return plan.decision === 'blocked' ? 1 : 0;
  }
  const result = requestCandidateBrowserOpen(plan, openInSystemBrowser);
  console.log(JSON.stringify({
    ...result,
    next_step: result.decision === 'browser_open_requested'
      ? 'Complete login, MFA, CAPTCHA, any changed fields, and final review in the browser. The candidate alone may submit.'
      : 'Copy the exact application URL from the validated launch plan into an ordinary browser, then resume with the same token.',
  }, null, 2));
  return result.decision === 'browser_open_requested' ? 0 : 1;
}

if (isMainModule(import.meta.url)) process.exitCode = await main();
