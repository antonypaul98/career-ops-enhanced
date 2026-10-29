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

test("a child closing first cannot cancel escalation for a surviving grandchild", { skip: process.platform === "win32" }, async t => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const grandchildCode = 'process.on("SIGTERM",()=>{});process.send("ready");process.disconnect();setInterval(()=>{},1000)';
  const parentCode = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',()=>console.log(c.pid));setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ["-e", parentCode], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => { try { process.kill(-parent.pid, "SIGKILL"); } catch {} });
  const [chunk] = await once(parent.stdout, "data");
  const descendant = Number(String(chunk).trim());
  const stopper = createProcessTreeStopper(parent, { graceMs: 100 });
  parent.once("close", stopper.settled);
  const closed = once(parent, "close");
  stopper.stop();
  await closed;
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
});
