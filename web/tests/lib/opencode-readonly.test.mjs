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
  const permission = { "*": "deny", read: "allow", grep: "allow", glob: "allow", list: "allow", webfetch: "allow", edit: "deny", patch: "deny", bash: "deny", external_directory: "deny", task: "deny", todowrite: "deny", lsp: "deny", skill: "deny" };
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
