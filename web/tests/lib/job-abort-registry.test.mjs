import test from "node:test";
import assert from "node:assert/strict";
import { createJobAbortRegistry } from "../../src/lib/job-abort-registry.mjs";

test("cancel aborts exactly the selected running job and is idempotent", () => {
  const registry = createJobAbortRegistry();
  const first = new AbortController();
  const second = new AbortController();
  registry.register("job-1", first);
  registry.register("job-2", second);

  assert.equal(registry.cancel("job-1"), true);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(registry.cancel("job-1"), false);
  assert.equal(second.signal.aborted, false);
});

test("registering a replacement aborts the orphaned controller", () => {
  const registry = createJobAbortRegistry();
  const stale = new AbortController();
  const current = new AbortController();

  registry.register("job-1", stale);
  registry.register("job-1", current);

  assert.equal(stale.signal.aborted, true);
  assert.equal(current.signal.aborted, false);
  assert.equal(registry.has("job-1"), true);
});

test("a stale completion cannot forget a replacement controller", () => {
  const registry = createJobAbortRegistry();
  const stale = new AbortController();
  const current = new AbortController();

  registry.register("job-1", stale);
  registry.register("job-1", current);
  registry.forget("job-1", stale);

  assert.equal(registry.has("job-1"), true);
  assert.equal(registry.cancel("job-1"), true);
  assert.equal(current.signal.aborted, true);
});

test("forget removes a completed job without aborting it", () => {
  const registry = createJobAbortRegistry();
  const controller = new AbortController();

  registry.register("job-1", controller);
  registry.forget("job-1", controller);

  assert.equal(registry.has("job-1"), false);
  assert.equal(controller.signal.aborted, false);
  assert.equal(registry.cancel("job-1"), false);
});
