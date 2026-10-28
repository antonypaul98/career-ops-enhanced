import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = readFileSync(new URL("../../src/components/jobs/job-store.tsx", import.meta.url), "utf8");
const pills = readFileSync(new URL("../../src/components/jobs/worker-pills.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../../src/app/api/run/route.ts", import.meta.url), "utf8");

test("running job cancellation aborts the fetch that owns the server stream", () => {
  assert.match(store, /createJobAbortRegistry\(\)/);
  assert.match(store, /signal:\s*controller\.signal/);
  assert.match(store, /aborts\.current\.cancel\(id\)/);
  assert.match(store, /Cancelled by user/);
});

test("the worker affordance cancels running jobs and only dismisses settled jobs", () => {
  assert.match(pills, /j\.status === "running"\) cancelJob\(j\.id\)/);
  assert.match(pills, /else removeJob\(j\.id\)/);
  assert.match(pills, /Cancel running job/);
});

test("request-stream cancellation terminates the spawned CLI", () => {
  const cancel = route.slice(route.indexOf("cancel() {"));
  assert.notEqual(cancel.indexOf("cancel() {"), -1);
  assert.match(cancel, /runAbort\.abort\(\)/);
  assert.match(cancel, /childStopper\.stop\(\)/);
});
