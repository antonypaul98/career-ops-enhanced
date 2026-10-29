import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyMaterializationError, preflightMaterialized } from "../../src/lib/materialization-preflight.mjs";

test("samples materialized files without changing them", () => {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-preflight-"));
  writeFileSync(path.join(root, "mode.md"), "ready");
  assert.deepEqual(preflightMaterialized(root, ["mode.md"]), { ok: true });
});

test("missing required files fail safely and optional files may be absent", () => {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-preflight-"));
  assert.equal(preflightMaterialized(root, [{ path: "optional", required: false }]).ok, true);
  assert.equal(preflightMaterialized(root, ["required"]).ok, false);
  assert.match(classifyMaterializationError({ code: "ETIMEDOUT" }, "fixture"), /available offline/);
});


test("Mac files with no local blocks pause before attempting to read", { skip: process.platform !== "darwin" }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-dataless-"));
  const file = path.join(root, "placeholder");
  writeFileSync(file, ""); truncateSync(file, 4096);
  const result = preflightMaterialized(root, ["placeholder"]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ENODATA");
});
