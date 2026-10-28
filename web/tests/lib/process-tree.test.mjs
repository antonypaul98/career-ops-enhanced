import { test } from "node:test";
import assert from "node:assert/strict";
import { createProcessTreeStopper } from "../../src/lib/process-tree.mjs";

test("POSIX cancellation targets the process group once and can be settled", () => {
  const signals = [];
  const child = { pid: 42, kill() { throw new Error("fallback should not run"); } };
  const stopper = createProcessTreeStopper(child, { platform: "darwin", killFn(pid, signal) { signals.push([pid, signal]); }, graceMs: 60_000 });
  assert.equal(stopper.stop(), true);
  assert.equal(stopper.stop(), false);
  stopper.settled();
  assert.deepEqual(signals, [[-42, "SIGTERM"]]);
});

test("Windows cancellation uses taskkill tree mode exactly once", () => {
  const calls = [];
  const child = { pid: 43, kill() { calls.push(["fallback"]); } };
  const stopper = createProcessTreeStopper(child, { platform: "win32", spawnFn(bin, args) { calls.push([bin, args]); return { unref() {} }; } });
  stopper.stop();
  stopper.stop();
  assert.deepEqual(calls, [["taskkill", ["/PID", "43", "/T", "/F"]]]);
});
