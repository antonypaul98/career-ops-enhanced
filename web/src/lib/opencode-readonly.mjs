import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { OPENCODE_READONLY_AGENT } from "./opencode-fencing.mjs";

const permission = Object.freeze({
  "*": "deny",
  read: "allow",
  grep: "allow",
  glob: "allow",
  list: "allow",
  webfetch: "allow",
  websearch: "allow",
  edit: "deny",
  patch: "deny",
  bash: "deny",
  external_directory: "deny",
  task: "deny",
  todowrite: "deny",
  lsp: "deny",
  skill: "deny",
});

function configDocument() {
  return {
    $schema: "https://opencode.ai/config.json",
    permission,
    agent: {
      [OPENCODE_READONLY_AGENT]: {
        mode: "primary",
        description: "Career Ops read-only evaluator. Canonical files are persisted by the trusted backend.",
        permission,
      },
    },
  };
}

function objectPermission(value, key) {
  const permissions = value?.permission;
  if (!permissions || typeof permissions !== "object") return undefined;
  return permissions[key] ?? permissions["*"];
}

export function assertResolvedOpenCodeAgentReadOnly(value) {
  const requiredDenied = ["edit", "patch", "bash", "external_directory", "task", "todowrite", "lsp", "skill"];
  for (const key of requiredDenied) {
    if (objectPermission(value, key) !== "deny") {
      throw new Error(`OpenCode resolved agent does not deny ${key}; refusing to start.`);
    }
  }
  for (const key of ["read", "grep", "glob", "list", "webfetch"]) {
    if (objectPermission(value, key) !== "allow") {
      throw new Error(`OpenCode resolved agent does not explicitly allow ${key}; refusing to start.`);
    }
  }
  return true;
}

/**
 * Create a per-run config and verify OpenCode's fully resolved agent before any
 * model prompt is launched. The user's global config is neither edited nor
 * weakened. Unknown debug output fails closed.
 */
export function prepareOpenCodeReadOnlyLaunch(binPath, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "career-ops-opencode-"));
  const configPath = path.join(dir, "opencode.json");
  writeFileSync(configPath, JSON.stringify(configDocument(), null, 2), { mode: 0o600 });
  const env = { ...process.env, ...options.env, OPENCODE_CONFIG: configPath };
  const runSync = options.spawnSyncFn ?? spawnSync;
  const probe = runSync(binPath, ["debug", "agent", OPENCODE_READONLY_AGENT], {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 10_000,
  });
  if (probe.error || probe.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    const detail = probe.error?.message || String(probe.stderr || "").trim() || `exit ${probe.status}`;
    throw new Error(`OpenCode permission verification failed: ${detail}`);
  }
  let resolved;
  try {
    resolved = JSON.parse(String(probe.stdout || ""));
  } catch {
    rmSync(dir, { recursive: true, force: true });
    throw new Error("OpenCode permission verification returned an unrecognized response; refusing to start.");
  }
  assertResolvedOpenCodeAgentReadOnly(resolved);
  return {
    env,
    configPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function readOpenCodeConfigForTest(configPath) {
  return JSON.parse(readFileSync(configPath, "utf8"));
}
