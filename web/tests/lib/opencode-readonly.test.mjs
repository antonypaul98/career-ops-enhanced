import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { assertResolvedOpenCodeAgentReadOnly, prepareOpenCodeReadOnlyLaunch, readOpenCodeConfigForTest } from "../../src/lib/opencode-readonly.mjs";
import { fenceOpenCodeArgs } from "../../src/lib/opencode-fencing.mjs";
import { CAPS } from "../../src/lib/worker-capabilities.mjs";

test("OpenCode read-only argv binds the dedicated agent and refuses writers", () => {
  assert.deepEqual(fenceOpenCodeArgs(["run", "PROMPT"], CAPS.networkReadOnly), ["run", "--agent", "career-ops-readonly", "PROMPT"]);
  assert.throws(() => fenceOpenCodeArgs(["run", "PROMPT"], CAPS.workspaceWrite), /read-only/);
});

test("resolved permissions must explicitly deny every mutation path", () => {
  const permission = { "*": "deny", read: "allow", grep: "allow", glob: "allow", list: "allow", webfetch: "allow", websearch: "allow", edit: "deny", patch: "deny", bash: "deny", external_directory: "deny", task: "deny", todowrite: "deny", lsp: "deny", skill: "deny" };
  assert.equal(assertResolvedOpenCodeAgentReadOnly({ permission }), true);
  assert.throws(() => assertResolvedOpenCodeAgentReadOnly({ permission: { ...permission, bash: "allow" } }), /bash/);
});

test("per-run config leaves global config untouched and is removed after use", () => {
  let seen;
  const launch = prepareOpenCodeReadOnlyLaunch("/fake/opencode", {
    spawnSyncFn(bin, args, options) {
      seen = { bin, args, options };
      const config = readOpenCodeConfigForTest(options.env.OPENCODE_CONFIG);
      return { status: 0, stdout: JSON.stringify(config.agent["career-ops-readonly"]), stderr: "" };
    },
  });
  assert.equal(seen.bin, "/fake/opencode");
  assert.deepEqual(seen.args, ["debug", "agent", "career-ops-readonly"]);
  assert.equal(existsSync(launch.configPath), true);
  launch.cleanup();
  assert.equal(existsSync(launch.configPath), false);
});


test("1.19 ordered rules reject later mutation exceptions and honor worker network scope", () => {
  const rule = (permission, action, pattern = "*") => ({ permission, action, pattern });
  const rules = [rule("*", "allow"), rule("edit", "allow", "src/*"), rule("*", "deny"),
    ...["read", "grep", "glob", "list", "webfetch", "websearch"].map(k => rule(k, "allow"))];
  assert.equal(assertResolvedOpenCodeAgentReadOnly({ permission: rules }), true);
  assert.throws(() => assertResolvedOpenCodeAgentReadOnly({ permission: [...rules, rule("bash", "allow", "echo *")] }), /exception/);
  assert.throws(() => assertResolvedOpenCodeAgentReadOnly({ permission: [...rules, rule("external_directory", "allow", "/home/*")] }), /exception/);
  assert.throws(() => assertResolvedOpenCodeAgentReadOnly({ permission: rules }, { capabilities: CAPS.localReadOnly }), /webfetch/);
  const local = [...rules, rule("webfetch", "deny"), rule("websearch", "deny")];
  assert.equal(assertResolvedOpenCodeAgentReadOnly({ permission: local }, { capabilities: CAPS.localReadOnly }), true);
});

test("a refused resolved agent removes its private temporary config", () => {
  let configPath;
  assert.throws(() => prepareOpenCodeReadOnlyLaunch("/fake/opencode", { spawnSyncFn(_bin, _args, options) {
    configPath = options.env.OPENCODE_CONFIG;
    return { status: 0, stdout: JSON.stringify({ permission: { "*": "allow" } }) };
  } }), /refusing/);
  assert.equal(existsSync(configPath), false);
});

test('quota observer is temporary and enabled only for structured dashboard runs', () => {
  const probe = (_bin, _args, options) => {
    const config = readOpenCodeConfigForTest(options.env.OPENCODE_CONFIG);
    return {status:0,stdout:JSON.stringify(config.agent['career-ops-readonly'])};
  };
  const plain = prepareOpenCodeReadOnlyLaunch('/fake/opencode',{spawnSyncFn:probe});
  const stream = prepareOpenCodeReadOnlyLaunch('/fake/opencode',{spawnSyncFn:probe,streaming:true});
  try {
    assert.equal(readOpenCodeConfigForTest(plain.configPath).plugin,undefined);
    const plugins=readOpenCodeConfigForTest(stream.configPath).plugin;
    assert.equal(plugins.length,1); assert.equal(new URL(plugins[0]).protocol,'file:');
    assert.equal(existsSync(new URL(plugins[0])),true);
    stream.cleanup(); assert.equal(existsSync(new URL(plugins[0])),false);
  } finally {plain.cleanup();stream.cleanup();}
});

test("normal OpenCode workers preserve the XDG credential and state locations", () => {
  const originalData = "/existing-user-xdg-data";
  const originalState = "/existing-user-xdg-state";
  const originalConfig = "/existing-user-global-config.jsonc";
  const launch = prepareOpenCodeReadOnlyLaunch("/fake/opencode", {
    env: { XDG_DATA_HOME: originalData, XDG_STATE_HOME: originalState, OPENCODE_CONFIG: originalConfig },
    capabilities: CAPS.networkReadOnly,
    spawnSyncFn(_bin, args, options) {
      assert.deepEqual(args, ["debug", "agent", "career-ops-readonly"]);
      assert.equal(options.env.XDG_DATA_HOME, originalData);
      assert.equal(options.env.XDG_STATE_HOME, originalState);
      const privateConfig = readOpenCodeConfigForTest(options.env.OPENCODE_CONFIG);
      assert.equal(privateConfig.agent["career-ops-readonly"].permission.bash, "deny");
      assert.equal(privateConfig.agent["career-ops-readonly"].permission.edit, "deny");
      return { status: 0, stdout: JSON.stringify(privateConfig.agent["career-ops-readonly"]) };
    },
  });
  try {
    assert.equal(launch.env.XDG_DATA_HOME, originalData);
    assert.equal(launch.env.XDG_STATE_HOME, originalState);
    assert.notEqual(launch.env.OPENCODE_CONFIG, originalConfig, "per-run restrictions still override the user's config");
  } finally {
    launch.cleanup();
  }
});

test("normal OpenCode runs retain the HOME-based credential fallback when XDG is unset", () => {
  const launch = prepareOpenCodeReadOnlyLaunch("/fake/opencode", {
    env: { XDG_DATA_HOME: undefined, XDG_STATE_HOME: undefined },
    capabilities: CAPS.networkReadOnly,
    spawnSyncFn(_bin, _args, options) {
      const config = readOpenCodeConfigForTest(options.env.OPENCODE_CONFIG);
      return { status: 0, stdout: JSON.stringify(config.agent["career-ops-readonly"]) };
    },
  });
  try {
    assert.equal(launch.env.XDG_DATA_HOME, undefined);
    assert.equal(launch.env.XDG_STATE_HOME, undefined);
  } finally {
    launch.cleanup();
  }
});

test("tool-free preview still isolates OpenCode OAuth data and state directories", () => {
  const userData = "/existing-user-xdg-data";
  const userState = "/existing-user-xdg-state";
  const launch = prepareOpenCodeReadOnlyLaunch("/fake/opencode", {
    env: { XDG_DATA_HOME: userData, XDG_STATE_HOME: userState },
    capabilities: { writes: false, network: false, tools: false },
    spawnSyncFn(_bin, args, options) {
      const config = readOpenCodeConfigForTest(options.env.OPENCODE_CONFIG);
      if (args[0] === "--version") return { status: 0, stdout: "1.19.4\n" };
      if (args[1] === "agent") {
        return { status: 0, stdout: JSON.stringify({
          ...config.agent["career-ops-readonly"],
          model: { providerID: "opencode", modelID: "glm-5.3-flash-free" },
        }) };
      }
      if (args[1] === "config") return { status: 0, stdout: JSON.stringify(config) };
      throw new Error("Unexpected preview verification command");
    },
  });
  try {
    assert.notEqual(launch.env.XDG_DATA_HOME, userData);
    assert.notEqual(launch.env.XDG_STATE_HOME, userState);
    assert.ok(launch.env.XDG_DATA_HOME.startsWith(launch.configPath.slice(0, -"/opencode.json".length)));
    assert.equal(launch.env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
    assert.equal(launch.env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "1");
    assert.equal(launch.env.CAREER_OPS_SINGLE_REQUEST, "1");
  } finally {
    launch.cleanup();
  }
});
