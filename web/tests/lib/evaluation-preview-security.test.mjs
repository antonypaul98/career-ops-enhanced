import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkPreviewAccess, previewCompletion, reservePreviewAttempt,
} from "../../src/lib/evaluation-preview-security.mjs";

const secret = "f".repeat(64);
const args = {
  enabled: "1", configuredToken: secret, providedToken: secret,
  host: "127.0.0.1:3009", origin: null,
};

test("preview is disabled by default, even with a correct token", () => {
  const result = checkPreviewAccess({ ...args, enabled: undefined });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("missing/weak secret and missing/wrong request token fail closed", () => {
  for (const configuredToken of [undefined, "", "short", "abc def".repeat(8)]) {
    assert.equal(checkPreviewAccess({ ...args, configuredToken }).status, 503);
  }
  for (const providedToken of [null, undefined, "", "e".repeat(64), "a".repeat(4096)]) {
    assert.equal(checkPreviewAccess({ ...args, providedToken }).status, 401);
  }
  assert.equal(checkPreviewAccess(args).ok, true);
});

test("loopback host is an additional restriction, not a replacement for the secret", () => {
  for (const host of ["evil.example", "localhost.evil.example:3009",
    "10.0.0.1:3009", "127.0.0.2", "127.0.0.1@evil.example",
    "127.0.0.1/path", "[::1].example", "", null]) {
    assert.equal(checkPreviewAccess({ ...args, host }).status, 403, String(host));
  }
  assert.equal(checkPreviewAccess({ ...args, host: "localhost:3009" }).ok, true);
  assert.equal(checkPreviewAccess({ ...args, host: "[::1]:3009" }).ok, true);
  assert.equal(checkPreviewAccess({ ...args, host: "127.0.0.1:3009", providedToken: "" }).status, 401);
});

test("cross-site, opaque and mismatched browser origins are rejected", () => {
  for (const origin of ["https://evil.example", "null",
    "http://localhost:3009", "http://127.0.0.1:3010",
    "http://127.0.0.1:3009.evil.example", "http://127.0.0.1:3009/path"]) {
    assert.equal(checkPreviewAccess({ ...args, origin }).status, 403, origin);
  }
  assert.equal(checkPreviewAccess({ ...args, origin: "http://127.0.0.1:3009" }).ok, true);
});

test("one-attempt marker is exclusive, private and survives repeated reservations", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "career-ops-preview-security-test-"));
  const once = { directory, configuredToken: secret, root: "/isolated/career-ops",
    model: "opencode/glm-5.3-flash-free" };
  try {
    assert.deepEqual(reservePreviewAttempt(once), { reserved: true });
    assert.throws(() => reservePreviewAttempt(once), { code: "EEXIST" });
    // Changing the model or root cannot accidentally reuse a prior marker.
    assert.deepEqual(reservePreviewAttempt({ ...once, root: "/isolated/other-project" }), { reserved: true });
    assert.deepEqual(reservePreviewAttempt({ ...once, model: "another-free-model" }), { reserved: true });
    const files = readdirSync(directory);
    assert.equal(files.length, 3);
    for (const name of files) {
      assert.match(name, /^career-ops-report-preview-once-[a-f0-9]{64}\.lock$/);
      assert.ok(!name.includes(secret));
      const file = path.join(directory, name);
      assert.equal(readFileSync(file, "utf8"), "");
      if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed, cancelled, timed-out and incomplete model output cannot complete the preview", () => {
  const valid = { aborted: false, timedOut: false, failed: false, exitCode: 0,
    envelope: { ok: true, reportMarkdown: "complete" } };
  assert.equal(previewCompletion(valid).ok, true);
  for (const updates of [
    { aborted: true }, { timedOut: true }, { failed: true },
    { exitCode: 1 }, { exitCode: null }, { envelope: { ok: false } },
    { envelope: undefined },
  ]) {
    assert.equal(previewCompletion({ ...valid, ...updates }).ok, false);
  }
});
