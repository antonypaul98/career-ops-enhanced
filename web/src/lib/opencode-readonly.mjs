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

function configDocument(capabilities = { network: "fetch" }) {
  const scoped = { ...permission, webfetch: capabilities.network === "fetch" ? "allow" : "deny",
    websearch: capabilities.network ? "allow" : "deny" };
  return {
    $schema: "https://opencode.ai/config.json",
    permission: scoped,
    agent: {
      [OPENCODE_READONLY_AGENT]: {
        mode: "primary",
        description: "Career Ops read-only evaluator. Canonical files are persisted by the trusted backend.",
        permission: scoped,
      },
    },
  };
}

// OpenCode 1.x debug output is an ordered ruleset, not its input config map.
// Last matching rule wins. Prove the universal rule plus every later exception;
// do not infer safety from checking only a single sample path.
export function assertResolvedOpenCodeAgentReadOnly(value, options = {}) {
  const raw = value?.permission;
  const rules = Array.isArray(raw) ? raw : raw && typeof raw === "object"
    ? Object.entries(raw).flatMap(([permission, action]) => typeof action === "string"
      ? [{ permission, pattern: "*", action }]
      : Object.entries(action).map(([pattern, action]) => ({ permission, pattern, action }))) : [];
  if (!rules.length || rules.some(r => typeof r.permission !== "string" ||
      typeof r.pattern !== "string" || !["allow", "deny", "ask"].includes(r.action) ||
      (r.permission !== "*" && /[*?]/.test(r.permission)))) throw new Error("Unrecognized OpenCode permission rules");
  const network = options.capabilities?.network ?? "fetch";
  const allowed = new Set(["read", "grep", "glob", "list", ...(network ? ["websearch"] : []),
    ...(network === "fetch" ? ["webfetch"] : [])]);
  const keys = new Set(["*", "edit", "patch", "bash", "external_directory", "task", "todowrite", "lsp", "skill",
    "webfetch", "websearch", ...rules.map(r => r.permission)]);
  for (const key of keys) {
    const matching = rules.filter(r => r.permission === "*" || r.permission === key);
    const baseline = matching.findLastIndex(r => r.pattern === "*");
    const expected = allowed.has(key) ? "allow" : "deny";
    if (baseline < 0 || matching[baseline].action !== expected) throw new Error(`OpenCode resolved agent does not ${expected} ${key}; refusing to start.`);
    for (const r of matching.slice(baseline + 1)) {
      // OpenCode adds its own read-only truncated-output directory. Permit only
      // this run's isolated directory, never a user's home or an arbitrary path.
      if (key === "external_directory" && r.action === "allow" &&
          options.toolOutputPattern && r.pattern === options.toolOutputPattern) continue;
      if (!allowed.has(key) && r.action !== "deny") throw new Error(`OpenCode permission exception enables ${key}; refusing to start.`);
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
  writeFileSync(configPath, JSON.stringify(configDocument(options.capabilities), null, 2), { mode: 0o600 });
  const env = { ...process.env, ...options.env, OPENCODE_CONFIG: configPath, PWD: String(options.cwd ?? process.cwd()),
    XDG_DATA_HOME: path.join(dir, "data"), XDG_STATE_HOME: path.join(dir, "state") };
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
  try {
    assertResolvedOpenCodeAgentReadOnly(resolved, { capabilities: options.capabilities,
      toolOutputPattern: path.join(env.XDG_DATA_HOME, "opencode", "tool-output", "*") });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
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
