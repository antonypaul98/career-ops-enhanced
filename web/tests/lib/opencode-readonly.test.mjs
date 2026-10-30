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
