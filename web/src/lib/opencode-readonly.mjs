import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  const strict = capabilities.tools === false;
  const scoped = strict ? Object.fromEntries(Object.keys(permission).map(key => [key, "deny"])) : { ...permission, webfetch: capabilities.network === "fetch" ? "allow" : "deny",
    websearch: capabilities.network ? "allow" : "deny" };
  return {
    $schema: "https://opencode.ai/config.json",
    permission: scoped,
    agent: {
      [OPENCODE_READONLY_AGENT]: {
        mode: "primary",
        description: "Career Ops read-only evaluator. Canonical files are persisted by the trusted backend.",
        permission: scoped,
        ...(strict ? { model: "opencode/glm-5.3-flash-free" } : {}),
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
  const allowed = new Set(options.capabilities?.tools === false ? [] : ["read", "grep", "glob", "list", ...(network ? ["websearch"] : []),
    ...(network === "fetch" ? ["webfetch"] : [])]);
  const keys = new Set(["*", "edit", "patch", "bash", "external_directory", "task", "todowrite", "lsp", "skill",
    "webfetch", "websearch", ...rules.map(r => r.permission)]);
  for (const key of keys) {
    const matching = rules.filter(r => r.permission === "*" || r.permission === key);
    const baseline = matching.findLastIndex(r => r.pattern === "*");
    const expected = allowed.has(key) ? "allow" : "deny";
    if (baseline < 0 || matching[baseline].action !== expected) throw new Error(`OpenCode resolved agent does not ${expected} ${key}; refusing to start.`);
    for (const r of matching.slice(baseline + 1)) {
      // OpenCode adds a narrow exception for its own truncated tool-output files.
      // Accept only the precisely resolved XDG/HOME tool-output pattern; strict
      // previews use a run-private XDG path. Never allow a whole home directory.
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
  const config = configDocument(options.capabilities);
  const strict = options.capabilities?.tools === false;
  if (strict && (options.capabilities.writes || options.capabilities.network)) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error("Tool-free preview cannot request write or network tools.");
  }
  if (options.streaming) {
    const observerPath = path.join(dir, "quota-observer.mjs");
    copyFileSync(new URL("./opencode-quota-observer.mjs", import.meta.url), observerPath);
    config.plugin = [pathToFileURL(observerPath).href];
  }
  if (strict) Object.assign(config, { model: "opencode/glm-5.3-flash-free", small_model: "opencode/glm-5.3-flash-free",
    enabled_providers: ["opencode"], share: "disabled", autoupdate: false,
    compaction: { auto: false }, instructions: [], mcp: {} });
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  const inherited = { ...process.env, ...options.env };
  // Do not pass preview tokens, API credentials, Node preload options or user
  // OpenCode overrides to a model worker. Default production workers are unchanged.
  const base = strict ? Object.fromEntries(["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT"]
    .filter(key => typeof inherited[key] === "string").map(key => [key, inherited[key]])) : inherited;
  const cwd = strict ? path.join(dir, "workspace") : options.cwd;
  if (strict) mkdirSync(cwd, { mode: 0o700 });
  // Regular workers must retain OpenCode's existing data/state locations: OAuth
  // credentials are resolved through XDG_DATA_HOME (or its normal HOME default).
  // Isolating those paths breaks signed-in CLI runs, despite a successful probe.
  // Only the credential-free, tool-free preview uses private XDG directories.
  const env = { ...base, OPENCODE_CONFIG: configPath, PWD: String(cwd ?? process.cwd()),
    ...(strict ? { XDG_DATA_HOME: path.join(dir, "data"), XDG_STATE_HOME: path.join(dir, "state") } : {}) };
  if (strict) Object.assign(env, { XDG_CONFIG_HOME: path.join(dir, "config"), XDG_CACHE_HOME: path.join(dir, "cache"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1", CAREER_OPS_SINGLE_REQUEST: "1" });
  const runSync = options.spawnSyncFn ?? spawnSync;
  const probeTimeout = options.timeoutMs ?? (strict ? 45_000 : 10_000);
  if (strict) {
    const version = runSync(binPath, ["--version"], { cwd, env, encoding: "utf8", timeout: probeTimeout });
    if (version.error || version.status !== 0 || String(version.stdout).trim() !== "1.19.4") {
      rmSync(dir, { recursive: true, force: true });
      throw new Error("Single-request preview adapter is verified only for OpenCode 1.19.4.");
    }
  }
  const probe = runSync(binPath, ["debug", "agent", OPENCODE_READONLY_AGENT], {
    cwd,
    env,
    encoding: "utf8",
    timeout: probeTimeout,
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
    // OpenCode resolves its tool-output location from XDG_DATA_HOME, otherwise
    // from HOME/.local/share. Match that *exact* directory in the resolved
    // permission exception; never broaden external_directory access.
    const openCodeDataHome = env.XDG_DATA_HOME || path.join(env.HOME || homedir(), ".local", "share");
    assertResolvedOpenCodeAgentReadOnly(resolved, { capabilities: options.capabilities,
      toolOutputPattern: path.join(openCodeDataHome, "opencode", "tool-output", "*") });
    if (strict) {
      const model = resolved.model;
      if (model?.providerID !== "opencode" || model?.modelID !== "glm-5.3-flash-free")
        throw new Error("Resolved preview agent is not pinned to the approved free model.");
      const probeConfig = runSync(binPath, ["debug", "config"], { cwd, env, encoding: "utf8", timeout: probeTimeout });
      if (probeConfig.error || probeConfig.status !== 0) throw new Error("Preview config verification failed.");
      const final = JSON.parse(String(probeConfig.stdout));
      if (final.model !== config.model || final.small_model !== config.small_model || final.share !== "disabled"
          || final.compaction?.auto !== false || JSON.stringify(final.enabled_providers) !== '["opencode"]'
          || Object.keys(final.mcp ?? {}).length || (final.instructions ?? []).length
          || Object.keys(final.provider ?? {}).length || JSON.stringify(final.plugin) !== JSON.stringify(config.plugin))
        throw new Error("Unexpected provider, plugin, sharing or context settings in preview config.");
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    env,
    cwd,
    configPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function readOpenCodeConfigForTest(configPath) {
  return JSON.parse(readFileSync(configPath, "utf8"));
}
