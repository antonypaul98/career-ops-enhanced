import { test } from "node:test";
import assert from "node:assert/strict";
import { createProcessTreeStopper } from "../../src/lib/process-tree.mjs";
import { EventEmitter, once } from "node:events";
import { spawn, execFileSync } from "node:child_process";

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

test("short-lived controller awaits escalation after its leader exits", { skip: process.platform === "win32" }, async t => {
  const stopperUrl = new URL('../../src/lib/process-tree.mjs', import.meta.url).href;
  const grandchildCode = 'process.on("SIGTERM",()=>{});process.send("ready");process.disconnect();setInterval(()=>{},1000)';
  const leaderCode = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',()=>console.log(c.pid));setInterval(()=>{},1000);`;
  const script = `import {spawn} from 'node:child_process';import {once} from 'node:events';import {createProcessTreeStopper} from ${JSON.stringify(stopperUrl)};
    const leader=spawn(process.execPath,['-e',${JSON.stringify(leaderCode)}],{stdio:['ignore','pipe','ignore'],detached:true});
    const [data]=await once(leader.stdout,'data');console.log(JSON.stringify({leader:leader.pid,grandchild:Number(data.toString())}));
    const stopper=createProcessTreeStopper(leader,{graceMs:100});const closed=once(leader,'close');
    stopper.stop();await closed;stopper.settled();await stopper.waitForStop();`;
  const controller = spawn(process.execPath, ['--input-type=module','-e',script], { stdio: ['ignore','pipe','pipe'] });
  let stderr='';controller.stderr.on('data',data=>{stderr+=data;});
  const closed=once(controller,'close');
  const [data]=await once(controller.stdout,'data');
  const pids=JSON.parse(data.toString());
  t.after(()=>{try {process.kill(-pids.leader,'SIGKILL');} catch {}});
  const [code]=await closed;assert.equal(code,0,stderr);
  // A container's init may briefly retain a dead orphan as a zombie. It cannot
  // execute or retain external activity; fail only if a live process remains.
  let running=true;
  for(let attempt=0;attempt<20;attempt++) {
    try {
      process.kill(pids.grandchild,0);
      const state=execFileSync('ps',['-o','stat=','-p',String(pids.grandchild)],{encoding:'utf8'}).trim();
      if(!state || state.startsWith('Z')) {running=false;break;}
    } catch(error) {if(error.code==='ESRCH'||error.status===1) {running=false;break;}throw error;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(running,false,'resistant descendant survived controller completion');
});

test("awaited cleanup preserves the stop boolean API and confirms group signalling", async () => {
  const signals=[];
  const stopper=createProcessTreeStopper({pid:99,kill(){}},{platform:'darwin',graceMs:5,killFn:(pid,signal)=>signals.push([pid,signal])});
  assert.equal(stopper.stop(),true);assert.equal(stopper.stop(),false);
  await stopper.waitForStop();
  assert.deepEqual(signals,[[-99,'SIGTERM'],[-99,'SIGKILL']]);
});

test("awaited cleanup rejects when the group cannot be signalled", async () => {
  const stopper=createProcessTreeStopper({pid:99,kill(){}},{platform:'darwin',graceMs:5,killFn(){throw Object.assign(new Error('denied'),{code:'EPERM'});}});
  stopper.stop();await assert.rejects(stopper.waitForStop(),/not confirmed/);
});

test("awaited Windows cleanup waits for successful taskkill", async () => {
  const killer=new EventEmitter();killer.unref=()=>{};killer.ref=()=>{};
  const stopper=createProcessTreeStopper({pid:99,kill(){}},{platform:'win32',spawnFn:()=>killer});
  stopper.stop();let completed=false;
  const wait=stopper.waitForStop().then(()=>{completed=true;});
  assert.equal(completed,false);killer.emit('close',0);await wait;assert.equal(completed,true);
});

test("awaited Windows cleanup fails closed on helper failure or timeout", async () => {
  for(const failure of ['error','exit','timeout']) {
    const killer=new EventEmitter();killer.unref=()=>{};killer.ref=()=>{};killer.kill=()=>{};
    const stopper=createProcessTreeStopper({pid:99,kill(){}},{platform:'win32',spawnFn:()=>killer,waitTimeoutMs:5});
    stopper.stop();const wait=stopper.waitForStop();
    if(failure==='error')killer.emit('error',new Error('missing taskkill'));
    if(failure==='exit')killer.emit('close',1);
    await assert.rejects(wait,/cleanup/);
  }
});
